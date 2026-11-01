# STATE

Updated: 1 Nov 2026, end of Phase 4 (Opus 5.5).

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test` runs 118 tests, all passing; `npx tsc -p .` is clean.

Phase 4 added:
- Tiers A/B/C as world state; 24 background characters in content (identity, household, occupation, home).
- Promotion (independent responsibility -> A; caught up in a military event -> B), demotion after 30 quiet days, one step at a time, history kept.
- Leader appointment by recommendation and trust; delegated "investigate" expeditions with subordinate orders.
- Tier B light planning and compressed traces; wake accounting by tier.
- `tools/phase4_gate.ts` (G-14); `withExtraBackground` content variant; gate key includes the engine source hash.

Phase 3 added:
- `src/agents/` (pure, reads only beliefs): `model.ts` (Situation, Perceiver), `terms.ts` (expected consequences), `planner.ts` (candidate templates capped by skill, scoring with reasons, commitment, strategic focus), `obedience.ts` (interpretation, margins, obey/adapt/refuse).
- `src/systems/agents.ts`: wake subscription index, coalescing, reviews of live intentions, execution (letters, marches, detachments, sorties), advice and B3 Recommendations, answer-rate learning.
- `src/systems/orders.ts`: real interpretation and obedience; execution with the recipient's skill.
- `src/chronicle.ts`: failure attribution (belief / choice / communication / execution) and breach tracing.
- `tools/phase3_gate.ts`: G-10/G-11 runner (TUNE and sealed modes).
- Content v3: objectives, houses, garrisons, Caron's company, threat strength and treasury predicates, agent and battle parameters.

Phase 2 added:
- `content/march/`: 22 locations, 3 provinces, 27 routes, the Vey with bridge/ford/ferry, 8 characters with tiers and capabilities, predicates with half-lives.
- `src/map.ts`: travel time per mode and terrain, crossings, deterministic shortest paths over open routes.
- `src/beliefs.ts`: bands, lazy staleness, integration (contradictions kept; first-hand and same-source resolution), eviction plan.
- `src/schemas.ts`: frozen B2 StructuredOrder, B3 Recommendation/Reason, B5 Report with validators and the order lifecycle grammar.
- `src/systems/`: `movement`, `knowledge` (observation, learning, seeding), `messenger` (reports and orders leg by leg; loss, interception, redirect, undeliverable), `orders` (lifecycle with a stub executor), `player`, `physical` (placeholder economy, weather, threat).

Phase 1 base:
- `src/rng.ts`: per-system seeded streams (sfc32 + cyrb128), keyed substreams, state save/restore.
- `src/canonical.ts`: canonical integer-only JSON and hashing.
- `src/events.ts`: B1 envelope, event-type registry (system, domain, significance, root flag).
- `src/world.ts`: WorldState and one reducer per event type (state is a projection of the log).
- `src/scheduler.ts`: tick-ordered heap; jumps to the next item.
- `src/engine.ts`: Sim (emit with validation, ablation, ViewOf, save/load by verified replay, RNG accounting).
- `src/save.ts`: save schema v1 with explicit migration from v0.
- `src/view.ts`, `src/presentation/`: ViewOf and a court summary that reads only the view.
- `src/policies.ts`: passive, delegating, aggressive, random-valid; adviser-following policies declared for Phase 5.
- `src/content.ts`: loader and validator (unknown IDs, traits outside the 14, orphans, unreachable places, unknown terrain/tier/river, duplicates, non-integers, schema version).
- `src/invariants.ts`: C3 checks, run on every seed, plus paired-arm checks.
- `src/gates.ts`: C0 evaluator (Wilson, paired bootstrap, PASS/AMBER/FAIL, policy groups, sealed-block gate log).
- `src/batch.ts`, `src/cli.ts`: headless batch runner with the C1 metrics row; CLI `run | g01 | validate | gate | inspect | timeline`.
- `src/inspect.ts`: causal ancestry and timeline inspectors.

**Phase 0 / 0b prototypes (`phase0/`, throwaway):** see D-001 to D-008.

## Result
- Phase 1: G-01, G-02 PASS (D-009). Phase 2: built (D-010).
- Phase 3: G-10 PASS, **G-11 FAIL** (wrong beliefs do not lead to worse outcomes under passive or delegating rulers). Proceeded at Marko's instruction; needs his confirmation as an override (D-012, D-013).
- Phase 4: G-14 PASS on block 40000 with the final code; G-01 PASS (D-014). G-02 redefined (first divergence belongs to the perturbed system).

## Stubbed / not built (by design)
- Agents: interpretation and obedience are a stub (literal, always obey) until Phase 3; no DecisionTrace yet.
- Orders carry empty constraints and contingencies until the Phase 5 composer.
- Recommendations: schema only; produced from Phase 5.
- Physical systems (economy, weather, threat) are placeholders.
- Snapshots (load replays from the start).
- Metrics fields that need later systems are null.

## Known gaps
- G-11 open (D-013): information does not yet matter enough under passive or delegating rulers.
- G-01 not yet run on a second physical machine. In `engine/`: `node src/cli.ts g01 --seeds 1..100` must end with `combined 4238030536c7f39d09f7a9e1ffdfa62e8a50b6147a2c6fbf73e39dc630a006d7`.
- Tier B's busiest day sits exactly at its budget (3). Tier B sergeants wake but have no options yet.
- Placeholder physical systems (economy, weather, threat): storms dominate outcomes.
- Route closures exist but nothing triggers them (Phase 10).

## Needs a human
- Confirm the G-11 override, or pick an option from D-013.
- Optional: run the G-01 command above on your own computer (Node 22.18+).

## Next phase
Phase 5: Court, Map and personal presence. This is the GO/NO-GO human gate (H-01, with H-02 and G-12). Build the debug Court and Map with templated phrasing, then stop for testers. Recommended: Opus 5.5, high effort.
