import path from "node:path";
import { loadGuardConfig } from "@meko-guard/core";
import { Project } from "ts-morph";
import { checkGovernanceDiff, runAstChecks } from "./ast-checker.js";
import { buildRulesMap, collectTsFiles, toRepoRelative } from "./helpers.js";
import { runPiiTaintAnalysis } from "./pii-taint.js";
import type { GuardCheckOptions, GuardReport, Violation } from "./types.js";
import { runVitestInvariants } from "./vitest-runner.js";

export * from "./types.js";
export * from "./ast-checker.js";
export * from "./pii-taint.js";
export * from "./spec-checker.js";
export * from "./blast-radius.js";
export * from "./vitest-runner.js";

function sortViolations(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.ruleId.localeCompare(b.ruleId);
  });
}

function buildSummary(violations: readonly Violation[]): GuardReport["summary"] {
  let errors = 0;
  let warnings = 0;
  const byRule: Record<string, number> = {};

  for (const v of violations) {
    if (v.severity === "warning") {
      warnings += 1;
    } else {
      errors += 1;
    }
    byRule[v.ruleId] = (byRule[v.ruleId] ?? 0) + 1;
  }

  return {
    totalViolations: violations.length,
    errors,
    warnings,
    byRule
  };
}

/**
 * Runs the full Meko Standards Guard check pipeline:
 * 1) ts-morph AST checks (S1, S2, S3, S5, S6, S7)
 * 2) Financial PII taint flow analysis (S4)
 * 3) Governance policy diff guard (S8)
 * 4) Optional dynamic Vitest invariant runner
 */
export async function runGuardCheck(options: GuardCheckOptions): Promise<GuardReport> {
  const { rootDir } = options;
  const config = options.config ?? loadGuardConfig(rootDir);
  const rulesById = buildRulesMap(config);

  const rawFiles =
    options.targetFiles && options.targetFiles.length > 0
      ? options.targetFiles.map((f) => (path.isAbsolute(f) ? f : path.resolve(rootDir, f)))
      : collectTsFiles(path.resolve(rootDir, config.targetDir, "src"));

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, strict: true }
  });

  const sourceFiles = rawFiles.map((filePath) => project.addSourceFileAtPath(filePath));
  const checkedFiles = sourceFiles.map((sf) => toRepoRelative(rootDir, sf.getFilePath())).sort();

  const rawViolations: Violation[] = [
    ...runAstChecks(sourceFiles, rootDir, rulesById),
    ...runPiiTaintAnalysis(sourceFiles, rootDir, rulesById),
    ...checkGovernanceDiff(rootDir, config, options.changedFiles, options.allowPolicyEdit)
  ];

  const violations = sortViolations(rawViolations);
  const summary = buildSummary(violations);

  const tests = options.runTests
    ? await runVitestInvariants({ rootDir, target: options.testTarget })
    : undefined;

  const passed = summary.errors === 0 && (tests ? tests.passed : true);

  return {
    passed,
    checkedFiles,
    violations,
    tests,
    summary,
    generatedAt: new Date().toISOString()
  };
}
