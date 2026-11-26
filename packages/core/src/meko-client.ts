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
  private datapackId: string | null = null;
  private resolvedDatapackName: string;
  private conversationId: string | null = null;
  private readonly defaultAgentId = "standards-guard:meko-standards-guard";
  private quota: QuotaUsage = createEmptyQuota();

  constructor(options: { datapack: string; mcpUrl?: string; apiToken?: string }) {
    this.datapack = options.datapack;
    this.resolvedDatapackName = options.datapack;
    this.mcpUrl = options.mcpUrl ?? process.env.MEKO_MCP_URL ?? "https://mcp.mekodata.ai/mcp";
    this.apiToken = options.apiToken ?? process.env.MEKO_API_TOKEN ?? "";
  }

  private formatAgentId(agentId: string): string {
    return agentId.includes(":") ? agentId : `${agentId}:meko-standards-guard`;
  }

  private requireSession(): { conversationId: string; datapackId: string | null } {
    if (!this.conversationId) {
      throw new Error("LiveMekoClient has no active conversation_id. Call connect() first.");
    }
    return {
      conversationId: this.conversationId,
      datapackId: this.datapackId
    };
  }

  private async callMcpTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client) {
      throw new Error("LiveMekoClient is not connected. Call connect() first.");
    }
    const cleanArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) {
        cleanArgs[key] = value;
      }
    }

    const result = await this.client.callTool({
      name,
      arguments: cleanArgs
    });
    const textContent = Array.isArray(result.content)
      ? result.content.find(
          (part): part is { type: "text"; text: string } => part.type === "text"
        )
      : undefined;

    let parsed: unknown = textContent ? textContent.text : result;
    if (textContent) {
      try {
        parsed = JSON.parse(textContent.text) as unknown;
      } catch {
        parsed = textContent.text;
      }
    }

    if (result.isError) {
      const msg = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      throw new Error(`Meko MCP tool "${name}" failed: ${msg}`);
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error?: unknown }).error === "string" &&
      (parsed as { error: string }).error.trim().length > 0
    ) {
      const errObj = parsed as { error: string; detail?: string; message?: string };
      const detail = errObj.detail || errObj.message || "";
      throw new Error(
        `Meko MCP tool "${name}" failed: ${errObj.error}${detail ? ` (${detail})` : ""}`
      );
    }

    return parsed as T;
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

    const envDatapackId = process.env.MEKO_DATAPACK_ID?.trim();
    if (envDatapackId) {
      this.datapackId = envDatapackId;
    } else {
      const initialList = await this.callMcpTool<{
        datapack_id?: string;
        datapack_name?: string;
      }>("conversation_list", { limit: 1 });
      if (initialList.datapack_id) {
        this.datapackId = initialList.datapack_id;
      }
      if (initialList.datapack_name) {
        this.resolvedDatapackName = initialList.datapack_name;
      }
    }

    const bootstrapDatapackId = this.datapackId;

    const createdConv = await this.callMcpTool<{
      id?: string;
      conversation_id?: string;
    }>("conversation_create", {
      agent_id: this.defaultAgentId,
      session_id: "standards-guard-governance-session",
      title: "Meko Standards Guard Governance Session",
      ...(this.datapackId ? { datapack_id: this.datapackId } : {})
    });

    const convId = createdConv.id ?? createdConv.conversation_id;
    if (!convId) {
      throw new Error("Meko conversation_create did not return a conversation_id.");
    }
    this.conversationId = convId;

    try {
      type DatapackEntry = {
        id?: string;
        datapack_id?: string;
        name?: string;
        datapack_name?: string;
      };
      const dpList = await this.callMcpTool<
        | DatapackEntry[]
        | {
            datapacks?: DatapackEntry[];
            results?: DatapackEntry[];
            items?: DatapackEntry[];
          }
      >("datapack_list", {
        conversation_id: this.conversationId
      });

      const entries = Array.isArray(dpList)
        ? dpList
        : (dpList.datapacks ?? dpList.results ?? dpList.items ?? []);
      const targetLower = this.datapack.toLowerCase();
      const matched = entries.find((item) => {
        const name = item.datapack_name ?? item.name;
        return (
          name?.toLowerCase() === targetLower ||
          item.datapack_id === this.datapack ||
          item.id === this.datapack
        );
      });
      if (matched) {
        const nextDatapackId = matched.datapack_id ?? matched.id ?? this.datapackId;
        this.datapackId = nextDatapackId;
        this.resolvedDatapackName = matched.datapack_name ?? matched.name ?? this.datapack;

        if (nextDatapackId && nextDatapackId !== bootstrapDatapackId) {
          const targetConv = await this.callMcpTool<{
            id?: string;
            conversation_id?: string;
          }>("conversation_create", {
            agent_id: this.defaultAgentId,
            session_id: "standards-guard-governance-session",
            title: "Meko Standards Guard Governance Session",
            datapack_id: nextDatapackId
          });
          this.conversationId =
            targetConv.id ?? targetConv.conversation_id ?? this.conversationId;
        }
      }
    } catch {
      // Keep the caller's resolved default datapack if datapack_list cannot inspect org datapacks.
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
    this.conversationId = null;
  }

  getQuotaUsage(): QuotaUsage {
    return { ...this.quota };
  }

  private normalizeMemoryRecord(
    raw: Record<string, unknown>,
    fallbackTier: "private" | "shared" = "private"
  ): MemoryRecord {
    let parsedMeta: Record<string, unknown> = {};
    if (typeof raw.metadata === "string") {
      try {
        parsedMeta = JSON.parse(raw.metadata) as Record<string, unknown>;
      } catch {
        parsedMeta = {};
      }
    } else if (raw.metadata && typeof raw.metadata === "object") {
      parsedMeta = raw.metadata as Record<string, unknown>;
    }

    const isPromoted =
      raw.promoted === true ||
      raw.is_promoted === true ||
      raw.scope === "shared" ||
      raw.tier === "shared" ||
      fallbackTier === "shared";
    const id = String(raw.id ?? raw.memory_id ?? `mem_${crypto.randomUUID().slice(0, 8)}`);
    const content = String(raw.text ?? raw.memory ?? raw.data ?? raw.content ?? "");
    const agentId = String(raw.agent_id ?? raw.agentId ?? "unknown");
    const contentRuleMatch = content.match(/^\[(S[1-8])\/ADR-\d{3}\]/i);
    const ruleId =
      typeof parsedMeta.ruleId === "string"
        ? parsedMeta.ruleId
        : typeof raw.rule_id === "string"
          ? raw.rule_id
          : contentRuleMatch
            ? contentRuleMatch[1].toUpperCase()
            : undefined;
    const tags = Array.isArray(parsedMeta.tags)
      ? parsedMeta.tags.map(String)
      : Array.isArray(raw.tags)
        ? raw.tags.map(String)
        : [];

    return {
      id,
      content,
      tier: isPromoted ? "shared" : "private",
      agentId,
      ruleId,
      tags,
      createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
      promotedAt:
        raw.promoted_at || raw.promotedAt
          ? String(raw.promoted_at ?? raw.promotedAt)
          : undefined,
      promotedBy:
        raw.promoted_by || raw.promotedBy
          ? String(raw.promoted_by ?? raw.promotedBy)
          : undefined,
      promotionReason:
        raw.promotion_reason || raw.promotionReason
          ? String(raw.promotion_reason ?? raw.promotionReason)
          : undefined
    };
  }

  private normalizeKnowledgeDoc(raw: Record<string, unknown>, idx: number): KnowledgeDocument {
    const content = String(raw.content ?? raw.chunk_text ?? raw.text ?? raw.chunk ?? "");
    const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const sectionTitle = /^Section:\s*/i.test(firstLine)
      ? firstLine.replace(/^Section:\s*/i, "").trim()
      : "";
    const filename = String(raw.filename ?? raw.title ?? raw.document_id ?? raw.id ?? `KB-${idx + 1}`);
    const matchSource = `${filename} ${sectionTitle} ${content}`;
    const adrMatch = matchSource.match(/\b(ADR-\d{3})\b/i);
    const ruleMatch = matchSource.match(/\b(S[1-8])\b/i);
    return {
      id: adrMatch?.[1]?.toUpperCase() ?? String(raw.document_id ?? raw.id ?? filename.replace(/\.md$/i, "")),
      ruleId: String(
        raw.ruleId ?? ruleMatch?.[1]?.toUpperCase() ?? adrMatch?.[1]?.toUpperCase() ?? "ADR"
      ),
      title: String(raw.title ?? raw.filename ?? (sectionTitle || filename)),
      content,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      updatedAt: String(raw.updated_at ?? raw.created_at ?? new Date().toISOString())
    };
  }

  async contextSearch(options: ContextSearchOptions): Promise<ContextSearchResult> {
    this.quota.searches += 1;
    this.quota.turns += 1;
    const { conversationId, datapackId } = this.requireSession();
    const [raw, promotedMemRes] = await Promise.all([
      this.callMcpTool<Record<string, unknown>>("context_search", {
        query: options.query,
        conversation_id: conversationId,
        datapack_id: datapackId,
        agent_id: options.agentId ? this.formatAgentId(options.agentId) : null,
        limit: options.limit ?? 8
      }),
      this.callMcpTool<
        | Array<Record<string, unknown>>
        | { memories?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
      >("memory_get_all", {
        conversation_id: conversationId,
        datapack_id: datapackId,
        promoted: true,
        page_size: 100
      }).catch(() => [])
    ]);

    const promotedList = Array.isArray(promotedMemRes)
      ? promotedMemRes
      : (promotedMemRes.memories ?? promotedMemRes.results ?? []);
    const promotedIds = new Set(
      promotedList
        .map((m) => String(m.id ?? m.memory_id ?? ""))
        .filter((id) => id.length > 0)
    );

    const container =
      raw.results && typeof raw.results === "object" && !Array.isArray(raw.results)
        ? (raw.results as Record<string, unknown>)
        : raw;

    const rawKb = Array.isArray(container.knowledge)
      ? container.knowledge
      : Array.isArray(container.knowledge_base)
        ? container.knowledge_base
        : Array.isArray(raw.knowledge)
          ? raw.knowledge
          : Array.isArray(raw.knowledge_base)
            ? raw.knowledge_base
            : [];
    const rawMem = Array.isArray(container.memories)
      ? container.memories
      : Array.isArray(container.memory)
        ? container.memory
        : Array.isArray(raw.memories)
          ? raw.memories
          : Array.isArray(raw.memory)
            ? raw.memory
            : [];

    const convObj =
      container.conversation && typeof container.conversation === "object"
        ? (container.conversation as Record<string, unknown>)
        : undefined;
    const rawConv = Array.isArray(container.conversations)
      ? container.conversations
      : Array.isArray(convObj?.hits)
        ? convObj.hits
        : Array.isArray(convObj?.thread)
          ? convObj.thread
          : Array.isArray(raw.conversations)
            ? raw.conversations
            : [];

    const rawSl = Array.isArray(container.selfLearning)
      ? container.selfLearning
      : Array.isArray(container.self_learning)
        ? container.self_learning
        : Array.isArray(raw.selfLearning)
          ? raw.selfLearning
          : Array.isArray(raw.self_learning)
            ? raw.self_learning
            : [];

    let knowledge = rawKb.map((item, idx) =>
      this.normalizeKnowledgeDoc((item ?? {}) as Record<string, unknown>, idx)
    );
    if (knowledge.length === 0 && datapackId) {
      knowledge = await this.knowledgebaseSearch(
        options.query,
        Math.min(options.limit ?? 8, 5)
      ).catch(() => []);
    }

    const formattedIncludePrivate = options.includePrivateForAgent
      ? this.formatAgentId(options.includePrivateForAgent)
      : null;

    const memories = rawMem
      .map((item) => {
        const rec = (item ?? {}) as Record<string, unknown>;
        const id = String(rec.id ?? rec.memory_id ?? "");
        const fallbackTier = promotedIds.has(id) ? "shared" : "private";
        return this.normalizeMemoryRecord(rec, fallbackTier);
      })
      .filter((mem) => {
        if (mem.tier === "shared") {
          return true;
        }
        if (!options.includePrivateForAgent) {
          return false;
        }
        return (
          mem.agentId === options.includePrivateForAgent ||
          mem.agentId === formattedIncludePrivate
        );
      });

    return {
      query: options.query,
      knowledge,
      memories,
      conversations: rawConv.map((item, idx) => {
        const rec = (item ?? {}) as Record<string, unknown>;
        return {
          id: String(rec.id ?? `conv_${idx}`),
          author: String(rec.agent_id ?? rec.author ?? "agent"),
          role: "agent",
          content: String(rec.output ?? rec.content ?? rec.text ?? ""),
          createdAt: String(rec.created_at ?? new Date().toISOString())
        };
      }),
      selfLearning: rawSl.map((item, idx) => {
        const rec = (item ?? {}) as Record<string, unknown>;
        return {
          id: String(rec.id ?? `sl_${idx}`),
          agentId: String(rec.agent_id ?? this.defaultAgentId),
          ruleId: String(rec.rule_id ?? rec.category ?? "GENERAL"),
          pattern: String(rec.pattern ?? rec.shortfall ?? rec.query ?? ""),
          remediation: String(rec.remediation ?? rec.reason ?? ""),
          outcome: "violation_recorded",
          createdAt: String(rec.created_at ?? new Date().toISOString())
        };
      })
    };
  }

  async knowledgebaseUpload(
    doc: KnowledgeDocument
  ): Promise<{ id: string; updated: boolean }> {
    this.quota.uploads += 1;
    const { conversationId, datapackId } = this.requireSession();
    const buf = Buffer.from(doc.content, "utf8");
    const size = buf.byteLength;
    const contentHash = crypto.createHash("sha256").update(buf).digest("hex");
    const contentHeadBase64 = buf.subarray(0, 3072).toString("base64");
    const filename = doc.id.endsWith(".md") ? doc.id : `${doc.id}.md`;

    const res = await this.callMcpTool<{
      already_uploaded?: boolean;
      url?: string;
      fields?: Record<string, string>;
      key?: string;
    }>("knowledgebase_upload_document", {
      filename,
      size,
      content_hash: contentHash,
      content_head_base64: contentHeadBase64,
      conversation_id: conversationId,
      datapack_id: datapackId,
      agent_id: this.defaultAgentId
    });

    if (res.already_uploaded === true || !res.url) {
      return { id: doc.id, updated: true };
    }

    const formData = new FormData();
    if (res.fields) {
      for (const [key, value] of Object.entries(res.fields)) {
        formData.append(key, String(value));
      }
    }
    formData.append("file", new Blob([buf], { type: "text/markdown" }), filename);

    const uploadRes = await fetch(res.url, {
      method: "POST",
      body: formData
    });
    if (!uploadRes.ok) {
      const bodyText = await uploadRes.text().catch(() => "");
      throw new Error(
        `S3 upload failed for ${filename}: HTTP ${uploadRes.status}${bodyText ? ` ${bodyText}` : ""}`
      );
    }

    return { id: doc.id, updated: false };
  }

  async knowledgebaseSearch(query: string, limit = 8): Promise<KnowledgeDocument[]> {
    this.quota.searches += 1;
    const { conversationId, datapackId } = this.requireSession();
    if (!datapackId) {
      throw new Error("datapack_id is required for live knowledgebase_search.");
    }
    const raw = await this.callMcpTool<
      | Array<Record<string, unknown>>
      | {
          results?: Array<Record<string, unknown>>;
          chunks?: Array<Record<string, unknown>>;
          documents?: Array<Record<string, unknown>>;
        }
    >("knowledgebase_search", {
      query,
      conversation_id: conversationId,
      datapack_id: datapackId,
      limit
    });
    const list = Array.isArray(raw)
      ? raw
      : (raw.results ?? raw.chunks ?? raw.documents ?? []);
    return list.map((item, idx) => this.normalizeKnowledgeDoc(item, idx));
  }

  async memoryAdd(
    input: Omit<MemoryRecord, "id" | "tier" | "createdAt">
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    const { conversationId, datapackId } = this.requireSession();
    const res = await this.callMcpTool<{
      id?: string;
      memory_id?: string;
      results?: Array<{ id?: string }>;
    }>("memory_add", {
      text: input.content,
      conversation_id: conversationId,
      datapack_id: datapackId,
      agent_id: this.formatAgentId(input.agentId),
      metadata: JSON.stringify({
        ruleId: input.ruleId,
        tags: input.tags,
        source: "standards-guard"
      })
    });

    const id =
      res.id ?? res.memory_id ?? res.results?.[0]?.id ?? `mem_${crypto.randomUUID().slice(0, 8)}`;

    return {
      id,
      content: input.content,
      tier: "private",
      agentId: input.agentId,
      ruleId: input.ruleId,
      tags: input.tags,
      createdAt: new Date().toISOString()
    };
  }

  async memorySearch(
    query: string,
    options?: { tier?: "private" | "shared" | "all"; agentId?: string; limit?: number }
  ): Promise<MemoryRecord[]> {
    this.quota.searches += 1;
    const { conversationId, datapackId } = this.requireSession();
    const raw = await this.callMcpTool<
      Array<Record<string, unknown>> | { results?: Array<Record<string, unknown>> }
    >("memory_search", {
      query,
      conversation_id: conversationId,
      datapack_id: datapackId,
      agent_id: options?.agentId ? this.formatAgentId(options.agentId) : null,
      limit: options?.limit ?? 8
    });
    const list = Array.isArray(raw) ? raw : (raw.results ?? []);
    return list.map((item) => this.normalizeMemoryRecord(item));
  }

  async memoryPromote(
    memoryId: string,
    promotedBy: string,
    reason: string
  ): Promise<MemoryRecord> {
    this.quota.memoryAdds += 1;
    const { conversationId, datapackId } = this.requireSession();
    await this.callMcpTool<Record<string, unknown>>("memory_promote", {
      conversation_id: conversationId,
      memory_ids: [memoryId],
      datapack_id: datapackId
    });

    return {
      id: memoryId,
      content: `Promoted memory ${memoryId}`,
      tier: "shared",
      agentId: "shared",
      tags: [],
      createdAt: new Date().toISOString(),
      promotedAt: new Date().toISOString(),
      promotedBy,
      promotionReason: reason
    };
  }

  async conversationAddMessage(
    msg: Omit<ConversationMessage, "id" | "createdAt">
  ): Promise<ConversationMessage> {
    this.quota.turns += 1;
    const { conversationId, datapackId } = this.requireSession();
    const res = await this.callMcpTool<{ id?: string; message_id?: string; created_at?: string }>(
      "conversation_add_message",
      {
        conversation_id: conversationId,
        datapack_id: datapackId,
        agent_id: this.defaultAgentId,
        input: `[${msg.role}] ${msg.author}`,
        output: msg.content,
        reasoning: msg.relatedMemoryId
          ? `Governance audit linked to memory ${msg.relatedMemoryId}`
          : "Standards Guard governance event",
        metadata: JSON.stringify({
          author: msg.author,
          role: msg.role,
          relatedMemoryId: msg.relatedMemoryId
        })
      }
    );

    return {
      id: res.id ?? res.message_id ?? `conv_${crypto.randomUUID().slice(0, 8)}`,
      author: msg.author,
      role: msg.role,
      content: msg.content,
      relatedMemoryId: msg.relatedMemoryId,
      createdAt: res.created_at ?? new Date().toISOString()
    };
  }

  async artifactPut(name: string, payload: unknown): Promise<ArtifactRecord> {
    this.quota.artifacts += 1;
    const { conversationId, datapackId } = this.requireSession();
    const canonical = canonicalStringify(payload);
    const buf = Buffer.from(canonical, "utf8");
    const localHash = computeContentHash(payload);

    const res = await this.callMcpTool<{
      content_hash?: string;
      contentHash?: string;
      created_at?: string;
      createdAt?: string;
    }>("artifact_put", {
      filename: name,
      content_base64: buf.toString("base64"),
      content_type: "application/json",
      conversation_id: conversationId,
      datapack_id: datapackId,
      agent_id: this.defaultAgentId
    });

    return {
      name,
      contentHash: res.content_hash ?? res.contentHash ?? localHash,
      payload,
      createdAt: res.created_at ?? res.createdAt ?? new Date().toISOString()
    };
  }

  async artifactGet(contentHash: string): Promise<ArtifactRecord | null> {
    const { conversationId, datapackId } = this.requireSession();
    try {
      const res = await this.callMcpTool<Record<string, unknown> | null>("artifact_get", {
        content_hash: contentHash,
        conversation_id: conversationId,
        datapack_id: datapackId,
        agent_id: this.defaultAgentId
      });
      if (!res) {
        return null;
      }
      let payload: unknown = res.payload ?? null;
      if (!payload && typeof res.content_base64 === "string") {
        const decoded = Buffer.from(res.content_base64, "base64").toString("utf8");
        try {
          payload = JSON.parse(decoded) as unknown;
        } catch {
          payload = decoded;
        }
      }
      return {
        name: String(res.filename ?? res.name ?? contentHash),
        contentHash: String(res.content_hash ?? res.contentHash ?? contentHash),
        payload,
        createdAt: String(res.created_at ?? res.createdAt ?? new Date().toISOString())
      };
    } catch {
      return null;
    }
  }

  async selfLearningRecord(
    signal: Omit<SelfLearningSignal, "id" | "createdAt">
  ): Promise<SelfLearningSignal> {
    this.quota.turns += 1;
    const { conversationId, datapackId } = this.requireSession();
    const res = await this.callMcpTool<{ id?: string; message_id?: string; created_at?: string }>(
      "conversation_add_message",
      {
        conversation_id: conversationId,
        datapack_id: datapackId,
        agent_id: this.defaultAgentId,
        input: `[self-learning:${signal.outcome}] ${signal.ruleId} by ${signal.agentId}`,
        output: `${signal.pattern} | Remediation: ${signal.remediation}`,
        reasoning: `Recorded ${signal.outcome} telemetry for rule ${signal.ruleId}`,
        metadata: JSON.stringify({
          type: "self_learning_signal",
          ...signal
        })
      }
    );

    return {
      id: res.id ?? res.message_id ?? `sl_${crypto.randomUUID().slice(0, 8)}`,
      agentId: signal.agentId,
      ruleId: signal.ruleId,
      pattern: signal.pattern,
      remediation: signal.remediation,
      outcome: signal.outcome,
      createdAt: res.created_at ?? new Date().toISOString()
    };
  }

  async getSnapshot(): Promise<DatapackSnapshot> {
    const { conversationId, datapackId } = this.requireSession();

    const [describeRes, privateMemRes, sharedMemRes, convListRes, slStatusRes] =
      await Promise.all([
        datapackId
          ? this.callMcpTool<Record<string, unknown>>("datapack_describe", {
              datapack_id: datapackId,
              include_status: true,
              conversation_id: conversationId
            }).catch(() => ({} as Record<string, unknown>))
          : Promise.resolve({} as Record<string, unknown>),
        this.callMcpTool<
          Array<Record<string, unknown>> | { memories?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
        >("memory_get_all", {
          conversation_id: conversationId,
          datapack_id: datapackId,
          promoted: false,
          page_size: 50
        }).catch(() => []),
        this.callMcpTool<
          Array<Record<string, unknown>> | { memories?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
        >("memory_get_all", {
          conversation_id: conversationId,
          datapack_id: datapackId,
          promoted: true,
          page_size: 50
        }).catch(() => []),
        this.callMcpTool<{ conversations?: Array<Record<string, unknown>> }>("conversation_list", {
          conversation_id: conversationId,
          datapack_id: datapackId,
          limit: 20
        }).catch(() => ({ conversations: [] })),
        this.callMcpTool<Record<string, unknown>>("selflearning_status", {
          conversation_id: conversationId,
          datapack_id: datapackId
        }).catch(() => ({} as Record<string, unknown>))
      ]);

    const kbFileCount = describeRes.knowledge_base_file_count;
    const kbChunkCount = describeRes.knowledge_chunk_count;
    const statusObj =
      describeRes.status && typeof describeRes.status === "object"
        ? (describeRes.status as Record<string, unknown>)
        : undefined;
    const statusKbCount = statusObj?.knowledge_base_count;

    let kbCount = 0;
    let kbLabel = "Indexed Knowledge Document";
    if (typeof kbFileCount === "number" && kbFileCount > 0) {
      kbCount = kbFileCount;
    } else if (typeof kbChunkCount === "number" && kbChunkCount > 0) {
      kbCount = kbChunkCount;
      kbLabel = "Indexed Knowledge Chunk";
    } else if (typeof statusKbCount === "number" && statusKbCount > 0) {
      kbCount = statusKbCount;
    }

    const knowledge: KnowledgeDocument[] = Array.from({ length: kbCount }, (_, idx) => ({
      id: `KB-${idx + 1}`,
      ruleId: "ADR",
      title: `${kbLabel} #${idx + 1}`,
      content: "",
      tags: ["indexed"],
      updatedAt: new Date().toISOString()
    }));

    const extractMemList = (
      val:
        | Array<Record<string, unknown>>
        | { memories?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
    ): Array<Record<string, unknown>> =>
      Array.isArray(val) ? val : (val.memories ?? val.results ?? []);

    const privateMemories = extractMemList(privateMemRes).map((m) =>
      this.normalizeMemoryRecord(m, "private")
    );
    const sharedMemories = extractMemList(sharedMemRes).map((m) =>
      this.normalizeMemoryRecord(m, "shared")
    );

    const conversations: ConversationMessage[] = (convListRes.conversations ?? []).map(
      (c, idx) => ({
        id: String(c.id ?? c.conversation_id ?? `conv_${idx}`),
        author: String(c.agent_id ?? "agent"),
        role: "agent",
        content: String(c.title ?? c.name ?? "Conversation session"),
        createdAt: String(c.created_at ?? new Date().toISOString())
      })
    );

    const openFixes = Array.isArray(slStatusRes.open_fixes)
      ? slStatusRes.open_fixes
      : Array.isArray(slStatusRes.todos)
        ? slStatusRes.todos
        : [];
    const selfLearning: SelfLearningSignal[] = openFixes.map((fix, idx) => {
      const rec = (fix ?? {}) as Record<string, unknown>;
      return {
        id: String(rec.id ?? `sl_${idx}`),
        agentId: this.defaultAgentId,
        ruleId: String(rec.shortfall ?? rec.id ?? "GENERAL"),
        pattern: String(rec.shortfall ?? rec.id ?? "self_learning"),
        remediation: `Open Meko fix (${String(rec.searches ?? 0)} searches)`,
        outcome: "violation_recorded",
        createdAt: new Date().toISOString()
      };
    });

    return {
      datapack: this.resolvedDatapackName,
      knowledge,
      memories: [...privateMemories, ...sharedMemories],
      conversations,
      artifacts: [],
      selfLearning
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
