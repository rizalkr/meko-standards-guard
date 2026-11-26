import fs from "node:fs";
import path from "node:path";
import {
  loadAdrDocuments,
  loadGuardConfig,
  type ArtifactRecord,
  type ConversationMessage,
  type DatapackSnapshot,
  type GuardMode,
  type KnowledgeDocument,
  type MemoryRecord,
  type QuotaUsage,
  type RuleDefinition,
  type SelfLearningSignal
} from "@meko-guard/core";
import {
  checkSpecConflicts,
  computeBlastRadius,
  runGuardCheck,
  type BlastRadiusResult,
  type GuardReport,
  type SpecCheckResult,
  type Violation
} from "@meko-guard/engine";
import {
  resolveGitHead,
  resolveGitStagedFiles,
  withMekoClient,
  type CliContextOptions
} from "./context.js";

export interface SeedResult {
  datapack: string;
  mode: GuardMode;
  adrCount: number;
  created: number;
  updated: number;
  artifactHash: string;
  quota: QuotaUsage;
}

export interface StatusResult {
  datapack: string;
  mode: GuardMode;
  knowledgeCount: number;
  privateMemoryCount: number;
  sharedMemoryCount: number;
  conversationCount: number;
  artifactCount: number;
  selfLearningCount: number;
  snapshot: DatapackSnapshot;
}

export interface SpecCheckActionResult {
  result: SpecCheckResult;
  relatedKnowledge: KnowledgeDocument[];
  relatedMemories: MemoryRecord[];
  quota: QuotaUsage;
}

export interface CheckActionOptions extends CliContextOptions {
  agentId: string;
  staged?: boolean;
  files?: string[];
  runTests?: boolean;
  testTarget?: string;
  allowPolicyEdit?: boolean;
  recordFix?: boolean;
  recordFindings?: boolean;
}

export interface CheckActionResult {
  agentId: string;
  report: GuardReport;
  recordedMemories: MemoryRecord[];
  recordedSignals: SelfLearningSignal[];
  quota: QuotaUsage;
}

export interface QueueActionResult {
  datapack: string;
  mode: GuardMode;
  pending: MemoryRecord[];
  sharedCount: number;
}

export interface ApproveActionResult {
  promoted: MemoryRecord;
  conversationEntry: ConversationMessage;
  quota: QuotaUsage;
}

export interface ExplainRuleResult {
  rule: RuleDefinition;
  adr: KnowledgeDocument;
  blastRadius: BlastRadiusResult;
}

export interface PreflightActionResult {
  agentId: string;
  query: string;
  knowledge: KnowledgeDocument[];
  memories: MemoryRecord[];
  conversations: ConversationMessage[];
  selfLearning: SelfLearningSignal[];
  quota: QuotaUsage;
}

export interface ReleaseGateActionOptions extends CliContextOptions {
  skipTests?: boolean;
  testTarget?: string;
  allowPolicyEdit?: boolean;
  actor?: string;
}

export interface ReleaseGateActionResult {
  passed: boolean;
  report: GuardReport;
  receipt: ArtifactRecord | null;
  conversationEntry: ConversationMessage | null;
  pendingPrivateMemories: number;
  quota: QuotaUsage;
}

/**
 * Seeds all ADR markdown files from standards/ into the Meko Knowledge Base and writes a seed artifact.
 */
export async function seedAction(options: CliContextOptions = {}): Promise<SeedResult> {
  return withMekoClient(options, async ({ rootDir, config, mode, meko }) => {
    const docs = loadAdrDocuments(config, rootDir);
    let created = 0;
    let updated = 0;

    for (const doc of docs) {
      const res = await meko.knowledgebaseUpload(doc);
      if (res.updated) {
        updated += 1;
      } else {
        created += 1;
      }
    }

    const receipt = await meko.artifactPut("seed-summary.json", {
      datapack: config.datapack,
      mode,
      adrCount: docs.length,
      adrIds: docs.map((d) => d.id)
    });

    return {
      datapack: config.datapack,
      mode,
      adrCount: docs.length,
      created,
      updated,
      artifactHash: receipt.contentHash,
      quota: meko.getQuotaUsage()
    };
  });
}

/**
 * Inspects counts across all 5 Meko primitives in the configured datapack.
 */
export async function statusAction(options: CliContextOptions = {}): Promise<StatusResult> {
  return withMekoClient(options, async ({ mode, meko }) => {
    const snapshot = await meko.getSnapshot();
    const privateMemoryCount = snapshot.memories.filter((m) => m.tier === "private").length;
    const sharedMemoryCount = snapshot.memories.filter((m) => m.tier === "shared").length;

    return {
      datapack: snapshot.datapack,
      mode,
      knowledgeCount: snapshot.knowledge.length,
      privateMemoryCount,
      sharedMemoryCount,
      conversationCount: snapshot.conversations.length,
      artifactCount: snapshot.artifacts.length,
      selfLearningCount: snapshot.selfLearning.length,
      snapshot
    };
  });
}

