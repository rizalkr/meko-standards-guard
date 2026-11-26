# Connecting Coding Agents to Meko MCP

Connect any supported coding agent to the shared Meko datapack (`payledger-standards-guard`) via native **remote Streamable HTTP MCP** (`https://mcp.mekodata.ai/mcp` with `Authorization: Bearer <token>` and `User-Agent: meko-mcp-installer/1.0`) alongside the local `standards-guard` stdio MCP server.

## Official Meko Setup Installer CLI

To configure user-level settings interactively with YugabyteDB's official Meko MCP setup installer CLI (requires Node.js 20.18+):

```bash
npx @yugabytedb/meko-mcp@latest --client <client> --url "https://mcp.mekodata.ai/mcp"
```

Supported `--client` values include: `cursor`, `opencode`, `claude-code`, `codex`, `kiro`. Note that `@yugabytedb/meko-mcp@latest` is the setup installer CLI, not a stdio runtime bridge.

## Config Templates in This Directory

All templates use environment variable placeholders — **never commit real tokens**. Every template below is pre-wired with both `meko` (remote Streamable HTTP) and `standards-guard` (local stdio MCP, defaulting to `GUARD_MODE=mock`):

- [`cursor.mcp.json`](./cursor.mcp.json) — Cursor (`.cursor/mcp.json`)
- [`opencode.json`](./opencode.json) — OpenCode (`opencode.json`)
- [`claude-code.mcp.json`](./claude-code.mcp.json) — Claude Code (`.mcp.json`)
- [`vscode.mcp.json`](./vscode.mcp.json) — VS Code / GitHub Copilot (`.vscode/mcp.json`)
- [`codex.toml`](./codex.toml) — OpenAI Codex CLI (`~/.codex/config.toml` or project-level `.codex/config.toml`)
- [`kiro.mcp.json`](./kiro.mcp.json) — Kiro (`.kiro/settings/mcp.json`)

## Local Standards Guard Stdio MCP Server

In addition to the remote Meko HTTP MCP server, any agent can attach the local `standards-guard` stdio MCP server after building the workspace:

```bash
node packages/guard-cli/dist/bin.js mcp --mode mock
```

Switch `--mode mock` (or `GUARD_MODE=mock` in the templates above) to `live` (with `MEKO_API_TOKEN` exported) when running against YugabyteDB Meko live.

Exposed tools:
- `guard_preflight` — query Meko ADRs, shared team memories, agent-private learnings, and self-learning signals
- `guard_spec_check` — check an RFC spec against `S1`–`S8` before writing code
- `guard_verify_diff` — run AST checks, PII taint analysis, governance diff checks, and optional Vitest invariants
- `guard_explain_rule` — return full ADR details and impacted code for a rule/ADR ID
- `guard_blast_radius` — map a rule/ADR ID to affected files, routes, and tests
- `guard_queue_list` — read-only inspection of pending private candidate memories (promotion remains human-only via `standards-guard approve` per `ADR-008`)
- `guard_release_gate` — verify all invariants and emit a SHA-256 compliance receipt artifact

## Verifying Live MCP Connections

Export your `.env` token in the current shell and verify zero-quota MCP handshakes and tool discovery:

```bash
set -a && source .env && set +a
opencode mcp list
cursor-agent mcp list
cursor-agent mcp list-tools standards-guard
codex mcp list
```

When opening the Cursor IDE desktop app with `GUARD_MODE=live`, launch it from a shell that has `.env` exported (`set -a && source .env && set +a && cursor .`) so `${env:MEKO_API_TOKEN}` resolves cleanly.
