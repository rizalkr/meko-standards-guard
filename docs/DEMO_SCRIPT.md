# ContextCon Demo Video Script & Rehearsal Runbook (< 4:30)

- **Target Duration**: `4:15` (hard ceiling `4:30`)
- **Theme**: ContextCon Theme 01 — Coding Agents and ADLC (*"One Memory, Every Coding Agent"*)
- **Core Story**: Cross-Agent Vaccination on PayLedger Mini (`S1`–`S8`) backed by YugabyteDB Meko (`payledger-standards-guard`)

---

## 1. Pre-Recording Checklist

1. Confirm clean repository state and passing tests:
   ```bash
   git status -s
   npm run build && npm run typecheck && npm test
   ```
2. Display preparation:
   - Terminal font size `15pt–16pt`, dark theme, 2 panes or clean single terminal with prompt shortened.
   - Browser open to Governance Control Plane (`http://127.0.0.1:4321`) with tabs ready for `?view=queue`, `?view=timeline`, `?view=blast`, and `?view=benchmark`.
   - Editor / IDE tab ready showing `standards/ADR-003-append-only-ledger.md`, `specs/001-refunds-rfc.md`, `fixtures/benchmark/runs/t1-baseline-cursor.ts`, and `fixtures/benchmark/runs/t1-guarded-opencode.ts`.
3. **Meko Quota-Safety Rule**:
   - Use **Track A (Zero-Quota Dry Rehearsal)** with `--mode mock --fixture /tmp/meko-rehearsal-datapack.json` for all practice runs so `fixtures/meko/mock-datapack.json` stays unmodified and live Meko quota (`~42/1000` searches) is preserved.
   - During **Track B (Live Recording)**, run `npm run guard:ui -- --mode mock --port 4321` when showcasing `ADR Blast Radius` and `A/B Benchmark` (each browser refresh in `guard:ui` calls `statusAction` across overview/queue/timeline). Only switch `guard:ui` to `--mode live` if you specifically want live queue promotion inside the browser.

---

## 2. Five-Beat Script & Timing (`4:15` Target)

### Beat 1 (`0:00–0:40`, 40s) — Problem & 5-Primitive Meko Architecture
- **On Screen**: Show the Mermaid architecture diagram in `README.md`, then run `status` in Terminal.
- **Command (Rehearsal / Live)**:
  ```bash
  # Rehearsal (mock)
  npm run guard:status -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json

  # Live take
  npm run guard:status -- --mode live
  ```
- **Voiceover**:
  > "AI coding agents start every session from zero. Standards memorized in Cursor never reach OpenCode or Claude Code, prose ADR files get ignored under long context, and letting agents write directly into shared memory risks context poisoning.
  > Meko Standards Guard solves this with one YugabyteDB Meko datapack (`payledger-standards-guard`) using all five Meko primitives: Knowledge Base for 8 financial ADRs (`S1`–`S8`), 2-tier Private and Shared Memory for human-gated learnings, Conversations for audit logs, Content-Addressed Artifacts for release receipts, and Self-Learning signals."

### Beat 2 (`0:40–1:25`, 45s) — Pre-Implementation Spec Gate & Blast Radius
- **On Screen**: Briefly show `specs/001-refunds-rfc.md`, run `spec-check` and `impact`.
- **Commands**:
  ```bash
  # Rehearsal (mock)
  npm run guard:spec-check -- specs/001-refunds-rfc.md --mode mock --fixture /tmp/meko-rehearsal-datapack.json
  npm run guard:impact -- ADR-003

  # Live take
  npm run guard:spec-check -- specs/001-refunds-rfc.md --mode live
  npm run guard:impact -- ADR-003
  ```
- **Expected Output Highlight**:
  - `SPEC FAIL`: flags `S2/ADR-002` (optional idempotency), `S3/ADR-003` (mutating `ledger_entries` to `amount_cents = 0`), and `S4/ADR-004` (returning raw merchant record).
  - `guard:impact -- ADR-003`: traces `ADR-003` to PayLedger source files, routes, and invariant tests.
- **Voiceover**:
  > "Before writing a single line of code, `standards-guard spec-check` checks our draft refunds RFC against Meko ADRs and catches three invariant conflicts immediately—optional idempotency, mutating append-only `ledger_entries`, and returning raw merchant PII. `standards-guard impact ADR-003` shows the exact files, routes, and Vitest invariants in its blast radius."

### Beat 3 (`1:25–2:35`, 70s) — Agent A (Cursor) Blocked -> Human Gate (`memory_promote`)
- **On Screen**: Show `fixtures/benchmark/runs/t1-baseline-cursor.ts`, run `guard:check --agent cursor`, inspect `guard:queue`, approve the candidate memory, and briefly show Governance UI (`?view=timeline`).
- **Commands**:
  ```bash
  # Rehearsal (mock)
  npm run guard:check -- --agent cursor --files fixtures/benchmark/runs/t1-baseline-cursor.ts --mode mock --fixture /tmp/meko-rehearsal-datapack.json
  npm run guard:queue -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json
  npm run guard:approve -- <MEMORY_ID> --reason "Verified ADR-002/003/004 refund safeguards" --by rizal --mode mock --fixture /tmp/meko-rehearsal-datapack.json

  # Live take
  npm run guard:check -- --agent cursor --files fixtures/benchmark/runs/t1-baseline-cursor.ts --mode live
  npm run guard:queue -- --mode live
  npm run guard:approve -- <MEMORY_ID> --reason "Verified ADR-002/003/004 refund safeguards" --by rizal --mode live
  ```
