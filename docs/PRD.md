# Product Requirements Document (PRD): Meko Standards Guard

- **Project**: Meko Standards Guard (`meko-standards-guard`)
- **Hackathon**: ContextCon by YugabyteDB Meko (HackerEarth)
- **Theme**: Theme 01 — Coding Agents and ADLC (*"One Memory, Every Coding Agent"*)
- **Target Datapack**: `payledger-standards-guard` (single Meko Free-tier datapack)
- **Submission Deadline**: January 18, 2027, 14:59 WIB (Target Freeze: January 16, 2027)
- **Author**: Rizal Kurnia

---

## 1. Product Vision & ContextCon Alignment

**Meko Standards Guard** codifies repository Architecture Decision Records (ADRs), postmortem lessons, and cryptographic compliance receipts inside a single **YugabyteDB Meko** datapack so every coding agent (Cursor, OpenCode, Claude Code, Codex, Kiro, and VS Code Copilot) operates on one shared, human-governed institutional memory across the entire Application Development Lifecycle (ADLC).

Instead of prompting agents from scratch every session or letting autonomous agents pollute shared team context, Standards Guard:
1. Gates pre-implementation RFC specs against existing ADRs before a line of code is written.
2. Inspects staged code diffs deterministically via AST analysis (`ts-morph`), PII taint tracking, and live financial invariant tests (`vitest`), rejecting violations with cited ADRs and Meko traces.
3. Isolates agent-discovered violation traces and fixes in **private/candidate memory** (`memory_add`) until a human maintainer explicitly promotes them to **shared memory** (`memory_promote`) with an audit trail.
4. Grants **cross-agent immunity**: when Agent A (e.g., Cursor) triggers and fixes a violation and the maintainer promotes the lesson, Agent B (e.g., OpenCode) in a brand-new session queries Meko and avoids the bug on its first attempt.

### Judging Criteria Alignment

| Criterion | Weight | How Meko Standards Guard Maximizes Score |
| :--- | :--- | :--- |
| **Meko Use** | 30% | Uses all 5 Meko primitives in one datapack: Knowledge Base (`knowledgebase_upload`/`search`), 2-tier Private/Shared Memory (`memory_add`/`search`/`promote`), Conversations (`conversation_add_message`), Content-Addressed Artifacts (`artifact_put`/`get`), and Self-Learning (`selflearning_*`), plus `context_search`. |
| **Impact** | 25% | Eliminates silent financial/security defects (float penny drift, duplicate payouts, mutable ledger rows, PII leakage, TOCTOU overdrafts, unverified webhooks) across heterogeneous coding agents and measures token/turn savings via an auditable A/B benchmark. |
| **Technical** | 20% | Deterministic hybrid verification combining `ts-morph` AST static checks, PII data-flow taint analysis, synchronous SQLite double-entry invariant tests, a native MCP server (`standards-guard mcp`), and a zero-quota offline `--mode mock` engine. |
| **Innovation** | 15% | **Human-Gated Cross-Agent Vaccination** (prevents context poisoning while transferring immunity from Cursor to OpenCode) + **ADR-to-Code Blast-Radius Mapping** + **Content-Addressed Compliance Receipts**. |
| **Presentation** | 10% | Under-5-minute end-to-end live demo on **PayLedger Mini** (`packages/payledger`), Mermaid architecture diagrams, local Governance UI (`localhost:4321`), and 1-command offline quickstart. |

---

## 2. Problem Statement

