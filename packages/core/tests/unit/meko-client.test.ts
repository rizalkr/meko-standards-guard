import { describe, expect, it } from "vitest";
import { LiveMekoClient, MockMekoClient } from "../../src/meko-client.js";

describe("MockMekoClient 5-pillar behavior", () => {
  it("isolates private memories by agentId until promoted to shared", async () => {
    const client = new MockMekoClient({ datapack: "test-pack" });
    await client.connect();

    const candidate = await client.memoryAdd({
      agentId: "cursor",
      ruleId: "S2",
      content: "POST /refunds must validate Idempotency-Key header",
      tags: ["idempotency", "refunds"]
    });
    expect(candidate.tier).toBe("private");

    const opencodeBefore = await client.contextSearch({
      query: "refunds idempotency",
      agentId: "opencode"
    });
    expect(opencodeBefore.memories).toHaveLength(0);

    const cursorOwn = await client.contextSearch({
      query: "refunds idempotency",
      includePrivateForAgent: "cursor"
    });
    expect(cursorOwn.memories).toHaveLength(1);

    const promoted = await client.memoryPromote(
      candidate.id,
      "maintainer",
      "Confirmed missing Idempotency-Key check"
    );
    expect(promoted.tier).toBe("shared");

    const opencodeAfter = await client.contextSearch({
      query: "refunds idempotency",
      agentId: "opencode"
    });
    expect(opencodeAfter.memories).toHaveLength(1);
    expect(opencodeAfter.memories[0]?.id).toBe(candidate.id);
  });

  it("stores content-addressed artifacts idempotently", async () => {
    const client = new MockMekoClient({ datapack: "test-pack" });
    await client.connect();

    const first = await client.artifactPut("receipt.json", { b: 2, a: 1 });
    const second = await client.artifactPut("receipt.json", { a: 1, b: 2 });

    expect(first.contentHash).toBe(second.contentHash);
    expect(client.getQuotaUsage().artifacts).toBe(1);

    const fetched = await client.artifactGet(first.contentHash);
    expect(fetched?.name).toBe("receipt.json");
  });

  it("links knowledge ADRs, conversations, and self-learning signals in contextSearch", async () => {
    const client = new MockMekoClient({ datapack: "test-pack" });
    await client.connect();

    await client.knowledgebaseUpload({
      id: "ADR-003",
      ruleId: "S3",
      title: "Append-Only Ledger",
      content: "Never update or delete ledger_entries rows.",
      tags: ["ledger", "append-only"],
      updatedAt: new Date().toISOString()
    });
    await client.conversationAddMessage({
      author: "maintainer",
      role: "maintainer",
      content: "Approved append-only ledger rule after refund review"
    });
    await client.selfLearningRecord({
      agentId: "cursor",
      ruleId: "S3",
      pattern: "db.update(ledgerEntries)",
      remediation: "Insert a REVERSAL entry instead",
      outcome: "violation_recorded"
    });

    const result = await client.contextSearch({ query: "ledger reversal" });
    expect(result.knowledge).toHaveLength(1);
    expect(result.conversations).toHaveLength(1);
    expect(result.selfLearning).toHaveLength(1);
  });
});

describe("LiveMekoClient configuration guard", () => {
  it("fails fast when MEKO_API_TOKEN is missing", async () => {
    const client = new LiveMekoClient({
      datapack: "test-pack",
      apiToken: ""
    });
    await expect(client.connect()).rejects.toThrow(/MEKO_API_TOKEN is required/i);
  });
});
