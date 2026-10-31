# STATE

Updated: 31 Oct 2026, end of Phase 1 (Opus 5.5).

## Built
**Phase 1 engine (`engine/`, TypeScript on Node 22, no build step).** `npm test` runs 57 tests, all passing; `npx tsc -p .` is clean.
- `src/rng.ts`: per-system seeded streams (sfc32 + cyrb128), keyed substreams, state save/restore.
- `src/canonical.ts`: canonical integer-only JSON and hashing.
- `src/events.ts`: B1 envelope, event-type registry (system, domain, significance, root flag).
- `src/world.ts`: WorldState and one reducer per event type (state is a projection of the log).
- `src/scheduler.ts`: tick-ordered heap; jumps to the next item.
- `src/engine.ts`: Sim (emit with validation, ablation, ViewOf, save/load by verified replay, RNG accounting).
- `src/save.ts`: save schema v1 with explicit migration from v0.
- `src/view.ts`, `src/presentation/`: ViewOf and a court summary that reads only the view.
- `src/policies.ts`: passive, delegating, aggressive, random-valid; adviser-following policies declared for Phase 5.
- `src/content.ts`, `content/testbed/`: loader and validator (unknown IDs, traits outside the 14, orphans, unreachable places, duplicates, non-integers, schema version).
- `src/invariants.ts`: C3 checks, run on every seed, plus paired-arm checks.
- `src/gates.ts`: C0 evaluator (Wilson, paired bootstrap, PASS/AMBER/FAIL, policy groups, sealed-block gate log).
- `src/batch.ts`, `src/cli.ts`: headless batch runner with the C1 metrics row; CLI `run | g01 | validate | gate | inspect | timeline`.
- `src/inspect.ts`: causal ancestry and timeline inspectors.
- `src/systems/testbed.ts`: placeholder systems (economy, weather, threat, messenger, player orders) that exist only to exercise the engine.

**Phase 0 / 0b prototypes (`phase0/`, throwaway):** see D-001 to D-008.

## Result
- G-01 PASS (Node and Bun, three time zones, two locales; 100 seeds).
- G-02 PASS (100/100 seeds for each perturbed system).
- 1,000 seeds per arm with all invariants: 0 violations, 97 s.
- Evaluator reproduces the Phase 0 and 0b verdicts. Details: DECISIONS D-009.

## Stubbed / not built (by design)
- Map, beliefs with staleness, real reports and orders (B2 lifecycle), Recommendation, DecisionTrace: Phase 2-3. The testbed's belief store is a placeholder: the latest delivered value per key.
- Snapshots (load replays from the start).
- Metrics fields that need later systems are null (endings, failureOrigin, wakes, revolts).
- Adviser-following policies (Phase 5).

## Known gaps
- G-01 not yet run on a second physical machine or CPU architecture. Run `node src/cli.ts g01 --seeds 1..100` on any other computer: the last line must read `combined 9d7168d4f8ce7a3b37599aeeb1065db229ea55576cfcc4295d1eba9e5500afaa`.
- Testbed systems are not a design and will be replaced from Phase 2 on.
- The static presentation check covers imports only; the runtime guard covers `sim.world`.

## Needs a human
Optional: run the G-01 command above on your own computer (needs Node 22.18+).

## Next phase
Phase 2: map, beliefs, reports and contracts. Recommended: Opus 5.5, high effort.
