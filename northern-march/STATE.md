# STATE

Updated: 8 Nov 2026, economy gaps filled (D-045, gates D-046 pending); Economy tab on the page (D-044); Phase 7A extended (advisers on communities, petition repetition, D-036..D-038) and the wider economy built, stages 1-3 (D-039..D-043), all gated on march-0.8; earlier: Phase 6 (6A) built; Agent Playtest Lab L0-L7 built (Opus 5.5). Plan in force: `docs/IMPLEMENTATION_PLAN.md` v4; lab: `docs/playtest/` (v4 + V4_1_AMENDMENTS, D-022).

## Built
**Engine (`engine/`, TypeScript on Node 22, no build step).** `npm test`: 160 tests passed at the L0 baseline; since then `test/saveload.test.ts` (+1) and `test/playtest.test.ts` (10) pass on their own; full suite re-run pending. `npx tsc -p .` is clean.

**Agent Playtest Lab (D-022, `engine/src/playtest/`, operator guide `docs/playtest/README.md`).** L0 baseline, L1 strict contracts (Zod, playtest layer only), L2 one affordance module for page and agents with import barriers and leak tests, L3 runner and exact replay, L4 ten personas and worker batches with resume, L5 analysis, known issues, shrinker and regression cases, L6 paired evaluator, sealed packages and dashboard with causal explorer, L7 milestones, durable outbox, retries and fake provider. Real email waits for Marko's secrets and approval; L8/L9 not started (separate approvals). Quick run: `results/playtest/quick-demo/` (100 games). 1,100-game unattended run: `results/playtest/full-140054b/` (running).
Finds: save replay dropped mission/raid/repair mode (fixed); KI-01 attack orders skipped interpretation and obedience (fixed 6 Nov, approved; D-023); bridge offered unaffordable advice (fixed).

L9 (D-023): proposal only, `results/playtest/l9-001/proposal.json`. It lowers the crown's daily upkeep from 25,000 to 22,500 and cuts adviser-dependent levies from about 25 to about 3 a game on validation seeds. Marko approved it on 6 Nov; applied as content march-0.7; G-12 and G-13 pass on sealed block 110000.

L8 (D-024): first adversarial search run, findings for review only. Levy-spam exploit appears above upkeep 22,500; a cliff in upkeep between 25,000 and 27,500. Not applied.

Gate status after the KI-01 fix and the upkeep change (content march-0.7): G-12 and G-13 PASS on sealed block 110000 (D-023). The regression batch (phase1 gates) and the pre-fix results remain pre-fix evidence.

**Phase 7A (D-025..D-034), content march-0.8: stages 1-4 built, gates run.** Grain core, requisition with refusal (standing 30 days), purchase, convoys with loss and seizure, castellans who consult first, Varos courting, Greyfen support rule (supportAt 480), outcome classifier. Sealed results: G-12 PASS (150000), G-13 PASS (160000), G-03 aggressive PASS, delegating AMBER (5.8%, override 3), passive FAIL (1.0%, override 1), G-04/G-05 PASS, outcome caution 2.4% (override 2), G-06 PASS (1 knife-edge: greyfen.supportAt), G-01/G-02 PASS, 0 invariant violations. Lab L0 on march-0.8 (results/lab_L0_march08.json): tests 191/191, typecheck clean, quick 100/100 games. Still open: H-01/H-02 human playtests, G-11 re-run, and the design question of why delegating stays near the 5% edge (7B or adviser step).

**Advisers on communities and petition repetition (D-035..D-038).** Advisers hear petitions at court, so they advise relief or a lighter levy for a community with a fresh request (reasons `reason.community_eased` / `reason.community_resents`). A grievance is petitioned again after 30 days only if it has grown by at least `regrowth` since the last petition, or after 90 days. Sealed: delegating G-03 6.6% PASS (block 140000), G-12 PASS (180000), G-13 PASS (190000). This was earlier mislabelled "7B"; it is part of 7A.

