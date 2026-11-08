
#### D-026 addendum 3 — three levers tested (TUNE seeds 1–60, ON arm; OFF = 0 everywhere; no gate block touched, no band moved)
End-state rate (CI) passive / delegating / aggressive:
- Baseline (supportAt 470, grievance 260, levy 30d): 10% / 21.7% / 51.7%
- Lever 1, aggressive levies every 60 days: aggressive 43.3% (32–57); other policies unchanged
- Lever 2, requisition grievance 140: 0% / 10% / 46.7% (33–60)
- Lever 3, Greyfen supportAt 600: 0% / 1.7% / 15% (7–25)
Reading: only lever 3 brings aggressive inside 5–40%, but it drives passive to 0% and delegating to 1.7%, so the policies then fail G-03 instead. Levers 1 and 2 barely move aggressive. political_caution_military_danger stays at 1.7% in every variant. Nothing adopted; decision on band or design left to Marko.

#### D-026 addendum 4 — option 3 (60-day levy + higher Greyfen supportAt), TUNE seeds 1–60, ON arm
passive / delegating / aggressive-with-60-day-levy: supportAt 470: 10% / 21.7% / 43.3% (FAIL); 500: 5% / 18.3% / 36.7% (AMBER, CI 25–50); 540: 1.7% / 10% / 23.3% (PASS, CI 13–33). Not adopted yet; no content changed, no band moved.

#### D-026 addendum 5 — chosen by Marko: Greyfen supportAt 480; aggressive levies every 60 days
TUNE seeds 1–60, ON arm: passive 8.3% (AMBER), delegating 23.3% (PASS), aggressive 38.3% (AMBER, CI 27–52). No band moved. Pending: full suite, KI-01 hash re-record, then sealed-block gate run.

#### D-026 addendum 6 — aggressive levy every 70 days (Marko), supportAt 480, TUNE seeds 1–60, ON arm
passive 8.3% (AMBER), delegating 23.3% (PASS), aggressive 48.3% (FAIL, CI 37–62). Higher than the 38.3% at 60 days, so the cadence effect is not monotonic at n=60 (interval overlap; likely noise plus timing of levies against the crisis). Full suite and KI-01 hash re-record still pending.

