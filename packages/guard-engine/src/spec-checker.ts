import fs from "node:fs";
import path from "node:path";
import type { GuardConfig, RuleDefinition } from "@meko-guard/core";
import { buildRulesMap, toRepoRelative } from "./helpers.js";
import type { SpecCheckResult, SpecConflict } from "./types.js";

interface SpecRulePattern {
  ruleId: string;
  matchLine: (line: string, fullDoc: string) => boolean;
  reason: string;
  remediation: string;
}

const NEGATION_RE = /\b(never|do not|must not|prohibit|forbid|disallow|prevent|avoid)\b/i;

const SPEC_PATTERNS: SpecRulePattern[] = [
  {
    ruleId: "S1",
    matchLine: (line) =>
      !NEGATION_RE.test(line) &&
      (/\b(float|floating[- ]point|decimal\s+dollars?|Math\.round)\b/i.test(line) ||
        /\$\s*\d+\.\d+|\*\s*0\.\d+/i.test(line)),
    reason: "Specification proposes floating-point or dollar-decimal monetary calculation.",
    remediation: "Specify integer minor units (cents) and BigInt banker's rounding (multiplyBpsBankers)."
  },
  {
    ruleId: "S2",
    matchLine: (line) =>
      /\bidempotency(?:\s+header|\s+key)?\b.*\b(optional|skip|skipped|not required|mvp)\b/i.test(line) ||
      /\bavoid double[- ]clicking\b/i.test(line),
    reason: "Specification makes Idempotency-Key optional on a money-mutating endpoint.",
    remediation: "Require Idempotency-Key header enforced by requireIdempotency(db) middleware with 409 conflict checks."
  },
  {
    ruleId: "S3",
    matchLine: (line) =>
      !NEGATION_RE.test(line) &&
      ((/\b(update|modify|mutate|overwrite|delete|zero out|set .*=\s*0)\b/i.test(line) &&
        /\bledger[_\s]?entries\b/i.test(line)) ||
        /\bamount_cents\s*=\s*0\b/i.test(line)),
    reason: "Specification mutates or deletes existing ledger_entries rows instead of appending compensating entries.",
    remediation: "Keep ledger_entries strictly append-only and emit balanced REVERSAL rows via reverseLedgerGroup()."
  },
  {
    ruleId: "S4",
    matchLine: (line, fullDoc) => {
      const exposesRawMerchant =
        /\breturn\b.*\bupdated\s+merchant\s+(record|row|object|entity)\b/i.test(line) ||
        (/\breturn\b.*\bmerchant\s+(record|row)\b/i.test(line) &&
          !/\b(dto|toPublicMerchantDto|masked|stripped|public\s+merchant)\b/i.test(fullDoc)) ||
        (/\b(bank_account_number|routing_number|tax_id|bankAccountNumber|routingNumber|taxId)\b/i.test(
          line
        ) &&
          !/\b(strip|omit|redact|exclude|never|toPublicMerchantDto)\b/i.test(line));
      return exposesRawMerchant;
    },
    reason: "Specification exposes raw merchant database records or sensitive financial PII fields.",
    remediation: "Return toPublicMerchantDto(merchant) so bankAccountNumber, routingNumber, and taxId are omitted."
  },
  {
    ruleId: "S5",
    matchLine: (line) =>
      /\b(check|read)\s+balance\s+outside\s+(the\s+)?transaction\b/i.test(line) ||
      /\bwithout\s+(a\s+)?(db\s+)?transaction\b/i.test(line),
    reason: "Specification separates balance validation from the ledger write transaction (TOCTOU race risk).",
    remediation: "Perform balance validation and ledger insertion inside one immediate db.transaction()."
  },
  {
    ruleId: "S6",
    matchLine: (line) =>
      /\bparse\b.*\bjson\b.*\bbefore\b.*\b(hmac|signature|verify)\b/i.test(line) ||
      /\bskip\b.*\bsignature\s+verification\b/i.test(line),
    reason: "Specification parses webhook JSON before HMAC signature verification.",
    remediation: "Read raw body text and verify X-Signature and X-Timestamp via verifyWebhookSignature() prior to JSON.parse()."
  },
  {
    ruleId: "S7",
    matchLine: (line) =>
      /\brecalculate\b.*\b(historical|existing|captured)\s+invoice\b.*\b(fee|tax|rate)\b/i.test(line),
    reason: "Specification recalculates historical invoice fees or taxes from current merchant rates.",
    remediation: "Read immutable feeBps, feeCents, taxRateBps, and taxCents snapshots stored on invoices."
  },
  {
    ruleId: "S8",
    matchLine: (line) =>
      /\bauto[- ]?promote\b.*\b(shared\s+memory|without\s+(human|maintainer)\s+approval)\b/i.test(line),
    reason: "Specification bypasses human memory_promote governance.",
    remediation: "Keep automated agent learnings in private tier until promoted via human maintainer approval."
  }
];

/**
 * Evaluates a Markdown RFC/spec against S1-S8 architectural invariants before coding starts.
 */
export function checkSpecConflicts(
  specFilePath: string,
  rootDir: string,
  config: GuardConfig
): SpecCheckResult {
  const absPath = path.isAbsolute(specFilePath)
    ? specFilePath
    : path.resolve(rootDir, specFilePath);
  const content = fs.readFileSync(absPath, "utf8");
  const lines = content.split(/\r?\n/);
  const rulesById: Map<string, RuleDefinition> = buildRulesMap(config);
  const conflicts: SpecConflict[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    const trimmed = lineText.trim();
    if (!trimmed) {
      continue;
    }

    for (const pattern of SPEC_PATTERNS) {
      if (pattern.matchLine(lineText, content)) {
        const rule = rulesById.get(pattern.ruleId);
        conflicts.push({
          ruleId: pattern.ruleId,
          adrId: rule?.adrId ?? pattern.ruleId,
          line: i + 1,
          excerpt: trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed,
          reason: pattern.reason,
          remediation: pattern.remediation
        });
      }
    }
  }

  return {
    specFile: toRepoRelative(rootDir, absPath),
    passed: conflicts.length === 0,
    conflicts,
    checkedRules: config.rules.map((r) => r.id)
  };
}
