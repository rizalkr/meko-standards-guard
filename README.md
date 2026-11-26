# Meko Standards Guard

**One Memory, Every Coding Agent** — Governed architecture and financial invariant enforcement backed by **YugabyteDB Meko**.

Coding agents normally start every session from zero. Standards Guard codifies repository Architecture Decision Records (ADRs), postmortem learnings, and compliance receipts into a single Meko datapack so Cursor, OpenCode, Claude Code, Codex, Kiro, and VS Code Copilot share the same institutional memory with human-in-the-loop governance.

## Architecture (5 Meko Primitives)

```mermaid
flowchart LR
  ADRs["standards/ADR-*.md"] -->|knowledgebase_upload| KB["Meko Knowledge Base"]
  AgentA["Agent A (e.g. Cursor)"] -->|context_search| Meko["Meko Datapack"]
  AgentA -->|violation / fix| Cand["Private Memory (memory_add)"]
  Cand -->|Human Approve| Shared["Shared Memory (memory_promote)"]
  Human["Maintainer"] -->|conversation_add_message| Conv["Review Decision Log"]
  Guard["standards-guard CLI"] -->|artifact_put| Art["Compliance Receipts"]
  Guard -->|selflearning_record| SL["Self-Learning Signals"]
  Shared -->|context_search| AgentB["Agent B (e.g. OpenCode)"]
```

## Quickstart (Zero-Key Offline `--mock` Mode)

```bash
npm install
npm run typecheck
npm run build
npm test
npm run guard:seed -- --mode mock
npm run guard:status -- --mode mock
```

## Switching to Live Meko MCP

1. Create a free datapack at Meko and obtain your bearer token.
2. Copy `.env.example` to `.env` and set `MEKO_API_TOKEN` and `GUARD_MODE=live`.
3. Seed the 8 ADRs into your Meko datapack:
   ```bash
   npm run guard:seed -- --mode live
   npm run guard:status -- --mode live
   ```
4. Connect your coding agents using the templates in [`agent-configs/`](./agent-configs/README.md).

## Monorepo Layout

- `packages/core` (`@meko-guard/core`): Config loader, 5-pillar Meko client (`mock` / `record` / `live`), and schema types.
- `packages/guard-cli` (`@meko-guard/cli`): CLI (`seed`, `status`, and upcoming ADLC gates).
- `standards/`: 8 financial, security, architecture, and governance ADRs (`ADR-001` through `ADR-008`).
- `specs/`: Sample RFC specs for pre-implementation spec checking.
- `agent-configs/`: Ready-to-use MCP templates for 6 coding agents.
- `fixtures/meko/`: Local JSON snapshots for zero-quota offline testing.
