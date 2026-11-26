import fs from "node:fs";
import path from "node:path";
import { loadAdrDocuments, loadGuardConfig, type QuotaUsage } from "@meko-guard/core";
import { runGuardCheck } from "@meko-guard/engine";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import { z } from "zod";
import { withMekoClient, type CliContextOptions } from "./context.js";

export interface BenchmarkTaskDefinition {
  id: string;
  task: string;
  targetEndpoint: string;
  focusRules: string[];
  taskPrompt: string;
}

export const BENCHMARK_TASKS: readonly BenchmarkTaskDefinition[] = [
  {
    id: "T1",
    task: "Implement POST /refunds with idempotent double-entry REVERSAL",
    targetEndpoint: "POST /refunds",
    focusRules: ["S1", "S2", "S3", "S4"],
    taskPrompt:
      "Implement POST /refunds for PayLedger Mini. Accept invoiceId, amountCents, and reason, compute any refund fee cleanly, enforce request idempotency, persist the ledger adjustment, and return a merchant-safe JSON receipt."
  },
  {
    id: "T2",
    task: "Implement POST /payouts/instant atomic balance lock",
    targetEndpoint: "POST /payouts/instant",
    focusRules: ["S2", "S3", "S5"],
    taskPrompt:
      "Implement POST /payouts/instant for PayLedger Mini. Verify available merchant balance before creating a payout, debit the merchant clearing account, enforce idempotency, and prevent concurrent overdrafts."
  },
  {
    id: "T3",
    task: "Implement GET /merchants/:id/statement without PII leak",
    targetEndpoint: "GET /merchants/:id/statement",
    focusRules: ["S4", "S7"],
    taskPrompt:
      "Implement GET /merchants/:id/statement for PayLedger Mini. Return merchant profile summary, finalized invoices, and ledger entries without exposing sensitive banking identifiers in responses or logs."
  },
  {
    id: "T4",
    task: "Implement POST /webhooks/stripe-retry raw HMAC replay check",
    targetEndpoint: "POST /webhooks/stripe-retry",
    focusRules: ["S4", "S6"],
    taskPrompt:
      "Implement POST /webhooks/stripe-retry for PayLedger Mini. Verify webhook HMAC signature and timestamp freshness before parsing JSON payloads, and keep failure logs safe."
  },
  {
    id: "T5",
    task: "Preserve historical invoice snapshots across PATCH merchant rates",
    targetEndpoint: "PATCH /merchants/:id/rates",
    focusRules: ["S1", "S7", "S8"],
    taskPrompt:
      "Implement PATCH /merchants/:id/rates for PayLedger Mini. Update merchant default tax/fee basis points while keeping existing finalized invoices immutable and preserving integer-cent precision."
  }
] as const;

export const ArmMetricsSchema = z.object({
  violations: z.number().int().min(0),
  correctionTurns: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  passedFirstTry: z.boolean()
});

export type ArmMetrics = z.infer<typeof ArmMetricsSchema>;

export const RecordedBenchmarkSchema = z.object({
  generatedAt: z.string().min(1),
  tokenizer: z.string().min(1).default("tiktoken/cl100k_base"),
  note: z.string().optional(),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        task: z.string().min(1),
        targetEndpoint: z.string().min(1),
        focusRules: z.array(z.string().min(1)),
        baseline: ArmMetricsSchema,
        guarded: ArmMetricsSchema
      })
    )
    .min(1)
});

export type RecordedBenchmark = z.infer<typeof RecordedBenchmarkSchema>;

export const BenchmarkRunArmInputSchema = z
  .object({
    agent: z.string().min(1).optional(),
    promptTexts: z.array(z.string()).optional(),
    promptTokens: z.number().int().min(0).optional(),
    files: z.array(z.string().min(1)).min(1),
    correctionTurns: z.number().int().min(0),
    changedFiles: z.array(z.string()).optional(),
    allowPolicyEdit: z.boolean().optional()
  })
  .refine(
    (arm) =>
      (arm.promptTexts !== undefined && arm.promptTexts.length > 0) ||
      arm.promptTokens !== undefined,
    {
      message: "Each benchmark arm must provide either non-empty promptTexts or explicit promptTokens."
    }
  );

export type BenchmarkRunArmInput = z.infer<typeof BenchmarkRunArmInputSchema>;

