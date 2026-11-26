import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGuardConfig } from "@meko-guard/core";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import { checkGovernanceDiff, runAstChecks } from "../../src/ast-checker.js";
import { buildRulesMap } from "../../src/helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const config = loadGuardConfig(REPO_ROOT);
const rulesById = buildRulesMap(config);

const tempDirs: string[] = [];

function createTempSourceFile(relPath: string, code: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-ast-"));
  tempDirs.push(tmpDir);
  const absFile = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, code, "utf8");

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(absFile);
  return { tmpDir, sourceFile };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runAstChecks", () => {
  it("detects S1 floating-point money arithmetic, / 100, parseFloat, and Math.round while ignoring Date.now()", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/bad-money.ts",
      [
        "export function calcTax(amountCents: number): number {",
        "  const feeCents = amountCents * 0.11;",
        "  const rateRatio = amountCents / 100;",
        "  const parsed = parseFloat('12.34');",
        "  const roundedTotal = Math.round(feeCents);",
        "  const nowSec = Math.floor(Date.now() / 1000);",
        "  return feeCents + rateRatio + parsed + roundedTotal + nowSec;",
        "}"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s1 = violations.filter((v) => v.ruleId === "S1");

    expect(s1.length).toBe(4);
    expect(s1.every((v) => v.adrId === "ADR-001")).toBe(true);
    expect(s1.map((v) => v.line)).toEqual([2, 3, 4, 5]);
  });

  it("detects S2 missing requireIdempotency on money routes and allows protected routes", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/refunds/routes.ts",
      [
        "app.post('/refunds', async (c) => {",
        "  return c.json({ ok: true }, 201);",
        "});",
        "app.post('/payouts', requireIdempotency(db), async (c) => {",
        "  return c.json({ ok: true }, 201);",
        "});"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s2 = violations.filter((v) => v.ruleId === "S2");

    expect(s2).toHaveLength(1);
    expect(s2[0].adrId).toBe("ADR-002");
    expect(s2[0].line).toBe(1);
  });

  it("detects S3 update/delete calls and raw SQL mutations on ledgerEntries", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/refunds/service.ts",
      [
        "export function corruptLedger(db: any) {",
        "  db.update(ledgerEntries).set({ amountCents: 0 }).run();",
        "  db.delete(ledgerEntries).run();",
        "  const sql = 'UPDATE ledger_entries SET amount_cents = 0';",
        "  return sql;",
        "}"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s3 = violations.filter((v) => v.ruleId === "S3");

    expect(s3).toHaveLength(3);
    expect(s3.every((v) => v.adrId === "ADR-003")).toBe(true);
    expect(s3.map((v) => v.line)).toEqual([2, 3, 4]);
  });

  it("detects S5 non-atomic balance check and ledger write outside transaction", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/payouts/bad-payout.ts",
      [
        "export function unsafePayout(db: any, merchantId: string, amountCents: number) {",
        "  const bal = getMerchantBalanceCents(db, merchantId);",
        "  if (bal < amountCents) throw new Error('insufficient');",
        "  return db.transaction((tx: any) => {",
        "    return postBalancedEntries(tx, { merchantId, entryType: 'PAYOUT_SETTLEMENT', referenceId: '1', lines: [] });",
        "  });",
        "}"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s5 = violations.filter((v) => v.ruleId === "S5");

    expect(s5).toHaveLength(1);
    expect(s5[0].adrId).toBe("ADR-005");
    expect(s5[0].line).toBe(5);
  });

  it("detects S6 JSON.parse before verifyWebhookSignature and c.req.json in webhook handler", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/webhooks/bad-webhook.ts",
      [
        "app.post('/webhooks/payments', async (c) => {",
        "  const rawBody = await c.req.text();",
        "  const parsed = JSON.parse(rawBody);",
        "  const verification = verifyWebhookSignature({ rawBody, signatureHeader: undefined, timestampHeader: undefined, secret: 's' });",
        "  return c.json({ parsed, verification }, 200);",
        "});"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s6 = violations.filter((v) => v.ruleId === "S6");

    expect(s6).toHaveLength(1);
    expect(s6[0].adrId).toBe("ADR-006");
    expect(s6[0].line).toBe(3);
  });

  it("detects S7 recalculating merchant rates on invoice retrieval while allowing createInvoice", () => {
    const { tmpDir, sourceFile } = createTempSourceFile(
      "packages/payledger/src/invoices/bad-invoice.ts",
      [
        "export function createInvoice(db: any, merchantId: string) {",
        "  const merchant = db.select().from(merchants).get();",
        "  return multiplyBpsBankers(1000, merchant.feeBps);",
        "}",
        "export function getInvoiceById(db: any, id: string) {",
        "  const merchant = db.select().from(merchants).get();",
        "  return multiplyBpsBankers(1000, merchant.taxRateBps);",
        "}"
      ].join("\n")
    );

    const violations = runAstChecks([sourceFile], tmpDir, rulesById);
    const s7 = violations.filter((v) => v.ruleId === "S7");

    expect(s7).toHaveLength(2);
    expect(s7.every((v) => v.adrId === "ADR-007")).toBe(true);
    expect(s7.map((v) => v.line)).toEqual([6, 7]);
  });

  it("detects S8 unapproved policy edits unless allowPolicyEdit is true", () => {
    const blocked = checkGovernanceDiff(
      REPO_ROOT,
      config,
      ["standards/ADR-001-integer-cents.md", "guard.config.json", "packages/payledger/src/app.ts"],
      false
    );
    expect(blocked).toHaveLength(2);
    expect(blocked.every((v) => v.ruleId === "S8" && v.adrId === "ADR-008")).toBe(true);

    const allowed = checkGovernanceDiff(
      REPO_ROOT,
      config,
      ["standards/ADR-001-integer-cents.md", "guard.config.json"],
      true
    );
    expect(allowed).toHaveLength(0);
  });
});
