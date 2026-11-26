import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ArtifactRecord,
  ContextSearchOptions,
  ContextSearchResult,
  ConversationMessage,
  DatapackSnapshot,
  GuardMode,
  KnowledgeDocument,
  MemoryRecord,
  QuotaUsage,
  SelfLearningSignal
} from "./types.js";

export interface MekoClient {
  readonly mode: GuardMode;
  connect(): Promise<void>;
  close(): Promise<void>;
  getQuotaUsage(): QuotaUsage;
  contextSearch(options: ContextSearchOptions): Promise<ContextSearchResult>;
  knowledgebaseUpload(doc: KnowledgeDocument): Promise<{ id: string; updated: boolean }>;
  knowledgebaseSearch(query: string, limit?: number): Promise<KnowledgeDocument[]>;
  memoryAdd(
    input: Omit<MemoryRecord, "id" | "tier" | "createdAt">
  ): Promise<MemoryRecord>;
  memorySearch(
    query: string,
    options?: { tier?: "private" | "shared" | "all"; agentId?: string; limit?: number }
  ): Promise<MemoryRecord[]>;
  memoryPromote(
    memoryId: string,
    promotedBy: string,
    reason: string
  ): Promise<MemoryRecord>;
  conversationAddMessage(
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ): Promise<ConversationMessage>;
  artifactPut(name: string, payload: unknown): Promise<ArtifactRecord>;
  artifactGet(contentHash: string): Promise<ArtifactRecord | null>;
  selfLearningRecord(
    signal: Omit<SelfLearningSignal, "id" | "createdAt">
  ): Promise<SelfLearningSignal>;
  getSnapshot(): Promise<DatapackSnapshot>;
}

export interface CreateMekoClientOptions {
  mode: GuardMode;
  datapack: string;
  fixturePath?: string;
  mcpUrl?: string;
  apiToken?: string;
  recordingDir?: string;
}

function createEmptyQuota(): QuotaUsage {
  return {
    searches: 0,
    memoryAdds: 0,
    uploads: 0,
    artifacts: 0,
    turns: 0
  };
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${canonicalStringify(val)}`)
    .join(",")}}`;
}

function computeContentHash(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2);
}

