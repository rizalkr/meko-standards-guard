import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGuardConfig } from "@meko-guard/core";
import { afterEach, describe, expect, it } from "vitest";
import { computeBlastRadius } from "../../src/blast-radius.js";
import { checkSpecConflicts } from "../../src/spec-checker.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const config = loadGuardConfig(REPO_ROOT);
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("checkSpecConflicts", () => {
  it("flags S2, S3, and S4 conflicts in specs/001-refunds-rfc.md", () => {
    const result = checkSpecConflicts("specs/001-refunds-rfc.md", REPO_ROOT, config);

    expect(result.passed).toBe(false);
    expect(result.specFile).toBe("specs/001-refunds-rfc.md");
    expect(result.conflicts.map((c) => c.ruleId).sort()).toEqual(["S2", "S3", "S4"]);
  });

  it("passes a compliant refunds RFC", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-spec-"));
    tempDirs.push(tmpDir);
    const specFile = path.join(tmpDir, "compliant-refund.md");
    fs.writeFileSync(
      specFile,
      [
        "# Compliant Refund RFC",
        "1. Require Idempotency-Key header via requireIdempotency(db).",
        "2. Never update ledger_entries; append compensating REVERSAL rows via reverseLedgerGroup().",
        "3. Return merchant metadata masked via toPublicMerchantDto(merchant)."
      ].join("\n"),
      "utf8"
    );

    const result = checkSpecConflicts(specFile, tmpDir, config);
    expect(result.passed).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe("computeBlastRadius", () => {
  it("maps S3, ADR-004, and S6 to affected source files, routes, and tests", () => {
    const s3 = computeBlastRadius("S3", REPO_ROOT, config);
    expect(s3.adrId).toBe("ADR-003");
    expect(s3.affectedFiles).toContain("packages/payledger/src/ledger/service.ts");
    expect(s3.affectedTests).toContain("packages/payledger/tests/integration/invariants.test.ts");

    const s4 = computeBlastRadius("ADR-004", REPO_ROOT, config);
    expect(s4.ruleId).toBe("S4");
    expect(s4.affectedFiles).toContain("packages/payledger/src/accounts/routes.ts");
    expect(s4.affectedRoutes).toContain("POST /merchants");

    const s6 = computeBlastRadius("S6", REPO_ROOT, config);
    expect(s6.affectedFiles).toContain("packages/payledger/src/webhooks/routes.ts");
    expect(s6.affectedRoutes).toContain("POST /webhooks/payments");
    expect(s6.affectedTests).toContain("packages/payledger/tests/unit/webhook-signature.test.ts");
  });
});
