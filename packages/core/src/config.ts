import fs from "node:fs";
import path from "node:path";
import { GuardConfigSchema, type GuardConfig, type KnowledgeDocument } from "./types.js";

/**
 * Loads and validates guard.config.json from the given repository root.
 */
export function loadGuardConfig(rootDir: string = process.cwd()): GuardConfig {
  const configPath = path.resolve(rootDir, "guard.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`guard.config.json not found at ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  return GuardConfigSchema.parse(raw);
}

/**
 * Extracts the first markdown H1 heading or falls back to the rule title.
 */
function extractHeading(markdown: string, fallbackTitle: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallbackTitle;
}

/**
 * Reads all ADR markdown files referenced by guard.config.json.
 */
export function loadAdrDocuments(
  config: GuardConfig,
  rootDir: string = process.cwd()
): KnowledgeDocument[] {
  const standardsRoot = path.resolve(rootDir, config.standardsDir);
  const now = new Date().toISOString();

  return config.rules.map((rule) => {
    const adrPath = path.join(standardsRoot, rule.adrFile);
    if (!fs.existsSync(adrPath)) {
      throw new Error(`Missing ADR file for rule ${rule.id}: ${adrPath}`);
    }
    const content = fs.readFileSync(adrPath, "utf8").trim();
    if (!content) {
      throw new Error(`ADR file for rule ${rule.id} is empty: ${adrPath}`);
    }
    return {
      id: rule.adrId,
      ruleId: rule.id,
      title: extractHeading(content, rule.title),
      content,
      tags: rule.tags,
      updatedAt: now
    };
  });
}
