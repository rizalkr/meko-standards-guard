import fs from "node:fs";
import path from "node:path";
import type { GuardConfig, RuleDefinition } from "@meko-guard/core";
import type { Node } from "ts-morph";
import type { Violation } from "./types.js";

const DEFAULT_ADR_MAP: Record<string, string> = {
  S1: "ADR-001",
  S2: "ADR-002",
  S3: "ADR-003",
  S4: "ADR-004",
  S5: "ADR-005",
  S6: "ADR-006",
  S7: "ADR-007",
  S8: "ADR-008"
};

/**
 * Converts an absolute or relative path into a POSIX repo-relative path.
 */
export function toRepoRelative(rootDir: string, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  return path.relative(rootDir, abs).split(path.sep).join("/");
}

/**
 * Builds a Map<ruleId, RuleDefinition> from GuardConfig.
 */
export function buildRulesMap(config: GuardConfig): Map<string, RuleDefinition> {
  return new Map(config.rules.map((rule) => [rule.id, rule]));
}

/**
 * Creates a structured Violation object populated with ADR metadata from config.
 */
export function makeViolation(
  rulesById: Map<string, RuleDefinition>,
  ruleId: string,
  details: {
    file: string;
    line: number;
    column?: number;
    message: string;
    snippet?: string;
    remediation: string;
    trace?: string[];
  }
): Violation {
  const rule = rulesById.get(ruleId);
  return {
    ruleId,
    adrId: rule?.adrId ?? DEFAULT_ADR_MAP[ruleId] ?? ruleId,
    severity: rule?.severity ?? "error",
    file: details.file,
    line: details.line,
    column: details.column,
    message: details.message,
    snippet: details.snippet,
    remediation: details.remediation,
    trace: details.trace
  };
}

/**
 * Returns 1-based line and column plus trimmed snippet for a ts-morph AST node.
 */
export function getNodeLocation(node: Node): {
  line: number;
  column: number;
  snippet: string;
} {
  const sourceFile = node.getSourceFile();
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
  const rawText = node.getText().replace(/\s+/g, " ").trim();
  const snippet = rawText.length > 140 ? `${rawText.slice(0, 137)}...` : rawText;
  return { line, column, snippet };
}

/**
 * Recursively collects all `.ts` files under a directory in sorted POSIX order.
 */
export function collectTsFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}
