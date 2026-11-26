import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdrDocuments, loadGuardConfig } from "../../src/config.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

describe("guard.config.json and ADR loader", () => {
  it("parses all 8 rules S1-S8 from guard.config.json", () => {
    const config = loadGuardConfig(repoRoot);
    expect(config.datapack).toBe("payledger-standards-guard");
    expect(config.rules.map((r) => r.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "S7",
      "S8"
    ]);
  });

  it("loads all 8 non-empty ADR markdown files", () => {
    const config = loadGuardConfig(repoRoot);
    const docs = loadAdrDocuments(config, repoRoot);
    expect(docs).toHaveLength(8);
    for (const doc of docs) {
      expect(doc.content.length).toBeGreaterThan(50);
      expect(doc.tags.length).toBeGreaterThan(0);
    }
  });
});