function scoreTextMatch(tokens: string[], fields: string[]): number {
  if (tokens.length === 0) {
    return 1;
  }
  const haystack = fields.join(" ").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Local JSON-backed Meko client for zero-quota offline development and testing.
 * Enforces 2-tier memory isolation: private memories are visible only to their owning agent
 * until explicitly promoted to shared memory via memoryPromote().
 */
export class MockMekoClient implements MekoClient {
  readonly mode: GuardMode = "mock";
  private readonly datapack: string;
  private readonly fixturePath?: string;
  private snapshot: DatapackSnapshot;
  private quota: QuotaUsage = createEmptyQuota();

  constructor(options: { datapack: string; fixturePath?: string }) {
    this.datapack = options.datapack;
    this.fixturePath = options.fixturePath;
    this.snapshot = {
      datapack: options.datapack,
      knowledge: [],
      memories: [],
      conversations: [],
      artifacts: [],
      selfLearning: []
    };
  }

  async connect(): Promise<void> {
    if (this.fixturePath && fs.existsSync(this.fixturePath)) {
      const raw = JSON.parse(fs.readFileSync(this.fixturePath, "utf8")) as DatapackSnapshot;
      this.snapshot = {
        datapack: raw.datapack || this.datapack,
        knowledge: raw.knowledge ?? [],
        memories: raw.memories ?? [],
        conversations: raw.conversations ?? [],
        artifacts: raw.artifacts ?? [],
        selfLearning: raw.selfLearning ?? []
      };
    }
  }

  async close(): Promise<void> {
    this.persist();
  }

  getQuotaUsage(): QuotaUsage {
    return { ...this.quota };
  }

  private persist(): void {
    if (!this.fixturePath) {
      return;
    }
    const dir = path.dirname(this.fixturePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.fixturePath, JSON.stringify(this.snapshot, null, 2) + "\n", "utf8");
  }

  async contextSearch(options: ContextSearchOptions): Promise<ContextSearchResult> {
    this.quota.searches += 1;
    this.quota.turns += 1;
    const limit = options.limit ?? 8;
    const tokens = tokenizeQuery(options.query);
    const agentScope = options.includePrivateForAgent ?? options.agentId;

    const knowledge = this.snapshot.knowledge
      .map((doc) => ({
        doc,
        score: scoreTextMatch(tokens, [doc.id, doc.ruleId, doc.title, doc.content, ...doc.tags])
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.doc);

    const memories = this.snapshot.memories
      .filter(
        (mem) =>
          mem.tier === "shared" ||
          (agentScope !== undefined && mem.agentId === agentScope)
      )
      .map((mem) => ({
        mem,
        score: scoreTextMatch(tokens, [mem.content, mem.ruleId ?? "", ...mem.tags])
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.mem);

    const conversations = this.snapshot.conversations
      .filter((msg) => scoreTextMatch(tokens, [msg.content, msg.author]) > 0)
      .slice(0, limit);

    const selfLearning = this.snapshot.selfLearning
      .filter(
        (sig) => scoreTextMatch(tokens, [sig.ruleId, sig.pattern, sig.remediation]) > 0
      )
      .slice(0, limit);

    return {
      query: options.query,
      knowledge,
      memories,
      conversations,
      selfLearning
    };
  }

  async knowledgebaseUpload(
    doc: KnowledgeDocument
  ): Promise<{ id: string; updated: boolean }> {
    this.quota.uploads += 1;
    const existingIndex = this.snapshot.knowledge.findIndex((item) => item.id === doc.id);
    if (existingIndex >= 0) {
      this.snapshot.knowledge[existingIndex] = doc;
      this.persist();
      return { id: doc.id, updated: true };
    }
    this.snapshot.knowledge.push(doc);
    this.persist();
    return { id: doc.id, updated: false };
  }

  async knowledgebaseSearch(query: string, limit = 8): Promise<KnowledgeDocument[]> {
    this.quota.searches += 1;
    const tokens = tokenizeQuery(query);
    return this.snapshot.knowledge
      .map((doc) => ({
        doc,
        score: scoreTextMatch(tokens, [doc.id, doc.ruleId, doc.title, doc.content, ...doc.tags])
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.doc);
  }

  async memoryAdd(
    input: Omit<MemoryRecord, "id" | "tier" | "createdAt">
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    const record: MemoryRecord = {
      id: `mem_${crypto.randomUUID().slice(0, 8)}`,
      tier: "private",
      createdAt: new Date().toISOString(),
      ...input
    };
    this.snapshot.memories.push(record);
    this.persist();
    return record;
  }

  async memorySearch(
    query: string,
    options?: { tier?: "private" | "shared" | "all"; agentId?: string; limit?: number }
  ): Promise<MemoryRecord[]> {
    this.quota.searches += 1;
    const tier = options?.tier ?? "all";
    const limit = options?.limit ?? 8;
    const tokens = tokenizeQuery(query);

    return this.snapshot.memories
      .filter((mem) => {
        if (tier !== "all" && mem.tier !== tier) {
          return false;
        }
        if (mem.tier === "private" && options?.agentId && mem.agentId !== options.agentId) {
          return false;
        }
        return true;
      })
      .map((mem) => ({
        mem,
        score: scoreTextMatch(tokens, [mem.content, mem.ruleId ?? "", ...mem.tags])
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.mem);
  }

  async memoryPromote(
    memoryId: string,
    promotedBy: string,
    reason: string
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    const record = this.snapshot.memories.find((item) => item.id === memoryId);
    if (!record) {
      throw new Error(`Memory record not found: ${memoryId}`);
    }
    if (record.tier === "shared") {
      throw new Error(`Memory record is already promoted to shared tier: ${memoryId}`);
    }
    record.tier = "shared";
    record.promotedAt = new Date().toISOString();
    record.promotedBy = promotedBy;
    record.promotionReason = reason;
    this.persist();
    return record;
  }

  async conversationAddMessage(
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ): Promise<ConversationMessage> {
    this.quota.turns += 1;
    const entry: ConversationMessage = {
      id: `conv_${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...msg
    };
    this.snapshot.conversations.push(entry);
    this.persist();
    return entry;
  }

  async artifactPut(name: string, payload: unknown): Promise<ArtifactRecord> {
    const contentHash = computeContentHash(payload);
    const existing = this.snapshot.artifacts.find(
      (item) => item.contentHash === contentHash
    );
    if (existing) {
      return existing;
    }
    this.quota.artifacts += 1;
    const record: ArtifactRecord = {
      name,
      contentHash,
      payload,
      createdAt: new Date().toISOString()
    };
    this.snapshot.artifacts.push(record);
    this.persist();
    return record;
  }

  async artifactGet(contentHash: string): Promise<ArtifactRecord | null> {
    return (
      this.snapshot.artifacts.find((item) => item.contentHash === contentHash) ?? null
    );
  }

  async selfLearningRecord(
    signal: Omit<SelfLearningSignal, "id" | "createdAt">
  ): Promise<SelfLearningSignal> {
    this.quota.turns += 1;
    const entry: SelfLearningSignal = {
      id: `sl_${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      ...signal
    };
    this.snapshot.selfLearning.push(entry);
    this.persist();
    return entry;
  }

  async getSnapshot(): Promise<DatapackSnapshot> {
    return {
      datapack: this.snapshot.datapack,
      knowledge: [...this.snapshot.knowledge],
      memories: [...this.snapshot.memories],
      conversations: [...this.snapshot.conversations],
      artifacts: [...this.snapshot.artifacts],
      selfLearning: [...this.snapshot.selfLearning]
    };
  }
}

/**
 * Live Meko MCP client over StreamableHTTPClientTransport.
 */
export class LiveMekoClient implements MekoClient {
  readonly mode: GuardMode = "live";
  private readonly datapack: string;
  private readonly mcpUrl: string;
  private readonly apiToken: string;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private quota: QuotaUsage = createEmptyQuota();

  constructor(options: { datapack: string; mcpUrl?: string; apiToken?: string }) {
    this.datapack = options.datapack;
    this.mcpUrl = options.mcpUrl ?? process.env.MEKO_MCP_URL ?? "https://mcp.mekodata.ai/mcp";
    this.apiToken = options.apiToken ?? process.env.MEKO_API_TOKEN ?? "";
  }

  async connect(): Promise<void> {
    if (!this.apiToken.trim()) {
      throw new Error(
        "MEKO_API_TOKEN is required in live mode. Set it in .env or use --mode mock for offline mode."
      );
    }
    this.transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.apiToken}`
        }
      }
    });
    this.client = new Client(
      { name: "meko-standards-guard", version: "0.1.0" },
      { capabilities: {} }
    );
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }

  getQuotaUsage(): QuotaUsage {
    return { ...this.quota };
  }

  private async callMcpTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client) {
      throw new Error("LiveMekoClient is not connected. Call connect() first.");
    }
    const result = await this.client.callTool({
      name,
      arguments: { datapack: this.datapack, ...args }
    });
    const textContent = Array.isArray(result.content)
      ? result.content.find(
          (part): part is { type: "text"; text: string } => part.type === "text"
        )
      : undefined;
    if (!textContent) {
      return result as unknown as T;
    }
    try {
      return JSON.parse(textContent.text) as T;
    } catch {
      return textContent.text as unknown as T;
    }
  }

  async contextSearch(options: ContextSearchOptions): Promise<ContextSearchResult> {
    this.quota.searches += 1;
    this.quota.turns += 1;
    const raw = await this.callMcpTool<Partial<ContextSearchResult>>("context_search", {
      query: options.query,
      agent_id: options.agentId,
      limit: options.limit ?? 8
    });
    return {
      query: options.query,
      knowledge: raw.knowledge ?? [],
      memories: raw.memories ?? [],
      conversations: raw.conversations ?? [],
      selfLearning: raw.selfLearning ?? []
    };
  }

  async knowledgebaseUpload(
    doc: KnowledgeDocument
  ): Promise<{ id: string; updated: boolean }> {
    this.quota.uploads += 1;
    return this.callMcpTool<{ id: string; updated: boolean }>("knowledgebase_upload", {
      document_id: doc.id,
      title: doc.title,
      content: doc.content,
      tags: doc.tags
    });
  }

  async knowledgebaseSearch(query: string, limit = 8): Promise<KnowledgeDocument[]> {
    this.quota.searches += 1;
    const raw = await this.callMcpTool<{ results?: KnowledgeDocument[] }>(
      "knowledgebase_search",
      { query, limit }
    );
    return raw.results ?? [];
  }

  async memoryAdd(
    input: Omit<MemoryRecord, "id" | "tier" | "createdAt">
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    return this.callMcpTool<MemoryRecord>("memory_add", {
      content: input.content,
      agent_id: input.agentId,
      rule_id: input.ruleId,
      tags: input.tags
    });
  }

  async memorySearch(
    query: string,
    options?: { tier?: "private" | "shared" | "all"; agentId?: string; limit?: number }
  ): Promise<MemoryRecord[]> {
    this.quota.searches += 1;
    const raw = await this.callMcpTool<{ results?: MemoryRecord[] }>("memory_search", {
      query,
      tier: options?.tier ?? "all",
      agent_id: options?.agentId,
      limit: options?.limit ?? 8
    });
    return raw.results ?? [];
  }

  async memoryPromote(
    memoryId: string,
    promotedBy: string,
    reason: string
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    return this.callMcpTool<MemoryRecord>("memory_promote", {
      memory_id: memoryId,
      promoted_by: promotedBy,
      reason
    });
  }

  async conversationAddMessage(
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ): Promise<ConversationMessage> {
    this.quota.turns += 1;
    return this.callMcpTool<ConversationMessage>("conversation_add_message", {
      author: msg.author,
      role: msg.role,
      content: msg.content,
      related_memory_id: msg.relatedMemoryId
    });
  }

  async artifactPut(name: string, payload: unknown): Promise<ArtifactRecord> {
    this.quota.artifacts += 1;
    return this.callMcpTool<ArtifactRecord>("artifact_put", {
      name,
      content: JSON.stringify(payload)
    });
  }

  async artifactGet(contentHash: string): Promise<ArtifactRecord | null> {
    return this.callMcpTool<ArtifactRecord | null>("artifact_get", {
      content_hash: contentHash
    });
  }

  async selfLearningRecord(
    signal: Omit<SelfLearningSignal, "id" | "createdAt">
  ): Promise<SelfLearningSignal> {
    this.quota.turns += 1;
    return this.callMcpTool<SelfLearningSignal>("selflearning_record", {
      agent_id: signal.agentId,
      rule_id: signal.ruleId,
      pattern: signal.pattern,
      remediation: signal.remediation,
      outcome: signal.outcome
    });
  }

  async getSnapshot(): Promise<DatapackSnapshot> {
    const [knowledge, memories] = await Promise.all([
      this.knowledgebaseSearch("*", 50),
      this.memorySearch("*", { tier: "all", limit: 50 })
    ]);
    return {
      datapack: this.datapack,
      knowledge,
      memories,
      conversations: [],
      artifacts: [],
      selfLearning: []
    };
  }
}

/**
 * Wraps LiveMekoClient and records all responses to fixtures/meko/recorded/ for deterministic replay.
 */
export class RecordingMekoClient implements MekoClient {
  readonly mode: GuardMode = "record";
  private readonly inner: LiveMekoClient;
  private readonly recordingDir: string;
  private readonly events: Array<{ op: string; at: string; payload: unknown }> = [];

  constructor(options: {
    datapack: string;
    mcpUrl?: string;
    apiToken?: string;
    recordingDir?: string;
  }) {
    this.inner = new LiveMekoClient(options);
    this.recordingDir = options.recordingDir ?? "fixtures/meko/recorded";
  }

  async connect(): Promise<void> {
    await this.inner.connect();
  }

  async close(): Promise<void> {
    await this.inner.close();
    if (this.events.length > 0) {
      fs.mkdirSync(this.recordingDir, { recursive: true });
      const file = path.join(
        this.recordingDir,
        `session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
      );
      fs.writeFileSync(file, JSON.stringify(this.events, null, 2) + "\n", "utf8");
    }
  }

  getQuotaUsage(): QuotaUsage {
    return this.inner.getQuotaUsage();
  }

  private record<T>(op: string, payload: T): T {
    this.events.push({ op, at: new Date().toISOString(), payload });
    return payload;
  }

  async contextSearch(options: ContextSearchOptions): Promise<ContextSearchResult> {
    return this.record("contextSearch", await this.inner.contextSearch(options));
  }

  async knowledgebaseUpload(
    doc: KnowledgeDocument
  ): Promise<{ id: string; updated: boolean }> {
    return this.record("knowledgebaseUpload", await this.inner.knowledgebaseUpload(doc));
  }

  async knowledgebaseSearch(query: string, limit?: number): Promise<KnowledgeDocument[]> {
    return this.record(
      "knowledgebaseSearch",
      await this.inner.knowledgebaseSearch(query, limit)
    );
  }

  async memoryAdd(
    input: Omit<MemoryRecord, "id" | "tier" | "createdAt">
  ): Promise<MemoryRecord> {
    return this.record("memoryAdd", await this.inner.memoryAdd(input));
  }

  async memorySearch(
    query: string,
    options?: { tier?: "private" | "shared" | "all"; agentId?: string; limit?: number }
  ): Promise<MemoryRecord[]> {
    return this.record("memorySearch", await this.inner.memorySearch(query, options));
  }

  async memoryPromote(
    memoryId: string,
    promotedBy: string,
    reason: string
  ): Promise<MemoryRecord> {
    return this.record(
      "memoryPromote",
      await this.inner.memoryPromote(memoryId, promotedBy, reason)
    );
  }

  async conversationAddMessage(
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ): Promise<ConversationMessage> {
    return this.record(
      "conversationAddMessage",
      await this.inner.conversationAddMessage(msg)
    );
  }

  async artifactPut(name: string, payload: unknown): Promise<ArtifactRecord> {
    return this.record("artifactPut", await this.inner.artifactPut(name, payload));
  }

  async artifactGet(contentHash: string): Promise<ArtifactRecord | null> {
    return this.record("artifactGet", await this.inner.artifactGet(contentHash));
  }

  async selfLearningRecord(
    signal: Omit<SelfLearningSignal, "id" | "createdAt">
  ): Promise<SelfLearningSignal> {
    return this.record(
      "selfLearningRecord",
      await this.inner.selfLearningRecord(signal)
    );
  }

  async getSnapshot(): Promise<DatapackSnapshot> {
    return this.inner.getSnapshot();
  }
}

export function createMekoClient(options: CreateMekoClientOptions): MekoClient {
  if (options.mode === "live") {
    return new LiveMekoClient({
      datapack: options.datapack,
      mcpUrl: options.mcpUrl,
      apiToken: options.apiToken
    });
  }
  if (options.mode === "record") {
    return new RecordingMekoClient({
      datapack: options.datapack,
      mcpUrl: options.mcpUrl,
      apiToken: options.apiToken,
      recordingDir: options.recordingDir
    });
  }
  return new MockMekoClient({
    datapack: options.datapack,
    fixturePath: options.fixturePath
  });
}
