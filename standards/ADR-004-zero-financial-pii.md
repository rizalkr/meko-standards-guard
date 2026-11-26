# ADR-004: Zero Financial PII Leakage in Responses and Logs (Rule S4)

- **Status**: Accepted
- **Rule ID**: `S4`
- **Category**: Security

## Context
Exposing raw merchant records (`SELECT *` / `db.select().from(merchants)`) or logging full request/DB payloads leaks sensitive financial PII (`bank_account_number`, `routing_number`, `tax_id`) to API consumers and log aggregators.

## Decision
1. Sensitive fields (`bank_account_number`, `routing_number`, `tax_id`) MUST NEVER appear in HTTP JSON responses or `console.*` / logger calls.
2. Endpoints MUST project explicit safe columns or pass records through `toPublicMerchantDto(...)`; returning raw `merchants` rows directly is forbidden.

## Enforcement
- AST taint analysis traces `merchants` queries and forbidden PII identifiers into `c.json(...)` and logger calls.
