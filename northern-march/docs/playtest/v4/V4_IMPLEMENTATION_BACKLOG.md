# V4 Implementation Backlog

## Lab gates

### L0 — Baseline
Record commit/hashes, Node version, tests/typecheck, gate status and runtime. No gameplay changes.

### L1 — Contracts
Install Zod; implement strict schemas, parsing, cross-references, contextual validation and schema tests.

### L2 — Real game bridge
Build semantic observations/affordances from existing player presentation and route actions through existing validators. Add hidden-state import barriers.

### L3 — Deterministic runner
Implement engine adapter, independent agent RNG, limits, run manifests/records and exact replay. Add passive/random agents.

### L4 — Agent ecology and batch execution
Add human-like/adversarial agents, isolated workers, deterministic output ordering, compact storage and a 1,000-run unattended demonstration.

### L5 — Analysis
Add hard invariants, canonical scenarios, metrics, causal slicing, failure classification, generators, shrinking and permanent regression export.

### L6 — Paired evaluation and Control Center
Add immutable result packages, dashboard, causal explorer, candidate comparison and evidence-linked Analyst briefing.

### L7 — Reporting and operator acceptance
Add exact 1k/10k milestones, email adapter, urgent/final alerts, durable outbox/idempotency, queries and investigation manifests. Prove fake delivery, restart safety, workers continuing, then one real email. Complete operator demonstration.

### L8 — Search
After explicit approval, add adversarial policy/scenario mutation and quality-diversity archives.

### L9 — Controlled recursive improvement
After separate explicit approval, add isolated candidates, allowlisted edit surfaces, development/validation evaluation, simplicity penalties and review gates.

## Required commands

Provide discoverable scripts such as:

```text
npm run playtest:quick
npm run playtest:full
npm run playtest:adversarial
npm run playtest:dashboard
npm run playtest:replay -- <artifact>
```

## Compute and cost controls

Every manifest declares maximum games, workers, wall time, memory/artifact budget and optional LLM/API budget. Runs stop cleanly at budget and issue a final incomplete-coverage report. Local deterministic agents are the default; paid model calls require explicit opt-in.

## Pull-request discipline

One gate per focused PR where practical. Every PR includes exact tests, typecheck, commands, artifacts, known gaps and `STATE.md` update. No gate is marked complete from code review alone; demonstrate it.
