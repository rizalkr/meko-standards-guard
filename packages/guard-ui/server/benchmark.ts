import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { BenchmarkReport, BenchmarkTaskRow } from "./types.js";

const ArmMetricsSchema = z.object({
  violations: z.number().int().min(0),
  correctionTurns: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  passedFirstTry: z.boolean()
});

const RecordedBenchmarkSchema = z.object({
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

const TEMPLATE_TASKS: BenchmarkTaskRow[] = [
  {
    id: "T1",
    task: "Implement POST /refunds with idempotent double-entry REVERSAL",
    targetEndpoint: "POST /refunds",
    focusRules: ["S1", "S2", "S3", "S4"],
    status: "pending",
    baseline: null,
    guarded: null
  },
  {
    id: "T2",
    task: "Implement POST /payouts/instant atomic balance lock",
    targetEndpoint: "POST /payouts/instant",
    focusRules: ["S2", "S3", "S5"],
    status: "pending",
    baseline: null,
    guarded: null
  },
  {
    id: "T3",
    task: "Implement GET /merchants/:id/statement without PII leak",
    targetEndpoint: "GET /merchants/:id/statement",
    focusRules: ["S4", "S7"],
    status: "pending",
    baseline: null,
    guarded: null
  },
  {
    id: "T4",
    task: "Implement POST /webhooks/stripe-retry raw HMAC replay check",
    targetEndpoint: "POST /webhooks/stripe-retry",
    focusRules: ["S4", "S6"],
    status: "pending",
    baseline: null,
    guarded: null
  },
  {
    id: "T5",
    task: "Preserve historical invoice snapshots across PATCH merchant rates",
    targetEndpoint: "PATCH /merchants/:id/rates",
    focusRules: ["S1", "S7", "S8"],
    status: "pending",
    baseline: null,
    guarded: null
  }
];

/**
 * Loads recorded A/B benchmark results from fixtures/benchmark/results.json when available,
 * or returns an honest pending template for the 5 planned PayLedger benchmark tasks.
 */
export function loadBenchmarkReport(rootDir: string): BenchmarkReport {
  const resultsPath = path.join(rootDir, "fixtures", "benchmark", "results.json");
  if (!fs.existsSync(resultsPath)) {
    return {
      source: "preview_template",
      generatedAt: null,
      tokenizer: "tiktoken (pending Week 6 run)",
      note: "Awaiting Week 6 live 5-task A/B run (Baseline without Meko vs Standards Guard with Meko). Showing target PayLedger evaluation matrix with zero synthetic numbers.",
      summary: {
        completedTasks: 0,
        totalTasks: TEMPLATE_TASKS.length,
        baselineTotalViolations: 0,
        guardedTotalViolations: 0,
        baselineAvgTurns: 0,
        guardedAvgTurns: 0,
        baselineTotalTokens: 0,
        guardedTotalTokens: 0,
        violationReductionPct: null,
        tokenDeltaPct: null
      },
      tasks: TEMPLATE_TASKS
    };
  }

  const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as unknown;
  const parsed = RecordedBenchmarkSchema.parse(raw);

  const tasks: BenchmarkTaskRow[] = parsed.tasks.map((item) => ({
    ...item,
    status: "completed"
  }));

  const count = tasks.length;
  const baselineTotalViolations = tasks.reduce((sum, t) => sum + (t.baseline?.violations ?? 0), 0);
  const guardedTotalViolations = tasks.reduce((sum, t) => sum + (t.guarded?.violations ?? 0), 0);
  const baselineTotalTurns = tasks.reduce((sum, t) => sum + (t.baseline?.correctionTurns ?? 0), 0);
  const guardedTotalTurns = tasks.reduce((sum, t) => sum + (t.guarded?.correctionTurns ?? 0), 0);
  const baselineTotalTokens = tasks.reduce((sum, t) => sum + (t.baseline?.promptTokens ?? 0), 0);
  const guardedTotalTokens = tasks.reduce((sum, t) => sum + (t.guarded?.promptTokens ?? 0), 0);

  const violationReductionPct =
    baselineTotalViolations > 0
      ? Number(
          (((baselineTotalViolations - guardedTotalViolations) / baselineTotalViolations) * 100).toFixed(1)
        )
      : null;

  const tokenDeltaPct =
    baselineTotalTokens > 0
      ? Number(
          (((guardedTotalTokens - baselineTotalTokens) / baselineTotalTokens) * 100).toFixed(1)
        )
      : null;

  return {
    source: "recorded",
    generatedAt: parsed.generatedAt,
    tokenizer: parsed.tokenizer,
    note:
      parsed.note ??
      "Recorded 5-task fair A/B benchmark measured with tiktoken prompt counts and real AST/Vitest violation traces.",
    summary: {
      completedTasks: count,
      totalTasks: count,
      baselineTotalViolations,
      guardedTotalViolations,
      baselineAvgTurns: Number((baselineTotalTurns / count).toFixed(2)),
      guardedAvgTurns: Number((guardedTotalTurns / count).toFixed(2)),
      baselineTotalTokens,
      guardedTotalTokens,
      violationReductionPct,
      tokenDeltaPct
    },
    tasks
  };
}
