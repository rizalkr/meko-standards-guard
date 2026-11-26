import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createGuardMcpServer, seedAction } from "../../src/index.js";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../../..");
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meko-cli-mcp-"));
  tempDirs.push(dir);
  return dir;
}

function parseToolText(result: { content: Array<{ type: string; text?: string }> }): any {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected text MCP tool response");
  }
  return JSON.parse(first.text);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("guard-cli native MCP server", () => {
  it("exposes guard tools without agent self-promotion and enforces isolation", async () => {
    const tmp = createTempDir();
    const fixturePath = path.join(tmp, "mock-datapack.json");
    await seedAction({ rootDir: ROOT_DIR, mode: "mock", fixturePath });

    const badFile = path.join(tmp, "bad-webhook.ts");
    fs.writeFileSync(
      badFile,
      [
        "export function registerWebhook(app: any) {",
        "  app.post('/webhooks/psp', async (c: any) => {",
        "    const body = await c.req.json();",
        "    return c.json({ ok: Boolean(body) });",
        "  });",
        "}"
      ].join("\n"),
      "utf8"
    );

    const server = createGuardMcpServer({
      rootDir: ROOT_DIR,
      mode: "mock",
      fixturePath
    });
    const client = new Client(
      { name: "test-mcp-client", version: "0.1.0" },
      { capabilities: {} }
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "guard_blast_radius",
        "guard_explain_rule",
        "guard_preflight",
        "guard_queue_list",
        "guard_release_gate",
        "guard_spec_check",
        "guard_verify_diff"
      ]);

      const specRes = parseToolText(
        (await client.callTool({
          name: "guard_spec_check",
          arguments: { specFile: "specs/001-refunds-rfc.md" }
        })) as any
      );
      expect(specRes.result.passed).toBe(false);

      const explainRes = parseToolText(
        (await client.callTool({
          name: "guard_explain_rule",
          arguments: { ruleOrAdrId: "ADR-003" }
        })) as any
      );
      expect(explainRes.rule.id).toBe("S3");
      expect(explainRes.adr.content).toContain("Append-Only");

      const blastRes = parseToolText(
        (await client.callTool({
          name: "guard_blast_radius",
          arguments: { ruleOrAdrId: "S3" }
        })) as any
      );
      expect(blastRes.ruleId).toBe("S3");
      expect(blastRes.affectedFiles).toContain("packages/payledger/src/ledger/service.ts");

      const verifyRes = parseToolText(
        (await client.callTool({
          name: "guard_verify_diff",
          arguments: { agentId: "cursor", files: [badFile] }
        })) as any
      );
      expect(verifyRes.report.passed).toBe(false);
      expect(verifyRes.report.summary.byRule.S6).toBeGreaterThanOrEqual(1);
      expect(verifyRes.recordedMemories).toHaveLength(1);
      expect(verifyRes.recordedMemories[0].tier).toBe("private");

      const queueRes = parseToolText(
        (await client.callTool({
          name: "guard_queue_list",
          arguments: {}
        })) as any
      );
      expect(queueRes.pending).toHaveLength(1);
      expect(queueRes.pending[0].agentId).toBe("cursor");

      const preflightOpenCode = parseToolText(
        (await client.callTool({
          name: "guard_preflight",
          arguments: { task: "webhook hmac signature", agentId: "opencode" }
        })) as any
      );
      expect(preflightOpenCode.knowledge.length).toBeGreaterThan(0);
      expect(preflightOpenCode.memories).toHaveLength(0);

      const gateRes = parseToolText(
        (await client.callTool({
          name: "guard_release_gate",
          arguments: { skipTests: true, allowPolicyEdit: true }
        })) as any
      );
      expect(gateRes.passed).toBe(true);
      expect(gateRes.receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
