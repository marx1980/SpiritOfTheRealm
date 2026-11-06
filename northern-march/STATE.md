# STATE

Updated: 6 Nov 2026, Phase 6 (6A) built; Agent Playtest Lab L0-L7 built (Opus 5.5). Plan in force: `docs/IMPLEMENTATION_PLAN.md` v4; lab: `docs/playtest/` (v4 + V4_1_AMENDMENTS, D-022).

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test`: 160 tests passed at the L0 baseline; since then `test/saveload.test.ts` (+1) and `test/playtest.test.ts` (10) pass on their own; full suite re-run pending. `npx tsc -p .` is clean.

**Agent Playtest Lab (D-022, `engine/src/playtest/`, operator guide `docs/playtest/README.md`).** L0 baseline, L1 strict contracts (Zod, playtest layer only), L2 one affordance module for page and agents with import barriers and leak tests, L3 runner and exact replay, L4 ten personas and worker batches with resume, L5 analysis, known issues, shrinker and regression cases, L6 paired evaluator, sealed packages and dashboard with causal explorer, L7 milestones, durable outbox, retries and fake provider. Real email waits for Marko's secrets and approval; L8/L9 not started (separate approvals). Quick run: `results/playtest/quick-demo/` (100 games). 1,100-game unattended run: `results/playtest/full-140054b/` (running).
Finds: save replay dropped mission/raid/repair mode (fixed); KI-01 attack orders skipped interpretation and obedience (fixed 6 Nov, approved; D-023); bridge offered unaffordable advice (fixed).

L9 (D-023): proposal only, `results/playtest/l9-001/proposal.json`. It lowers the crown's daily upkeep from 25,000 to 22,500 and cuts adviser-dependent levies from about 25 to about 3 a game on validation seeds. Marko approved it on 6 Nov; applied as content march-0.7; G-12 and G-13 pass on sealed block 110000.

L8 (D-024): first adversarial search run, findings for review only. Levy-spam exploit appears above upkeep 22,500; a cliff in upkeep between 25,000 and 27,500. Not applied.

Gate status after the KI-01 fix and the upkeep change (content march-0.7): G-12 and G-13 PASS on sealed block 110000 (D-023). The regression batch (phase1 gates) and the pre-fix results remain pre-fix evidence.

**Phase 7A in progress (D-025), stage 1 of 5 built (content march-0.8).** Grain core: `scenario.grain`, `src/systems/grain.ts`, events GrainDay / HarvestDamaged / ScarcityChanged, exact conservation, harvest cut by raids (so the shortage exists only in the ON arm), scarcity bands. `test/grain.test.ts` (7). Not yet built: Anna's grain picture, requisition/purchase/convoys/consultation, the Grain Crisis fixture and Varos, the outcome classifier, the gates. Gates and lab baseline are NOT re-run on march-0.8.

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
  - G-13 on sealed block 60000-60999: passive PASS (0 revolts, 0 unsupported escalations, 0 invariant violations, 1,000 seeds); delegating and aggressive running (results/phase6_g13_60000.txt).
  - G-12 TUNE with communities on: Elara 33.0%, Selene 30.5%, Oren 14.5%, passive 0.5% (gap 18.5 points; 7 before communities). Block 98000 was refused by the gate tool (not a multiple of 10,000) before any seed ran; re-registered as 100000-100999 (D-021); running (results/phase6_g12_100000.txt).
  - Regression: G-02 PASS (results/phase6_regression.log); rest of that run pending.

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
