import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  checkAction,
  explainRuleAction,
  impactAction,
  preflightAction,
  queueAction,
  releaseGateAction,
  specCheckAction
} from "../actions.js";
import type { CliContextOptions } from "../context.js";

async function wrapTool<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: message }, null, 2)
        }
      ],
      isError: true
    };
  }
}

/**
 * Builds an MCP server exposing Meko Standards Guard tools.
 * Promotion (`approve`) is intentionally excluded so coding agents cannot self-approve candidate memories (ADR-008).
 */
export function createGuardMcpServer(options: CliContextOptions = {}): McpServer {
  const server = new McpServer({
    name: "meko-standards-guard",
    version: "0.1.0"
  });

  server.registerTool(
    "guard_preflight",
    {
      description:
        "Query Meko Knowledge ADRs, promoted shared memories, private agent learnings, and self-learning signals before writing code.",
      inputSchema: {
        task: z.string().min(1),
        agentId: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional()
      }
    },
    async ({ task, agentId, limit }) =>
      wrapTool(() => preflightAction({ ...options, task, agentId, limit }))
  );

  server.registerTool(
    "guard_spec_check",
    {
      description:
        "Validate a Markdown RFC or feature specification against S1-S8 architectural invariants before implementation.",
      inputSchema: {
        specFile: z.string().min(1)
      }
    },
    async ({ specFile }) => wrapTool(() => specCheckAction({ ...options, specFile }))
  );

  server.registerTool(
    "guard_verify_diff",
    {
      description:
        "Run deterministic ts-morph AST checks, PII taint analysis, governance diff checks, and optional Vitest invariants. Violations are quarantined to agent-private memory.",
      inputSchema: {
        agentId: z.string().min(1),
        files: z.array(z.string()).optional(),
        staged: z.boolean().optional(),
        runTests: z.boolean().optional(),
        allowPolicyEdit: z.boolean().optional(),
        recordFindings: z.boolean().optional()
      }
    },
    async ({ agentId, files, staged, runTests, allowPolicyEdit, recordFindings }) =>
      wrapTool(() =>
        checkAction({
          ...options,
          agentId,
          files,
          staged,
          runTests,
          allowPolicyEdit,
          recordFindings
        })
      )
  );

  server.registerTool(
    "guard_explain_rule",
    {
      description:
        "Return the full ADR document, rule metadata, and impacted codebase files for a Rule ID (S1-S8) or ADR ID (ADR-001..ADR-008).",
      inputSchema: {
        ruleOrAdrId: z.string().min(1)
      }
    },
    async ({ ruleOrAdrId }) =>
      wrapTool(async () =>
        explainRuleAction({ rootDir: options.rootDir, ruleOrAdrId })
      )
  );

  server.registerTool(
    "guard_blast_radius",
    {
      description:
        "Map a Rule ID or ADR ID to impacted source files, Hono HTTP routes, and Vitest invariant tests.",
      inputSchema: {
        ruleOrAdrId: z.string().min(1)
      }
    },
    async ({ ruleOrAdrId }) =>
      wrapTool(async () =>
        impactAction({ rootDir: options.rootDir, ruleOrAdrId })
      )
  );

  server.registerTool(
    "guard_queue_list",
    {
      description:
        "Read-only view of unpromoted private candidate memories awaiting maintainer approval.",
      inputSchema: {}
    },
    async () => wrapTool(() => queueAction(options))
  );

  server.registerTool(
    "guard_release_gate",
    {
      description:
        "Run the full verification suite and emit a SHA-256 content-addressed compliance receipt when all invariants pass.",
      inputSchema: {
        skipTests: z.boolean().optional(),
        allowPolicyEdit: z.boolean().optional()
      }
    },
    async ({ skipTests, allowPolicyEdit }) =>
      wrapTool(() =>
        releaseGateAction({
          ...options,
          skipTests,
          allowPolicyEdit
        })
      )
  );

  return server;
}

/**
 * Starts the native stdio MCP server, keeping stdout reserved strictly for JSON-RPC frames.
 */
export async function startGuardMcpServer(
  options: CliContextOptions = {}
): Promise<void> {
  const server = createGuardMcpServer(options);
  const transport = new StdioServerTransport();
  process.stderr.write(
    `[standards-guard] MCP stdio server starting (mode=${options.mode ?? "mock"})\n`
  );
  await server.connect(transport);
}
