export type GuardMode = "mock" | "record" | "live";

export type RuleCategory = "financial" | "security" | "architecture" | "governance";

export interface RuleDefinition {
  id: string;
  adrId: string;
  adrFile: string;
  title: string;
  severity: "error" | "warning";
  category: RuleCategory;
  globs: string[];
  tags: string[];
}

export interface RuleSummary extends RuleDefinition {
  fileCount: number;
  routeCount: number;
  testCount: number;
}

export interface MemoryRecord {
  id: string;
  content: string;
  tier: "private" | "shared";
  agentId: string;
  ruleId?: string;
  tags: string[];
  createdAt: string;
  promotedAt?: string;
  promotedBy?: string;
  promotionReason?: string;
}

export interface ArtifactRecord {
  name: string;
  contentHash: string;
  payload: unknown;
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  ruleId: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

export interface BlastRadiusResult {
  query: string;
  ruleId: string;
  adrId: string;
  title: string;
  affectedFiles: string[];
  affectedRoutes: string[];
  affectedTests: string[];
}

export interface ExplainRuleResponse {
  rule: RuleDefinition;
  adr: KnowledgeDocument;
  blastRadius: BlastRadiusResult;
}

export interface SpecConflict {
  ruleId: string;
  adrId: string;
  line: number;
  excerpt: string;
  reason: string;
  remediation: string;
}

export interface SpecCheckResult {
  specFile: string;
  passed: boolean;
  conflicts: SpecConflict[];
  checkedRules: string[];
}

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

export interface BenchmarkReport {
  source: "recorded" | "preview_template";
  generatedAt: string | null;
  tokenizer: string;
  note: string;
  summary: {
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
  };
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
