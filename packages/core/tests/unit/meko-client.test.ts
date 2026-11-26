import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LiveMekoClient,
  MockMekoClient,
  readLiveEventLedger,
  recordLiveEventLedger
} from "../../src/meko-client.js";

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

describe("Live event ledger", () => {
  it("returns empty arrays when the ledger file is missing", () => {
    const missing = path.join(os.tmpdir(), `meko-missing-${Date.now()}`, "live-events.json");
    expect(readLiveEventLedger(missing)).toEqual({
      artifacts: [],
      selfLearning: [],
      conversations: []
    });
  });

  it("persists and deduplicates artifacts, selfLearning signals, and conversations", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-live-ledger-"));
    try {
      const ledgerPath = path.join(tmpDir, ".guard-state", "live-events.json");
      const now = new Date().toISOString();

      recordLiveEventLedger(ledgerPath, {
        selfLearning: [
          {
            id: "sl_open1",
            agentId: "opencode",
            ruleId: "ALL",
            pattern: "guard_check_passed",
            remediation: "Implementation satisfied all checked ADR invariants",
            outcome: "fix_verified",
            createdAt: now
          }
        ],
        conversations: [
          {
            id: "conv_rz1",
            author: "rizal",
            role: "maintainer",
            content: "Promoted mem_123 to shared",
            relatedMemoryId: "mem_123",
            createdAt: now
          }
        ],
        artifacts: [
          {
            name: "release-receipt-1.json",
            contentHash: "a".repeat(64),
            payload: { ok: true },
            createdAt: now
          }
        ]
      });

      // Re-record duplicates to verify deduplication by id / contentHash
      recordLiveEventLedger(ledgerPath, {
        selfLearning: [
          {
            id: "sl_open1",
            agentId: "opencode",
            ruleId: "ALL",
            pattern: "guard_check_passed",
            remediation: "Implementation satisfied all checked ADR invariants",
            outcome: "fix_verified",
            createdAt: now
          }
        ],
        conversations: [
          {
            id: "conv_rz1",
            author: "rizal",
            role: "maintainer",
            content: "Promoted mem_123 to shared",
            relatedMemoryId: "mem_123",
            createdAt: now
          }
        ],
        artifacts: [
          {
            name: "release-receipt-1.json",
            contentHash: "a".repeat(64),
            payload: { ok: true },
            createdAt: now
          }
        ]
      });

      const ledger = readLiveEventLedger(ledgerPath);
      expect(ledger.selfLearning).toHaveLength(1);
      expect(ledger.selfLearning[0]?.agentId).toBe("opencode");
      expect(ledger.selfLearning[0]?.outcome).toBe("fix_verified");
      expect(ledger.conversations).toHaveLength(1);
      expect(ledger.conversations[0]?.author).toBe("rizal");
      expect(ledger.artifacts).toHaveLength(1);
      expect(ledger.artifacts[0]?.contentHash).toBe("a".repeat(64));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
