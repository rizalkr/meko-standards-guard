# Engineering Roadmap & Demo Execution Plan

- **Hackathon**: ContextCon (YugabyteDB Meko, Theme 01)
- **Hard Deadline**: January 18, 2027, 14:59 WIB
- **Target Submission Freeze**: January 16, 2027 (H-2 buffer)

---

## 1. Seven-Week Milestone Plan

### Week 1 — Monorepo Foundation, ADRs & Core Meko Client [DONE]
- Commit: `82236a5`
- Delivered:
  - npm workspaces monorepo (`tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `guard.config.json`).
  - 8 ADRs (`standards/ADR-001` through `ADR-008`) covering Rules `S1`–`S8`.
  - Draft conflicting RFC ([`specs/001-refunds-rfc.md`](../specs/001-refunds-rfc.md)) for pre-implementation spec gate demos.
  - 6 agent MCP templates in [`agent-configs/`](../agent-configs/README.md) (`cursor`, `opencode`, `claude-code`, `vscode`, `codex`, `kiro`).
  - `@meko-guard/core`: 5-pillar `MekoClient` (`MockMekoClient`, `RecordingMekoClient`, `LiveMekoClient` over `@modelcontextprotocol/sdk`), Zod config loader, 6 unit tests passing.
  - `@meko-guard/cli`: `seed` and `status` commands seeding `fixtures/meko/mock-datapack.json`.

### Week 2 — PayLedger Mini Double-Entry Core (`packages/payledger`) [DONE]
- Commit: `52258aa`
- Delivered:
  - 5-table SQLite schema via Drizzle ORM + `better-sqlite3` (`merchants`, `invoices`, `ledger_entries`, `idempotency_keys`, `webhook_events`).
  - `BigInt` half-to-even banker's rounding (`multiplyBpsBankers`) and strict integer minor units (`S1`).
  - Canonical JSON SHA-256 `requireIdempotency` middleware with `409 Conflict` detection (`S2`).
  - Append-only double-entry ledger engine with balanced postings and `REVERSAL` groups (`S3`).
  - Hono routes (`accounts`, `invoices`, `payouts`, `webhooks`) with `toPublicMerchantDto` (`S4`), `db.transaction` payout balance locks (`S5`), `timingSafeEqual` raw-body HMAC verification (`S6`), and immutable invoice snapshots (`S7`).
  - 13 new tests (unit + end-to-end invariants); total test suite at **19/19 passing**.
  - `POST /refunds` intentionally omitted for Week 6 live cross-agent demonstration.

### Week 3 — Guard Static & Dynamic Engine (`packages/guard-engine`) [NEXT]
- Deliverables:
  - `ast-checker.ts` (`ts-morph`): deterministic checks for `S1` (float money arithmetic), `S2` (mutation routes without `requireIdempotency`), `S3` (`db.update`/`db.delete` on `ledgerEntries`), `S5` (payout writes outside `db.transaction`), `S6` (`JSON.parse` before HMAC verification), and `S8` (unapproved diffs on `standards/` or `guard.config.json`).
  - `pii-taint.ts`: `ts-morph` intra/inter-procedural taint tracker tracing `merchants` rows and PII identifiers (`bankAccountNumber`, `routingNumber`, `taxId`) into `c.json(...)` and `console.*` (`S4`).
  - `spec-checker.ts`: evaluates draft markdown specs (`specs/001-refunds-rfc.md`) against ADR rules (`S1`–`S8`) before implementation.
  - `vitest-runner.ts`: invokes targeted `@meko-guard/payledger` invariant tests and parses pass/fail evidence.
  - `blast-radius.ts`: computes `ADR -> files -> Hono routes -> Vitest tests` graph.
  - Fixture unit tests proving `100%` catch rate on intentionally violated snippets for `S1`–`S8` and `0` false positives on `packages/payledger`.

### Week 4 — Full ADLC CLI & Native MCP Server (`packages/guard-cli`)
- Deliverables:
  - Expand `packages/guard-cli/src/bin.ts` with:
    - `spec-check <file>`: pre-implementation RFC conflict report (`PASS`/`FAIL` + cited ADRs).
    - `check [--staged] [--agent <id>]`: runs `guard-engine`, blocks violations with ADR citation + file/line trace, writes `private` candidate memory via `memoryAdd` and `selfLearningRecord`.
    - `queue`: lists pending `private` candidate memories awaiting human review.
    - `approve <memoryId> --reason "<text>"`: calls `memoryPromote` (`private -> shared`) + `conversationAddMessage` audit entry.
    - `impact <ADR-ID>`: outputs blast radius (files, routes, tests).
    - `release-gate`: runs typecheck + build + AST check + Vitest invariants + governance diff check, and writes a content-addressed compliance receipt via `artifactPut`.
    - `bench`: executes and scores the A/B token & turn benchmark.
  - Add `standards-guard mcp`: native stdio MCP server exposing `guard_preflight`, `guard_verify_diff`, `guard_explain_rule`, and `guard_blast_radius`.

### Week 5 — Local Governance Control Plane (`packages/guard-ui`)
- Deliverables:
  - React + Vite + Tailwind web app (`localhost:4321`) backed by a lightweight local HTTP bridge serving `fixtures/meko/mock-datapack.json` (or `.cache`) so inspecting the UI burns **zero** live Meko searches.
  - 4 focused views:
    1. **Human Approval Queue**: inspect candidate `private` learnings, diff/rule citations, and 1-click approve (`memory_promote`) with reason.
    2. **Cross-Agent Audit Timeline**: unified chronological view of Knowledge Base uploads, Cursor/OpenCode memories, maintainer conversation logs, and compliance receipts.
    3. **ADR Blast-Radius Graph**: interactive mapping from `S1`–`S8` ADRs to PayLedger modules, routes, and tests.
    4. **A/B Benchmark Panel**: visual comparison of Baseline vs Standards Guard (violations, correction turns, prompt tokens).

### Week 6 — Live Meko Integration, Cross-Agent Demo & A/B Benchmark
- Deliverables:
  - Create free YugabyteDB Meko account and single datapack `payledger-standards-guard`; configure local `.env` (gitignored).
  - Run `npm run guard:seed -- --mode live` to upload `ADR-001`–`ADR-008`.
  - Install and configure **OpenCode** alongside **Cursor** using [`agent-configs/`](../agent-configs/README.md) so both connect to Meko MCP + `standards-guard mcp`.
  - Execute and record fixtures (`--mode record`) for the 2-beat Cross-Agent Vaccination workflow (`POST /refunds` in Cursor -> block -> human approve -> `POST /payouts/instant` in OpenCode -> pass first try -> `release-gate`).
  - Run the 5-task A/B Benchmark (`Baseline without Meko` vs `Standards Guard with Meko`) using `tiktoken` + real agent turn logs.

### Week 7 & Buffer (January 7–16, 2027) — Final Audit, Video & Submission
- Deliverables:
  - Clean-repo audit: verify zero secrets/tokens, zero internal data, zero `.db` artifacts, and clean `git clone` offline quickstart in `--mode mock`.
  - Record `< 4:30` demo video covering 5 tight beats:
    1. `0:00–0:40` Problem & Meko 5-primitive architecture.
    2. `0:40–1:30` Pre-implementation `spec-check` catching RFC violations before coding.
    3. `1:30–2:45` Cursor writes defective `POST /refunds` -> Guard blocks (`S2`/`S3`/`S4`), writes `private` candidate memory -> Maintainer approves via UI/CLI (`memory_promote`).
    4. `2:45–3:45` Fresh OpenCode session queries Meko -> generates compliant endpoint on first try -> `release-gate` emits content-addressed receipt.
    5. `3:45–4:30` Fair 5-task A/B token & violation reduction results + offline quickstart CTA.
  - Submit on HackerEarth before **January 18, 2027, 14:59 WIB**.

---

## 2. Meko Free-Tier Quota Budget

Meko Free Tier limits are lifetime per account (`1` datapack recommended, `1,000` turns, `10,000` memory adds, `1,000` searches per type). Budget below keeps live consumption under ~6% of search quota:

| Phase | Operation | Est. `searches` | Est. `memoryAdds` | Est. `uploads` / `artifacts` | Mode |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Weeks 1–5 | All dev, AST tests, PayLedger tests, UI dev | 0 | 0 | 0 | `mock` |
| Week 6a | Initial ADR seeding & verification | ~2 | 0 | 9 (`8` ADRs + `1` receipt) | `live` |
| Week 6b | 5-task A/B Benchmark + `record` capture | ~15 | ~10 | ~5 | `record` |
| Week 6c | Live Cursor + OpenCode vaccination rehearsal | ~15 | ~6 | ~3 | `live` |
| Week 7 | Final video recording live take | ~10 | ~4 | ~2 | `live` |
| **Total** | **Full Hackathon Lifecycle** | **~42 / 1,000** | **~20 / 10,000** | **~19** | `< 5%` quota |

---

## 3. Scope-Cut Priority Ladder (If Time Tightens)

1. **P0 — Must Ship (Never Cut)**:
   - `packages/core` (`LiveMekoClient` + `MockMekoClient` + all 5 Meko primitives).
   - `packages/payledger` (verified double-entry core).
   - `packages/guard-engine` (`S1`–`S8` AST/taint checks + Vitest invariant runner).
   - `packages/guard-cli` (`seed`, `status`, `spec-check`, `check`, `queue`, `approve`, `release-gate`, `mcp`).
   - Live 2-agent Cursor -> Human `memory_promote` -> OpenCode demo video (`< 4:30`).
2. **P1 — High-Impact Differentiators**:
   - `packages/guard-ui` local Governance Control Plane (`localhost:4321`).
   - 5-task fair A/B `tiktoken` benchmark + `guard impact` blast-radius CLI.
3. **P2 — Cut First If Needed**:
   - Visual D3/SVG graph polish in `guard-ui` (keep clean table/tree blast-radius view instead).
   - Multi-agent live runs beyond Cursor + OpenCode (keep templates in `agent-configs/` for Claude Code, Codex, Kiro, VS Code Copilot without extra recorded takes).
