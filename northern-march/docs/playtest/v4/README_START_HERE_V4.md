# Spirit of the Realm — Agent Playtest Laboratory v4

**v4 is the single authoritative implementation package.** It consolidates the earlier test-lab, Control Center and email-reporting documents and resolves their overlaps.

## Authority order

1. Existing engine invariants and accepted decisions in `DECISIONS.md`
2. `V4_MASTER_PLAN.md`
3. `V4_IMPLEMENTATION_BACKLOG.md`
4. `V4_CONTROL_CENTER_AND_REPORTING.md`
5. `V4_ACCEPTANCE_AND_GOVERNANCE.md`
6. Existing architecture documents where they do not conflict

Archive v1–v3 under `docs/playtest/archive/`. Do not let a coding agent treat old prompts or task numbers as current requirements.

## First action

Add this package under `docs/playtest/v4/`, then give the coding agent only Prompt 0 from `V4_COPILOT_PROMPTS.md`.

```text
Read STATE.md, DECISIONS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md and docs/playtest/v4. Execute Prompt 0 from V4_COPILOT_PROMPTS.md only. Inspect and plan; make no code changes.
```

## Critical gates

- No hidden-state access by player agents.
- No search or recursive optimization until Lab Gates L0–L7 pass; L8 and L9 each require separate explicit approval.
- No real email sending until secrets are configured and a fake-delivery demonstration passes.
- H-01 and H-02 remain human gates.
