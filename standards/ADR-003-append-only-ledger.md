# ADR-003: Strict Double-Entry and Append-Only Ledger (Rule S3)

- **Status**: Accepted
- **Rule ID**: `S3`
- **Category**: Financial Invariant

## Context
Mutating or deleting historical rows in `ledger_entries` destroys the financial audit trail and makes external reconciliation impossible.

## Decision
1. `ledger_entries` is strictly **append-only**. `UPDATE` and `DELETE` queries against `ledger_entries` are strictly forbidden.
2. Corrections, refunds, and cancellations MUST append a new balanced reversing entry (`entry_type = 'REVERSAL'`) referencing the original `tx_group_id`.
3. Every `tx_group_id` MUST satisfy `SUM(debit_cents) === SUM(credit_cents)`.

## Enforcement
- AST check rejects `db.update(ledgerEntries)` and `db.delete(ledgerEntries)`.
- Invariant tests verify global and per-group debit/credit balance after every operation.
