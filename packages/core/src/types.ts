import { z } from "zod";

export const GuardModeSchema = z.enum(["mock", "record", "live"]);
export type GuardMode = z.infer<typeof GuardModeSchema>;

export const RuleCategorySchema = z.enum([
  "financial",
  "security",
  "architecture",
  "governance"
]);
export type RuleCategory = z.infer<typeof RuleCategorySchema>;

export const RuleDefinitionSchema = z.object({
  id: z.string().min(1),
  adrId: z.string().min(1),
  adrFile: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  category: RuleCategorySchema,
  globs: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).min(1)
});
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

export const GuardConfigSchema = z.object({
  datapack: z.string().min(1),
  standardsDir: z.string().min(1),
  targetDir: z.string().min(1),
  fixturePath: z.string().min(1),
  rules: z.array(RuleDefinitionSchema).min(1)
});
export type GuardConfig = z.infer<typeof GuardConfigSchema>;

export interface KnowledgeDocument {
  id: string;
  ruleId: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

export type MemoryTier = "private" | "shared";

export interface MemoryRecord {
  id: string;
  content: string;
  tier: MemoryTier;
  agentId: string;
  ruleId?: string;
  tags: string[];
  createdAt: string;
  promotedAt?: string;
  promotedBy?: string;
  promotionReason?: string;
}

export interface ConversationMessage {
  id: string;
  author: string;
  role: "agent" | "maintainer" | "system";
  content: string;
  relatedMemoryId?: string;
  createdAt: string;
}

export interface ArtifactRecord {
  name: string;
  contentHash: string;
  payload: unknown;
  createdAt: string;
}

export interface SelfLearningSignal {
  id: string;
  agentId: string;
  ruleId: string;
  pattern: string;
  remediation: string;
  outcome: "violation_recorded" | "fix_verified";
  createdAt: string;
}

export interface ContextSearchOptions {
  query: string;
  agentId?: string;
  includePrivateForAgent?: string;
  limit?: number;
}

export interface ContextSearchResult {
  query: string;
  knowledge: KnowledgeDocument[];
  memories: MemoryRecord[];
  conversations: ConversationMessage[];
  selfLearning: SelfLearningSignal[];
}

export interface QuotaUsage {
  searches: number;
  memoryAdds: number;
  uploads: number;
  artifacts: number;
  turns: number;
}

export interface DatapackSnapshot {
  datapack: string;
  knowledge: KnowledgeDocument[];
  memories: MemoryRecord[];
  conversations: ConversationMessage[];
  artifacts: ArtifactRecord[];
  selfLearning: SelfLearningSignal[];
}
