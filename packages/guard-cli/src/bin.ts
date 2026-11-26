#!/usr/bin/env node
import { Command } from "commander";
import {
  approveAction,
  checkAction,
  impactAction,
  queueAction,
  releaseGateAction,
  seedAction,
  specCheckAction,
  statusAction
} from "./actions.js";
import { resolveMode, type CliContextOptions } from "./context.js";
import { startGuardMcpServer } from "./mcp/server.js";

const program = new Command();

function getContextOptions(): CliContextOptions {
  const opts = program.opts<{ mode?: string; fixture?: string }>();
  return {
    mode: resolveMode(opts.mode),
    fixturePath: opts.fixture
  };
}

program
  .name("standards-guard")
  .description("Meko-backed Architecture & Financial Invariant Guard")
  .version("0.1.0")
  .option("--mode <mode>", "Meko client mode: mock | record | live")
  .option("--fixture <path>", "Override local mock fixture JSON path");

program
  .command("seed")
  .description("Upload all ADR documents from standards/ into the Meko Knowledge Base")
  .option("--json", "Output JSON", false)
  .action(async (cmdOpts: { json?: boolean }) => {
    const result = await seedAction(getContextOptions());
    if (cmdOpts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `[standards-guard] Seeded ${result.adrCount} ADRs into "${result.datapack}" (mode=${result.mode}, created=${result.created}, updated=${result.updated})`
    );
    console.log(`[standards-guard] Seed artifact hash: ${result.artifactHash}`);
    console.log(
      `[standards-guard] Session quota: uploads=${result.quota.uploads}, artifacts=${result.quota.artifacts}, searches=${result.quota.searches}`
    );
  });

program
  .command("status")
  .description("Inspect Meko datapack knowledge, 2-tier memories, and artifacts")
  .option("--json", "Output JSON", false)
  .action(async (cmdOpts: { json?: boolean }) => {
    const result = await statusAction(getContextOptions());
    if (cmdOpts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Datapack: ${result.datapack} (mode=${result.mode})`);
    console.log(`  Knowledge ADRs   : ${result.knowledgeCount}`);
    console.log(`  Private Memories : ${result.privateMemoryCount}`);
    console.log(`  Shared Memories  : ${result.sharedMemoryCount}`);
    console.log(`  Conversations    : ${result.conversationCount}`);
    console.log(`  Artifacts        : ${result.artifactCount}`);
    console.log(`  Self-Learning    : ${result.selfLearningCount}`);
  });

program
  .command("spec-check <specFile>")
  .description("Check a Markdown RFC/spec for conflicts with S1-S8 architectural invariants")
  .option("--json", "Output JSON", false)
  .action(async (specFile: string, cmdOpts: { json?: boolean }) => {
    const { result, relatedKnowledge, quota } = await specCheckAction({
      ...getContextOptions(),
      specFile
    });

    if (cmdOpts.json) {
      console.log(JSON.stringify({ result, relatedKnowledge, quota }, null, 2));
    } else if (result.passed) {
      console.log(
        `[standards-guard] SPEC PASS: ${result.specFile} has 0 conflicts across ${result.checkedRules.length} rules.`
      );
    } else {
      console.log(
        `[standards-guard] SPEC FAIL: ${result.specFile} has ${result.conflicts.length} conflict(s):`
      );
      for (const c of result.conflicts) {
        console.log(`  - [${c.ruleId}/${c.adrId}] line ${c.line}: ${c.reason}`);
        console.log(`    Excerpt    : ${c.excerpt}`);
        console.log(`    Remediation: ${c.remediation}`);
      }
      if (relatedKnowledge.length > 0) {
        console.log(
          `  Related ADRs in Meko: ${relatedKnowledge.map((k) => `${k.id} (${k.ruleId})`).join(", ")}`
        );
      }
    }

    if (!result.passed) {
      process.exitCode = 1;
    }
  });

program
  .command("check")
  .description("Run AST, PII taint, governance diff, and optional Vitest invariant checks")
  .option("--agent <id>", "Originating agent identifier", "cli")
  .option("--staged", "Inspect git staged files", false)
  .option("--files <files...>", "Explicit TypeScript files to inspect")
  .option("--run-tests", "Execute dynamic Vitest invariants", false)
  .option("--test-target <path>", "Specific Vitest test file or directory")
  .option("--allow-policy-edit", "Allow edits to standards/ or guard.config.json", false)
  .option("--record-fix", "Record fix_verified signal when check passes", false)
  .option("--no-record", "Skip persisting violation memories and self-learning signals")
  .option("--json", "Output JSON", false)
  .action(
    async (cmdOpts: {
      agent: string;
      staged: boolean;
      files?: string[];
      runTests: boolean;
      testTarget?: string;
      allowPolicyEdit: boolean;
      recordFix: boolean;
      record: boolean;
      json: boolean;
    }) => {
      const outcome = await checkAction({
        ...getContextOptions(),
        agentId: cmdOpts.agent,
        staged: cmdOpts.staged,
        files: cmdOpts.files,
        runTests: cmdOpts.runTests,
        testTarget: cmdOpts.testTarget,
        allowPolicyEdit: cmdOpts.allowPolicyEdit,
        recordFix: cmdOpts.recordFix,
        recordFindings: cmdOpts.record
      });

      const { report, recordedMemories, recordedSignals } = outcome;

      if (cmdOpts.json) {
        console.log(JSON.stringify(outcome, null, 2));
      } else if (report.passed) {
        console.log(
          `[standards-guard] PASS: Checked ${report.checkedFiles.length} file(s), 0 blocking violations.`
        );
        if (report.tests) {
          console.log(
            `  Tests: ${report.tests.numPassedTests}/${report.tests.numTotalTests} passed (${report.tests.durationMs}ms)`
          );
        }
      } else {
        console.log(
          `[standards-guard] FAIL: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s) across ${report.checkedFiles.length} file(s):`
        );
        for (const v of report.violations) {
          console.log(
            `  - [${v.ruleId}/${v.adrId}] (${v.severity}) ${v.file}:${v.line}: ${v.message}`
          );
          if (v.trace && v.trace.length > 0) {
            console.log(`    Taint Trace: ${v.trace.join(" -> ")}`);
          }
          console.log(`    Remediation: ${v.remediation}`);
        }
        if (report.tests && !report.tests.passed) {
          console.log(
            `  Tests Failed: ${report.tests.numFailedTests}/${report.tests.numTotalTests}`
          );
        }
        if (recordedMemories.length > 0) {
          console.log(
            `  Quarantined ${recordedMemories.length} private candidate memory item(s) for agent "${outcome.agentId}": ${recordedMemories.map((m) => m.id).join(", ")}`
          );
          console.log(
            `  Recorded ${recordedSignals.length} self-learning signal(s). Run "standards-guard queue" to review.`
          );
        }
      }

      if (!report.passed) {
        process.exitCode = 1;
      }
    }
  );

program
  .command("queue")
  .description("List private candidate memories awaiting maintainer promotion")
  .option("--json", "Output JSON", false)
  .action(async (cmdOpts: { json?: boolean }) => {
    const result = await queueAction(getContextOptions());
    if (cmdOpts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      `Approval Queue (${result.datapack}, mode=${result.mode}): ${result.pending.length} pending, ${result.sharedCount} shared`
    );
    for (const mem of result.pending) {
      console.log(
        `  - ${mem.id} [agent=${mem.agentId}, rule=${mem.ruleId ?? "n/a"}] ${mem.content}`
      );
    }
  });

program
  .command("approve <memoryId>")
  .description("Promote a private candidate memory to shared institutional memory")
  .requiredOption("--reason <reason>", "Human rationale for promoting this learning")
  .option("--by <maintainer>", "Maintainer name or identifier", "maintainer")
  .option("--json", "Output JSON", false)
  .action(
    async (
      memoryId: string,
      cmdOpts: { reason: string; by: string; json?: boolean }
    ) => {
      const result = await approveAction({
        ...getContextOptions(),
        memoryId,
        reason: cmdOpts.reason,
        promotedBy: cmdOpts.by
      });

      if (cmdOpts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(
        `[standards-guard] Promoted ${result.promoted.id} (${result.promoted.ruleId ?? "general"}) -> shared by ${result.promoted.promotedBy}`
      );
      console.log(`[standards-guard] Audit message logged: ${result.conversationEntry.id}`);
    }
  );

program
  .command("impact <ruleOrAdrId>")
  .description("Map a Rule ID or ADR ID to affected files, routes, and tests")
  .option("--json", "Output JSON", false)
  .action((ruleOrAdrId: string, cmdOpts: { json?: boolean }) => {
    const result = impactAction({ ruleOrAdrId });
    if (cmdOpts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Blast Radius: ${result.ruleId} / ${result.adrId} — ${result.title}`);
    console.log(`  Files (${result.affectedFiles.length}):`);
    for (const file of result.affectedFiles) {
      console.log(`    - ${file}`);
    }
    console.log(`  Routes (${result.affectedRoutes.length}):`);
    for (const route of result.affectedRoutes) {
      console.log(`    - ${route}`);
    }
    console.log(`  Tests (${result.affectedTests.length}):`);
    for (const test of result.affectedTests) {
      console.log(`    - ${test}`);
    }
  });