/**
 * Evaluates a Markdown RFC/spec against S1-S8 rules and retrieves related Meko ADRs/memories.
 */
export async function specCheckAction(
  options: CliContextOptions & { specFile: string }
): Promise<SpecCheckActionResult> {
  return withMekoClient(options, async ({ rootDir, config, meko }) => {
    const result = checkSpecConflicts(options.specFile, rootDir, config);
    const query =
      result.conflicts.length > 0
        ? [...new Set(result.conflicts.map((c) => `${c.ruleId} ${c.adrId}`))].join(" ")
        : `${path.basename(options.specFile, ".md")} ADR`;

    const ctx = await meko.contextSearch({ query, limit: 6 });

    return {
      result,
      relatedKnowledge: ctx.knowledge,
      relatedMemories: ctx.memories,
      quota: meko.getQuotaUsage()
    };
  });
}

/**
 * Runs deterministic AST, PII taint, governance diff, and optional Vitest checks,
 * automatically quarantining any violations into private agent memory.
 */
export async function checkAction(options: CheckActionOptions): Promise<CheckActionResult> {
  return withMekoClient(options, async ({ rootDir, config, meko }) => {
    let targetFiles: string[] | undefined;
    let changedFiles: string[] | undefined;

    if (options.files && options.files.length > 0) {
      targetFiles = options.files;
    } else if (options.staged) {
      const stagedFiles = resolveGitStagedFiles(rootDir);
      changedFiles = stagedFiles;
      const targetPrefix = `${config.targetDir.replace(/\\/g, "/").replace(/\/$/, "")}/`;
      const stagedTs = stagedFiles.filter((file) => {
        const normalized = file.replace(/\\/g, "/");
        return (
          normalized.startsWith(targetPrefix) &&
          normalized.endsWith(".ts") &&
          fs.existsSync(path.resolve(rootDir, file))
        );
      });
      if (stagedTs.length > 0) {
        targetFiles = stagedTs;
      }
    }

    const report = await runGuardCheck({
      rootDir,
      config,
      targetFiles,
      changedFiles,
      runTests: options.runTests,
      testTarget: options.testTarget,
      allowPolicyEdit: options.allowPolicyEdit
    });

    const recordedMemories: MemoryRecord[] = [];
    const recordedSignals: SelfLearningSignal[] = [];

    if (options.recordFindings !== false) {
      if (!report.passed && report.violations.length > 0) {
        const grouped = new Map<string, Violation[]>();
        for (const v of report.violations) {
          const list = grouped.get(v.ruleId) ?? [];
          list.push(v);
          grouped.set(v.ruleId, list);
        }

        for (const [ruleId, ruleViolations] of grouped.entries()) {
          const primary = ruleViolations[0];
          const mem = await meko.memoryAdd({
            agentId: options.agentId,
            ruleId,
            content: `[${ruleId}/${primary.adrId}] Candidate learning from ${options.agentId} at ${primary.file}:${primary.line}: ${primary.message} Remediation: ${primary.remediation}`,
            tags: [ruleId, primary.adrId, "candidate", "violation", options.agentId]
          });
          recordedMemories.push(mem);

          const sig = await meko.selfLearningRecord({
            agentId: options.agentId,
            ruleId,
            pattern: `${primary.file}:${primary.line} - ${primary.message}`,
            remediation: primary.remediation,
            outcome: "violation_recorded"
          });
          recordedSignals.push(sig);
        }
      } else if (report.passed && options.recordFix) {
        const sig = await meko.selfLearningRecord({
          agentId: options.agentId,
          ruleId: "ALL",
          pattern: "guard_check_passed",
          remediation: "Implementation satisfied all checked ADR invariants",
          outcome: "fix_verified"
        });
        recordedSignals.push(sig);
      }
    }

    return {
      agentId: options.agentId,
      report,
      recordedMemories,
      recordedSignals,
      quota: meko.getQuotaUsage()
    };
  });
}

/**
 * Lists all unpromoted private candidate memories waiting in the maintainer review queue.
 */
export async function queueAction(options: CliContextOptions = {}): Promise<QueueActionResult> {
  return withMekoClient(options, async ({ mode, meko }) => {
    const snapshot = await meko.getSnapshot();
    const pending = snapshot.memories.filter((m) => m.tier === "private");
    const sharedCount = snapshot.memories.filter((m) => m.tier === "shared").length;

    return {
      datapack: snapshot.datapack,
      mode,
      pending,
      sharedCount
    };
  });
}

/**
 * Promotes a private candidate memory to shared institutional memory and appends an audit note.
 */
