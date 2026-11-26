# Connecting Coding Agents to Meko MCP

Connect any supported coding agent to the shared Meko datapack (`payledger-standards-guard`) using the official Meko MCP bridge (requires Node.js 20.18+).

## Official CLI Bridge

```bash
npx @yugabytedb/meko-mcp@latest --client <client> --url "https://mcp.mekodata.ai/mcp"
```

Supported `--client` values include: `cursor`, `opencode`, `claude-code`, `codex`, `kiro`.

## Config Templates in This Directory

All templates use environment variable placeholders — **never commit real tokens**.

- [`cursor.mcp.json`](./cursor.mcp.json) — Cursor (`.cursor/mcp.json`)
- [`opencode.json`](./opencode.json) — OpenCode (`opencode.json`)
- [`claude-code.mcp.json`](./claude-code.mcp.json) — Claude Code (`.mcp.json`)
- [`vscode.mcp.json`](./vscode.mcp.json) — VS Code / GitHub Copilot (`.vscode/mcp.json`)
- [`codex.toml`](./codex.toml) — OpenAI Codex CLI (`~/.codex/config.toml`)
- [`kiro.mcp.json`](./kiro.mcp.json) — Kiro (`.kiro/settings/mcp.json`)
