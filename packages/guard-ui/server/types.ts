import type {
  ArtifactRecord,
  GuardMode,
  MemoryRecord,
  RuleDefinition
} from "@meko-guard/core";

export type TimelineEventKind =
  | "knowledge"
  | "memory_private"
  | "memory_shared"
  | "conversation"
  | "self_learning"
  | "artifact";

export interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: TimelineEventKind;
  actor: string;
  ruleId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface RuleSummary extends RuleDefinition {
  fileCount: number;
  routeCount: number;
  testCount: number;
}

export interface BenchmarkArmMetrics {
  violations: number;
  correctionTurns: number;
  promptTokens: number;
  passedFirstTry: boolean;
}

export interface BenchmarkTaskRow {
  id: string;
  task: string;
  targetEndpoint: string;
  focusRules: string[];
  status: "pending" | "completed";
  baseline: BenchmarkArmMetrics | null;
  guarded: BenchmarkArmMetrics | null;
}

export interface BenchmarkSummaryMetrics {
  completedTasks: number;
  totalTasks: number;
  baselineTotalViolations: number;
  guardedTotalViolations: number;
  baselineAvgTurns: number;
  guardedAvgTurns: number;
  baselineTotalTokens: number;
  guardedTotalTokens: number;
  violationReductionPct: number | null;
  tokenDeltaPct: number | null;
}

export interface BenchmarkReport {
  source: "recorded" | "preview_template";
  generatedAt: string | null;
  tokenizer: string;
  note: string;
  summary: BenchmarkSummaryMetrics;
  tasks: BenchmarkTaskRow[];
}

export interface OverviewResponse {
  datapack: string;
  mode: GuardMode;
  zeroQuotaMode: boolean;
  counts: {
    knowledge: number;
    privateMemories: number;
    sharedMemories: number;
    conversations: number;
    artifacts: number;
    selfLearning: number;
  };
  latestReceipt: ArtifactRecord | null;
  benchmarkSource: BenchmarkReport["source"];
  rules: RuleDefinition[];
}

export interface QueueResponse {
  datapack: string;
  mode: GuardMode;
  pending: MemoryRecord[];
  shared: MemoryRecord[];
  sharedCount: number;
}

export interface GovernanceServerOptions {
  rootDir?: string;
  mode?: GuardMode;
  fixturePath?: string;
  staticDir?: string;
}
