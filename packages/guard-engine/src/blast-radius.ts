import fs from "node:fs";
import path from "node:path";
import type { GuardConfig, RuleDefinition } from "@meko-guard/core";
import { collectTsFiles, toRepoRelative } from "./helpers.js";
import type { BlastRadiusResult } from "./types.js";

const RULE_SYMBOL_MATCHERS: Record<string, RegExp> = {
  S1: /multiplyBpsBankers|assertSafeCents|assertPositiveCents|cents/i,
  S2: /requireIdempotency|idempotencyKeys|Idempotency-Key/i,
  S3: /ledgerEntries|postBalancedEntries|reverseLedgerGroup/i,
  S4: /toPublicMerchantDto|bankAccountNumber|routingNumber|taxId/i,
  S5: /getMerchantBalanceCents|db\.transaction|createPayout/i,
  S6: /verifyWebhookSignature|signWebhookPayload|webhookEvents|timingSafeEqual/i,
  S7: /taxRateBps|feeBps|createInvoice|getInvoiceById/i,
  S8: /memoryPromote|tier:\s*"private"|guard\.config\.json|standards\//i
};

const HONO_ROUTE_RE =
  /\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;

function extractRoutes(content: string): string[] {
  const routes: string[] = [];
  for (const match of content.matchAll(HONO_ROUTE_RE)) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes;
}

function findRule(config: GuardConfig, ruleOrAdrId: string): RuleDefinition {
  const normalized = ruleOrAdrId.trim().toLowerCase();
  const found = config.rules.find(
    (r) =>
      r.id.toLowerCase() === normalized ||
      r.adrId.toLowerCase() === normalized
  );
  if (!found) {
    const valid = config.rules.map((r) => `${r.id}/${r.adrId}`).join(", ");
    throw new Error(`Unknown rule or ADR ID "${ruleOrAdrId}". Known rules: ${valid}`);
  }
  return found;
}

function matchesRule(content: string, rule: RuleDefinition): boolean {
  const symbolMatcher = RULE_SYMBOL_MATCHERS[rule.id];
  if (symbolMatcher && symbolMatcher.test(content)) {
    return true;
  }
  return rule.tags.some((tag) => content.toLowerCase().includes(tag.toLowerCase()));
}

/**
 * Maps a Rule ID or ADR ID to impacted source files, HTTP routes, and invariant test files.
 */
export function computeBlastRadius(
  ruleOrAdrId: string,
  rootDir: string,
  config: GuardConfig
): BlastRadiusResult {
  const rule = findRule(config, ruleOrAdrId);
  const targetAbs = path.resolve(rootDir, config.targetDir);

  const srcDirs = [path.join(targetAbs, "src")];
  const testDirs = [path.join(targetAbs, "tests")];

  if (rule.id === "S8") {
    srcDirs.push(path.resolve(rootDir, "packages/core/src"));
    testDirs.push(path.resolve(rootDir, "packages/core/tests"));
  }

  const affectedFilesSet = new Set<string>();
  const affectedRoutesSet = new Set<string>();
  const affectedTestsSet = new Set<string>();

  for (const dir of srcDirs) {
    for (const file of collectTsFiles(dir)) {
      const content = fs.readFileSync(file, "utf8");
      if (matchesRule(content, rule)) {
        affectedFilesSet.add(toRepoRelative(rootDir, file));
        for (const route of extractRoutes(content)) {
          affectedRoutesSet.add(route);
        }
      }
    }
  }

  for (const dir of testDirs) {
    for (const file of collectTsFiles(dir)) {
      const content = fs.readFileSync(file, "utf8");
      if (matchesRule(content, rule) || content.includes(rule.id) || content.includes(rule.adrId)) {
        affectedTestsSet.add(toRepoRelative(rootDir, file));
      }
    }
  }

  if (rule.id === "S8") {
    const adrRel = toRepoRelative(rootDir, path.resolve(rootDir, config.standardsDir, rule.adrFile));
    affectedFilesSet.add(adrRel);
    affectedFilesSet.add("guard.config.json");
  }

  return {
    query: ruleOrAdrId,
    ruleId: rule.id,
    adrId: rule.adrId,
    title: rule.title,
    affectedFiles: [...affectedFilesSet].sort(),
    affectedRoutes: [...affectedRoutesSet].sort(),
    affectedTests: [...affectedTestsSet].sort()
  };
}
