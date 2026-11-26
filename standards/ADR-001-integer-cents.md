# ADR-001: Integer Minor Units and Banker's Rounding (Rule S1)

- **Status**: Accepted
- **Rule ID**: `S1`
- **Category**: Financial Invariant

## Context
Floating-point arithmetic (`0.1 + 0.2 !== 0.3`) introduces penny drift across invoices, fee splits, and double-entry ledger totals. Over thousands of payouts, 1-cent rounding mismatches break ledger reconciliation.

## Decision
1. All monetary amounts in database columns, DTOs, and service logic MUST be represented as integer minor units (`*_cents`, `Number.isSafeInteger`).
2. Floating-point arithmetic (`* 0.11`, `/ 100`, `parseFloat`) on monetary values is forbidden.
3. Percentage calculations (fees, taxes) MUST use basis points (`bps`, where `100 bps = 1%`) and the shared banker's rounding (half-to-even) integer helper.

## Enforcement
- AST check rejects non-integer monetary literals and float multiplication/division on money variables.
- Ledger invariant tests verify zero rounding drift across fee/tax splits.
