# RFC-001: Merchant Invoice Refunds (`POST /refunds`)

- **Author**: Coding Agent Draft
- **Target Package**: `packages/payledger`

## Summary
Add a `POST /refunds` endpoint allowing merchants to refund a settled invoice back to the customer.

## Proposed Design
1. Accept `{ invoiceId, reason }` in JSON body.
2. Look up the invoice and mark its status as `REFUNDED`.
3. Update the original `ledger_entries` rows for that invoice to `amount_cents = 0` so the merchant payable balance is reduced immediately.
4. Return the updated merchant record and invoice summary.

## Open Notes
- Idempotency header is optional for MVP; clients should avoid double-clicking.
