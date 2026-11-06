# Agent Playtest Laboratory: review of v4 and v4.1 amendments (6 Nov 2026)

v4 (`v4/`, unchanged, SHA-256 in `v4/V4_MANIFEST.json`) stays the authority. This file amends it where it conflicts with the repository as it stands after Phase 6 (6A). Where this file and v4 disagree, this file wins (DECISIONS D-022).

## Review

v4 is sound in shape: a strict observation boundary, an existing validator as final authority, gated build order, sealed-data rules carried over from plan C0, and explicit approvals before search (L8) and self-improvement (L9). The problems are of fit and of specification:

| # | Finding | Amendment |
|---|---|---|
| R1 | Asks for D-017; D-017 to D-021 exist. | Recorded as **D-022**. |
| R2 | Written 3 Nov, before Phase 6: no communities, petitions, relief, levy cost, or the one-advice-prompt-a-day rule. | Personas cover communities and relief (A2). |
| R3 | Handover risk 12 (synthetic tester shares NPC logic) is not addressed. | A3: only the adviser-dependent persona may follow advice; no persona imports the planner; enforced by test. |
| R4 | Personas are names only: no goal, reading habit, rule or target failure. Undefined personas collapse into one, which plan C0.5 already forbids. | A2: a specification per persona; A4: distinctness check. |
| R5 | No bridge to H-01. Agents can state a reason for every decision, which allows an automated *proxy* of H-01 (a) and (c). | A5, labelled "proxy, not a human result". |
| R6 | "Same semantic model for UI and agents" has no mechanism. Costs, affordability and advice-to-action mapping live inside `ui/app.ts`. | A1: moved to `src/presentation/affordances.ts`; the page and the bridge both import it. |
| R7 | Zod placement unspecified. The engine has no runtime dependency and must stay deterministic and dependency-free. | Zod only under `src/playtest/`. |
| R8 | Compute: the build machine has 2 cores; a 1,000-game run is about an hour. Long runs belong on GitHub Actions or the owner's computer. | A6: budgets per mode; workers default to cores minus one. |
| R9 | Email: no mail provider is reachable from the build container. A message every 1,000 games is noisy. | A7: 1k milestones go to the dashboard and outbox; email at 10k, on Severity-1 alerts and at the end (configurable). Real sending only from CI with secrets. |
| R10 | The recipient address must not be committed (public repo). | Only `PLAYTEST_REPORT_EMAIL_TO` in the environment; `.env.example` shows a placeholder. |
| R11 | "Exact replay" for agents is undefined when an agent's choice depends on its own RNG. | A8: the record stores every validated decision; replay feeds decisions back without the agent and must reproduce the log hash. |
| R12 | Invalid-decision handling is undefined (crash, skip, retry?). | A9: rejected decisions are recorded with the reason and replaced by "wait"; a run with any rejection from a non-adversarial persona is a FAIL. |

## Amendments

**A1. One affordance model.** `src/presentation/affordances.ts` holds what a decision can be: advice turned into actions, repair cost from believed walls, affordability from believed coins, relief places, travel targets, missions. It takes `View` and a `PublicRules` object (prices and lists anyone in the realm knows), never `Content`. `ui/app.ts` and `src/playtest/observe.ts` both use it.

**A2. Personas.** Deterministic, each with its own RNG stream (`agent:<persona>`), independent of every simulation stream.

| Persona | Goal | Reads | Rule | Exposes |
|---|---|---|---|---|
| passive | none | nothing | always wait | baseline drift |
| random-valid | none | affordances | uniform over affordances, wait included | crashes, invalid states |
| cautious-administrator | keep the treasury | coins, walls | repair the worst wall below 50% only with a reserve of 30k left; levy only when coins < 20k; send the captain only to raiders reported strong and fresh (≤ 3 days) | over-caution cost, stale-news paralysis |
| impulsive-war-ruler | destroy raiders | raider reports | send the captain to any raiders at once, attack when there; rush repairs; levy whenever short | levy backlash, captain-away cost |
| adviser-dependent | do what the council says | advice | follow the advice with most supporters (ties: the adviser whose followed orders have completed most often, learned from letters) | adviser quality (G-12 by another route) |
| community-protector | keep the people content | people issues, levies | relief to the worst people issue when affordable; never levy unless coins < 5k; otherwise repairs below 40% | relief economics, petitions |
| literal-novice | answer what is in front | top issue only | act on the first issue's first evidence, whatever its age | stale-letter traps |
| miscalibrated-ruler | act on any word | all evidence, ignoring certainty and age | treats "perhaps" and old news as fact; acts on the oldest alarm first | certainty and age wording |
| delegating-strategist | standing policy | walls, raiders | defend the most threatened fort, repair below 60%, then leave it to the captain for 20 days | delegation |
| adversarial-probe | break the boundary | affordances | levy spam, travel spam, and a fixed share of deliberately invalid decisions (unknown ids, wrong observation id, duplicates) | validation chain, exploits |

**A3. Independence from the NPC planner.** `src/playtest/agents/**` may import only `../contract.ts` and `../agentkit.ts`. A test rejects any other import (world, engine, systems, agents/planner, inspector, chronicle, rng outside agentkit). Only `adviser-dependent` may read advice as a recommendation; the others may read advice text as evidence, not follow it.

**A4. Distinctness.** On every batch, report the share of seeds on which each pair of personas produces different log hashes. Pairs below 10% are reported as one group (plan C0.5).

**A5. H-01 proxy (automated, never a human result).** Per persona: (a) share of non-wait decisions whose stated reason cites at least one evidence id present in that observation; (c) uses of hidden information: structurally zero (A3), and checked by the observation leak test. (b) has no automated proxy.

**A6. Budgets.** Quick: 100 games, 150 days. Full: 1,000+ games. Every manifest declares max games, workers, wall time and artifact bytes; a run stops cleanly at the first limit and reports incomplete coverage.

**A7. Reporting cadence.** 1,000-game milestones: dashboard and outbox only, unless `PLAYTEST_EMAIL_EVERY_1K=1`. 10,000: deep report by email. Severity-1 invariant: immediate. Final: on completion, interruption or terminal failure. Exactly-once keys `<runSet>:<kind>:<n>`.

**A8. Replay.** A run record lists, per decision point, the observation hash and the validated actions. Replay feeds those actions to the engine without the agent and must reproduce the log hash.

**A9. Invalid decisions.** Rejected at the first failing step of the chain, recorded with that step and reason, replaced by "wait". Any rejection from a non-adversarial persona fails the run.

**A10. Scope this round.** L0-L7 with a fake mail provider. Real email (Prompt 10) needs secrets set by Marko. L8 and L9 not started; each needs his separate approval.

## Stored copy

`v4/` holds the package as received, except one line: the recipient address in `V4_CONTROL_CENTER_AND_REPORTING.md` is redacted because the repository is public (R10). That file's SHA-256 therefore differs from `V4_MANIFEST.json`; the other eight match.