- **Expected Output Highlight**:
  - `guard:check` exits with `FAIL: 4 error(s)` (`S2` missing `requireIdempotency`, `S1` float `* 0.025`, `S3` `db.update(ledgerEntries)`, `S4` raw `merchant` in `c.json`), quarantines private candidate memories (`memory_add`), and records `selflearning_record` signals.
  - `guard:approve` invokes `memory_promote` (`private -> shared`) and logs the human decision via `conversation_add_message`.
- **Voiceover**:
  > "When Cursor ignores the spec and writes a naive `POST /refunds` handler, our `ts-morph` AST and PII taint engine blocks it deterministically: missing idempotency (`S2`), float fee math (`S1`), direct `db.update(ledgerEntries)` (`S3`), and raw merchant PII in `c.json` (`S4`).
  > Crucially, Standards Guard quarantines these findings in Cursor's **private** Meko memory (`memory_add`) so an unreviewed agent cannot poison team context. A human maintainer reviews the queue and runs `approve`, calling `memory_promote` and logging an audit message to Meko Conversations."

### Beat 4 (`2:35–3:35`, 60s) — Agent B (OpenCode) Vaccinated First-Try Pass & Release Gate
- **On Screen**: Show `fixtures/benchmark/runs/t1-guarded-opencode.ts` (uses `requireIdempotency`, `multiplyBpsBankers`, `reverseLedgerGroup`, `toPublicMerchantDto`, `db.transaction`), run `guard:check --agent opencode --record-fix` and `guard:release-gate`.
- **Commands**:
  ```bash
  # Rehearsal (mock)
  npm run guard:check -- --agent opencode --files fixtures/benchmark/runs/t1-guarded-opencode.ts --record-fix --mode mock --fixture /tmp/meko-rehearsal-datapack.json
  npm run guard:release-gate -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json

  # Live take
  npm run guard:check -- --agent opencode --files fixtures/benchmark/runs/t1-guarded-opencode.ts --record-fix --mode live
  npm run guard:release-gate -- --mode live
  ```
- **Expected Output Highlight**:
  - `guard:check` prints `PASS: Checked 1 file(s), 0 blocking violations.`
  - `guard:release-gate` runs AST checks + PayLedger Vitest invariants and outputs `RELEASE GATE PASS` with a `Compliance Receipt SHA-256` stored via `artifact_put`.
- **Voiceover**:
  > "Now a fresh OpenCode session starts with zero chat history. Querying Meko via MCP returns the exact ADR chunk plus the newly promoted lesson. OpenCode implements `POST /refunds` using `requireIdempotency`, `multiplyBpsBankers`, `reverseLedgerGroup`, and `toPublicMerchantDto`—passing `guard check` on its very first try.
  > Running `standards-guard release-gate` verifies all AST and SQLite ledger invariants and emits a SHA-256 compliance receipt artifact directly into Meko."

### Beat 5 (`3:35–4:20`, 45s) — A/B Benchmark Results & Offline Quickstart CTA
- **On Screen**: Switch browser to Governance Control Plane `http://127.0.0.1:4321/?view=benchmark` (and briefly glance at `?view=blast`). End on `README.md` Quickstart.
- **UI Launch Command**:
  ```bash
  npm run guard:ui -- --mode mock --port 4321
  ```
- **Verified Numbers on Screen (`fixtures/benchmark/results.json`)**:
  - Total Rule Violations: `15 -> 0` (`-100%`)
  - Avg Correction Turns: `1.8 -> 0`
  - Total Prompt Tokens (`tiktoken/cl100k_base`): `9,725 -> 1,089` (`-88.8%`)
- **Voiceover**:
  > "Across five representative PayLedger endpoints measured with `tiktoken`, replacing full-ADR prompting and retry loops with targeted Meko retrieval cut rule violations from 15 to zero, eliminated correction turns from 1.8 to zero, and reduced prompt tokens from 9,725 to 1,089—an 88.8% reduction.
  > Every agent config, ADR, and test suite is open-source and runs offline in zero-key `--mode mock` with one command. One Meko datapack, every coding agent, zero drift."

---

## 3. One-Shot Zero-Quota Rehearsal Command Block

Run this anytime to rehearse Beats 1–4 locally without modifying repository fixtures or consuming live Meko quota:

```bash
cp fixtures/meko/mock-datapack.json /tmp/meko-rehearsal-datapack.json
npm run guard:status -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json
npm run guard:spec-check -- specs/001-refunds-rfc.md --mode mock --fixture /tmp/meko-rehearsal-datapack.json || true
npm run guard:impact -- ADR-003
npm run guard:check -- --agent cursor --files fixtures/benchmark/runs/t1-baseline-cursor.ts --mode mock --fixture /tmp/meko-rehearsal-datapack.json || true
MEM_ID=$(npm run -s guard:queue -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.pending[0]?.id ?? "");')
npm run guard:approve -- "$MEM_ID" --reason "Verified ADR-002/003/004 refund safeguards" --by rizal --mode mock --fixture /tmp/meko-rehearsal-datapack.json
npm run guard:check -- --agent opencode --files fixtures/benchmark/runs/t1-guarded-opencode.ts --record-fix --mode mock --fixture /tmp/meko-rehearsal-datapack.json
npm run guard:release-gate -- --mode mock --fixture /tmp/meko-rehearsal-datapack.json
rm -f /tmp/meko-rehearsal-datapack.json
```
