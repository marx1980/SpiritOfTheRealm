# STATE

Updated: 6 Nov 2026, end of Phase 6 (6A) build (Opus 5.5). Plan in force: `docs/IMPLEMENTATION_PLAN.md` v4.

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test` runs 160 tests, all passing; `npx tsc -p .` is clean (src, test, tools, ui).

Phase 6 (6A) added (DECISIONS D-021):
- `src/systems/communities.ts` and `content/march/communities.json` (content march-0.6): Northwatch (no named leader), Greyfen (Mara; the crown promised to consult before a levy), Eastmarch (Varos), Coldmere (Wenna; the Blackwood settlement).
- Cohorts, material condition, sparse memory, specific grievances (unprotected, levy, broken promise, misconduct) with crown blame, source trust, competing narratives from people with access (Varos: the crown is to blame; Bren and Anna: the raiders or the soldiers are).
- Plan D1 inputs from the community's own knowledge, D2 hard gates, ladder cooperate / petition / delay / withhold / refuse / support a named actor; no armed revolt.
- Effects: dues from Greyfen and Eastmarch, recruits for Northwatch, levy shares (refusers pay nothing). Petitions and officers' letters travel by messenger; the court shows a people's issue with a relief button.
- New player action: relief (15k, carts at walking pace). Levy now has a political cost.
- Second, non-grain grievance: a company quartered away from home misbehaves.
- `communities` is an ablatable system; with it off, income and levies are exactly as in Phase 5.
- Invariant (G-13, v4): no escalation past "delay" without all D2 gates; no revolt. `tools/phase6_gate.ts` (G-13 batch and community dashboard).
- `test/communities.test.ts` (13 tests) and `test/canonical.test.ts` (plan C5 registry, T04 gradient, T06 resource shock).

Phase 5 (1-2 Nov) added: interactive play, Court and Map from the view only, order composer, Anna's travel, regency, personal danger, objective, adviser advice in person; forts fall and are retaken; captains ask whether to stay or return; repair modes (standard, rush, labour); coin economy with levy; captain away cost; growing raids, ambushes, a second raider site (Stonewood); adviser roles and judgement error; one advice prompt a day; windfall line; spend approval (every cost is Anna's own order).

Phases 0-4: see DECISIONS D-001 to D-014.

**Debug page:** `node ui/build.ts` writes `ui/dist/northern-march.html`; published as a private artifact (version 62).

## Result
- Phase 1: G-01, G-02 PASS (D-009). Phase 2: built (D-010).
- Phase 3: G-10 PASS, G-11 FAIL, overridden (D-013, D-016).
- Phase 4: G-14 PASS (D-014).
- Phase 5: built; G-12 PASS on earlier blocks (D-015); H-01/H-02 overridden (D-020), to run at 7A.
- Phase 6 (6A), 6 Nov:
  - G-01 PASS: Node and Bun give the same combined hash, `0271266eaa91e448a41a7fe52d1037e57dd48237030907adec18aa965556cbda` (100 seeds).
  - G-13 on sealed block 60000-60999 (three policies): PENDING (results/phase6_g13_60000.txt).
  - G-12 with communities on, sealed block 98000: PENDING (results/phase6_g12_98000.txt).
  - Regression (G-02, invariants, 1,000 seeds x 2 arms): PENDING (results/phase6_regression.log).

## Known gaps
- G-11 open (D-016). Standing instruction: tell Marko if a re-run passes.
- Advisers do not yet advise on communities (relief, the promise to Greyfen); see BACKLOG.
- The crown cannot yet keep the promise to consult Greyfen (7A).
- Under the aggressive scripted policy (a levy every 30 days) Eastmarch and Coldmere usually end up declaring for Varos; under passive and delegating rulers communities mostly petition at most.
- An aggressive 240-day run takes about 4 s (communities and letters); within the G-14 wall-clock limit but worth watching.
- Placeholder physical systems; route closures have no trigger (Phase 10).

## Needs a human
- Testers for H-01/H-02 at 7A (`docs/H01_PROTOCOL.md`, now with C11-C12 and the handover worksheet).
- Optional: run `node src/cli.ts g01 --seeds 1..100` in `engine/` on your own computer; it must end with the combined hash above.

## Next phase
Phase 7 (7A): grain only and the Grain Crisis, gated by G-03/04/05/06 with the end state "Varos acts on Greyfen's grievance", outcome shares, and the second-grievance check; then the first serious human playtests. Opus 5.5, high effort.
