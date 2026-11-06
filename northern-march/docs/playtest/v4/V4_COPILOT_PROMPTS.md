# V4 Coding-Agent Prompts

Use one prompt at a time.

## Prompt 0 — Audit and map

```text
Read STATE.md, DECISIONS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md and docs/playtest/v4. Treat v4 as authoritative for the playtest laboratory. Inspect the repository and map existing types/functions to Lab Gates L0–L2. Do not modify code. Identify conflicts, reuse opportunities, security risks and missing prerequisites.
```

## Prompt 1 — L0

```text
Implement Lab Gate L0 only. Record the untouched baseline, run all current tests/typecheck/gates, save exact results and update STATE.md. No gameplay changes. Commit.
```

## Prompt 2 — L1

```text
Implement Lab Gate L1. Add Zod through npm, strict versioned schemas, parsing, cross-reference/context validation and exhaustive tests. Do not connect bots to the engine yet. Commit only when all tests/typecheck pass.
```

## Prompt 3 — L2

```text
Implement Lab Gate L2 by reusing existing ViewOf(player), Court, Map, letters, objectives, next()/answer() and action/order validators. Do not build a parallel engine. Add static hidden-state import barriers and equivalence/leakage tests. Commit.
```

## Prompt 4 — L3

```text
Implement Lab Gate L3: adapter, separate deterministic agent RNG, limits, versioned run artifacts, exact replay, passive and random-valid agents. Agent rationale/memory stays outside authoritative state. Demonstrate replay and commit.
```

## Prompt 5 — L4

```text
Implement Lab Gate L4: deterministic human-like/adversarial personas and isolated parallel batch execution. Produce compact summaries and a 1,000-run unattended demonstration. No RL or optimization. Commit.
```

## Prompt 6 — L5

```text
Implement Lab Gate L5: hard invariants, canonical scenarios, metrics, causal slicing, failure classification, bounded generation, shrinking and regression export. Demonstrate a complex failure reduced to a minimal reproducible case. Commit.
```

## Prompt 7 — L6

```text
Implement Lab Gate L6: paired evaluator, immutable result packages, static dashboard, causal explorer, candidate comparison and evidence-linked Analyst briefing. Components are read-only regarding gameplay/tests/gates. Commit.
```

## Prompt 8 — L7 reporting, fake delivery

```text
Implement L7 reporting with exact 1,000/10,000 milestones, urgent/final reports, durable outbox, restart-safe idempotency and provider-neutral NotificationAdapter. Use a fake provider only. Prove workers continue while reports generate and no duplicate milestones occur. Commit.
```

## Prompt 9 — L7 queries and real-email readiness

```text
Complete L7 queries/investigation manifests and produce exact secret/configuration instructions for one real email test. Do not expose or commit credentials. Stop before real send and request explicit approval.
```

## Prompt 10 — L7 acceptance

```text
After secrets are configured and explicit approval is provided, run one real email test, then demonstrate FAIL, REVIEW, positive finding, paired comparison, causal replay, shrinking and report delivery. Produce an evidence-linked L7 acceptance report. Do not start L8/L9.
```

## Prompt 11 — Readiness audit

```text
Audit all L0–L7 requirements against v4 documents. List proven, failed, incomplete and not-evaluated items with artifact links. Do not implement search or recursive optimization. Wait for explicit approval.
```