**Wider economy, stages 1-3 (D-039..D-043; the old "7B").** Goods (timber, iron, horses) held at named places, a realm price from total stock (clamped to half to triple the base), convoys with loss and seizure; timber at a fort covers 35% of a repair's coin cost. Muster: a levy order with a `men` constraint takes men from a community's hands to a fort, armed from the fort's iron and horses, paid daily, with a smaller harvest at home and a levy grievance. House control: Varos holds iron, Veyr some timber, Caron the horses; the crown can only buy from them, at a 15% markup that credits the House; the crown can sell at four market towns. Orders reuse `requisition`, `purchase` and `levy` with constraints `good`, `deliverTo`, `sell`, `men`. Additive: with nothing ordered, behaviour is as in 7A. Sealed re-run (D-043): 7A gates block 200000 (delegating 7.7% PASS, aggressive 25.4% PASS, passive and caution-share overrides stand), G-12 PASS (210000), G-13 PASS (220000), G-06 PASS (0 knife-edge), G-01/G-02 PASS, 0 invariant violations. Suite 230/230 with the screen (D-044).

**Economy gaps (D-045, built; sealed gates planned in D-046, not yet run).** The crown's ledger of what it paid each House; per-town prices that fall when the crown sells and recover; Houses restock their stores from their own coin; advisers at the seat voice timber and muster advice (extra, tagged economy; muster never beat waiting in sampled situations, timber advice appears); a `provisioner` lab policy (delegating plus timber orders and sales; on tune seeds 1-150 it ended with more coin than delegating, 414k against 353k, and 8.0% against 7.3% games without all forts held, an evidence run only). Stage A is neutral on matched seeds (1-12, three policies, 160 days); stage B changes the event stream, so everything sealed is re-run. Raider marker is now a horseman icon, larger, red, pulsing. Suite and typecheck clean; KI-01 hash re-recorded.

**Economy tab (D-044).** The page has an Economy tab: stores (grain from letters, goods from the steward's books) with ages, prices against usual and range, markets with the House cut and markup, an order form (move, buy, sell goods; call men; move or buy grain) and the orders given. Goods figures reach the ruler only at the seat (they ride on the daily goods event, no new events); away they age. Orders are offered only as far as the books allow, with the reason when not, and the same list feeds the lab's players. Behaviour is unchanged on matched seeds (seeds 1-12, three policies, 160 days); sealed gates were not re-run. The lab found and I fixed a recorder bug (replays dropped `to`, `good`, `sell`, `muster`, `consult`). Lab quick run (100 games) passes. Published as the private artifact (version 63).

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
- The economy is still unplayed by a human. Muster still needs iron at the fort first (buy it at Highcairn, which is Varos's), and advisers do not recommend it. Iron and horses are used only by muster. Houses spend only on restocking (an invented sink, not calibrated). Town prices change only when the crown sells. Battle counts the garrison only. Sealed gates for D-045 are pending (D-046).
- Advisers advise on relief and levy for communities (D-036) but not on goods, trade or mustering.
- The crown cannot yet keep the promise to consult Greyfen (7A).
- Under the aggressive scripted policy (a levy every 30 days) Eastmarch and Coldmere usually end up declaring for Varos; under passive and delegating rulers communities mostly petition at most.
- An aggressive 240-day run takes about 4 s (communities and letters); within the G-14 wall-clock limit but worth watching.
- Placeholder physical systems; route closures have no trigger (Phase 10).

## Needs a human
- Testers for H-01/H-02 at 7A (`docs/H01_PROTOCOL.md`, now with C11-C12 and the handover worksheet).
- Optional: run `node src/cli.ts g01 --seeds 1..100` in `engine/` on your own computer; it must end with the combined hash above.

## Next phase
(Updated 8 Nov.) The plan's Phase 7B is now built (stages 1-3) and gated. Next is Phase 8, minimal battle slice, Opus 5.5, high; after it the plan says to choose the timber/Blackwood loop or the Grey Hill battlefield laboratory from the evidence. Marko plays first. Older text follows.
Phase 7 (7A): grain only and the Grain Crisis, gated by G-03/04/05/06 with the end state "Varos acts on Greyfen's grievance", outcome shares, and the second-grievance check; then the first serious human playtests. Opus 5.5, high effort.
