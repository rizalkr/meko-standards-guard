# ADR-007: Immutable Invoice and Fee Snapshots (Rule S7)

- **Status**: Accepted
- **Rule ID**: `S7`
- **Category**: Financial Invariant

## Context
If an invoice dynamically joins the merchant's current `fee_bps` or `tax_rate_bps` when viewed, changing a merchant's pricing tier later silently alters historical invoice totals.

## Decision
1. Invoice creation MUST persist immutable `subtotal_cents`, `tax_rate_bps`, `tax_cents`, `fee_bps`, `fee_cents`, and `total_cents` columns on the `invoices` row.
2. Invoice retrieval endpoints MUST read stored snapshot columns and MUST NOT recompute totals from live merchant rates.

## Enforcement
- Contract tests update a merchant's fee tier after invoice creation and assert historical invoice totals remain unchanged.