export async function approveAction(
  options: CliContextOptions & { memoryId: string; reason: string; promotedBy?: string }
): Promise<ApproveActionResult> {
  const reason = options.reason.trim();
  if (!reason) {
    throw new Error("Approval reason must be non-empty.");
  }
  const promotedBy = options.promotedBy?.trim() || "maintainer";

  return withMekoClient(options, async ({ meko }) => {
    const promoted = await meko.memoryPromote(options.memoryId, promotedBy, reason);
    const conversationEntry = await meko.conversationAddMessage({
      author: promotedBy,
      role: "maintainer",
      content: `Promoted candidate memory ${promoted.id} (${promoted.ruleId ?? "general"}) to shared tier. Rationale: ${reason}`,
      relatedMemoryId: promoted.id
    });

    return {
      promoted,
      conversationEntry,
      quota: meko.getQuotaUsage()
    };
  });
}

/**
 * Maps a Rule ID or ADR ID to impacted source files, Hono routes, and Vitest test files locally.
 */
export function impactAction(options: {
  rootDir?: string;
  ruleOrAdrId: string;
}): BlastRadiusResult {
  const rootDir = options.rootDir ?? process.cwd();
  const config = loadGuardConfig(rootDir);
  return computeBlastRadius(options.ruleOrAdrId, rootDir, config);
}

/**
 * Explains an architectural rule with its full ADR markdown document and code blast radius.
 */
export function explainRuleAction(options: {
  rootDir?: string;
  ruleOrAdrId: string;
}): ExplainRuleResult {
  const rootDir = options.rootDir ?? process.cwd();
  const config = loadGuardConfig(rootDir);
  const normalized = options.ruleOrAdrId.trim().toLowerCase();
  const rule = config.rules.find(
    (r) => r.id.toLowerCase() === normalized || r.adrId.toLowerCase() === normalized
  );
  if (!rule) {
    const valid = config.rules.map((r) => `${r.id}/${r.adrId}`).join(", ");
    throw new Error(`Unknown rule or ADR ID "${options.ruleOrAdrId}". Known rules: ${valid}`);
  }

  const docs = loadAdrDocuments(config, rootDir);
  const adr = docs.find((d) => d.ruleId === rule.id);
  if (!adr) {
    throw new Error(`ADR document not found for rule ${rule.id}`);
  }

  const blastRadius = computeBlastRadius(rule.id, rootDir, config);
  return { rule, adr, blastRadius };
}

/**
 * Retrieves shared ADRs, promoted team memories, and self-learning signals for an agent task.
 */
export async function preflightAction(
  options: CliContextOptions & { task: string; agentId: string; limit?: number }
): Promise<PreflightActionResult> {
  return withMekoClient(options, async ({ meko }) => {
    const result = await meko.contextSearch({
      query: options.task,
      agentId: options.agentId,
      includePrivateForAgent: options.agentId,
      limit: options.limit ?? 8
    });

    return {
      agentId: options.agentId,
      query: result.query,
      knowledge: result.knowledge,
      memories: result.memories,
      conversations: result.conversations,
      selfLearning: result.selfLearning,
      quota: meko.getQuotaUsage()
    };
  });
}

/**
 * Runs the full verification suite and emits a SHA-256 content-addressed compliance receipt when clean.
 */
export async function releaseGateAction(
  options: ReleaseGateActionOptions = {}
): Promise<ReleaseGateActionResult> {
  return withMekoClient(options, async ({ rootDir, config, meko }) => {
    const report = await runGuardCheck({
      rootDir,
      config,
      runTests: !options.skipTests,
      testTarget: options.testTarget,
      allowPolicyEdit: options.allowPolicyEdit
    });

    const snapshot = await meko.getSnapshot();
    const pendingPrivateMemories = snapshot.memories.filter((m) => m.tier === "private").length;

    if (!report.passed) {
      return {
        passed: false,
        report,
        receipt: null,
        conversationEntry: null,
        pendingPrivateMemories,
        quota: meko.getQuotaUsage()
      };
    }

    const receiptPayload = {
      schemaVersion: "1.0.0",
      datapack: config.datapack,
      gitHead: resolveGitHead(rootDir),
      passed: true,
      checkedFiles: report.checkedFiles,
      rulesChecked: config.rules.map((r) => r.id),
      summary: report.summary,
      tests: report.tests
        ? {
            passed: report.tests.passed,
            numTotalTests: report.tests.numTotalTests,
            numPassedTests: report.tests.numPassedTests,
            numFailedTests: report.tests.numFailedTests
          }
        : null,
      pendingPrivateMemories
    };

    const receipt = await meko.artifactPut("release-receipt.json", receiptPayload);
    const conversationEntry = await meko.conversationAddMessage({
      author: options.actor?.trim() || "release-gate",
      role: "system",
      content: `Release gate PASSED for ${receiptPayload.gitHead}. Compliance receipt SHA-256: ${receipt.contentHash}`
    });

    return {
      passed: true,
      report,
      receipt,
      conversationEntry,
      pendingPrivateMemories,
      quota: meko.getQuotaUsage()
    };
  });
}
