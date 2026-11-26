import fs from "node:fs";
import path from "node:path";
import {
  approveAction,
  explainRuleAction,
  resolveMode,
  statusAction,
  withMekoClient,
  type CliContextOptions
} from "@meko-guard/cli";
import { loadGuardConfig } from "@meko-guard/core";
import { checkSpecConflicts, computeBlastRadius } from "@meko-guard/engine";
import { Hono } from "hono";
import { z } from "zod";
import { loadBenchmarkReport } from "./benchmark.js";
import { buildTimelineEvents } from "./timeline.js";
import type { GovernanceServerOptions, RuleSummary, TimelineEventKind } from "./types.js";

const ApproveBodySchema = z.object({
  reason: z.string().trim().min(3, "Promotion reason must be at least 3 characters."),
  promotedBy: z.string().trim().min(1).max(64).optional()
});

const SimulateBodySchema = z.object({
  scenario: z.enum(["S3", "S2", "S4", "S1"]).default("S3")
});

const DEMO_SCENARIOS = {
  S3: {
    ruleId: "S3",
    adrId: "ADR-003",
    pattern: "packages/payledger/src/refunds/routes.ts:24 - db.update(ledgerEntries).set({ amountCents: 0 })",
    remediation: "Keep ledger_entries append-only and call reverseLedgerGroup(...) with balanced REVERSAL rows.",
    content:
      "[S3/ADR-003] Candidate learning from cursor at packages/payledger/src/refunds/routes.ts:24: Direct db.update(ledgerEntries) mutates append-only ledger history. Remediation: Use reverseLedgerGroup() to emit balanced REVERSAL entries."
  },
  S2: {
    ruleId: "S2",
    adrId: "ADR-002",
    pattern: "packages/payledger/src/refunds/routes.ts:12 - app.post(\"/refunds\", handler) missing requireIdempotency()",
    remediation: "Attach requireIdempotency() middleware to POST /refunds and reject body mismatches with 409 Conflict.",
    content:
      "[S2/ADR-002] Candidate learning from cursor at packages/payledger/src/refunds/routes.ts:12: POST /refunds registered without requireIdempotency() middleware (Incident #41 duplicate retry risk). Remediation: Add requireIdempotency() before handler execution."
  },
  S4: {
    ruleId: "S4",
    adrId: "ADR-004",
    pattern: "packages/payledger/src/refunds/routes.ts:39 - c.json({ merchant }) exposes raw bankAccountNumber",
    remediation: "Project merchant records through toPublicMerchantDto(merchant) before returning JSON or writing logs.",
    content:
      "[S4/ADR-004] Candidate learning from cursor at packages/payledger/src/refunds/routes.ts:39: Raw merchants row serialized in c.json(...) leaks bankAccountNumber and taxId. Remediation: Wrap merchant record with toPublicMerchantDto()."
  },
  S1: {
    ruleId: "S1",
    adrId: "ADR-001",
    pattern: "packages/payledger/src/refunds/service.ts:18 - const fee = amountCents * 0.029",
    remediation: "Use integer basis points with multiplyBpsBankers(amountCents, feeBps) instead of floating-point arithmetic.",
    content:
      "[S1/ADR-001] Candidate learning from cursor at packages/payledger/src/refunds/service.ts:18: Float money arithmetic (* 0.029) introduces penny drift. Remediation: Compute refund fees with multiplyBpsBankers() in integer cents."
  }
} as const;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function resolveSafePathWithin(baseDir: string, relOrUrlPath: string): string | null {
  const cleanRel = relOrUrlPath.replace(/^\/+/, "");
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanRel);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)
  ) {
    return null;
  }
  return resolvedTarget;
}

