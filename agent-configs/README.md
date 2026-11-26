# Connecting Coding Agents to Meko MCP

Connect any supported coding agent to the shared Meko datapack (`payledger-standards-guard`) using the official Meko MCP bridge (requires Node.js 20.18+).

## Official CLI Bridge

```bash
npx @yugabytedb/meko-mcp@latest --client <client> --url "https://mcp.mekodata.ai/mcp"
```

Supported `--client` values include: `cursor`, `opencode`, `claude-code`, `codex`, `kiro`.

## Config Templates in This Directory

All templates use environment variable placeholders — **never commit real tokens**.

- [`cursor.mcp.json`](./cursor.mcp.json) — Cursor (`.cursor/mcp.json`, pre-wired with both `meko` and `standards-guard` MCP servers)
- [`opencode.json`](./opencode.json) — OpenCode (`opencode.json`, pre-wired with both `meko` and `standards-guard` MCP servers)
- [`claude-code.mcp.json`](./claude-code.mcp.json) — Claude Code (`.mcp.json`)
- [`vscode.mcp.json`](./vscode.mcp.json) — VS Code / GitHub Copilot (`.vscode/mcp.json`)
- [`codex.toml`](./codex.toml) — OpenAI Codex CLI (`~/.codex/config.toml`)
- [`kiro.mcp.json`](./kiro.mcp.json) — Kiro (`.kiro/settings/mcp.json`)

## Local Standards Guard Stdio MCP Server

In addition to the Meko MCP bridge, any agent can attach the local `standards-guard` stdio MCP server after building the workspace:

```bash
node packages/guard-cli/dist/bin.js mcp --mode mock
```

Switch `--mode mock` (or `GUARD_MODE=mock` in [`cursor.mcp.json`](./cursor.mcp.json) and [`opencode.json`](./opencode.json)) to `live` (with `MEKO_API_TOKEN` set) when running against YugabyteDB Meko live.

Exposed tools:
- `guard_preflight` — query Meko ADRs, shared team memories, agent-private learnings, and self-learning signals
- `guard_spec_check` — check an RFC spec against `S1`–`S8` before writing code
- `guard_verify_diff` — run AST checks, PII taint analysis, governance diff checks, and optional Vitest invariants
- `guard_explain_rule` — return full ADR details and impacted code for a rule/ADR ID
- `guard_blast_radius` — map a rule/ADR ID to affected files, routes, and tests
- `guard_queue_list` — read-only inspection of pending private candidate memories (promotion remains human-only via `standards-guard approve` per `ADR-008`)
- `guard_release_gate` — verify all invariants and emit a SHA-256 compliance receipt artifact
