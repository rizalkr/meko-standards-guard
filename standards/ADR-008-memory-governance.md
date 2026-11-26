# ADR-008: Human-Gated Standards and Anti-Context-Poisoning (Rule S8)

- **Status**: Accepted
- **Rule ID**: `S8`
- **Category**: Governance

## Context
Autonomous coding agents must learn from mistakes, but allowing agents to write directly to shared team memory risks **context poisoning** (an agent hallucinating or weakening a security/financial rule).

## Decision
1. All agent-discovered learnings and violation traces are written to **private/candidate memory** (`memory_add`) and MUST NOT affect other agents until reviewed.
2. Only a human maintainer can promote a candidate learning to **shared memory** (`memory_promote`) with an explicit audit reason logged to Meko Conversations (`conversation_add_message`).
3. Direct agent modifications to `standards/*.md`, `guard.config.json`, or official fee/tax constants require explicit human approval.

## Enforcement
- `guard check` flags unapproved modifications to `standards/` or `guard.config.json`.
- `MekoClient` isolates `private` memories by `agentId` until `memoryPromote` is called.