function getArtifactTimestamp(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Creates the local Governance Control Plane Hono application backed by CLI actions and local fixtures.
 */
export function createGovernanceApp(options: GovernanceServerOptions = {}): Hono {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const mode = resolveMode(options.mode);
  const ctxOptions: CliContextOptions = {
    rootDir,
    mode,
    fixturePath: options.fixturePath
  };

  const app = new Hono();

  app.get("/api/health", (c) => {
    const config = loadGuardConfig(rootDir);
    return c.json({
      status: "ok",
      mode,
      datapack: config.datapack
    });
  });

  app.get("/api/overview", async (c) => {
    const config = loadGuardConfig(rootDir);
    const status = await statusAction(ctxOptions);
    const benchmark = loadBenchmarkReport(rootDir);

    const releaseReceipts = status.snapshot.artifacts
      .filter((a) => a.name.includes("release"))
      .sort((a, b) => getArtifactTimestamp(b.createdAt) - getArtifactTimestamp(a.createdAt));

    return c.json({
      datapack: status.datapack,
      mode: status.mode,
      zeroQuotaMode: status.mode === "mock",
      counts: {
        knowledge: status.knowledgeCount,
        privateMemories: status.privateMemoryCount,
        sharedMemories: status.sharedMemoryCount,
        conversations: status.conversationCount,
        artifacts: status.artifactCount,
        selfLearning: status.selfLearningCount
      },
      latestReceipt: releaseReceipts[0] ?? null,
      benchmarkSource: benchmark.source,
      rules: config.rules
    });
  });

  app.get("/api/queue", async (c) => {
    const status = await statusAction(ctxOptions);
    const byNewest = <T extends { createdAt: string; promotedAt?: string }>(a: T, b: T): number =>
      Date.parse(b.promotedAt ?? b.createdAt) - Date.parse(a.promotedAt ?? a.createdAt);

    const pending = status.snapshot.memories
      .filter((m) => m.tier === "private")
      .sort(byNewest);
    const shared = status.snapshot.memories
      .filter((m) => m.tier === "shared")
      .sort(byNewest);

    return c.json({
      datapack: status.datapack,
      mode: status.mode,
      pending,
      shared,
      sharedCount: shared.length
    });
  });

  app.post("/api/queue/:id/approve", async (c) => {
    const memoryId = c.req.param("id");
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON request body." }, 400);
    }

    const parsed = ApproveBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid approval payload." },
        400
      );
    }

    try {
      const result = await approveAction({
        ...ctxOptions,
        memoryId,
        reason: parsed.data.reason,
        promotedBy: parsed.data.promotedBy
      });
      return c.json(result, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("already promoted")) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/timeline", async (c) => {
    const status = await statusAction(ctxOptions);
    const kindParam = c.req.query("kind")?.trim() as TimelineEventKind | undefined;
    const ruleIdParam = c.req.query("ruleId")?.trim().toLowerCase();
    const agentIdParam = c.req.query("agentId")?.trim().toLowerCase();
    const queryParam = c.req.query("q")?.trim().toLowerCase();

    let events = buildTimelineEvents(status.snapshot);

    if (kindParam && kindParam !== ("all" as TimelineEventKind)) {
      events = events.filter((event) => event.kind === kindParam);
    }
    if (ruleIdParam) {
      events = events.filter((event) => event.ruleId?.toLowerCase() === ruleIdParam);
    }
    if (agentIdParam) {
      events = events.filter(
        (event) =>
          event.actor.toLowerCase() === agentIdParam ||
          String(event.metadata.agentId ?? "").toLowerCase() === agentIdParam
      );
    }
    if (queryParam) {
      events = events.filter((event) => {
        const haystack = `${event.title} ${event.summary} ${event.actor} ${event.ruleId ?? ""}`.toLowerCase();
        return haystack.includes(queryParam);
      });
    }

    return c.json({
      events,
      total: events.length
    });
  });

  app.get("/api/rules", (c) => {
    const config = loadGuardConfig(rootDir);
    const rules: RuleSummary[] = config.rules.map((rule) => {
      const blast = computeBlastRadius(rule.id, rootDir, config);
      return {
        ...rule,
        fileCount: blast.affectedFiles.length,
        routeCount: blast.affectedRoutes.length,
        testCount: blast.affectedTests.length
      };
    });
    return c.json({ rules });
  });

  app.get("/api/rules/:id", (c) => {
    const id = c.req.param("id");
    try {
      const detail = explainRuleAction({
        rootDir,
        ruleOrAdrId: id
      });
      return c.json(detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 404);
    }
  });

  app.get("/api/spec-check", (c) => {
    const requestedFile = c.req.query("file")?.trim() || "specs/001-refunds-rfc.md";
    if (!requestedFile.endsWith(".md") || path.isAbsolute(requestedFile)) {
      return c.json(
        { error: "Spec file must be a relative Markdown path ending in .md." },
        400
      );
    }

    const safeTarget = resolveSafePathWithin(rootDir, requestedFile);
    if (!safeTarget) {
      return c.json({ error: "Spec file path escapes workspace root." }, 400);
    }
    if (!fs.existsSync(safeTarget)) {
      return c.json({ error: `Spec file not found: ${requestedFile}` }, 404);
    }

    const config = loadGuardConfig(rootDir);
    const relPath = path.relative(rootDir, safeTarget).replace(/\\/g, "/");
    const result = checkSpecConflicts(relPath, rootDir, config);
    return c.json(result);
  });

  app.get("/api/benchmark", (c) => {
    return c.json(loadBenchmarkReport(rootDir));
  });

  app.post("/api/demo/simulate-violation", async (c) => {
    if (mode !== "mock") {
      return c.json(
        { error: "Demo simulation is restricted to --mode mock so live Meko quota is protected." },
        403
      );
    }

    let rawBody: unknown = {};
    const text = await c.req.text();
    if (text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return c.json({ error: "Invalid JSON body." }, 400);
      }
    }

    const parsed = SimulateBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid simulation scenario." }, 400);
    }

    const scenario = DEMO_SCENARIOS[parsed.data.scenario];
    const outcome = await withMekoClient(ctxOptions, async ({ meko }) => {
      const memory = await meko.memoryAdd({
        agentId: "cursor",
        ruleId: scenario.ruleId,
        content: scenario.content,
        tags: [scenario.ruleId, scenario.adrId, "candidate", "violation", "cursor"]
      });

      const signal = await meko.selfLearningRecord({
        agentId: "cursor",
        ruleId: scenario.ruleId,
        pattern: scenario.pattern,
        remediation: scenario.remediation,
        outcome: "violation_recorded"
      });

      return { memory, signal };
    });

    return c.json(outcome, 201);
  });

  if (options.staticDir) {
    const resolvedStaticDir = path.resolve(options.staticDir);

    app.get("*", (c) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith("/api/") || reqPath === "/api") {
        return c.json({ error: "API route not found." }, 404);
      }

      if (!fs.existsSync(resolvedStaticDir)) {
        return c.text(
          "Governance UI client build not found. Run `npm run build -w @meko-guard/ui` first.",
          404
        );
      }

      const relAsset = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
      const candidatePath = resolveSafePathWithin(resolvedStaticDir, relAsset);
      if (!candidatePath) {
        return c.text("Invalid asset path.", 400);
      }

      let fileToServe = candidatePath;
      if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
        // Fallback to index.html for client-side navigation routes without file extensions
        if (!path.extname(relAsset)) {
          fileToServe = path.join(resolvedStaticDir, "index.html");
        } else {
          return c.text("Not found.", 404);
        }
      }

      if (!fs.existsSync(fileToServe)) {
        return c.text("Not found.", 404);
      }

      const ext = path.extname(fileToServe).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      const body = fs.readFileSync(fileToServe);
      return c.body(body, 200, { "Content-Type": contentType });
    });
  }

  return app;
}