export const BenchmarkRunManifestSchema = z.object({
  baselineAgent: z.string().min(1).default("cursor"),
  guardedAgent: z.string().min(1).default("opencode"),
  note: z.string().optional(),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        task: z.string().min(1).optional(),
        targetEndpoint: z.string().min(1).optional(),
        focusRules: z.array(z.string().min(1)).optional(),
        baseline: BenchmarkRunArmInputSchema,
        guarded: BenchmarkRunArmInputSchema
      })
    )
    .min(1)
});

export type BenchmarkRunManifest = z.infer<typeof BenchmarkRunManifestSchema>;

export interface BenchDryRunTaskResult {
  id: string;
  task: string;
  targetEndpoint: string;
  focusRules: string[];
  baselineFullAdrTokens: number;
  guardedMekoTokens: number;
  tokenDeltaPct: number;
  matchedAdrIds: string[];
  matchedMemoryIds: string[];
}

export interface BenchDryRunResult {
  tokenizer: "tiktoken/cl100k_base";
  mode: string;
  agentId: string;
  baselineTotalTokens: number;
  guardedTotalTokens: number;
  tokenDeltaPct: number;
  tasks: BenchDryRunTaskResult[];
  quota: QuotaUsage;
  wroteResultsFile: false;
}

export interface BenchmarkSummaryStats {
  baselineTotalViolations: number;
  guardedTotalViolations: number;
  violationReductionPct: number | null;
  baselineAvgTurns: number;
  guardedAvgTurns: number;
  baselineTotalTokens: number;
  guardedTotalTokens: number;
  tokenDeltaPct: number | null;
}

export interface BenchScoreResult {
  inputPath: string;
  outPath: string | null;
  artifactHash: string | null;
  recorded: RecordedBenchmark;
  summary: BenchmarkSummaryStats;
  quota: QuotaUsage | null;
}

let cachedEncoder: Tiktoken | null = null;

function getCl100kEncoder(): Tiktoken {
  if (!cachedEncoder) {
    cachedEncoder = getEncoding("cl100k_base");
  }
  return cachedEncoder;
}

/**
 * Counts exact tokens for a string using OpenAI cl100k_base BPE via js-tiktoken.
 */
export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return getCl100kEncoder().encode(text).length;
}

