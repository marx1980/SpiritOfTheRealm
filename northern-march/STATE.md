# STATE

Updated: 1 Nov 2026, end of Phase 5 build; stopped at the human gate (Opus 5.5).

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test` runs 129 tests, all passing; `npx tsc -p .` is clean (src, test, tools, ui).

Phase 5 added:
- Interactive play: `next()` / `answer()` with decision points (letter, advice in person, danger, arrival, optional daily checkpoint); exact replay of answers from saves.
- `src/presentation/`: `court.ts` (ranked issues with evidence and per-adviser advice), `map.ts` (belief map), `phrasing.ts` (templated words, no hidden numbers).
- Order composer: `OrderDraft` + `validateDraft` against what Anna knows.
- Anna's travel (Ravenport, Greybridge, Northwatch); letters read to the council in her absence then forwarded; direct observation of walls in person.
- Regency (Elara, delegated authority, letters to Anna); personal danger and campaign end (killed or captured); campaign objective and `objectiveMet` metric.
- Advice heard only in person; `follow:<adviser>` policies; G-12 tool (`tools/phase5_g12.ts`).
- Debug UI: `ui/` → `node ui/build.ts` → `ui/dist/northern-march.html` (published as a private artifact); H-01 scenario `ui/h01.json`; protocol `docs/H01_PROTOCOL.md`.
- Pure-JS SHA-256 (browser).

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
- Phase 4: G-14 PASS on block 40000 with the final code; G-01 PASS (D-014). G-02 redefined (first divergence belongs to the perturbed system); G-02 and the 1,000-seed invariant batch PASS on the final Phase 4 code.
- Phase 5: built. G-12 AMBER on block 50000 (5.9 points), then fixed by a seat-level treasury rule and PASS on block 60000 (18.6 points, interval 16.3-21.0) (D-015). H-01 and H-02 not run (need testers).

## Stubbed / not built (by design)
- The composer sets intent, objective, discretion and reporting; constraints and contingencies are accepted but not yet offered in the UI.
- Saves cannot be taken while a decision is open.
- Physical systems (economy, weather, threat) are placeholders.
- Snapshots (load replays from the start).
- Metrics fields that need later systems are null.

## Known gaps
- G-11 open (D-013): information does not yet matter enough under passive or delegating rulers.
- G-01 not yet run on a second physical machine. In `engine/`: `node src/cli.ts g01 --seeds 1..100` must end with `combined dd80352c194e7df3344c6d550f22be9fc8fdbb0eb23c0a40b814040f62bb21fa`.
- Tier B's busiest day sits exactly at its budget (3). Tier B sergeants wake but have no options yet.
- Placeholder physical systems (economy, weather, threat): storms dominate outcomes.
- Route closures exist but nothing triggers them (Phase 10).
- G-12 passes only because the best adviser is now informed about the treasury. Advisers are not yet differentiated by design (traits, capabilities, objectives); Selene is nearly as good as Elara on TUNE (D-015).
- H-01 scenario: the first pause comes on day 12 (first letter to Anna), so testers see no opening. Not yet fixed (see below).
- Only the steward knows the treasury; adviser quality is not yet differentiated by design.

## Needs a human
- **Run H-01 (and H-02 over two sessions)** with 3-5 testers who have not seen the design: `docs/H01_PROTOCOL.md`. Share the debug page from its Share menu, or build it locally (`cd engine && npm install && node ui/build.ts`).
- Decide whether to design the advisers' differences (D-015, option 3, not built) before or after H-01.
- Decide the H-01 opening: start paused at Day 1 and/or move the first raid earlier in ui/h01.json (not applied).
- Confirm the G-11 override, or pick an option from D-013.
- Optional: run the G-01 command above on your own computer (Node 22.18+).

## Next phase
Do not start Phase 6 until H-01 passes. If H-01 fails, fix the information design and re-test with new testers (Opus 5.5, high). After H-01 passes: Phase 6, population communities and rebellion — Opus 5.5, high effort.