#### D-026 addendum 7 — outcome-share exploration (Marko: "combine pooled reading and scenario tuning"), TUNE seeds 1–60, ON arm
Suite 190/190 and KI-01 hash re-recorded on march-0.8 (aggressive levy 60 days, Greyfen supportAt 480). political_caution_military_danger is 1.7% (target ≥5%).
- New test persona `cautious` (as delegating, never asks for grain): end state 36.7%, caution 1.7% (castellans' own requisitions still carry the end state).
- Official cover 3: caution 3.3% passive / 1.7% others; end state 5 / 23.3 / 8.3 / 41.7 (passive/cautious/delegating/aggressive).
- Harvest hit 500‰ × 35 days: caution ≤3.3%, end states 3.3–60%, misinformation up to 28%. Rejected.
Convoy loss/seizure variants running. No content committed from these; no band moved; no gate block used.

#### D-026 addendum 8 — convoy loss and a purchase persona (TUNE seeds 1–60, ON arm)
Convoy loss ×2 / seizure ×2: caution 3.3% (passive, cautious, delegating), 1.7% aggressive; end states 8.3 / 38.3 / 25 / 38.3 (passive/cautious/delegating/aggressive). ×4 / ×3: same caution, end states 8.3 / 36.7 / 28.3 / 40. Saturates; no further gain from harsher convoys.
Purchase-only cautious persona: caution 0%, misinformation 40% (buying while stocks are healthy). Rejected; persona reverted to "never asks for grain".
Best reachable caution share by parameter changes is ~3.3%, below the 5% floor. Nothing adopted; content unchanged (march-0.8).

#### D-027 (proposed, in progress) — requisition refusal
Marko chose "add a refusal mechanism" for the low political_caution_military_danger share. New event GrainRefused (grain, political); requisition.refuse {gFloor, chancePerG, consultedPermille} in scenario.json: the lending community's grievance against the crown G gives a refusal chance (G − gFloor) × chancePerG / 1000, capped, scaled by consultedPermille when asked first. Keyed draw per attempt; ordered shipments stop with "refused", castellans' own asks simply fail. Refusal needs the communities system on.
First setting (gFloor 300, 1000, 0.3), TUNE seeds 1–60: end state 8.3 / 31.7 / 21.7 / 33.3 (passive/cautious/delegating/aggressive); caution still 1.7%. About 20 refusals per 60 seeds, mostly after a first delivery. Stronger settings being tried. Not final; content march-0.8 unchanged in version; KI-01 hash will need re-recording.

#### D-027 addendum — refusal settings scan (gFloor 0 unless stated; TUNE seeds 1–60, ON arm; order passive / delegating / aggressive / cautious)
| setting (chancePerG, consultedPermille) | end state % | caution % |
|---|---|---|
| 300 floor, 1000, 300 (committed) | 8.3 / 21.7 / 33.3 / 31.7 | 1.7 / 1.7 / 0 / 1.7 |
| floor 100, 1000, 300 | 8.3 / 16.7 / 28.3 / 25 | 1.7 / 1.7 / 1.7 / 3.3 |
| 1000, 600 | 8.3 / 15 / 28.3 / 21.7 | 1.7 / 1.7 / 3.3 / 5 |
| 1500, 600 | 8.3 / 10 / 13.3 / 16.7 | 1.7 / 1.7 / 3.3 / 6.7 |
| 2000, 700 | 6.7 / 6.7 / 8.3 / 13.3 | 1.7 / 1.7 / 8.3 / 10 |
| 2500, 800 | 5 / 5 / 6.7 / 10 | 1.7 / 3.3 / 16.7 / 10 |
| 2500, 800 on seeds 61–120 | 3.3 / 11.7 / 3.3 / 10 | 1.7 / 0 / 20 / 3.3 |
Reading: refusal blocks the route Varos uses, so caution (grain refused, fort starves) and the end state trade off nearly one for one. Pooled over the three gated policies caution reaches ~5% only where end states fall to 5–8% (amber/fail). Seed-to-seed noise at n=60 is large (setting 2500/800: aggressive end state 6.7% vs 3.3%). Nothing adopted beyond the committed first setting.

#### D-027 final — pre-registration for the 7A sealed run (written before any run on the block)
Content march-0.8 with: Greyfen supportAt 480; aggressive levy every 60 days; requisition refusal (gFloor 0, chancePerG 1000, consultedPermille 600) chosen by Marko. Suite 191/191 (KI-01 hash unchanged by the refusal rule).
Named links for G-05 (ablation of each must cut A = R_on − R_off by ≥50%, 600 seeds, delegating and aggressive; passive's A is too small to judge): (1) raids cause the shortage = the threat system (the OFF arm itself, so it cuts 100% by construction); (2) the word reaches the ruler = the messenger system; (3) Greyfen's grievance climbs the ladder = the communities system. Requisition and Varos's courting are not separately ablatable (not systems); recorded as a limit.
Outcome shares: each of the four named outcomes ≥5% of all seeds pooled over passive, delegating and aggressive (Marko's choice of the pooled reading). Expected from TUNE: political_caution_military_danger ≈2% pooled → FAIL; to be recorded as is.
Block 120000 (seeds 120000..120999), tool tools/phase7_gate.ts (shards then eval). G-06 knife-edge and the second-grievance test follow on TUNE seeds / existing tests.

#### D-028 — Phase 7A sealed gate, block 120000 (seeds 120000..120999, 1,000 per policy, ON and OFF), calibration as pre-registered in D-027 final
- G-03: PASS (A = 5.0% passive [AMBER alone, CI 3.7–6.4], 18.2% delegating, 32.9% aggressive; OFF arm 0% everywhere). G-04: PASS (lift unbounded; R_off = 0). Invariant violations: 0.
- G-05: PASS. Ablating messenger or communities cuts A by 100% for both delegating (A 19.2%) and aggressive (A 32.5%); the threat link is the OFF arm.
- Outcome shares pooled over the three policies: cooperative_support 3.9%, material_success_political_damage 32.1%, political_caution_military_danger 3.0%, misinformation_failure 8.8% (also unresolved 16.3%, no_crisis 35.9%). Rule ≥5% each: FAIL on cooperative_support and political_caution_military_danger. Recorded as FAIL; no band moved, no tuning on the block.
- Not yet done: G-06 (knife-edge, TUNE), second-grievance (misconduct) test, regression G-01/G-02/G-12/G-13 re-run, lab re-run, human playtests (H-01/H-02). Phase 7A does not complete on a FAIL without a redesign or a recorded override by Marko.

#### D-029 (in progress) — fixes for the two failing 7A outcomes (after D-028)
Diagnostic on TUNE seeds 1–150: cooperative_support is lost because the castellan of Northwatch sends for grain himself, unconsulted, before the ruler acts (64 of 121 crisis seeds under delegating), breaking the crown's promise to consult (77 seeds); caution is rare because the castellan keeps asking every 20 days and help eventually arrives, so seeds end "unresolved" (12–29 per policy). Definitions (D-026) unchanged by Marko's decision: shares are of all seeds pooled over the three policies; danger = famine or ≥ a fifth of the garrison lost.
Built (engine, untested at the time of this note): (1) official.consultCover — a castellan below that cover asks the people first (consulted, adds consultDays); below official.cover he takes unasked; (2) requisition.refuse.standDays — a refusal stands for that long (the repeat is a GrainRefused with stood=true and does not renew the memory) and castellans skip lenders who recently refused; new world state grainRefusedAt. Test content variants: consultCover 8, cover 3, standDays 30 vs none. Not adopted; committed content still march-0.8 with the first refusal setting. KI-01 hash and full suite to be re-checked once content is chosen.

#### D-029 addendum 1 — castellan consults first (TUNE seeds 1–150, ON arm; passive / delegating / aggressive / cautious)
- A (consultCover 8, cover 3, refusal stands 30 days): end 0.7 / 3.3 / 24.7 / 7.3; cooperative_support 7.3 / 52.7 / 0 / 14 (pooled over the three gated policies 20.0%); caution 1.3 / 0 / 0 / 0.7 (pooled 0.4%).
- B (same, no standing refusal): end 1.3 / 4.7 / 31.3 / 7.3; cooperative pooled 19.8%; caution pooled 0.4%.
Reading: asking first fixes cooperative_support but removes the unconsulted takes that carried the end state under passive and delegating (G-03 fails there), and caution drops. Next: the emergency take gets its own cooldown (world.grainAsked keyed by "place" for consulted asks and "place!" for emergency takes, so a slow or refused consultation can still end in a take), tested with consultCover 8 and 6 (running). Not adopted.

#### D-029 addendum 2 — emergency cooldown and resentment from consulted asks (TUNE seeds 1–150, ON arm; passive / delegating / aggressive / cautious)
Common: official.cover 3, consultCover 6 (D) or 8 (C), refusal stands 30 days, emergency take on its own cooldown.
- C (consultCover 8): end 2.0 / 1.3 / 21.3 / 6.7; cooperative pooled 19.1%; caution pooled 1.3%.
- D (consultCover 6): end 2.0 / 5.3 / 21.3 / 8.0; cooperative pooled 17.1%; caution pooled 1.8%.
- E (D + requisition.consultedPermille 600): end 1.3 / 10.0 / 24.7 / 10.7; cooperative pooled 16.2%; caution pooled 1.8%.
- F (D + consultedPermille 850): end 0.7 / 10.7 / 27.3 / 12.7; cooperative pooled 15.1%; caution pooled 1.8%.
Reading: E and F put delegating and aggressive inside the band and clear the cooperative_support floor (pooled ≥15%), but passive's end state collapses (≤2%, its route was the castellans' unconsulted takes) and caution stays ≈1.8% (floor 5%). Passive failing G-03 breaks the policy-group rule (C0.5: no group may FAIL). Not adopted; committed content unchanged.

#### D-029 addendum 3 — variant E adopted into content (by Marko: "record overrides for both, then finish 7A")
official.cover 3, consultCover 6, cooldown 20; requisition.consultedPermille 600; refusal chance 1000, consulted 0.6, stands 30 days. Gate tool now ablates mechanism-level links (messenger, communities, requisition, Varos's courting) in addition to the threat OFF arm. Suite and KI-01 check pending; sealed block 130000 to follow after pre-registration (D-030).

#### D-030 — pre-registration for the second 7A sealed run (block 130000), written before any run on it
Content march-0.8 as committed (variant E, D-029 addendum 3). Suite 191/191 after two fixes: the KI-01 hash re-recorded (fd4d1cc5…, predicate still passes), and the "no flip between plans" property test now requires that A was still possible when B was chosen (Varos holding while away courting Greyfen is not dithering; the old check only asked whether B was possible on return).
Links for G-05 (ablation must cut A = R_on − R_off by ≥50%, 600 seeds, delegating and aggressive): threat (the OFF arm), messenger (system switch), communities (system switch), requisition (content: requisition.sacks = 0), Varos's courting (content: courtHours = 0). Castellan initiative, refusal and the consult promise are not named links: they shape the rate but the chain does not need them (delegating and aggressive rulers can requisition themselves; refusal only lowers A).
Marko's overrides, recorded in advance: (1) passive's G-03 end state may fall below 5% (passive no longer breaks promises through its castellans; reached on TUNE seeds 1–150 at ≈1.3%); (2) political_caution_military_danger may stay below 5% pooled (≈1.8% on TUNE). Both stay reported as FAIL numbers; no band moved. Pass requirements that remain: G-03 for delegating and aggressive, G-04, G-05, each other outcome ≥5% pooled (cooperative_support, material_success_political_damage, misinformation_failure), 0 invariant violations.

## D-031 — Sealed verdict, block 130000 (1,000 seeds, variant E)
Result against the pre-registration in D-030:
- G-03 A (R_on − R_off): passive 1.0% [0.4, 1.7] FAIL (covered by Marko's recorded override 1); delegating 5.8% [4.3, 7.3] AMBER (interval crosses the 5% edge); aggressive 26.1% [23.5, 28.8] PASS.
- G-04 lift ≥1.5: PASS for all three policies.
- G-05 link necessity (messenger, communities, requisition, courting): PASS for delegating and aggressive.
- Outcomes pooled: cooperative_support 15.7%, material_success_political_damage 23.8%, misinformation_failure 5.9% (all ≥5%); political_caution_military_danger 2.4% (below 5%, covered by recorded override 2).
- Invariant violations: 0.
Honest reading: the only unrecovered item is delegating's G-03 AMBER. Under C0 it gets one extension (doubled seeds, fresh sealed block, no change to engine or content), after which it counts as FAIL unless Marko records an override. No tuning was done after this verdict. Not claimed: fun or balance.
Next: G-06 knife-edge on TUNE seeds (rule fixed in advance: ≤2 parameters knife-edge at ±25%), then the AMBER extension on block 140000 (2,000 seeds).

## D-032 — Castellan tries the next lender after a refusal (pre-registration)
Why: block 130000 (D-031) left delegating's G-03 at 5.8% AMBER, down from 18.2% on block 120000. Cause (hypothesis, not yet isolated): castellans now ask first, and a refusal stands for 30 days, so a castellan who is turned away waits out the 20-day cooldown before asking again, usually too late.
Change (one, engine only): a refused official request clears that ask's cooldown (GrainRefused carries `official`; reducer deletes world.grainAsked for the place), so he asks the next lender at once. Standing refusals already exclude refusers from his choice. No content value changes.
Evaluation plan, fixed before running: tune-seed check of end state on seeds 1–600 (4 policies; noise ≈ ±4 points at that size), then a fresh sealed block 140000 with the same gate tool, rules and bands as D-030 (G-03 for delegating and aggressive, G-04, G-05, outcome shares ≥5% pooled except caution, overrides 1 and 2 stay as recorded). G-06 knife-edge is run on the final design only. If the change does not move delegating on tune seeds, it is not adopted and no further tuning happens before asking Marko.

## D-032 result — not adopted
Matched tune seeds 1–600, delegating end state: previous design 8.3% (±2.2), with the change 8.8% (±2.3), difference +0.5 points; outcome shares unchanged within a point. Under the rule fixed in advance the change does not move delegating, so it is reverted (engine back to the D-031 calibration, hash unchanged, block 140000 unspent). No further tuning until Marko decides.
Reading: the next-lender retry is not what limits delegating. Tune seeds read about 2 points higher than the sealed block (8.3% vs 5.8% [4.3, 7.3]), so the real delegating rate is probably 6–8%, near the 5% edge. What limits it is still open (candidates: the consult delay, the 30-day standing refusal, only one or two lenders with 12 days of spare grain).

## D-033 — Override 3: delegating's G-03 at AMBER (Marko, "1")
Recorded: block 130000 delegating A = 5.8% [4.3, 7.3], AMBER; the doubled extension and the one design attempt (D-032) were not adopted. Marko chose to override rather than extend or tune further. The number stays a reported AMBER, no band moved, nothing tuned to it. Likely true rate 6–8% (tune seeds read ≈2 points above sealed), so delegating sits near the 5% edge; what limits it is carried to the adviser step (b).
Phase 7A gate state: G-03 PASS for aggressive; delegating AMBER (override 3); passive FAIL (override 1). G-04 PASS. G-05 PASS. Outcome shares: caution 2.4% (override 2), others ≥5%. 0 invariant violations. G-06 knife-edge, regressions and lab baseline still to run on the final calibration.

## D-034 — Phase 7A gate results on march-0.8 (fresh blocks, Marko's override 3 stands)
- G-12 advisers, sealed block 150000 (1,000 seeds): follow-best 89.2% vs follow-worst 29.7%, difference 59.5 points [56.1, 62.8]. PASS.
- G-13 communities, sealed block 160000 (1,000 seeds per policy): 0 revolts, 0 unsupported escalations, 0 invariant violations. PASS.
- Phase 1 invariant batch (1,000 seeds per arm, 240 days): 0 violations. G-02 PASS (100 seeds). G-01 PASS (Node and Bun, seeds 1–100).
- G-06 knife-edge (TUNE 1–150): PASS, one knife-edge parameter (greyfen.supportAt; −25% → 16/45%, +25% → 0/4%).
- G-03/G-04/G-05 and outcome shares: as D-031 (block 130000), with overrides 1–3 recorded above.
Still open: lab L0 baseline on march-0.8, STATE.md, handoff, H-01/H-02 playtests.

## D-035 — Phase 7A closed with overrides; 7B scope (Marko, 7 Nov)
- H-01/H-02 human playtests: deferred by Marko ("no need for human tests just yet"). They remain unrun; no claim of fun or plausibility.
- Delegating's G-03 AMBER: accepted (override 3, D-033).
- "Build 7b" means the b and c of the agreed order, not the plan's wider economy: (b) advisers on communities, then (c) petition repetition. The plan's Phase 7B (timber, iron, horses, prices, markets, House control, full levy) stays deferred.

## D-036 — 7B(b): advisers on communities (design and gate plan, before building)
Facts found: petitions already reach the advisers. A petition letter to the ruler is read out at court and every councillor present learns `community.grievance` and `community.request` about that community (messenger.ts deliverReport). What is missing is advice that uses them; the planner's `protect_community` objective has no effect on any advice yet.
Design (content-driven, no new frozen schema):
1. New advice kind `advise_relief` (target: community). Generated when the adviser holds a `community.request = relief` belief about that community younger than `agents.values.communityFreshDays` (30). Expected cost is the relief cost (as the existing `relief` order).
2. Advisers value it through the objectives they already carry: `crown_standing` and `protect_community` each credit `agents.values.communityMilli` (12,000) scaled by priority, as reason `reason.community_eased`. An adviser with neither objective (Oren, the steward) never prefers it; Elara (crown_standing 400) does when the request is fresh. Advisers with an explicit `adviceKinds` list (Oren, Selene) do not give it at all, so the advisers differ by design and G-12's best-minus-worst contrast is not erased.
3. Levy caution: `advise_levy` is lowered by the same value for each fresh community grievance of kind levy or broken_promise the adviser believes (reason `reason.community_resents`). This is the "warn before a levy that Greyfen was promised consultation" item, in the form the present beliefs support (a resented levy, not a stored promise).
4. Followers: `followAdviser` and the court/affordance mapping turn `advise_relief` into the existing `relief` action. No new order kind.
Tests first: relief generated only with a fresh request and a crown-minded adviser; stale belief gives none; Oren never recommends it; levy score falls with a fresh levy grievance and not without; the policy maps it to a relief action; all 191 existing tests stay green.
Gates: this changes adviser behaviour, so G-12 must re-pass on a fresh sealed block, with G-13 and the 7A gates (G-03/G-04/G-05, outcome shares) re-run on fresh blocks after (c) as well. Bands and the three recorded overrides stay as they are. Tune on seeds 1–9,999 only, with at least 300 seeds per arm. If G-12 falls below PASS, report the numbers and stop; no tuning to pass.
Not claimed: that advisers' relief advice is wise or fun.

## D-037 — 7B tune check and pre-registration of the 7B sealed runs (written before any run on these blocks)
Tune seeds 1–300 after (b) and (c): G-12 contrast on TUNE: Elara 87.3%, Selene 89.7%, Oren 29.3% (best-minus-worst about 60 points, before 59.5 sealed); Grain Crisis end state (threat ON): passive 0.3%, delegating 6.0%, aggressive 26.0% (7A tune seeds read delegating 8.3% and aggressive 23.7% on 1–600; the differences are inside the noise of 300 seeds, about ±3 points), pooled outcomes cooperative 16.3%, material 26.0%, misinformation 6.3%, caution 1.4%; 0 invariant violations. Nothing was tuned: content values were set in D-036 and not changed. The G-12 aliases stay elara (best) and oren (worst) as recorded; Selene is within noise of Elara, so no re-pick.
Sealed blocks, each used once on this calibration: 7A gates on block 140000 (1,000 seeds, G-03/G-04/G-05 with 600 link seeds, outcome shares, invariants; same tool, bands and rules as D-030, overrides 1–3 stand: passive G-03, caution below 5% pooled, delegating AMBER); G-12 on block 180000; G-13 on block 190000. A verdict is whatever comes out; no rerun, no tuning, no moved band. If any gate that PASSed in D-034 now FAILs, I report and stop.

## D-038 — 7B sealed verdicts (blocks 140000, 180000, 190000; calibration d0a70b8c…)
- Block 140000 (1,000 seeds, 7A gates re-run): G-03 delegating 6.6% [5.1, 8.1] PASS (was AMBER at 5.8% on 130000); aggressive 23.8% [21.1, 26.4] PASS; passive 1.4% FAIL, covered by override 1. G-04 PASS. G-05 PASS for all links, both policies. Outcome pooled: cooperative 15.6, material 23.8, misinformation 6.0, caution 2.3 (override 2). Invariant violations 0.
- Block 180000 (G-12, advisers): best (Selene) 91.1% [89.2, 92.7] vs worst (Oren) 29.2% [26.5, 32.1]; difference 61.9 points [58.7, 65.0]. PASS.
- Block 190000 (G-13, communities, 1,000 seeds per policy): 0 revolts, 0 unsupported escalations, 0 invariant violations. PASS.
Reading: the petition rule (c) appears to have lifted delegating above the 5% edge without touching the aggressive path. Not a fun or balance claim.
Open: H-01/H-02 human playtests (Marko deferred), G-11 re-run, override 1 and override 2 still recorded.

## D-039 — Wider economy (plan Phase 7B): scope and stage 1 design (Marko, 8 Nov: "do everything, in order: goods and prices, then levy, then House control etc."; orders like grain)
Naming: the advisers-on-communities and petition-repetition work (D-035..D-038) was called "7B" in this session by mistake; it is an extension of 7A. The plan's Phase 7B is the wider economy, built here in three stages: (1) goods and prices, (2) levy and manpower, (3) House control of resources and markets.
Stage 1 design (additive; with nothing ordered, the realm plays as in 7A):
- Goods: timber, iron, horses. Whole units. Stores at named places (sources: crownwood, pinegate timber; highcairn iron; thornfield horses; depots at the three forts, which start empty), daily production (horses every 3 days), caps with spill. No random draws in stores.
- Price: one realm price per good from total stock against a target: base × (1000 + slope × (target − total)/target)/1000, clamped to [base/2, 3 × base].
- Orders like grain, through the same intents: `requisition` moves stock between the crown's places free of coin, `purchase` (intent negotiate) buys units at today's price; both carry a `good` constraint, both limited by source stock above a reserve, both travel as convoys with the grain loss and seizure rules. Events GoodsDay, GoodsShipped, GoodsDelivered, GoodsLost.
- First use: timber at a fort covers part of a repair. If the fort holds the timber the repair needs (1 unit per condition point restored), the coin cost falls by `coverPermille` (350) and the timber is used. Otherwise the repair is as before, so existing tuning is untouched.
- Not in stage 1 (stated, not hidden): iron and horses have no sink yet (levy and arming in stage 2); no selling and no market towns (stage 3); advisers do not advise on goods; the page/composer has no goods affordance yet; stocks are not yet shown to the player as beliefs.
Tests first: conservation of every store; price rises as stock falls and is clamped; purchase pays coin and delivers; requisition is free; refused when the source is below reserve; convoy loss ledger; repair discount with and without timber; scenario without goods unchanged.
Gates: stage 1 adds no behaviour a scripted policy uses, so sealed gates are re-run once after stage 3 on fresh blocks (all of G-01..G-06, G-12, G-13, outcome shares, plus goods invariants). KI-01 hash re-recorded when the event stream changes. Fun and balance not claimed.

## D-040 — Wider economy, stage 2: levy and manpower (design, before building)
Stage 1 is committed (D-039; suite 205/205; KI-01 hash re-recorded). Stage 2 gives iron and horses a use and puts a price on soldiers.
- Manpower: each community has `hands` (men of fighting age available). Men away on service are not at the harvest.
- Muster order (levy with a `men` constraint, target a community, deliverTo a fort): the word reaches the community by rider; men = min(musterMen, hands above a reserve, iron at the fort / ironPerMan) × the community's recruiting cooperation (its stance, as for garrison recovery). Up to mountedPermille of them take horses from the fort's store. No iron → abandoned "noIron"; hands at the reserve → "noHands".
- Men and horses arrive at the fort on foot and add to its garrison above establishment (a mounted man counts as two). Wages are paid from the treasury every day (wageMilli per man) for serviceDays; then the surplus above establishment is discharged and the hands come back. Hands regenerate slowly toward their base.
- Costs of mustering besides coin: a levy grievance and trust loss in the community (scaled by the share of its hands taken), and a smaller harvest there while its men are away (harvestPermille of the share away). Both read from the existing communities and grain machinery; the coin levy is unchanged.
- Additive: with nothing mustered, hands are full and every number matches stage 1.
Tests first: garrison, hands, iron and horses move exactly (hands + away = base; iron and horses conserved in the ledger); noIron and noHands; wages debit daily and end at serviceDays, with discharge and return; harvest falls while men are away and recovers; a levy grievance follows the muster and a hostile community gives fewer men; nothing mustered, nothing changes.
Not in stage 2: advisers do not advise on mustering; no page affordance; battle strength counts garrison only (mounted weight is by the two-for-one rule above, not a separate cavalry model).

## D-041 — Wider economy, stage 3: House control of resources and markets (design, before building)
Stage 2 is committed (D-040). Stage 3 adds who owns the goods and where they can be sold.
- House control: every place that holds goods names its controlling House (crown by default). Sources: crownwood crown; pinegate veyr (timber); highcairn varos (iron); thornfield caron (horses). Fort depots are the crown's.
- The crown cannot requisition from a place another House controls (abandoned "houseHolds"); it can only buy there, at the realm price plus houseMarkupPermille (150). The coin goes to that House's account (`houseCoin`), exactly. A House's account is visible in the world state, so later phases can let it spend.
- Markets: the crown can sell goods at market towns (ravenport, saltmere, greybridge, marchend). A sale is a requisition-style order with a `sell` constraint from a crown store to a market town; it ships as a convoy and, on arrival, the units leave the realm and the crown is paid units × price × (1000 − spreadPermille)/1000. At a House-controlled market (marchend, Varos's) that House takes cutPermille of the proceeds. Units sold leave the realm's stock, so the price rises afterwards. A place that is not a market town gives "noMarket"; a sale from a House-held place gives "houseHolds".
- Additive: nothing ordered, nothing changes from stage 2 (house accounts stay at zero).
Tests first: requisition from a House place refused; a purchase from a House place pays the markup and credits the House exactly; a sale pays the spread, the cut goes to the House at Marchend, units are recorded as sold in the ledger and conservation still holds with `sold`; selling raises the price; noMarket; nothing ordered changes nothing.
Not in stage 3: Houses do not yet spend coin or change loyalty; no adviser advice on trade; no page affordance for sales or House accounts; the price is realm-wide, not per town (prices per town are a later refinement).
After stage 3: the wider-economy gates on fresh sealed blocks (G-01..G-06 re-run, G-12, G-13, outcome shares, goods/manpower invariants) in one run, because stages 1-3 add no behaviour a scripted policy uses unless ordered.

## D-042 — Wider economy: final gate plan (written before any run on these blocks)
Stages 1-3 (D-039, D-040, D-041) are built and tested. They add no behaviour a scripted policy uses unless ordered, but they change the event stream, add systems and change the repair and harvest code paths, so every earlier gate is re-run on this calibration on fresh sealed blocks, once each:
- 7A gates (G-03/G-04/G-05, outcome shares, invariants, 600 link seeds): block 200000, 1,000 seeds, same tool, bands and rules as D-030; overrides 1-3 stand (passive G-03, caution below 5% pooled, and delegating if it falls to AMBER again).
- G-12 advisers: block 210000. G-13 communities: block 220000.
- Tune seeds (not sealed): G-06 knife-edge (1-150), G-01 cross-engine and G-02 stream independence, Phase 1 invariant batch, lab L0 (tests, typecheck, quick playtest). KI-01 hash re-recorded.
- New invariants checked in the suite: store conservation for every good (with sold), hands + away = base, House coin equals what was paid.
A verdict is whatever comes out: no rerun, no tuning, no band moved. If a gate that passed in D-038 fails, report and stop. Fun and balance are not claimed; the new economy is not yet used by any scripted policy, adviser or the page, so it is unplayed.

## D-043 — Wider economy: sealed verdicts (stages 1-3, content march-0.8, calibration c0c1dd2050b9+129368f90f29)
Run exactly as pre-registered in D-042, once each, no tuning, no band moved.
- 7A gates, block 200000, 1,000 seeds: G-03 aggressive PASS (25.4%, CI 22.5-28.1), delegating PASS (7.7%, CI 6.1-9.5), passive FAIL (1.4%, override 1 stands). G-04 PASS in all three policies. G-05 PASS (600 link seeds; delegating 7.5%, aggressive 26.3%; every link cut takes the rate to 0). Outcome shares pooled: cooperative support 15.2%, material success with political damage 23.8%, misinformation failure 6.6% all pass; political_caution_military_danger 2.3% fails the 5% floor (override 2 stands). 0 invariant violations.
- G-12 advisers, block 210000: PASS. Follow-best 89.8%, follow-worst 33.3%, gap 56.5 points (CI 53.2-59.7). On D-038's block 180000 the gap was 61.9; it is narrower here and still well inside the gate. Not investigated or tuned.
- G-13 communities, block 220000, 1,000 seeds each: PASS under passive, delegating and aggressive, 0 revolts, 0 unsupported escalations, 0 invariant violations.
- G-06 knife-edge (tune seeds 1-150, 8 parameters, ±25%): PASS, 0 knife-edge parameters. greyfen.supportAt, the one knife-edge in D-038, no longer is.
- G-01: node and bun give the same combined hash 3dfb2f6bcdf82f77ce5b978f92300fd244d79de835604336e7c4269a1d50c342 (100 seeds). G-02 PASS.
- Phase 1 invariant batch, 1,000 seeds per arm, 240 days: 0 violations.
- Lab L0 quick playtest (100 games): integrity, boundary, persona distinctness, performance (1.65 s a game) and coverage PASS. The H-01 proxy is automated evidence, not a human result. G-11 not evaluated.
Result: nothing that passed in D-038 failed. The same two recorded overrides stand (passive G-03, caution share). Nothing in the new economy is used by a scripted policy, adviser or the page, so these runs show only that stages 1-3 broke nothing; they say nothing about whether the economy is fun or balanced.

## D-044 — Economy screen: the steward's books, and what the page offers (design and checks)
Marko asked for an economy screen before Phase 8 (8 Nov). The page showed no stocks at all (not even grain), so the tab covers grain and the wider economy together. The screen reads only from `ViewOf(player)`.
- What the ruler may know. Goods stocks and prices are not in anyone's letters, so the steward keeps books: when the ruler is at the seat (Ravenport) the day's goods tally carries his figures for every store and the three going prices, each with an error that shrinks with his administration skill (stocks as for grain, twice as wide away from the place; prices within a third of that). Away from the seat the figures stop updating and age on the page. Grain still comes from the castellans' letters. House accounts are not shown: a House's wealth is not something the crown would know.
- How it is stored. First attempt: new `goods.*` beliefs from the steward. It added events, which shifted event ids and the keyed draws that use them, and one sortie resolved differently by day 105, so it was dropped before any commit. Final: the figures ride on the existing `GoodsDay` payload (`books`, `tick`) and a reducer copies them into `books` on the world state; no new events, no draws shared with anything else (draws are keyed by day, place and good). Check: world state without beliefs, reports and books, and the event counts by type, are identical to the previous commit on seeds 1-12 under passive, delegating and aggressive for 160 days. Event hashes change (the payload grew), so KI-01 is re-recorded; the sealed gate verdicts in D-043 still describe the behaviour, because the behaviour is unchanged. This rests on that matched-seed check; I have not re-run the sealed gates.
- View: `world.goods` (who holds each store, towns, markup, usual prices and range, units an order moves, muster terms; no stocks) and `ledger` (the ruler's view only).
- Affordances (one module for page and lab agents): economy orders are offered only as far as the books and letters allow (stock known, ownership, markets, iron at the fort), with reasons when not; costs of purchases (a House sells at the markup); `playerActions` now includes them, so the lab's players can use the economy too.
- Page: an Economy tab (Stores with grain and goods and their ages, Prices against usual and range, Markets with House cut and markup, an Order form for move, buy, sell, call men, move grain, buy grain, and Orders given). Orders queue like every other action and go with "Send and continue". Lean labels and values only; no explanatory text.
Tests first: `test/economy_screen.test.ts` (books near truth, ruler only, aging away from the seat, public rules carry no stock, ownership rules, words and costs, reasons, every offered order accepted by the engine, no muster without iron).
Not claimed: that the screen is clear or the economy is fun; that needs Marko playing. Known gaps: prices are realm-wide; no House accounts; muster needs iron moved to a fort first (the screen says so when it is missing); the economy is still unused by scripted policies and advisers.

## D-045 — Economy gaps filled: House accounts, per-town prices, House restocking, economy advice, provisioner policy
Marko asked for the known gaps to be filled (8 Nov). Design and checks, before any sealed run.
- Stage A (engine). The crown's own ledger of what it paid each House (`housePaid`, updated by shipments and sales); per-town glut: each sale by the crown lowers that town's price for that good and it recovers over days (`townGlut`), so prices differ by town; Houses restock their stores every `restock.everyDays` out of their own coin (`HouseRestocked`, a sink the Houses did not have; its size is an invented parameter, not calibrated); the steward's daily books now carry per-town prices and paid-to-House, and the ruler's `ledger` only updates while she is at the seat. A House's own wealth is still not shown: the page shows only what the crown paid.
- Stage A check: world state without beliefs, reports, books, ledger, housePaid and townGlut, plus event counts by type (not Observed/Belief), are identical to the previous commit (82ecee6) on seeds 1-12 under passive, delegating and aggressive for 160 days, with the economy advice switched off by a temporary flag (removed). Restocking only happens once a store is drawn down, which the scripted policies did not do.
- Stage B (behaviour). Advisers at the seat read the steward's books and may voice two extra pieces of advice, tagged "economy": move or buy timber for a fort that needs repair, and call men to a fort. They are said last and only when they score above saying nothing, so the main advice is unchanged but the event stream is not (extra DecisionMade and RecommendationMade: on seed 1, passive, 160 days, 26 more of each). New scripted policy `provisioner`: delegating plus ordering timber for repairs and selling surplus timber at the best known town price, from the ruler's view only. It is a policy for the lab, not a gate arm.
- Finding, reported as it is: in sampled situations the advisers' own model never rated calling men to a fort above waiting; timber advice appears (mostly from Oren). Calling men remains available on the page, and still needs iron at the fort first. Nothing was tuned to change this.
- Evidence run (tune seeds 1-150, 150 days, not a gate): provisioner against delegating. Mean treasury 414.4k against 353.0k; repair coin 105.2k against 131.0k; 69.8 timber used against none; 299 timber units sold for 56.5k; share of games ending without all forts held 8.0% against 7.3%. One counter (House purchases) read 0 in both and is probably not measuring purchases; not relied on. This shows the economy is usable by a policy; it does not show it is balanced or fun.
- Raider marker on the map: a horseman icon, 50% larger, red, pulsing glow (page only; no engine change).
- Because stage B changes the event stream, everything sealed is re-run on fresh blocks (D-046). KI-01 hash re-recorded.

## D-046 — Economy gaps: gate plan (written before any run on these blocks)
Same protocol as D-042, on fresh blocks, once each, calibration changed by D-045:
- 7A gates (G-03/G-04/G-05, outcome shares, invariants, 600 link seeds): block 230000, 1,000 seeds. Overrides 1-3 from D-030/D-043 stand (passive G-03, pooled caution below 5%, delegating if AMBER).
- G-12 advisers: block 240000. G-13 communities: block 250000.
- Tune seeds (not sealed): G-06 knife-edge (1-150), G-01 node and bun, G-02, Phase 1 invariant batch, lab quick playtest.
- If a gate that passed in D-043 now fails: report and stop, no tuning, no band moved. AMBER gets one extension on a fresh block, then counts as FAIL. Fun and balance are not claimed.

## D-047 — Economy tab, after Marko's phone review (8 Nov)
Page only, no engine change. Grain is treated as a good in the order form: one Action menu (Buy, Sell, Move, Recruit) and a Good menu (timber, iron, horses, grain; no grain under Sell, since grain cannot be sold). Grain price row added to Prices (sack price; no usual or range, it is fixed). Stores splits grain into Grain, Days (cover at current use) and Report (age of the letter), with a » mark that shows while the table has more to scroll to. "Markets" renamed "Market towns" (stores and market towns are different sets: only Greybridge is both). Gates in D-046 are unaffected (no engine change).
