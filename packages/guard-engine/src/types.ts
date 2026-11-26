import type { GuardConfig } from "@meko-guard/core";

export type ViolationSeverity = "error" | "warning";

export interface Violation {
  ruleId: string;
  adrId: string;
  severity: ViolationSeverity;
  file: string;
  line: number;
  column?: number;
  message: string;
  snippet?: string;
  remediation: string;
  trace?: string[];
}

export interface TestRunSummary {
  executed: boolean;
  passed: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  durationMs: number;
  failedTests: Array<{ name: string; file: string; message: string }>;
  output: string;
}

export interface GuardCheckOptions {
  rootDir: string;
  config?: GuardConfig;
  targetFiles?: string[];
  changedFiles?: string[];
  allowPolicyEdit?: boolean;
  runTests?: boolean;
  testTarget?: string;
}

export interface GuardReport {
  passed: boolean;
  checkedFiles: string[];
  violations: Violation[];
  tests?: TestRunSummary;
  summary: {
    totalViolations: number;
    errors: number;
    warnings: number;
    byRule: Record<string, number>;
  };
  generatedAt: string;
}

export interface SpecConflict {
  ruleId: string;
  adrId: string;
  line: number;
  excerpt: string;
  reason: string;
  remediation: string;
}

export interface SpecCheckResult {
  specFile: string;
  passed: boolean;
  conflicts: SpecConflict[];
  checkedRules: string[];
}

export interface BlastRadiusResult {
  query: string;
  ruleId: string;
  adrId: string;
  title: string;
  affectedFiles: string[];
  affectedRoutes: string[];
  affectedTests: string[];
}