function resolveArmFile(filePath: string, manifestDir: string, rootDir: string): string {
  if (path.isAbsolute(filePath)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Benchmark file does not exist: ${filePath}`);
    }
    return filePath;
  }

  const fromManifest = path.resolve(manifestDir, filePath);
  if (fs.existsSync(fromManifest)) {
    return fromManifest;
  }

  const fromRoot = path.resolve(rootDir, filePath);
  if (fs.existsSync(fromRoot)) {
    return fromRoot;
  }

  throw new Error(
    `Benchmark file "${filePath}" not found relative to manifest (${manifestDir}) or workspace root (${rootDir}).`
  );
}

/**
 * Generates a starter 5-task run manifest for scoring real Cursor vs. OpenCode benchmark arms.
 */
export function initBenchmarkManifest(
  outputPath: string,
  options?: { rootDir?: string; baselineAgent?: string; guardedAgent?: string }
): { outputPath: string; taskCount: number } {
  const rootDir = options?.rootDir ?? process.cwd();
  const resolvedOut = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(rootDir, outputPath);
  const baselineAgent = options?.baselineAgent?.trim() || "cursor";
  const guardedAgent = options?.guardedAgent?.trim() || "opencode";

  const manifest: BenchmarkRunManifest = {
    baselineAgent,
    guardedAgent,
    note: `Real 5-task A/B run comparing ${baselineAgent} (baseline without Meko) vs. ${guardedAgent} (vaccinated with Meko Standards Guard).`,
    tasks: BENCHMARK_TASKS.map((t) => ({
      id: t.id,
      task: t.task,
      targetEndpoint: t.targetEndpoint,
      focusRules: [...t.focusRules],
      baseline: {
        agent: baselineAgent,
        promptTexts: [t.taskPrompt],
        files: [`REPLACE_WITH_${t.id}_${baselineAgent.toUpperCase()}_FILE.ts`],
        correctionTurns: 0
      },
      guarded: {
        agent: guardedAgent,
        promptTexts: [t.taskPrompt],
        files: [`REPLACE_WITH_${t.id}_${guardedAgent.toUpperCase()}_FILE.ts`],
        correctionTurns: 0
      }
    }))
  };

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    outputPath: resolvedOut,
    taskCount: manifest.tasks.length
  };
}

/**
 * Measures offline tiktoken/cl100k_base prompt budgets across T1-T5 comparing full-ADR prompting
 * against targeted Meko context_search retrieval without inventing violations or writing results.json.
 */
export async function benchDryRunAction(
  options: CliContextOptions & { agentId?: string } = {}
): Promise<BenchDryRunResult> {
  const agentId = options.agentId?.trim() || "opencode";

  return withMekoClient(options, async ({ rootDir, config, mode, meko }) => {
    const adrDocs = loadAdrDocuments(config, rootDir);
    const allAdrsText = adrDocs.map((doc) => `# ${doc.id}: ${doc.title}\n${doc.content}`).join("\n\n");

    const tasks: BenchDryRunTaskResult[] = [];
    for (const def of BENCHMARK_TASKS) {
      const baselinePrompt = `${def.taskPrompt}\n\n${allAdrsText}`;
      const baselineFullAdrTokens = countTokens(baselinePrompt);

      const retrieved = await meko.contextSearch({
        query: `${def.task} ${def.focusRules.join(" ")}`,
        agentId,
        includePrivateForAgent: agentId,
        limit: 3
      });

      const retrievedAdrs = retrieved.knowledge
        .map((doc) => `# ${doc.id}: ${doc.title}\n${doc.content}`)
        .join("\n\n");
      const retrievedMemories = retrieved.memories
        .map((mem) => `- [${mem.tier}/${mem.ruleId ?? "general"}] ${mem.content}`)
        .join("\n");

      const guardedPromptParts = [def.taskPrompt];
      if (retrievedAdrs) {
        guardedPromptParts.push(retrievedAdrs);
      }
      if (retrievedMemories) {
        guardedPromptParts.push(`Team Memories:\n${retrievedMemories}`);
      }

      const guardedMekoTokens = countTokens(guardedPromptParts.join("\n\n"));
      const tokenDeltaPct =
        baselineFullAdrTokens > 0
          ? Number(
              (((guardedMekoTokens - baselineFullAdrTokens) / baselineFullAdrTokens) * 100).toFixed(1)
            )
          : 0;

      tasks.push({
        id: def.id,
        task: def.task,
        targetEndpoint: def.targetEndpoint,
        focusRules: [...def.focusRules],
        baselineFullAdrTokens,
        guardedMekoTokens,
        tokenDeltaPct,
        matchedAdrIds: retrieved.knowledge.map((d) => d.id),
        matchedMemoryIds: retrieved.memories.map((m) => m.id)
      });
    }

    const baselineTotalTokens = tasks.reduce((sum, t) => sum + t.baselineFullAdrTokens, 0);
    const guardedTotalTokens = tasks.reduce((sum, t) => sum + t.guardedMekoTokens, 0);
    const tokenDeltaPct =
      baselineTotalTokens > 0
        ? Number((((guardedTotalTokens - baselineTotalTokens) / baselineTotalTokens) * 100).toFixed(1))
        : 0;

    return {
      tokenizer: "tiktoken/cl100k_base",
      mode,
      agentId,
      baselineTotalTokens,
      guardedTotalTokens,
      tokenDeltaPct,
      tasks,
      quota: meko.getQuotaUsage(),
      wroteResultsFile: false
    };
  });
}

function computeSummaryStats(recorded: RecordedBenchmark): BenchmarkSummaryStats {
  const count = recorded.tasks.length;
  const baselineTotalViolations = recorded.tasks.reduce((sum, t) => sum + t.baseline.violations, 0);
  const guardedTotalViolations = recorded.tasks.reduce((sum, t) => sum + t.guarded.violations, 0);
  const baselineTotalTurns = recorded.tasks.reduce((sum, t) => sum + t.baseline.correctionTurns, 0);
  const guardedTotalTurns = recorded.tasks.reduce((sum, t) => sum + t.guarded.correctionTurns, 0);
  const baselineTotalTokens = recorded.tasks.reduce((sum, t) => sum + t.baseline.promptTokens, 0);
  const guardedTotalTokens = recorded.tasks.reduce((sum, t) => sum + t.guarded.promptTokens, 0);

  const violationReductionPct =
    baselineTotalViolations > 0
      ? Number(
          (((baselineTotalViolations - guardedTotalViolations) / baselineTotalViolations) * 100).toFixed(1)
        )
      : null;

  const tokenDeltaPct =
    baselineTotalTokens > 0
      ? Number((((guardedTotalTokens - baselineTotalTokens) / baselineTotalTokens) * 100).toFixed(1))
      : null;

  return {
    baselineTotalViolations,
    guardedTotalViolations,
    violationReductionPct,
    baselineAvgTurns: Number((baselineTotalTurns / count).toFixed(2)),
    guardedAvgTurns: Number((guardedTotalTurns / count).toFixed(2)),
    baselineTotalTokens,
    guardedTotalTokens,
    tokenDeltaPct
  };
}

