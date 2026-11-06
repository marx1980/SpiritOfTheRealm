# V4 Acceptance, Governance and Migration

## Acceptance checklist

### Boundary
- Agents see only semantic player observations.
- Strict runtime and contextual validation succeeds.
- Hidden-state imports are blocked.
- Existing engine validators remain authoritative.

### Reproducibility
- Independent agent RNG and exact input replay.
- All hashes, versions, prompts/models and partitions recorded.
- Worker ordering cannot alter canonical results.

### Laboratory
- 1,000 unattended runs complete.
- Failures have replay, causal slice and minimized regression.
- Paired evaluator uses identical tuples.
- Budgets stop safely and report incomplete coverage.

### Control Center
- Status categories remain distinct.
- Dashboard identifies exact run/baseline.
- Causal explorer separates objective/Anna/actor views.
- Analyst claims are evidence-linked.

### Reporting
- Exact 1k progress and 10k deep milestones.
- No duplicate 10k progress email.
- Urgent and final reports.
- Workers continue during reporting.
- Durable outbox, retries and restart idempotency.
- Fake provider tests and one approved real email test.
- No credentials in repository/logs/artifacts.

### Optimization safety
- Test/evaluator/gate/partition code is optimizer read-only.
- L8 and L9 require separate explicit approvals.
- Candidate code initially requires review.
- No seed, scenario or agent-ID special-casing.

### Human validation
- H-01/H-02 remain human gates.
- Automation never claims human comprehension or fun.

## Migration from v1–v3

1. Move old packages to `docs/playtest/archive/v1`, `/v2`, `/v3`.
2. Add v4 under `docs/playtest/v4`.
3. Add a short root pointer to `README_START_HERE_V4.md`.
4. Update `STATE.md` and `DECISIONS.md` to state that v4 supersedes earlier playtest-lab operational instructions.
5. Do not delete old decisions; mark them superseded where they conflict.
6. Do not execute old AP task numbers or prompts after v4 adoption.

## Decision record to add

```text
D-017 — Agent Playtest Laboratory v4 is the authoritative operational plan. Earlier v1–v3 playtest packages are archived. Recursive optimization is prohibited until Lab Gates L0–L7 pass and L8/L9 receive separate explicit approval.
```
