import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGuardCheck, runVitestInvariants } from "../../src/index.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

describe("PayLedger Mini baseline guard scan", () => {
  it("reports zero violations across real packages/payledger/src files", async () => {
    const report = await runGuardCheck({
      rootDir: REPO_ROOT,
      changedFiles: [],
      runTests: false
    });

    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.checkedFiles.length).toBeGreaterThanOrEqual(10);
    expect(report.summary.totalViolations).toBe(0);
  });

  it("executes targeted Vitest invariant suite via runVitestInvariants", async () => {
    const summary = await runVitestInvariants({
      rootDir: REPO_ROOT,
      target: "packages/payledger/tests/unit/money.test.ts"
    });

    expect(summary.executed).toBe(true);
    expect(summary.passed).toBe(true);
    expect(summary.numPassedTests).toBe(3);
    expect(summary.numFailedTests).toBe(0);
  }, 30_000);
});
