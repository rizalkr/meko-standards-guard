import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGuardConfig } from "@meko-guard/core";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import { buildRulesMap } from "../../src/helpers.js";
import { runPiiTaintAnalysis } from "../../src/pii-taint.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const config = loadGuardConfig(REPO_ROOT);
const rulesById = buildRulesMap(config);

const tempDirs: string[] = [];

function analyzeInlineCode(code: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-pii-"));
  tempDirs.push(tmpDir);
  const absFile = path.join(tmpDir, "packages/payledger/src/accounts/sample.ts");
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, code, "utf8");

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(absFile);
  return runPiiTaintAnalysis([sourceFile], tmpDir, rulesById);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runPiiTaintAnalysis (S4 / ADR-004)", () => {
  it("catches direct unmasked merchant response in c.json", () => {
    const violations = analyzeInlineCode(
      [
        "app.get('/merchants/:id', (c) => {",
        "  const merchant = db.select().from(merchants).get();",
        "  return c.json({ merchant }, 200);",
        "});"
      ].join("\n")
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("S4");
    expect(violations[0].adrId).toBe("ADR-004");
    expect(violations[0].line).toBe(3);
    expect(violations[0].trace && violations[0].trace.length).toBeGreaterThanOrEqual(2);
  });

  it("catches multi-hop spread propagation and direct PII field logging", () => {
    const violations = analyzeInlineCode(
      [
        "app.post('/refunds', (c) => {",
        "  const merchant = db.select().from(merchants).get();",
        "  const payload = { ...merchant };",
        "  console.log(merchant.bankAccountNumber);",
        "  return c.json(payload, 200);",
        "});"
      ].join("\n")
    );

    expect(violations.length).toBe(2);
    expect(violations.map((v) => v.line)).toEqual([4, 5]);
    expect(violations[1].trace?.some((step) => step.includes("Propagation"))).toBe(true);
  });

  it("allows toPublicMerchantDto sanitizer, safe field projections, and safe scalar fields", () => {
    const violations = analyzeInlineCode(
      [
        "app.get('/merchants/:id', (c) => {",
        "  const existing = db.select({ id: merchants.id }).from(merchants).get();",
        "  const merchant = db.select().from(merchants).get();",
        "  console.info(merchant.id);",
        "  return c.json({ existing, merchant: toPublicMerchantDto(merchant) }, 200);",
        "});"
      ].join("\n")
    );

    expect(violations).toHaveLength(0);
  });
});
