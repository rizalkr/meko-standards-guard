import type { DatapackSnapshot } from "@meko-guard/core";
import type { TimelineEvent } from "./types.js";

/**
 * Normalizes records across all 5 Meko primitives into a single reverse-chronological audit feed.
 */
export function buildTimelineEvents(snapshot: DatapackSnapshot): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const doc of snapshot.knowledge) {
    events.push({
      id: `kb:${doc.id}`,
      timestamp: doc.updatedAt,
      kind: "knowledge",
      actor: "standards-seed",
      ruleId: doc.ruleId,
      title: `${doc.id} (${doc.ruleId}) — ${doc.title}`,
      summary: `Canonical ADR indexed in Meko Knowledge Base (${doc.tags.join(", ")})`,
      metadata: {
        adrId: doc.id,
        ruleId: doc.ruleId,
        tags: doc.tags.join(", ")
      }
    });
  }

  for (const mem of snapshot.memories) {
    const isShared = mem.tier === "shared";
    events.push({
      id: `mem:${mem.id}`,
      timestamp: isShared && mem.promotedAt ? mem.promotedAt : mem.createdAt,
      kind: isShared ? "memory_shared" : "memory_private",
      actor: isShared && mem.promotedBy ? mem.promotedBy : mem.agentId,
      ruleId: mem.ruleId ?? null,
      title: isShared
        ? `Promoted to Shared Memory (${mem.ruleId ?? "general"})`
        : `Quarantined Private Memory from ${mem.agentId} (${mem.ruleId ?? "general"})`,
      summary:
        isShared && mem.promotionReason
          ? `${mem.content} | Promotion rationale: ${mem.promotionReason}`
          : mem.content,
      metadata: {
        memoryId: mem.id,
        tier: mem.tier,
        agentId: mem.agentId,
        promotedBy: mem.promotedBy ?? null,
        promotedAt: mem.promotedAt ?? null,
        createdAt: mem.createdAt
      }
    });
  }

  for (const msg of snapshot.conversations) {
    events.push({
      id: `conv:${msg.id}`,
      timestamp: msg.createdAt,
      kind: "conversation",
      actor: msg.author,
      ruleId: null,
      title: `Audit Log (${msg.role}) — ${msg.author}`,
      summary: msg.content,
      metadata: {
        conversationId: msg.id,
        role: msg.role,
        relatedMemoryId: msg.relatedMemoryId ?? null
      }
    });
  }

  for (const sig of snapshot.selfLearning) {
    events.push({
      id: `sl:${sig.id}`,
      timestamp: sig.createdAt,
      kind: "self_learning",
      actor: sig.agentId,
      ruleId: sig.ruleId,
      title:
        sig.outcome === "fix_verified"
          ? `Fix Verified by ${sig.agentId} (${sig.ruleId})`
          : `Violation Signal from ${sig.agentId} (${sig.ruleId})`,
      summary: `${sig.pattern} — Remediation: ${sig.remediation}`,
      metadata: {
        signalId: sig.id,
        outcome: sig.outcome,
        agentId: sig.agentId
      }
    });
  }

  for (const art of snapshot.artifacts) {
    events.push({
      id: `art:${art.name}:${art.contentHash.slice(0, 12)}`,
      timestamp: art.createdAt,
      kind: "artifact",
      actor: art.name.includes("release") ? "release-gate" : "standards-seed",
      ruleId: null,
      title: `Artifact Stored: ${art.name}`,
      summary: `Content-addressed SHA-256 artifact committed to Meko store`,
      metadata: {
        name: art.name,
        contentHash: art.contentHash
      }
    });
  }

  return events.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
