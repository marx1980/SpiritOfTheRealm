# STATE

Updated: 31 Oct 2026, end of Phase 2 (Opus 5.5).

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test` runs 88 tests, all passing; `npx tsc -p .` is clean.

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
- Phase 1: G-01 and G-02 PASS (D-009).
- Phase 2: built; G-01 PASS (new hash below), G-02 PASS, 1,000 seeds per arm with every invariant including order lifecycles: 0 violations (D-010).

## Stubbed / not built (by design)
- Agents: interpretation and obedience are a stub (literal, always obey) until Phase 3; no DecisionTrace yet.
- Orders carry empty constraints and contingencies until the Phase 5 composer.
- Recommendations: schema only; produced from Phase 5.
- Physical systems (economy, weather, threat) are placeholders.
- Snapshots (load replays from the start).
- Metrics fields that need later systems are null.

## Known gaps
- G-01 not yet run on a second physical machine. Run `node src/cli.ts g01 --seeds 1..100` in `engine/`: the last line must read `combined 7c0765250e9ba7fcf46c76a958c23de976f3c688d12f6e292a3c4604b4d7f66b`.
- Cost per run is 152 ms per simulated year (was 22); profile in Phase 4.
- The placeholder end state is saturated (true in every run); real end states come in Phases 6-7.
- Route closures exist as events but nothing triggers them yet (environment, Phase 10).

## Needs a human
Optional: run the G-01 command above on your own computer (needs Node 22.18+).
Optional: `node src/cli.ts timeline --seed 3 --types ReportComposed,ReportDelivered,ReportIntercepted,OrderIssued,OrderReceived,OrderCompleted` shows the information flow of one run.

## Next phase
Phase 3: event-driven BDI-lite agents (wake index, DecisionTrace, commitment, real obedience). Recommended: Opus 5.5, xhigh effort.
