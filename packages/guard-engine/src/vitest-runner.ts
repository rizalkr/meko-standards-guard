import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TestRunSummary } from "./types.js";

const execFileAsync = promisify(execFile);

interface VitestAssertionResult {
  fullName?: string;
  title?: string;
  status?: string;
  failureMessages?: string[];
}

interface VitestFileResult {
  name?: string;
  assertionResults?: VitestAssertionResult[];
}

interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  success?: boolean;
  startTime?: number;
  testResults?: VitestFileResult[];
}

function resolveVitestExecutable(rootDir: string): { cmd: string; baseArgs: string[] } {
  const localBin = path.join(rootDir, "node_modules", ".bin", "vitest");
  if (fs.existsSync(localBin)) {
    return { cmd: localBin, baseArgs: [] };
  }
  return { cmd: "npx", baseArgs: ["vitest"] };
}

function parseVitestJson(stdout: string): VitestJsonReport | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as VitestJsonReport;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as VitestJsonReport;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * Runs non-interactive `vitest run --reporter=json` on the targeted test suite
 * and returns a structured TestRunSummary without throwing on failing tests.
 */
export async function runVitestInvariants(options: {
  rootDir: string;
  target?: string;
  timeoutMs?: number;
}): Promise<TestRunSummary> {
  const { rootDir, target = "packages/payledger/tests", timeoutMs = 60_000 } = options;
  const { cmd, baseArgs } = resolveVitestExecutable(rootDir);
  const args = [...baseArgs, "run", "--reporter=json", target];
  const startedAt = Date.now();

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    const result = await execFileAsync(cmd, args, {
      cwd: rootDir,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    exitCode = typeof err.code === "number" ? err.code : 1;
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? err.message ?? "";
  }

  const durationMs = Date.now() - startedAt;
  const parsed = parseVitestJson(stdout);

  if (!parsed) {
    return {
      executed: true,
      passed: false,
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 1,
      durationMs,
      failedTests: [
        {
          name: "vitest_execution",
          file: target,
          message: stderr.trim() || stdout.trim() || `Vitest exited with code ${exitCode}`
        }
      ],
      output: [stdout, stderr].filter(Boolean).join("\n")
    };
  }

  const failedTests: Array<{ name: string; file: string; message: string }> = [];
  for (const fileResult of parsed.testResults ?? []) {
    const filePath = fileResult.name ?? target;
    for (const assertion of fileResult.assertionResults ?? []) {
      if (assertion.status === "failed") {
        failedTests.push({
          name: assertion.fullName ?? assertion.title ?? "unknown_test",
          file: path.relative(rootDir, filePath).split(path.sep).join("/"),
          message: (assertion.failureMessages ?? []).join("\n") || "Test failed"
        });
      }
    }
  }

  const numTotalTests = parsed.numTotalTests ?? 0;
  const numPassedTests = parsed.numPassedTests ?? 0;
  const numFailedTests = parsed.numFailedTests ?? failedTests.length;

  return {
    executed: true,
    passed: exitCode === 0 && (parsed.success ?? numFailedTests === 0),
    numTotalTests,
    numPassedTests,
    numFailedTests,
    durationMs,
    failedTests,
    output: [stdout, stderr].filter(Boolean).join("\n")
  };
}
