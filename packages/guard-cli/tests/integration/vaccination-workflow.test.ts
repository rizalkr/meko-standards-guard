import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveAction,
  checkAction,
  explainRuleAction,
  impactAction,
  preflightAction,
  queueAction,
  releaseGateAction,
  seedAction,
  specCheckAction,
  statusAction
} from "../../src/index.js";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../../..");
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-cli-vaccination-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("guard-cli cross-agent vaccination & ADLC workflow", () => {
  it("runs seed, spec-check, private quarantine, human promote, OpenCode vaccination, impact, and release-gate", async () => {
    const tmp = createTempDir();
    const fixturePath = path.join(tmp, "mock-datapack.json");

    // 1. Seed ADRs & inspect status
    const seeded = await seedAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath
    });
    expect(seeded.adrCount).toBe(8);
    expect(seeded.created).toBe(8);
    expect(seeded.artifactHash).toMatch(/^[a-f0-9]{64}$/);

    const status = await statusAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath
    });
    expect(status.knowledgeCount).toBe(8);
    expect(status.privateMemoryCount).toBe(0);
    expect(status.sharedMemoryCount).toBe(0);
    expect(status.artifactCount).toBe(1);

    // 2. Pre-implementation Spec Gate catches S2, S3, S4 in draft RFC
    const specResult = await specCheckAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      specFile: "specs/001-refunds-rfc.md"
    });
    expect(specResult.result.passed).toBe(false);
    const conflictRules = specResult.result.conflicts.map((c) => c.ruleId);
    expect(conflictRules).toEqual(expect.arrayContaining(["S2", "S3", "S4"]));
    expect(specResult.relatedKnowledge.length).toBeGreaterThan(0);

    // 3. Beat 1: Cursor introduces S1 + S3 violations -> blocked & quarantined to private memory
    const badRefundFile = path.join(tmp, "refund-service.ts");
    fs.writeFileSync(
      badRefundFile,
      [
        "export function issueBadRefund(db: any, ledgerEntries: any, amountCents: number) {",
        "  const feeCents = amountCents * 0.025;",
        "  db.update(ledgerEntries).set({ debitCents: 0 }).run();",
        "  return { feeCents };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const cursorCheck = await checkAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      agentId: "cursor",
      files: [badRefundFile],
      changedFiles: []
    });

    expect(cursorCheck.report.passed).toBe(false);
    expect(cursorCheck.report.summary.byRule.S1).toBeGreaterThanOrEqual(1);
    expect(cursorCheck.report.summary.byRule.S3).toBeGreaterThanOrEqual(1);
    expect(cursorCheck.recordedMemories).toHaveLength(2);
    expect(cursorCheck.recordedMemories.every((m) => m.tier === "private")).toBe(true);
    expect(cursorCheck.recordedMemories.every((m) => m.agentId === "cursor")).toBe(true);
    expect(cursorCheck.recordedSignals).toHaveLength(2);
    expect(
      cursorCheck.recordedSignals.every((s) => s.outcome === "violation_recorded")
    ).toBe(true);

    // 4. Cross-agent isolation before approval: OpenCode cannot see Cursor's private memory
    const opencodeBefore = await preflightAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      task: "ledger entries reversal",
      agentId: "opencode"
    });
    expect(opencodeBefore.knowledge.length).toBeGreaterThan(0);
    expect(opencodeBefore.memories).toHaveLength(0);

    const cursorPreflight = await preflightAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      task: "ledger entries reversal",
      agentId: "cursor"
    });
    expect(cursorPreflight.memories.length).toBeGreaterThanOrEqual(1);

    // 5. Maintainer inspects approval queue and promotes Cursor's S3 finding to shared tier
    const queue = await queueAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath
    });
    expect(queue.pending).toHaveLength(2);
    const s3Candidate = queue.pending.find((m) => m.ruleId === "S3");
    expect(s3Candidate).toBeDefined();

    const approved = await approveAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      memoryId: s3Candidate!.id,
      promotedBy: "rizal",
      reason: "Verified append-only REVERSAL lesson from refund incident review"
    });
    expect(approved.promoted.tier).toBe("shared");
    expect(approved.promoted.promotedBy).toBe("rizal");
    expect(approved.conversationEntry.relatedMemoryId).toBe(s3Candidate!.id);

    // 6. Beat 2: OpenCode in a fresh session now receives the promoted S3 lesson
    const opencodeAfter = await preflightAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      task: "ledger entries reversal",
      agentId: "opencode"
    });
    expect(opencodeAfter.memories).toHaveLength(1);
    expect(opencodeAfter.memories[0]?.id).toBe(s3Candidate!.id);
    expect(opencodeAfter.memories[0]?.tier).toBe("shared");

    // 7. Blast radius & rule explanation map ADR/Rule IDs to payledger source/routes/tests
    const s4Impact = impactAction({ rootDir: ROOT_DIR, ruleOrAdrId: "ADR-004" });
    expect(s4Impact.ruleId).toBe("S4");
    expect(s4Impact.affectedFiles).toContain("packages/payledger/src/accounts/dto.ts");
    expect(s4Impact.affectedRoutes.length).toBeGreaterThan(0);
    expect(s4Impact.affectedTests.length).toBeGreaterThan(0);

    const s3Explain = explainRuleAction({ rootDir: ROOT_DIR, ruleOrAdrId: "S3" });
    expect(s3Explain.adr.id).toBe("ADR-003");
    expect(s3Explain.adr.content).toContain("REVERSAL");

    // 8. Release Gate on clean payledger baseline emits deterministic SHA-256 artifact
    const gateFirst = await releaseGateAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      skipTests: true,
      allowPolicyEdit: true,
      actor: "rizal"
    });
    expect(gateFirst.passed).toBe(true);
    expect(gateFirst.receipt).not.toBeNull();
    expect(gateFirst.receipt!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(gateFirst.conversationEntry?.content).toContain(gateFirst.receipt!.contentHash);

    const gateSecond = await releaseGateAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      skipTests: true,
      allowPolicyEdit: true
    });
    expect(gateSecond.receipt!.contentHash).toBe(gateFirst.receipt!.contentHash);
  });
});
