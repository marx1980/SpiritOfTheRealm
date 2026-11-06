# V4 Agent API and Runtime Validation

## Public types

Implement a versioned `PlayerObservation`, `ActionAffordance`, `PlayerAgentDecision`, `PlaytestRunManifest`, `PlaytestRunRecord` and `NotificationRecord`.

Each observation contains only:

- campaign objective as known to Anna;
- Court, Map, letters and advice visible to Anna;
- visible evidence with source, age and reliability;
- Anna's position/status;
- semantic action affordances.

## Validation chain

```text
unknown payload
→ strict Zod schema
→ cross-reference checks
→ decision matched to observation
→ affordance allowlist checks
→ existing game validator
→ canonical PlayerInput
```

Use `z.strictObject()` and discriminated unions. Reject unknown fields, implicit numeric coercion, duplicate IDs, unresolved references, invalid ages, unsupported action values and schema-version mismatches.

## Static security boundary

`src/playtest/agents/**` may import only the public playtest API and deterministic test utilities. Add a test that rejects imports from world state, simulation systems, private NPC model, inspector, chronicle and simulation RNG.

## LLM agents

LLM output is optional and untrusted. It must return schema-constrained JSON, receive at most a bounded correction retry, then fall back deterministically. Model/provider/version/prompt hash must be recorded. LLM agents are excluded from determinism claims unless their validated decisions are recorded and replayed.

## Versioning

Breaking contract changes increment `schemaVersion`. Persisted artifacts declare schema and migration support. No silent parsing of unknown future versions.
