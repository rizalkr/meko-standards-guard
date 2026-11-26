import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockMekoClient } from "@meko-guard/core";
import {
  BENCHMARK_TASKS,
  RecordedBenchmarkSchema,
  benchDryRunAction,
  benchScoreAction,
  countTokens,
  initBenchmarkManifest
} from "../../src/index.js";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../../..");
const COMMITTED_FIXTURE = path.join(ROOT_DIR, "fixtures/meko/mock-datapack.json");
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-cli-bench-"));
  tempDirs.push(dir);
  return dir;
}

function copyMockFixture(tmpDir: string): string {
  const target = path.join(tmpDir, "mock-datapack.json");
  fs.copyFileSync(COMMITTED_FIXTURE, target);
  return target;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("guard-cli bench harness (tiktoken/cl100k_base)", () => {
  it("counts tokens deterministically with cl100k_base", () => {
    expect(countTokens("")).toBe(0);
    const shortCount = countTokens("Implement POST /refunds with idempotent REVERSAL.");
    const longerCount = countTokens(
      "Implement POST /refunds with idempotent REVERSAL and S1-S4 ADR enforcement."
    );
    expect(shortCount).toBeGreaterThan(0);
    expect(longerCount).toBeGreaterThan(shortCount);
    expect(countTokens("Implement POST /refunds with idempotent REVERSAL.")).toBe(shortCount);
  });

  it("runs offline dry-run prompt-budget comparison across T1-T5 without modifying results.json", async () => {
    const tmp = createTempDir();
    const fixturePath = copyMockFixture(tmp);
    const resultsPath = path.join(ROOT_DIR, "fixtures/benchmark/results.json");
    const beforeContent = fs.existsSync(resultsPath)
      ? fs.readFileSync(resultsPath, "utf8")
      : null;

    const dryRun = await benchDryRunAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      agentId: "opencode"
    });

    expect(dryRun.tokenizer).toBe("tiktoken/cl100k_base");
    expect(dryRun.wroteResultsFile).toBe(false);
    expect(dryRun.tasks).toHaveLength(5);
    expect(dryRun.tasks.map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(dryRun.guardedTotalTokens).toBeLessThan(dryRun.baselineTotalTokens);
    for (const task of dryRun.tasks) {
      expect(task.matchedAdrIds.length).toBeGreaterThan(0);
      expect(task.guardedMekoTokens).toBeLessThan(task.baselineFullAdrTokens);
    }
    const afterContent = fs.existsSync(resultsPath)
      ? fs.readFileSync(resultsPath, "utf8")
      : null;
    expect(afterContent).toBe(beforeContent);
  });

  it("scores a Cursor vs. OpenCode manifest, validates RecordedBenchmarkSchema, and stores Meko artifact", async () => {
    const tmp = createTempDir();
    const fixturePath = copyMockFixture(tmp);

    const badFile = path.join(tmp, "cursor-t1-refund.ts");
    fs.writeFileSync(
      badFile,
      [
        "export function handleRefund(db: any, ledgerEntries: any, amountCents: number, merchant: any) {",
        "  const feeCents = amountCents * 0.025;",
        "  db.update(ledgerEntries).set({ debitCents: 0 }).run();",
        "  console.log({ account: merchant.bank_account_number });",
        "  return { feeCents };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const cleanFile = path.join(tmp, "opencode-t1-refund.ts");
    fs.writeFileSync(
      cleanFile,
      [
        "export function handleRefundClean(amountCents: number) {",
        "  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {",
        '    throw new Error("Invalid amountCents");',
        "  }",
        "  return { refundAmountCents: amountCents };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const manifestPath = path.join(tmp, "run-manifest.json");
    const outPath = path.join(tmp, "out", "results.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          baselineAgent: "cursor",
          guardedAgent: "opencode",
          tasks: [
            {
              id: "T1",
              baseline: {
                agent: "cursor",
                promptTexts: [
                  BENCHMARK_TASKS[0].taskPrompt,
                  "Retry turn after fixing float math and ledger mutation."
                ],
                files: ["cursor-t1-refund.ts"],
                correctionTurns: 2
              },
              guarded: {
                agent: "opencode",
                promptTexts: [BENCHMARK_TASKS[0].taskPrompt],
                files: ["opencode-t1-refund.ts"],
                correctionTurns: 0
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const scored = await benchScoreAction({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath,
      inputPath: manifestPath,
      outPath,
      recordArtifact: true
    });

    const row = scored.recorded.tasks[0];
    expect(row.id).toBe("T1");
    expect(row.baseline.violations).toBeGreaterThanOrEqual(3);
    expect(row.baseline.passedFirstTry).toBe(false);
    expect(row.guarded.violations).toBe(0);
    expect(row.guarded.passedFirstTry).toBe(true);
    expect(scored.summary.violationReductionPct).toBe(100);

    expect(fs.existsSync(outPath)).toBe(true);
    const writtenJson = JSON.parse(fs.readFileSync(outPath, "utf8")) as unknown;
    const validated = RecordedBenchmarkSchema.parse(writtenJson);
    expect(validated.tokenizer).toBe("tiktoken/cl100k_base");

    expect(scored.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    const verifyClient = new MockMekoClient({
      datapack: "payledger-standards-guard",
      fixturePath
    });
    await verifyClient.connect();
    const fetchedArtifact = await verifyClient.artifactGet(scored.artifactHash!);
    await verifyClient.close();
    expect(fetchedArtifact?.name).toBe("benchmark-results.json");
  });

  it("throws a clear error when a manifest references a missing TypeScript file", async () => {
    const tmp = createTempDir();
    const manifestPath = path.join(tmp, "bad-manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        tasks: [
          {
            id: "T1",
            baseline: {
              promptTokens: 100,
              files: ["does-not-exist.ts"],
              correctionTurns: 1
            },
            guarded: {
              promptTokens: 80,
              files: ["does-not-exist.ts"],
              correctionTurns: 0
            }
          }
        ]
      }),
      "utf8"
    );

    await expect(
      benchScoreAction({
        rootDir: ROOT_DIR,
        mode: "mock",
        inputPath: manifestPath
      })
    ).rejects.toThrow(/not found/);
  });

  it("generates a 5-task starter manifest targeting cursor vs opencode", () => {
    const tmp = createTempDir();
    const manifestPath = path.join(tmp, "starter-manifest.json");
    const init = initBenchmarkManifest(manifestPath, {
      rootDir: ROOT_DIR,
      baselineAgent: "cursor",
      guardedAgent: "opencode"
    });

    expect(init.taskCount).toBe(5);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      baselineAgent: string;
      guardedAgent: string;
      tasks: Array<{ id: string }>;
    };
    expect(parsed.baselineAgent).toBe("cursor");
    expect(parsed.guardedAgent).toBe("opencode");
    expect(parsed.tasks.map((t) => t.id)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
  });
});
