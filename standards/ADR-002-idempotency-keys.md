# ADR-002: Mandatory Idempotency Keys on Money Mutations (Rule S2)

- **Status**: Accepted
- **Rule ID**: `S2`
- **Category**: Financial Invariant

## Context
**Postmortem — Incident #41 (Duplicate Payout on Retry):** A payment gateway timeout caused the client worker to retry `POST /payouts`. Because the endpoint lacked an idempotency check, the merchant was paid twice for the same settlement batch.

## Decision
1. Every money-mutating HTTP endpoint (`POST /invoices`, `POST /payouts`, `POST /refunds`, `POST /payouts/:id/reverse`) MUST require an `Idempotency-Key` header.
2. Requests with an existing `Idempotency-Key` MUST compare the SHA-256 hash of the canonical request payload:
   - Same key + same payload hash -> replay stored response (`200`/`201`) without re-executing side effects.
   - Same key + different payload hash -> return `409 Conflict`.

## Enforcement
- AST check verifies mutation routes apply the `requireIdempotency` guard.
- Integration tests replay identical and conflicting payloads.
