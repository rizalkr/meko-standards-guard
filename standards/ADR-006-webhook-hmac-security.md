# ADR-006: HMAC Signature Verification Before Webhook Parsing (Rule S6)

- **Status**: Accepted
- **Rule ID**: `S6`
- **Category**: Security

## Context
Parsing untrusted webhook JSON before verifying its cryptographic signature exposes the server to spoofed payment confirmations, replay attacks, and parser DoS.

## Decision
1. Inbound webhook handlers MUST read raw request bytes (`await c.req.text()`) and verify the `X-Signature` HMAC-SHA256 digest using constant-time comparison (`crypto.timingSafeEqual`) BEFORE calling `JSON.parse`.
2. Webhook timestamps (`X-Timestamp`) older than 300 seconds MUST be rejected to block replay attacks.
3. Failed webhook payloads MUST be logged without PII.

## Enforcement
- AST check verifies `verifyWebhookSignature` / `timingSafeEqual` runs before `JSON.parse` in webhook handlers.
