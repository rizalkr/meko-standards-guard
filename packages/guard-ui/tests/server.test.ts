import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGovernanceApp } from "../server/app.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const BASE_FIXTURE = path.join(REPO_ROOT, "fixtures/meko/mock-datapack.json");

describe("guard-ui governance HTTP server", () => {
  const tempDirs: string[] = [];

  function createIsolatedFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-guard-ui-test-"));
    tempDirs.push(dir);
    const fixturePath = path.join(dir, "mock-datapack.json");
    fs.copyFileSync(BASE_FIXTURE, fixturePath);
    return fixturePath;
  }

  function createTempRootWithStatic(): { rootDir: string; staticDir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-guard-ui-root-"));
    tempDirs.push(dir);
    fs.copyFileSync(path.join(REPO_ROOT, "guard.config.json"), path.join(dir, "guard.config.json"));
    const staticDir = path.join(dir, "dist-client");
    fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><html><body>UI</body></html>");
    fs.writeFileSync(path.join(staticDir, "assets/app.js"), "console.log('ok');");
    return { rootDir: dir, staticDir };
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns health and overview counts across Meko primitives in zero-quota mock mode", async () => {
    const fixturePath = createIsolatedFixture();
    const app = createGovernanceApp({
      rootDir: REPO_ROOT,
      mode: "mock",
      fixturePath
    });

    const healthRes = await app.request("/api/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      status: string;
      mode: string;
      datapack: string;
    };
    expect(health).toEqual({
      status: "ok",
      mode: "mock",
      datapack: "payledger-standards-guard"
    });

    const overviewRes = await app.request("/api/overview");
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      mode: string;
      zeroQuotaMode: boolean;
      counts: { knowledge: number; privateMemories: number; sharedMemories: number };
      rules: Array<{ id: string }>;
    };
    expect(overview.mode).toBe("mock");
    expect(overview.zeroQuotaMode).toBe(true);
    expect(overview.counts.knowledge).toBe(8);
    expect(overview.counts.privateMemories).toBe(0);
    expect(overview.rules).toHaveLength(8);
  });

  it("serves rule summaries, ADR blast-radius details, and 404 for unknown rules", async () => {
    const fixturePath = createIsolatedFixture();
    const app = createGovernanceApp({ rootDir: REPO_ROOT, mode: "mock", fixturePath });

    const rulesRes = await app.request("/api/rules");
    expect(rulesRes.status).toBe(200);
    const rulesJson = (await rulesRes.json()) as {
      rules: Array<{ id: string; fileCount: number; testCount: number }>;
    };
    expect(rulesJson.rules).toHaveLength(8);
    expect(rulesJson.rules.every((r) => r.fileCount > 0 && r.testCount > 0)).toBe(true);

    const adrRes = await app.request("/api/rules/ADR-003");
    expect(adrRes.status).toBe(200);
    const adrDetail = (await adrRes.json()) as {
      rule: { id: string; adrId: string };
      adr: { content: string };
      blastRadius: { affectedFiles: string[]; affectedRoutes: string[]; affectedTests: string[] };
    };
    expect(adrDetail.rule.id).toBe("S3");
    expect(adrDetail.blastRadius.affectedFiles.length).toBeGreaterThan(0);
    expect(adrDetail.blastRadius.affectedRoutes.length).toBeGreaterThan(0);
    expect(adrDetail.adr.content).toContain("ledger_entries");

    const missingRes = await app.request("/api/rules/UNKNOWN-999");
    expect(missingRes.status).toBe(404);
  });

  it("evaluates spec-check locally and blocks path traversal", async () => {
    const fixturePath = createIsolatedFixture();
    const app = createGovernanceApp({ rootDir: REPO_ROOT, mode: "mock", fixturePath });

    const specRes = await app.request("/api/spec-check?file=specs/001-refunds-rfc.md");
    expect(specRes.status).toBe(200);
    const specJson = (await specRes.json()) as {
      passed: boolean;
      conflicts: Array<{ ruleId: string }>;
    };
    expect(specJson.passed).toBe(false);
    const ruleIds = new Set(specJson.conflicts.map((c) => c.ruleId));
    expect(ruleIds.has("S2")).toBe(true);
    expect(ruleIds.has("S3")).toBe(true);
    expect(ruleIds.has("S4")).toBe(true);

    const traversalRes = await app.request("/api/spec-check?file=../../etc/passwd.md");
    expect(traversalRes.status).toBe(400);
  });

  it("allows demo violation simulation only in mock mode and rejects live mode", async () => {
    const fixturePath = createIsolatedFixture();
    const mockApp = createGovernanceApp({ rootDir: REPO_ROOT, mode: "mock", fixturePath });

    const simRes = await mockApp.request("/api/demo/simulate-violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "S3" })
    });
    expect(simRes.status).toBe(201);

    const liveApp = createGovernanceApp({ rootDir: REPO_ROOT, mode: "live", fixturePath });
    const blockedRes = await liveApp.request("/api/demo/simulate-violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "S3" })
    });
    expect(blockedRes.status).toBe(403);
  });

  it("validates, promotes private candidate memory to shared tier, writes audit log, and rejects duplicates", async () => {
    const fixturePath = createIsolatedFixture();
    const app = createGovernanceApp({ rootDir: REPO_ROOT, mode: "mock", fixturePath });

    const simRes = await app.request("/api/demo/simulate-violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "S2" })
    });
    expect(simRes.status).toBe(201);
    const simJson = (await simRes.json()) as { memory: { id: string } };
    const memId = simJson.memory.id;

    // 400 on too-short reason
    const badReasonRes = await app.request(`/api/queue/${memId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "ok" })
    });
    expect(badReasonRes.status).toBe(400);

    // 404 on unknown memory ID
    const notFoundRes = await app.request("/api/queue/mem-does-not-exist/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Valid rationale for audit log" })
    });
    expect(notFoundRes.status).toBe(404);

    // 200 valid promotion
    const approveRes = await app.request(`/api/queue/${memId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "Confirmed S2 idempotency pattern against ADR-002",
        promotedBy: "rizal"
      })
    });
    expect(approveRes.status).toBe(200);
    const approveJson = (await approveRes.json()) as {
      promoted: { id: string; tier: string; promotedBy: string };
      conversationEntry: { relatedMemoryId: string; author: string };
    };
    expect(approveJson.promoted.tier).toBe("shared");
    expect(approveJson.promoted.promotedBy).toBe("rizal");
    expect(approveJson.conversationEntry.relatedMemoryId).toBe(memId);

    // 409 duplicate promotion
    const dupRes = await app.request(`/api/queue/${memId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Duplicate promotion attempt" })
    });
    expect(dupRes.status).toBe(409);

    // Timeline reflects promoted shared memory and maintainer conversation log
    const timelineRes = await app.request("/api/timeline?kind=conversation");
    expect(timelineRes.status).toBe(200);
    const timelineJson = (await timelineRes.json()) as {
      events: Array<{ summary: string; actor: string }>;
    };
    expect(timelineJson.events.some((e) => e.summary.includes(memId))).toBe(true);
  });

  it("loads preview benchmark template when results.json is absent and loads recorded benchmark results from repo root", async () => {
    const fixturePath = createIsolatedFixture();
    const { rootDir: emptyRoot } = createTempRootWithStatic();
    const defaultApp = createGovernanceApp({ rootDir: emptyRoot, mode: "mock", fixturePath });
    const previewRes = await defaultApp.request("/api/benchmark");
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      source: string;
      tasks: Array<{ id: string; status: string }>;
    };
    expect(preview.source).toBe("preview_template");
    expect(preview.tasks).toHaveLength(5);
    expect(preview.tasks[0].status).toBe("pending");

    const repoApp = createGovernanceApp({ rootDir: REPO_ROOT, mode: "mock", fixturePath });
    const repoRes = await repoApp.request("/api/benchmark");
    expect(repoRes.status).toBe(200);
    const repoBench = (await repoRes.json()) as {
      source: string;
      summary: {
        completedTasks: number;
        violationReductionPct: number;
        baselineTotalViolations: number;
        guardedTotalViolations: number;
      };
    };
    expect(repoBench.source).toBe("recorded");
    expect(repoBench.summary.completedTasks).toBe(5);
    expect(repoBench.summary.baselineTotalViolations).toBeGreaterThan(0);
    expect(repoBench.summary.guardedTotalViolations).toBe(0);
    expect(repoBench.summary.violationReductionPct).toBe(100);

    const { rootDir } = createTempRootWithStatic();
    const benchDir = path.join(rootDir, "fixtures/benchmark");
    fs.mkdirSync(benchDir, { recursive: true });
    fs.writeFileSync(
      path.join(benchDir, "results.json"),
      JSON.stringify({
        generatedAt: "2026-12-01T00:00:00.000Z",
        tokenizer: "tiktoken/cl100k_base",
        tasks: [
          {
            id: "T1",
            task: "Implement POST /refunds",
            targetEndpoint: "POST /refunds",
            focusRules: ["S2", "S3"],
            baseline: { violations: 3, correctionTurns: 2, promptTokens: 4200, passedFirstTry: false },
            guarded: { violations: 0, correctionTurns: 0, promptTokens: 3100, passedFirstTry: true }
          }
        ]
      })
    );

    const recordedApp = createGovernanceApp({ rootDir, mode: "mock", fixturePath });
    const recordedRes = await recordedApp.request("/api/benchmark");
    expect(recordedRes.status).toBe(200);
    const recorded = (await recordedRes.json()) as {
      source: string;
      summary: { violationReductionPct: number; baselineTotalViolations: number; guardedTotalViolations: number };
    };
    expect(recorded.source).toBe("recorded");
    expect(recorded.summary.baselineTotalViolations).toBe(3);
    expect(recorded.summary.guardedTotalViolations).toBe(0);
    expect(recorded.summary.violationReductionPct).toBe(100);
  });

  it("serves static UI assets with SPA fallback and protects against path traversal", async () => {
    const fixturePath = createIsolatedFixture();
    const { rootDir, staticDir } = createTempRootWithStatic();
    const app = createGovernanceApp({
      rootDir,
      mode: "mock",
      fixturePath,
      staticDir
    });

    const indexRes = await app.request("/");
    expect(indexRes.status).toBe(200);
    expect(indexRes.headers.get("content-type")).toContain("text/html");

    const spaRouteRes = await app.request("/timeline");
    expect(spaRouteRes.status).toBe(200);
    expect(await spaRouteRes.text()).toContain("<body>UI</body>");

    const jsRes = await app.request("/assets/app.js");
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("application/javascript");

    const unknownApiRes = await app.request("/api/nonexistent");
    expect(unknownApiRes.status).toBe(404);

    const dotDotRes = await app.request("/%2e%2e/guard.config.json");
    expect([400, 404]).toContain(dotDotRes.status);
    expect(await dotDotRes.text()).not.toContain("payledger-standards-guard");
  });
});