program
  .command("release-gate")
  .description("Run full verification and emit a SHA-256 compliance receipt artifact")
  .option("--skip-tests", "Skip running Vitest invariant tests", false)
  .option("--test-target <path>", "Specific Vitest test file or directory")
  .option("--allow-policy-edit", "Allow edits to standards/ or guard.config.json", false)
  .option("--actor <name>", "Actor recorded in release conversation log", "release-gate")
  .option("--json", "Output JSON", false)
  .action(
    async (cmdOpts: {
      skipTests: boolean;
      testTarget?: string;
      allowPolicyEdit: boolean;
      actor: string;
      json?: boolean;
    }) => {
      const result = await releaseGateAction({
        ...getContextOptions(),
        skipTests: cmdOpts.skipTests,
        testTarget: cmdOpts.testTarget,
        allowPolicyEdit: cmdOpts.allowPolicyEdit,
        actor: cmdOpts.actor
      });

      if (cmdOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.passed && result.receipt) {
        console.log(
          `[standards-guard] RELEASE GATE PASS: ${result.report.checkedFiles.length} file(s) clean.`
        );
        console.log(
          `[standards-guard] Compliance Receipt SHA-256: ${result.receipt.contentHash}`
        );
        console.log(
          `[standards-guard] Pending Private Memories: ${result.pendingPrivateMemories}`
        );
      } else {
        console.log(
          `[standards-guard] RELEASE GATE FAIL: ${result.report.summary.errors} violation(s).`
        );
        for (const v of result.report.violations) {
          console.log(`  - [${v.ruleId}/${v.adrId}] ${v.file}:${v.line}: ${v.message}`);
        }
      }

      if (!result.passed) {
        process.exitCode = 1;
      }
    }
  );

program
  .command("mcp")
  .description("Start the native stdio MCP server for coding agents")
  .action(async () => {
    await startGuardMcpServer(getContextOptions());
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[standards-guard] Error: ${message}`);
  process.exitCode = 1;
});
