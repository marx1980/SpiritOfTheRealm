# Review notes - 31 Oct 2026

What was changed in each document and why. Put the decisions you accept into `DECISIONS.md`.

## Cross-document issues fixed
- **Time unit:** none of the docs defined it. Now one clock everywhere: 1 tick = 1 game second, scheduler jumps between events.
- **Two implementation plans:** v1 and v2 are merged into one `IMPLEMENTATION_PLAN.md` (v3).
- **Backlog not mapped to phases:** epics P0.07 (personal presence), P0.17 (Arven) and P0.24 (endings) had no phase. Every epic now has a phase, a Core/Full scope and a "Done when" criterion.
- **Schemas scattered:** all contracts now live in the plan, section B; the other docs reference it instead of redefining.
- **Terminology:** `GameTime` vs tick, "ruler knowledge projection" vs `ViewOf(player)`, BattleBeliefs vs command-post belief map, aligned and listed in `GLOSSARY.md`.
- **Succession mentioned in the prototype battle doc:** moved to P1.

## IMPLEMENTATION_PLAN.md
- Phase 5 now includes personal presence, capital delegation, objective tracking and death/capture defeat.
- Phase 8 includes battle entry/exit and Anna's command-position risk.
- Scripted player policies added to the batch runner, so batch runs exercise the game without a human.
- Added the backlog-to-phase map and an open decisions list.

## ARCHITECTURE.md (§20)
Only section 20 was in the file you shared; numbering kept.
- Added: wake subscription index and trigger coalescing; significance-to-layer mapping.
- Added: commitment/hysteresis and repair-before-replan, to stop agents dithering.
- Added: capability effects at observation, interpretation, planning and execution (§20.7).
- Added: order interpretation and obedience model (§20.8).
- Added: belief caps with logged eviction; contradictions kept.
- Tightened: language-layer validation of both generated speech and parsed orders.
- Added: per-tier wake budgets and DecisionTrace retention policy.

## DESIGN_PIPELINE.md
- Added: time model (§0), player knowledge pipeline (§5), chronicle pipeline (§11).
- Added: interception, rumours, technical vs in-world clarification branches, order failure branches.
- Added: battle entry and exit to the battle pipeline.
- Planning layers as a table with replan triggers.

## BATTLEFIELD.md
- Added: battle start (§2B), time and pace with conversation costing game time per exchange (§2C), signals (§9A), battle end and debrief (§22), prototype scale (§23), open questions (§24).
- Anna's risk is systemic and signalled before lethal, not a hidden death roll.
- Conditional orders are evaluated against the commander's beliefs, not reality.
- Every order carries a reporting policy, shaped by the commander's traits.
- Formation behaviours must be readable without numbers, tested in Phase 8.

## BACKLOG.md
- New P0.00 epic for tooling and contracts.
- Added items: cast sheet for Bren, Oren, Mara and Selene (no roles defined anywhere), belief caps, commitment, rumours, battle entry/exit, reports following Anna, output validation, templated fallback.

## Gate redesign (31 Oct)
- `IMPLEMENTATION_PLAN.md` §C rewritten: sealed seed blocks, paired ON/OFF arms, intervals, PASS/AMBER/FAIL, knife-edge test, anti-script check, gate registry G-01 to G-16, human gates H-01 to H-03.
- Reason: the Phase 0 chain "passed" the old gate while the threat added nothing. Gates now test attributable effect, not label rate.
- Phase 0 re-evaluated under the new gates: FAIL (DECISIONS D-007).
- BACKLOG Done-when lines and GLOSSARY updated to match.

## Decided 31 Oct (proposals adopted)
- `dominantCrisis`, battle conversation cost, Ravenport regent, Stefan's emergence route, wake budgets, roles for Bren, Oren, Mara and Selene, balancing ownership, battle command delegation, signals and night battles. Full text in `IMPLEMENTATION_PLAN.md` §G and `BATTLEFIELD.md` §24.
- **Magic moved to P1.** Phase 10 is environment only. The magical-use policy is removed from Phase 9 and the Stone of Vey stays a fixed-property artefact. Selene's court-mage role moves to P1.
- **Correction to an earlier proposal:** I said Phase 14 would drop to four pressures. It doesn't. Environment remains a pressure, so five pressures stay; only the magic element leaves it.

## Still open
1. Stefan's numeric thresholds (set after the first 100-seed batch).
2. Wake budgets (confirm after Phase 4 measures real costs).
3. Regent's exact authority limits (tune in the Phase 5 playtest).

All numeric targets and parameters are starting guesses until the first 100-seed run.
