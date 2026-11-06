# V4 Master Plan — Automated Playtesting and Controlled Improvement

## Mission

Build a reproducible laboratory that plays the real Spirit of the Realm simulation through Anna's limited player interface, runs thousands of campaigns, detects and minimizes failures, explains causes, compares candidate changes, reports progress, and only later supports controlled recursive improvement.

## System boundary

```text
WorldState → existing simulation → ViewOf(Anna)
→ semantic PlayerObservation → player agent
→ Zod validation → observation-context validation
→ existing human action/order validator → Sim.answer()
```

Agents never receive unrestricted WorldState, private beliefs, hidden traits, DecisionTrace, future events, objective causality, simulation RNG or observer data while deciding. Their rationale and memory are test-side artifacts only.

## Core subsystems

1. **Observation contract:** the same semantic model supports UI and agents.
2. **Runtime validation:** Zod validates serialized/untrusted inputs; engine validators retain gameplay authority.
3. **Player-agent ecology:** baseline, human-like and adversarial personas.
4. **Deterministic runner:** independent agent RNG, exact replay and strict limits.
5. **Scenario laboratory:** canonical, generated and adversarial scenarios.
6. **Invariant engine:** integrity failures are separate from design-quality findings.
7. **Causal analyzer:** objective, Anna-known and acting-agent views.
8. **Shrinker:** converts complex failures into minimal regression cases.
9. **Paired evaluator:** baseline and candidate use identical tuples.
10. **Control Center:** dashboard, reports, delivery tracking and investigations.
11. **Analyst Agent:** evidence-linked interpretation, never test authority.
12. **Controlled optimizer:** only after all prior gates pass.

## Player-agent set

- passive;
- random-valid;
- cautious administrator;
- impulsive war ruler;
- adviser-dependent ruler;
- community protector;
- literal novice;
- miscalibrated ruler;
- delegating strategist;
- adversarial affordance/exploit probes.

Learning agents and MAP-Elites are deferred until deterministic agents, evaluation and shrinking are trusted.

## Evaluation hierarchy

1. Hard validity: zero leaks, invalid lifecycles, replay divergence and causal corruption.
2. Existing passing gates: no regression.
3. Target defect: fixed on development data.
4. Validation: improvement persists on held-back tuples.
5. Diversity: no unintended strategic collapse.
6. Performance: within an explicit budget.
7. Simplicity: prefer fewer changes and no scenario/seed/agent special cases.

## Data partitions

- **Development/TUNE:** ordinary iteration.
- **Validation:** not used by the inner optimizer.
- **Sealed gates:** never optimization feedback.
- **Regression corpus:** permanent minimized failures.
- **Human-test builds:** separately frozen and hashed.

## Recursive-improvement safety

The optimizer cannot edit tests, evaluators, gates, thresholds, partition definitions or reporting logic. Candidate work occurs in isolated branches/worktrees. Initially, code changes always require review; only pre-approved bounded parameter changes may later be auto-accepted.

## Human limits

Automation can outperform humans in coverage, consistency, reproducibility and causal comparison. It cannot certify fun, perceived fairness, emotional impact, comprehensibility or character believability. H-01/H-02 remain human.
