# ADR-005: Atomic Transaction and Balance Lock on Payouts (Rule S5)

- **Status**: Accepted
- **Rule ID**: `S5`
- **Category**: Architecture

## Context
Performing a balance read followed by a separate payout insert outside a database transaction creates a TOCTOU (Time-of-Check to Time-of-Use) race condition allowing concurrent requests to overdraft a merchant's payable balance.

## Decision
1. All payout and settlement balance checks MUST execute inside the same `db.transaction(...)` block as the corresponding `ledger_entries` insert.
2. Balance availability MUST be computed from posted ledger entries inside the transaction before writing settlement entries.

## Enforcement
- AST check verifies payout/settlement services wrap balance reads and ledger writes in `db.transaction(...)`.
- Concurrency tests assert that parallel payout requests cannot overdraft available balance.