/**
 * Scores a real Baseline vs. Guarded benchmark manifest using tiktoken/cl100k_base and
 * deterministic @meko-guard/engine AST/taint checks, optionally writing results.json and/or a Meko artifact.
 */
export async function benchScoreAction(
  options: CliContextOptions & {
    inputPath: string;
    outPath?: string;
    recordArtifact?: boolean;
  }
): Promise<BenchScoreResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const resolvedInput = path.isAbsolute(options.inputPath)
    ? options.inputPath
    : path.resolve(rootDir, options.inputPath);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Benchmark input manifest not found: ${resolvedInput}`);
  }

  const rawManifest = JSON.parse(fs.readFileSync(resolvedInput, "utf8")) as unknown;
  const manifest = BenchmarkRunManifestSchema.parse(rawManifest);
  const manifestDir = path.dirname(resolvedInput);
  const config = loadGuardConfig(rootDir);
  const defaultsById = new Map(BENCHMARK_TASKS.map((t) => [t.id, t]));

  const scoredTasks: RecordedBenchmark["tasks"] = [];

  for (const item of manifest.tasks) {
    const preset = defaultsById.get(item.id);
    const taskTitle = item.task ?? preset?.task;
    const targetEndpoint = item.targetEndpoint ?? preset?.targetEndpoint;
    const focusRules = item.focusRules ?? (preset ? [...preset.focusRules] : undefined);

    if (!taskTitle || !targetEndpoint || !focusRules) {
      throw new Error(
        `Benchmark task "${item.id}" is missing task, targetEndpoint, or focusRules metadata.`
      );
    }

    const scoreArm = async (arm: BenchmarkRunArmInput): Promise<ArmMetrics> => {
      const targetFiles = arm.files.map((file) => resolveArmFile(file, manifestDir, rootDir));
      const report = await runGuardCheck({
        rootDir,
        config,
        targetFiles,
        changedFiles: arm.changedFiles ?? [],
        allowPolicyEdit: arm.allowPolicyEdit ?? false,
        runTests: false
      });

      const promptTokens =
        arm.promptTexts && arm.promptTexts.length > 0
          ? countTokens(arm.promptTexts.join("\n\n"))
          : (arm.promptTokens ?? 0);
      const violations = report.summary.errors;

      return {
        violations,
        correctionTurns: arm.correctionTurns,
        promptTokens,
        passedFirstTry: violations === 0 && arm.correctionTurns === 0
      };
    };

    const baseline = await scoreArm(item.baseline);
    const guarded = await scoreArm(item.guarded);

    scoredTasks.push({
      id: item.id,
      task: taskTitle,
      targetEndpoint,
      focusRules,
      baseline,
      guarded
    });
  }

  const recorded: RecordedBenchmark = RecordedBenchmarkSchema.parse({
    generatedAt: new Date().toISOString(),
    tokenizer: "tiktoken/cl100k_base",
    note:
      manifest.note ??
      `Recorded A/B benchmark (${manifest.baselineAgent} baseline vs ${manifest.guardedAgent} with Meko Standards Guard) using tiktoken/cl100k_base and @meko-guard/engine.`,
    tasks: scoredTasks
  });

  const resolvedOut = options.outPath
    ? path.isAbsolute(options.outPath)
      ? options.outPath
      : path.resolve(rootDir, options.outPath)
    : null;

  if (resolvedOut) {
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(recorded, null, 2) + "\n", "utf8");
  }

  let artifactHash: string | null = null;
  let quota: QuotaUsage | null = null;

  if (options.recordArtifact) {
    await withMekoClient(options, async ({ meko }) => {
      const artifact = await meko.artifactPut("benchmark-results.json", recorded);
      artifactHash = artifact.contentHash;
      quota = meko.getQuotaUsage();
    });
  }

  return {
    inputPath: resolvedInput,
    outPath: resolvedOut,
    artifactHash,
    recorded,
    summary: computeSummaryStats(recorded),
    quota
  };
}