Engineering teams using multiple AI coding tools face three compounding failures:
1. **Cross-Agent Amnesia**: Rules memorized in Cursor are invisible to OpenCode, Claude Code, Codex, Kiro, or VS Code Copilot. Each new session starts from zero and repeats historical incidents (such as Incident #41: duplicate payout on retry).
2. **Prose Standards Without Deterministic Enforcement**: Markdown style guides and scattered `.cursorrules` files are easily ignored by LLMs under long context. Silent bugs—such as floating-point tax calculations (`* 0.11`), updating `ledger_entries` rows directly, leaking `bank_account_number` in logs, or calling `JSON.parse` before HMAC verification—slip past superficial linters.
3. **Context Poisoning Risk**: Allowing autonomous agents to write directly into shared team memory enables a single hallucinated workaround to weaken security or financial invariants for every subsequent agent.

---

## 3. Target Demo Application & Cross-Agent Story

### 3.1 Demo Application: PayLedger Mini (`packages/payledger`)
PayLedger Mini is a fictional, 100% local double-entry ledger, invoice, payout, and payment webhook API built with **TypeScript, Hono, Drizzle ORM, `better-sqlite3`, Zod, and Vitest**. It requires zero external databases, zero external LLM API keys, and zero proprietary code.

PayLedger Mini intentionally leaves `POST /refunds` unimplemented ([`specs/001-refunds-rfc.md`](../specs/001-refunds-rfc.md)) so the live hackathon demonstration executes against real, non-trivial financial code.

### 3.2 Eight Enforced Standards (`S1`–`S8`)

| Rule ID | ADR File | Category | Core Invariant |
| :--- | :--- | :--- | :--- |
| `S1` | `ADR-001-integer-cents.md` | Financial | Integer minor units (`*_cents`, `Number.isSafeInteger`) and `BigInt` half-to-even banker's rounding; zero float money arithmetic. |
| `S2` | `ADR-002-idempotency-keys.md` | Financial | Mandatory `Idempotency-Key` header + canonical SHA-256 payload conflict check (`409 Conflict`) on money mutations (cites Incident #41). |
| `S3` | `ADR-003-append-only-ledger.md` | Financial | Strict double-entry (`SUM(debit_cents) === SUM(credit_cents)`) and append-only `ledger_entries` (`UPDATE`/`DELETE` forbidden; use `REVERSAL`). |
| `S4` | `ADR-004-zero-financial-pii.md` | Security | Zero `bank_account_number`, `routing_number`, or `tax_id` in HTTP JSON responses or `console.*`/logger calls; require `toPublicMerchantDto`. |
| `S5` | `ADR-005-atomic-payout-lock.md` | Architecture | Payout balance check and `ledger_entries` settlement write must execute inside one synchronous `db.transaction(...)`. |
| `S6` | `ADR-006-webhook-hmac-security.md` | Security | Raw body `verifyWebhookSignature` (`crypto.timingSafeEqual`) before `JSON.parse`, 300s replay window, PII-free error logs. |
| `S7` | `ADR-007-immutable-invoice-snapshots.md` | Financial | Persist immutable `subtotal_cents`, `tax_rate_bps`, `tax_cents`, `fee_bps`, `fee_cents`, and `total_cents` on `invoices`; never recompute from live merchant rates. |
| `S8` | `ADR-008-memory-governance.md` | Governance | Two-tier private/shared memory gated by human `memory_promote`; human approval required to modify `standards/` or `guard.config.json`. |

### 3.3 Core Demo Flow ("Cross-Agent Vaccination")
1. **Spec Gate**: `standards-guard spec-check specs/001-refunds-rfc.md` flags conflicts against `ADR-002` (optional idempotency key) and `ADR-003` (updating `ledger_entries` rows to `0`) before coding starts.
2. **Beat 1 — Agent A (Cursor) Blocked**: Cursor writes a naive `POST /refunds` handler with float fee math, missing `requireIdempotency`, or direct `db.update(ledgerEntries)` / PII leakage. `standards-guard check --staged --agent cursor` blocks the commit, cites exact ADRs + file/line spans, records a **private** candidate learning via `memory_add`, and logs a `selflearning_record` signal.
3. **Human Governance Gate**: Maintainer inspects the pending candidate via `standards-guard queue` or the local Governance UI (`localhost:4321`) and executes `standards-guard approve <memoryId> --reason "..."`, calling `memory_promote` and recording an audit note via `conversation_add_message`.
4. **Beat 2 — Agent B (OpenCode) Vaccinated**: In a fresh terminal session with zero prior chat history, OpenCode calls `context_search` / `guard_preflight`, receives the promoted lesson alongside `ADR-001`–`ADR-008`, implements `POST /payouts/instant` (or corrected `POST /refunds`) cleanly on the first attempt, and `standards-guard release-gate` outputs a SHA-256 compliance receipt via `artifact_put`.

---

## 4. Functional Requirements

| ID | Capability | Scope & Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- |
| **FR-1** | **Config, ADR Loader & Datapack Seeding** | Parse `guard.config.json` with Zod, load `standards/ADR-*.md`, seed into Meko (`seed`), report counts across all 5 primitives (`status`), support `--mode mock \| record \| live`. | **Implemented** (Week 1) |
| **FR-2** | **PayLedger Mini Financial Core** | 5 Drizzle SQLite tables, `BigInt` banker's rounding, idempotency middleware, double-entry ledger engine, Hono routes (`accounts`, `invoices`, `payouts`, `webhooks`), and S1–S7 invariant test suite. | **Implemented** (Week 2) |
| **FR-3** | **Pre-Implementation Spec Gate** | `guard spec-check <spec.md>` checks RFC proposals against indexed ADRs (`context_search` / local rules) and reports `PASS`/`FAIL` conflicts prior to coding. | **Implemented** (Week 3–4) |
| **FR-4** | **Deterministic Code Guard** | `guard check --staged` runs `ts-morph` AST checks + PII taint analysis + scoped `vitest` invariant suite, returning `PASS`/`FAIL` with rule ID, ADR citation, file/line span, and Meko trace. | **Implemented** (Week 3–4) |
| **FR-5** | **Human-Gated Promotion Queue** | Store unapproved agent learnings as `tier: "private"` isolated by `agentId`; expose `guard queue` and `guard approve <id> --reason "..."` to invoke `memory_promote` + `conversation_add_message`. | **Implemented** (Week 4) |
| **FR-6** | **ADR-to-Code Blast Radius** | `guard impact <ADR-ID>` maps an ADR rule to matched files, Hono route definitions, and Vitest test files so reviewers see exact impact before approving changes. | **Implemented** (Week 3–4) |
| **FR-7** | **Release Gate & Compliance Receipts** | `guard release-gate` verifies AST checks, invariant tests, typecheck/build, and empty unapproved governance diffs, then emits a content-addressed JSON receipt via `artifact_put`. | **Implemented** (Week 4) |
| **FR-8** | **Native Guard MCP Server** | `standards-guard mcp` exposes `guard_preflight`, `guard_verify_diff`, `guard_explain_rule`, and `guard_blast_radius` over stdio MCP alongside Meko MCP. | **Implemented** (Week 4) |
| **FR-9** | **Local Governance UI & Benchmark** | `packages/guard-ui` (`localhost:4321`) visualizes Approval Queue, Cross-Agent Timeline, Blast-Radius Graph, and A/B Benchmark; `guard bench` computes `tiktoken` + real turn comparisons. | **Implemented** (Week 5–6) |

---

## 5. Non-Functional Requirements & Constraints

1. **Meko Free-Tier Quota Safety**: Lifetime Free-tier limits are strict (`1` datapack `payledger-standards-guard`, `1,000` turns, `10,000` memory adds, `1,000` searches per type). All automated unit/integration tests and day-to-day CLI development MUST run in `--mode mock` against `fixtures/meko/mock-datapack.json`. Live Meko calls (`--mode live` / `--mode record`) are reserved for initial live seeding, MCP integration checks, the 5-task benchmark, and final demo recording (target budget: `< 50` live searches total).
2. **Zero Secrets & Clean Public Repo**: `.env` is gitignored; `agent-configs/` and `.env.example` use placeholder tokens only; zero internal/proprietary code, screenshots, or third-party data may enter the repository.
3. **Offline Reproducibility**: Anyone cloning the repository must be able to run `npm install && npm run build && npm run typecheck && npm test` completely offline in under 30 seconds without network access or Meko credentials.
4. **Language & Code Quality**: All source code, comments, ADRs, commit messages, and documentation are written in English with zero emoticons, strict TypeScript (`strict: true`, `NodeNext`), and `.js` extensions on relative ESM imports.

---

## 6. Success Metrics

- **Detection Accuracy**: `100%` detection on seeded `S1`–`S8` violation fixtures (`guard-engine` test suite) and `0` false positives against compliant `packages/payledger` (`19/19` baseline tests green).
- **Cross-Agent Transfer**: Demonstrable first-try pass by OpenCode after Cursor failure + human `memory_promote` without manually pasting ADRs into OpenCode's prompt.
- **Fair A/B Efficiency**: Documented token (`tiktoken`), correction-turn, and violation-rate comparison across 5 representative PayLedger tasks (Baseline without Meko vs. Standards Guard with Meko).
