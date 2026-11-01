# DECISIONS

Newest first. Numbers come from `phase0/results/` (files named in each entry). All parameters are toy-world values; they say something about the *shape* of the design, not about final magnitudes.

---

## D-015 (Phase 5) Court, Map and personal presence

**G-12 pre-registration (written before the sealed run).**
- Objective success = after 240 days the campaign has not ended (Anna alive and free) and Northwatch, Greybridge and Eastmarch Keep are all at or above the breach line (repairs can restore a breached wall before the end).
- "Follow adviser X" = at every decision point, carry out each piece of advice heard from X in person in the last 15 days (one standing piece per target): repair → repair; send the captain → advance; attack raiders → send the captain to the nearest fort; levy → levy. Waiting is no action. 10-day cooldown per action and target.
- Best and worst chosen on TUNE seeds 1..200 (results/phase5_g12_tune.txt): Elara 7.0%, Selene 4.0%, Oren 0.0% (passive 0.0%). Best = Elara, worst = Oren (results/g12_aliases.json).
- Sealed block 50000..50999, paired by seed, bootstrap 2,000. PASS: difference ≥ 10 points and interval lower bound > 0. AMBER: one of the two. FAIL: neither.
- Expectation from TUNE: about 7 points, so AMBER is the likely verdict. Not tuning to pass; see the findings below.

**G-12 amendment (Marko asked to fix G-12 first; D-015 option 3 and part of option 2).**
- Cause, found on TUNE seeds: only the steward observed the treasury. Elara and Selene never knew the money, so their repairs were abandoned and no adviser but Oren could recommend a levy.
- Change (rule, not per-adviser tuning): a principal (Tier A) who is at the seat (Ravenport, `scenario.regency.seat`) observes the treasury, with error set by their own administration skill, just as the steward always did. The treasury is kept there.
- Diagnostic on TUNE seeds 1..60, before the rule was made permanent: Elara 20.0%, Selene 16.7%, Oren 0.0%.
- Re-measured on TUNE seeds 1..200 (results/phase5_g12_tune_v2.txt): Elara 24.0%, Selene 17.0%, Oren 0.0%, passive 0.0%. Best = Elara, worst = Oren (results/g12_aliases.json).
- **The first sealed run (block 50000, AMBER, 5.9 points) is kept as recorded.** This change was made after seeing that result. It is disclosed here, and the rule was chosen from TUNE evidence only.
- **Second sealed run, block 60000..60999 (results/phase5_g12_60000.txt): PASS.** Follow Elara 18.6% (Wilson 16.3-21.1%), follow Oren 0.0% (0-0.4%); difference 18.6 points, paired bootstrap interval 16.3-21.0. Calibration key `c9ce105911ef+df72cad8a755`. Advice followed about 26.9 times per run for Elara and 4.4 for Oren.
- What this does and does not show: the gate measures that advice from a better-informed adviser leads to better outcomes. It does not show that the advisers differ by design. Their traits, capabilities and objectives are unchanged, and the "narrow" and "biased" roles of option 3 are not built yet. Selene (17% on TUNE) is nearly as good as Elara; only Oren is clearly worse, because of his treasury objective. H-01 and H-02 still have to show whether testers can tell the advisers apart from what they say.
- Not changed: the advisers' contents (traits, capabilities, objectives). Option 3's "narrow" and "biased" roles are not yet designed in. Elara, Selene and Oren are not differentiated by design; only Oren's objective (treasury first) makes him worse. That is still open (BACKLOG).

**Built (129 tests pass; `npx tsc -p .` clean, now also over `tools/` and `ui/`):**
- **Interactive play:** `next(limit)` runs to the next decision point and returns what Anna sees; `answer(actions)` resumes. Decision points: a letter delivered to her, advice given in her presence, a danger warning, her arrival somewhere (and an optional daily checkpoint). Saves record answers and replay exactly; a save cannot be taken while a decision is open.
- **Court** (`presentation/court.ts`): issues ranked by urgency (walls, raiders, her own orders), each with its evidence (what, source, age, certainty) and each adviser's standing advice on that issue; the council's latest advice per adviser; letters. Built from `ViewOf(player)` only; no exact numbers (test).
- **Map** (`presentation/map.ts`): places from static knowledge, walls and raiders as Anna believes them with source, age and certainty, people where she last heard they were, her own position. Locations gained map coordinates (content).
- **Templated phrasing** (`presentation/phrasing.ts`): walls in words, raider strength in words, ages in days, certainty bands as words, reasons as words.
- **Order composer:** `OrderDraft` validated against what Anna knows (a recipient she knows where to find, a place on her map or a person she knows of, an intent from the frozen list, a discretion level). Invalid drafts are refused with the reason.
- **Presence:** Anna travels between Ravenport, Greybridge and Northwatch by rider. Letters for her reach Ravenport, are read to the councillors present (`ReportShared {inAbsence}`), then follow her. In person she sees the walls of a fort when she arrives and when raiders strike it while she is there; people present see each other.
- **Regency** (content `scenario.regency`): while Anna is away, Elara at Ravenport decides within delegated authority (repairs up to a cost cap; no levy, no sending the captain). Within authority she orders it and writes to Anna; beyond it she writes asking. DecisionTrace kind `regency`.
- **Personal danger and defeat:** if Anna is in a fort whose believed walls drop below the danger line, `DangerSignalled` and a forced pause; if the walls are breached with her inside, `CampaignEnded` (killed or captured, keyed draw) and nothing happens after it.
- **Campaign objective** (`scenario.objective`): `objectiveStatus()` and the `objectiveMet` metric.
- **Advice audience:** advisers advise whoever is with them; Anna hears advice only in person. She keeps each adviser's latest advice per target for 15 days.
- **Adviser policies:** `follow:<id>`, and `follow-best-adviser` / `follow-worst-adviser` through measured aliases.
- **Letter reader layout:** the writer's name on the left; "arrived" and "written" as separate tags on the right; the text starts "Name: ".
- **Letters speak in the first person about the writer's own whereabouts** ("I am at Greybridge"); the writer's walls and raiders stay as "The walls at…".
- **Advice pauses name their advice:** `next()` returns `adviceId`; the pause shows that advice with its reasons and a Do it button. The page passes advice to wait (the engine still records it, so G-12 and the tests are unchanged). Continue moved to the top row.
- **Letters arrive in order and the pause names the right one:** the view lists letters by arrival, not by stored id, and a report pause carries the letter that arrived (`next()` returns `letterId`). Before, a pause for Caron's letter could show the last stored letter, so Bren's first letter (arrives day 11.6) was not what the pause showed.
- **Letters are readable:** each letter's content is shown as plain sentences (`letterSentences`, in words), in the letter list and in the reader opened by clicking a letter; the pause box shows the letter's content too. Found after the first play: the list showed only one phrase per letter and nothing could be opened.
- **Debug UI** (`ui/`, bundled by esbuild into one HTML page): Court, Map, letters, orders given, quick actions, order composer, travel, pause settings per decision type, hidden observer panel (Shift+O) with hidden truth and the event log. Published as a private artifact.
- **Invariant change:** a player input must be caused by something she perceived (a letter delivered to her, advice in her audience, a danger warning to her, her own arrival) or by nothing (a checkpoint).
- `canonical.ts`: SHA-256 in pure JS (byte-identical to node:crypto; needed in the browser).

**Fixed along the way:**
- The levy candidate was generated last in advise mode and always cut by the candidate cap: no adviser could ever advise a levy. Now it is generated, before repairs, when the believed treasury cannot cover the repairs the adviser believes are needed.
- `random-valid` answered every piece of advice with a new order, which woke the advisers again (30,000 events in 30 days). It no longer repeats an order given in the last 10 days.

**G-12 result (first run, kept):** **AMBER** on sealed block 50000..50999. Follow Elara 5.9% (Wilson 4.6-7.5%), follow Oren 0.0% (0-0.4%); difference 5.9 points, paired bootstrap 95% interval 4.4-7.5. The interval is above 0 but the difference is below 10 points. Run first on the pre-final code and again on the final code (gate key `c9ce105911ef+61f15c4bfccc`): identical numbers. Advice was followed about 24.5 times per run for Elara and 4.4 for Oren (results/phase5_g12_50000*.txt).

**Finding: no single adviser holds the realm.** Only the steward reads the books, so Elara and Selene never advise a levy and many of the repairs they advise are abandoned for lack of funds. Oren advises waiting or a levy and never a repair. The scripted aggressive ruler (repair below 80%, levy every 30 days) meets the objective on 20 of 30 TUNE seeds; following any one adviser meets it on 0-7%. The advisers differ in kind (each sees part of the problem), not enough in overall quality for G-12.

Options (Marko to choose; none applied):
1. Accept AMBER now and re-test G-12 at Phase 14 with the full cast and economy.
2. The steward reads the books to the council (treasury shared at court like dispatches), so every councillor can advise a levy. Expected to raise the best adviser's rate a lot; it also makes advisers more alike.
3. Make adviser quality deliberately different in content: one sound generalist, one narrow expert, one biased or careless adviser. This is what H-02 needs testers to be able to learn.
4. Soften the objective (e.g. no fort breached for more than N days), since passive play scores 0%.
Recommendation: 3, plus 2 for the steward only when he is at court.

**Regressions (final code):** G-01 PASS on the final code (after the seat-treasury rule): combined hash `95c062a8f7a076ca61ba6caed75beadc290e5bab798189e9da302aff7a7d740b` under Node and under Bun (results/phase5_g01_v2*.txt). The earlier hash `8e008…` is superseded. G-02 PASS (300/300 first divergences in the perturbed system). 1,000 seeds × 2 arms × 240 days: 0 invariant violations (results/phase5_regression_v2.txt, final code; mean 5,448 events per run, breached 96.5% on / 94.2% off).

**Not verified (needs humans):** H-01 and H-02. Protocol and observer sheets in `docs/H01_PROTOCOL.md`; scenario in `engine/ui/h01.json` (seed 51, 90 days, two raider waves).

## D-014 (Phase 4) Simulation tiers: built, G-14 PASS

**Built (118 tests pass):**
- Tiers A/B/C as world state. 24 background characters (Tier C) with identity, household, occupation, home, two traits and one or two relationships. They hold no beliefs, observe nothing and never wake until something makes them relevant.
- **Promotion** (ARCHITECTURE §20.9): given independent responsibility, to Tier A; caught up in a significant military event where they stand (a raid, a sortie, losses), to Tier B. The promoted start with what their station would tell them (seat and whereabouts of their superior and the people they deal with); nothing about them was simulated before.
- **Demotion:** when the role has ended (no order in force, not travelling, no live intention) and nothing has stirred them for 30 days, one step down. Plans are dropped; history, experience, learned answer rates, beliefs and relationships are kept. Principal characters never go below their content tier.
- **Choosing a leader** (adopted decision 5): a delegate's candidates are its own retainers and anyone recommended by someone it trusts at least 500; busy or travelling people are excluded; score = trust x recommendation (or the retainer bond). With delegated discretion, handing an expedition to a chosen leader counts as obeying.
- **Delegated expeditions:** the "investigate" intent; the senior's order goes LocalPlanFormed -> SubordinateOrdersIssued -> ExecutionStarted and completes when the subordinate order does (`parentOrderId`, a B2 addition). The leader rides out, scouts, reports back and goes home.
- **Tier B plans lightly:** 3 options, no strategic layer, compressed traces (selected option and its top three reasons).
- **Wake accounting** by tier on every `AgentWoke`.

**Test: Stefan** (seed 1). Anna orders Caron (delegated discretion) on day 2 to investigate the Blackwood. Caron trusts Bren (550) and Bren recommends Stefan (850): score 467 beats Caron's own retainer, Sergeant Tobin (400). On day 2.9 Stefan is promoted C to A and Caron's order goes out; Stefan receives it on day 3.1, obeys, rides to the Blackwood (day 4.0), scouts, writes to Caron and rides home. Caron's own order completes on day 4.2, when Stefan's report reaches him. Stefan steps down to B on day 34 and to C on day 64, keeping his history, experience and memories. Nothing about Stefan existed in the log before his promotion. If Caron's trust in Bren is 300, Stefan is never considered.

**Found while testing:**
- The reporting routine treated anyone at a fort who reports to someone as a reporting castellan, so sergeants were inspecting walls and writing to their castellans. At Eastmarch the urgent report would have gone to Sergeant Rurik before Varos, by alphabet. Reporting duty now belongs to Tier A/B, senior first.
- The ruler now knows the whereabouts of principal (Tier A) characters only, not the whole background.
- Demotion has no causing event: it is a clock-driven review, registered as a root event type.
- *Demotion ran two steps in one day* (A to B, then B to C a day later): "quiet for 30 days" was measured from the last activity both times. Each step now restarts the clock.
- *Information leak:* Caron's order completed, and he reported to the queen, the moment Stefan reached the Blackwood, before he could know. A delegated order now completes when the leader's report reaches the delegate; if it is lost, the delegate never hears.
- *Nowhere to reply:* Stefan, promoted from the background, did not know where Caron was, so his report was undeliverable. Receiving an order now teaches the recipient the issuer's seat and where the order was sent from (B5 evidence kind `order`, an addition; checked by the invariant harness).
- *G-02 failed, correctly.* Extra draws in weather or economy changed threat outcomes on 11-33% of seeds: a storm changes a wall, Bren sorties, the threat ends early, and the threat system rolls on days it used to skip. That is cause and effect, not stream coupling, which the old definition could not tell apart once systems interact. G-02 is redefined (plan C2): the first event that differs must belong to the perturbed system. The threat system now draws a fixed schedule (three draws per site per day, used or not), so its stream stays aligned day by day.
- *Gate key includes the engine.* The calibration hash covered content and parameters but not code, so the fixes above would not have forced a fresh block. Gate verdicts are now claimed under calibration + engine source hash (plan C0.1). G-14 was re-run on block 40000 with the final code.
- *An ablated messenger still drew random numbers:* agents composed request letters directly; they now go through the messenger's handler and vanish with it.

**G-14: PASS** under all three policies, first on block 30000 (code before the fixes below), then on block 40000 with the final code (gate key `921518d99555+5b8ecf930310`, `engine/results/phase4_gate_40000.txt`):

| Policy | Busiest agent-day, A / B / C (budget 20 / 3 / 0) | Tier A wakes with the background doubled | Worst wall-clock per simulated year |
|---|---|---|---|
| passive | 6 / 3 / 0 | +1.9% | 0.9 s |
| delegating | 6 / 3 / 0 | -1.0% | 1.0 s |
| aggressive | 5 / 3 / 0 | -1.0% | 1.5 s |

**Regressions (final code):** G-01 PASS (combined hash `4238030536c7f39d09f7a9e1ffdfa62e8a50b6147a2c6fbf73e39dc630a006d7`, Node and Bun, two time zones and locales). G-02 and the 1,000-seed invariant batch: G-02 (redefined) PASS: in all 300 perturbed seeds the first divergence belongs to the perturbed system (economy 100/100, weather 100/100, threat 100/100); no foreign first divergence. 1,000 seeds × 2 arms × 240 days: 0 invariant violations, breached 96.0% on / 94.2% off, mean 5,011 events and 17.9 decisions per run, 452 ms per simulated year (results/phase4_regression.txt)

**Watch:**
- The busiest Tier B day is exactly at its budget (3). Fine now; more Tier B roles may need a larger budget or lighter triggers.
- Tier B sergeants wake on wall news but have no role options yet, so they wake and do nothing. Cheap, but pointless until Phase 6-8 give them something to do.
- Recommendations are static content; recommendation and appointment chains that change in play come with Phase 14 (P0.08).

---

## D-013 Proceeding to Phase 4 with G-11 open

Marko asked to proceed to Phase 4 after being told the Phase 3 gate would fail G-11 (D-012). Recorded as his decision to proceed, not as a fix: G-11 stays FAIL until re-tested. Phase 4 (tiers, performance) does not depend on it.

Options for making information matter, to decide before Phase 7 at the latest:
1. **Make the common choices belief-sensitive.** Requests carry the castellan's estimate of urgency, and the ruler or steward triages by it; a wrong estimate then sends help to the wrong place. Partly a Phase 5 (Court) and Phase 7 (economy) concern.
2. **Reduce exogenous noise.** The placeholder storms (5-25 points, up to 2.5% a day) swamp decisions; Phase 10 replaces the weather.
3. **Re-test at Phase 7**, when requisition and grievance decisions hinge on beliefs about stocks and villages, and again at Phase 14 (G-11 is a Phase 14 gate too).

Recommendation: 3, with 1 folded into Phase 5's Court design. Needs Marko's confirmation as an override (C0.4).

---

## D-012 (Phase 3) Event-driven BDI-lite agents: built

**Built (110 tests pass):**
- Agents with objectives (10 data-defined kinds), houses, capped traits with a commitment modifier, capabilities plus experience, relationships, and a learned "answer rate" per person they ask for help.
- Wake subscription index keyed by subject: an agent wakes only when one of its own beliefs changes materially (crosses a band of the predicate's `materialDelta`) on a subject it cares about; same-tick triggers coalesce; a daily review runs only while it pursues a live intention. Physical events reach agents only through observation (being there) or messages.
- Layered planning: strategic focus on significance-3 wakes; operational plans from role templates (castellan, captain, adviser), capped by planning skill (3-7 options); scoring through objectives, risk appetite, capability, relationships, orders in force and cost, every term recorded as a Reason; commitment margin scaled by traits; deterministic tie-break.
- Obedience: interpretation (clarity x skill), willingness (obey vs adapt vs refuse, margins from temperament, loyalty, legitimacy, discretion and changed circumstances), local plan and execution with the recipient's own skill (a skilled engineer repairs faster and closer to target). No random rolls.
- Execution through people and physical systems: request letters, marches with troops, detachments, sorties (men x skill against raider strength), losses; raids are reduced by defenders.
- Advice: dispatches delivered at court are read out to the councillors present (`ReportShared`); each prepares a B3 Recommendation from their own beliefs.
- DecisionTrace (B4) on every consequential choice (`DecisionMade`), validated.
- Chronicle pass (derived data, the log is untouched): failure origin per bad outcome; breaches traced to the failed agent decision or to the ruler.

**Same evidence, different plans (test):** with identical beliefs (Northwatch at 60%, raiders at 700), Elara advises repairing Northwatch (protecting the realm outweighs the cost; a sortie is too risky for her), Caron advises a sortie (renown outweighs leaving his post and the expected losses), Oren advises sending the captain (repairs would drain the treasury), Selene advises repair (sound works).

**Design decisions found while testing:**
1. *Dithering through a threshold.* Bren flipped between "ask for repairs" and "ask for reinforcement" because the repair option is only generated below 70% and his readings wobble around 70. A feasible current intention now always stays on the table.
2. *Ignoring the wall underfoot.* An 8-day-old "probable" report outranked Caron's own daily "uncertain" look at the wall he stood on. First-hand observation of one's own surroundings now resolves contradictions at uncertain or better.
3. *Advice by alphabet.* Oren's objectives did not touch the options, so ties broke by name. `crown_standing` now values the realm's fortifications at its own (lower) priority.
4. *Agents learn whom they can count on.* Ten days after a request, the asker checks whether help came and updates its answer rate (30% weight). Under a passive ruler Bren learns that asking is pointless.
5. *Calibration.* Expected storms (from the known climate) are part of every agent's baseline; a repair completing within the horizon now counts in full (it was scaled down by the remaining fraction, a bug).
6. *Low-skill overconfidence.* Below 500 in the relevant domain, an observer or reader treats a reading one band more reliable than it is (ARCHITECTURE §20.7).
7. *Who answers repair orders.* Unchanged from Phase 2; captains answer "advance".

**How the G-10/G-11 measurement was reached (TUNE seeds, every run in `engine/results/phase3_tune.jsonl`):**
- v1: bad = the fort lost 15+ points or was breached within 20 days. About 70% of decisions were "bad", almost all "execution": it judged situations (a heavy raid makes every option lose 15 points), not decisions. Rejected.
- v2: bad = surprise (more than 10 points worse than the decider expected) or regret (with the truth another option was 10+ points better); only new choices judged; decisive beliefs only. Exposed systematically optimistic expectations (median 17-20 points), leading to decisions 4-5 above.
- v3: with calibration, storms still dominated (one storm does 5-25 points). Luck adjustment added: storm damage beyond its climatic expectation is not counted against the decision; the raw ratio is reported alongside.
- v4: breaches without a failed agent decision are traced to the ruler (told and gave no order: choice; never told or order lost: communication; could not be carried out: execution). G-10 had failed for passive without this.
- G-11(b) did not move with any of these: under passive and delegating rulers the ratio stayed near 1. No change was made to pass it.

**Sealed gate (block 20000, pre-registered in D-011; `engine/results/phase3_gate_20000.txt`):**

| Policy | Bad outcomes | G-10 attributed | G-11(a) wrong/stale (95% CI) | G-11(b) ratio, luck-adjusted (95% CI) | raw ratio |
|---|---|---|---|---|---|
| passive | 8,790 | 100% PASS | 21.0% (20.6-21.4) PASS | 0.88 (0.82-0.94) FAIL | 0.86 |
| delegating | 17,186 | 100% PASS | 17.0% (16.7-17.3) PASS | 1.09 (1.05-1.14) FAIL | 1.03 |
| aggressive | 8,188 | 100% PASS | 8.8% (8.7-9.0) PASS | 2.22 (2.07-2.37) PASS | 1.61 |

**Verdict: G-10 PASS, G-11 FAIL** (two of three policy groups fail G-11(b)). As predicted on TUNE seeds.

What it means: under a passive or delegating ruler, an agent acting on wrong or stale beliefs is not more likely to end badly. The most common agent choice there (Bren and Varos asking for repairs) barely depends on beliefs, and the commonest belief error (misjudging raider strength) cuts both ways: overestimating is harmless or even protective, which is why passive comes out below 1. When the captain is sent and sorties happen (aggressive), information becomes decisive and the ratio is 2.2. Most bad outcomes are still execution (storm luck beyond the adjustment, empty treasury, unanswered requests).

**Regressions:** G-01 and G-02 re-run with Phase 4 (D-014).

---

## D-011 (Phase 3) Pre-registration for sealed block 20000-20999 (G-10, G-11)

Written before the gate run. Content `march-0.3`, calibration hash `a3cbe77f9cae` (full content + parameters). Policies: passive, delegating, aggressive; 1,000 seeds each, 240 days. Evaluated by `engine/tools/phase3_gate.ts gate 20000 1000` and logged to `engine/results/gate_log.jsonl`. One evaluation; the result stands.

Definitions fixed on TUNE seeds 1-400 (logged in `engine/results/phase3_tune.jsonl`; see D-012 for how they were reached):
- Judged decisions: each new choice (an intention adopted; an order answered). Re-affirmations are not judged.
- Bad outcome of a decision: more than 10 points worse than the decider expected (surprise), or with the truth another option was more than 10 points better (regret). Losses = fort condition lost + men lost + breach penalty, both sides. **Luck adjustment:** storm damage beyond its climatic expectation is not counted against the decision. The raw (unadjusted) ratio is reported alongside.
- Breaches are bad outcomes too, traced to the failed agent decision, else to the ruler (order lost: communication; order could not be carried out: execution; refused: choice; told and gave no order: choice; never told: communication).
- Wrong or stale: a decisive belief (about the decision's fort or the threats near it) off by more than 5 points (condition), 150 (threat strength) or 20 coin (treasury), or older than its predicate's half-life.
- G-10: attributed / (bad decisions + breaches); PASS if point >= 95% and Wilson lower bound >= 90%, with at least 300 outcomes.
- G-11: (a) wrong-or-stale share in [5%, 35%] (three-state); (b) bad rate after wrong-or-stale / after correct >= 1.5 with seed-clustered bootstrap lower bound > 1.0. G-11 per policy = worst of (a) and (b).
- Policy rule C0.5 (groups of policies differing on < 10% of seeds count once).

TUNE expectation (seeds 201-400): G-10 PASS for all three; G-11(a) PASS for all three; G-11(b) FAIL for passive (0.83) and delegating (1.12), PASS for aggressive (2.41). So the expected verdict is G-10 PASS, G-11 FAIL.

---

## D-010 (Phase 2) Map, beliefs, reports and order contracts: built

**Built:** 22 locations in three provinces (Crownlands, Northmarch, Eastmarch) with 27 routes, terrain, the river Vey (bridge at Greybridge, ford at Veyford, ferry Saltmere-Marchend) and travel times for rider, foot and army; character positions and movement; observation with quality from capability and conditions; B5 belief propositions with evidence, bands, lazy staleness, kept contradictions and capped stores with logged eviction; reports with author bias, carried leg by leg; loss, interception, redirection and undeliverable messages; B2 StructuredOrder with every lifecycle step as its own event; B3 Recommendation and B5 Report frozen with validators. 88 tests pass.

**Design decisions (new):**
1. **Seat vs whereabouts.** `character.location` decays fast (half-life 3 days); `character.seat` never decays. A messenger goes to the last known whereabouts while that belief is alive, otherwise to the seat. Found when every report became undeliverable after 12 days because nobody "knew" where the queen was.
2. **When contradictions resolve.** First-hand observation at probable or better replaces other values; a source's newer account replaces its own older one; everything else coexists. Which one an agent acts on is a planning choice (Phase 3 DecisionTrace).
3. **Interception takes time.** Captured papers travel to the interceptor by courier; only then does the interceptor learn the claims plus who wrote to whom (`report.route`) or what was ordered (`order.content`). The interceptor's own couriers are not lost.
4. **Redirection.** Locals know where someone went unless the departure was secret; a messenger follows such word up to 2 times, then the message is undeliverable.
5. **Trust and bias.** A recipient who trusts the author below 500 reads the report one band lower. An author whose traits make them reluctant to report bad news may understate damage (chance 1000 minus their mean `badNewsReportingPermille`); the report is tagged `understates_damage`.
6. **Stub obedience until Phase 3.** Interpretation is literal and obedience always "obey"; both payloads carry a `stub` note, so nothing downstream can mistake them for decisions.
7. **Scripted hooks.** `TravelScripted` and `OrderScripted` are root events for tests and scenario setup only. A gated chain containing one fails C0.7.
8. **Schema bumps.** Event schema v2 (belief, report and order payloads) and content schema v2 (provinces, rivers, predicates, tiers, capabilities). The Phase 1 testbed content is retired; v1 content and saves are rejected, not migrated.

**Bugs found while testing (fixed):**
- The aggressive policy re-levied every minute: its "levied recently?" check compared targets, and a levy's target is the ruler. Policies now match on action only when the target is irrelevant.
- Repair orders for Greybridge found no recipient (Caron is a captain, not a castellan), so the policy re-decided on every report. Repairs now go to whoever holds the place and reports on it.

**Results:**
- G-01 PASS: combined hash `7c0765250e9ba7fcf46c76a958c23de976f3c688d12f6e292a3c4604b4d7f66b` under Node (two time zones and locales) and Bun.
- G-02 PASS: 100/100 seeds per perturbed system.
- 1,000 seeds per arm (threat ON/OFF), 240 days, every invariant including order lifecycles: 0 violations.

**Watch:**
- Cost per run rose from 22 to 152 ms per simulated year (belief integration and views). Within G-14's 60 s limit by a wide margin, but Phase 4 should profile `learn()` and `buildView()`.
- The placeholder end state `fortificationBreached` is now true in every run (Stonegate has a fortification and nobody to repair it), so the testbed gate no longer separates ON from OFF. Real end states arrive with Phases 6-7.
- Decisions on stale or wrong beliefs: 32% of the delegating policy's repair decisions. That is in the G-11(a) band (5-35%) by chance; G-11 is not evaluated until Phase 3.

---

## D-009 (Phase 1) Engine core and tooling: built, G-01 and G-02 PASS

**Stack.** TypeScript run directly by Node 22 (type stripping, no build step; `tsc` for type checks only). Reason: the frozen schemas in plan §B are already written as TypeScript interfaces, the same code can later run in a browser UI, and a second engine (Bun/JavaScriptCore) is available for the cross-engine determinism check. Rejected: Python (the Phase 0 prototypes) because it cannot share code with a browser UI; Rust because it is slower to iterate during Phases 2-7.

**Found at start:** an `engine/` scaffold (package.json, tsconfig, two test files for G-01 and G-02, no source) created earlier the same evening. Kept and built on; the two test files became part of the spec.

**Key choices:**
1. RNG: sfc32 seeded by cyrb128(`master|stream`), 32-bit integer operations only. Unbiased `int()` by rejection. Messages and orders draw from keyed substreams (`messenger:report:<tick>:<location>`), so one extra message never shifts another's draws.
2. Every state change is an event with a reducer; `projectFromLog()` must equal live state (tested every seed). `canonicalJson` rejects non-integers, so a float cannot enter the log.
3. Load = replay from seed + content version + recorded inputs, verified against the saved log hash and RNG states. Snapshots are deferred (optimisation, never authority, A1).
4. Player inputs are keyed by decision index (each wake of the player), so a replay needs no policy. The player RNG stream is restored after replay, so a scripted run can be saved and resumed identically.
5. `sim.world` throws; UI and policies get `ViewOf` (deep-frozen: own beliefs, delivered reports, own orders, clock). Static check: presentation may import only `view.ts` and its own formatter.
6. Ablation: an ablated system is never started, cannot emit (throws) and cannot draw (throws). ON/OFF pairing checked on every seed.
7. Gate evaluator: Wilson and paired bootstrap (deterministic stream), three-state verdicts, policy groups (policies differing on < 10% of seeds count once, worst verdict, at least min(2, groups) PASS), sealed-block log that refuses TUNE seeds and reuse.
8. `follow-best-adviser` / `follow-worst-adviser` are declared but refuse to run until Phase 5 (they need advisers).

**Results** (`engine/results/`):
- **G-01 PASS:** 100 seeds x 240 days give one combined hash under Node (UTC, C locale), Node (Asia/Kolkata, hr_HR) and Bun (America/Los_Angeles). Not yet done: a second physical machine or CPU architecture.
- **G-02 PASS:** 3 extra draws per day in economy, weather or threat leave the other systems' drawn events identical on 100/100 seeds (`phase1_gates.json`).
- **Batch:** 1,000 seeds per arm (threat ON and OFF), 240 days, all invariants on every seed: 0 violations, 97 s total. About 1,450 events and 22 ms per simulated year per run.
- **Evaluator:** reproduces the Phase 0 verdicts (CAL FAIL/FAIL, ALT1 and ALT2 FAIL/PASS) and Phase 0b (AMBER on block 20000, PASS on the extension) from the prototypes' per-seed flags (`test/fixtures/phase0_flags.json`).
- **End-to-end gate on the testbed** (block 10000, 4 policies): runs and logs correctly, and refuses a second run on the same block. The testbed is not a game design; its verdict (FAIL, since passive never repairs) only shows that verdicts depend on policy.

**Corrections found while testing:**
- Plan C0.2 quoted a Wilson interval of 4.7-7.7% for 60/1000; it is 4.7-7.6%.
- D-001's pooled holdout interval (4.0-7.7%) used the normal approximation; Wilson gives 4.2-8.0%.
- D-008: under the 10% distinctness rule, all three Phase 0b policies are one group (delegating differs from passive on 8.2% of seeds). The verdicts stand (AMBER, then PASS) but are single-policy.

---

## D-008 (Phase 0b) Pre-registration for sealed block 20000-20999

Written before the gate run. Calibration: D-002 values (`greyfen_use 10.5, coin_start 120, coin_upkeep 21, varos_grain_range [30,150], varos_theta 0.40`) plus all three fixes at their first-guess values in `proto_b.default_params()`. No Phase 0b parameter was tuned. Calibration hash `d3c8bfd6`. Gates: G-03 (A in 5-40%) and G-04 (lift >= 1.5, CI low > 1), 1,000 seeds per arm, policies passive / delegating / aggressive, rule C0.5. One evaluation; the result stands.

**Correction after the run:** the hash above covers only the overrides, so it collides with Phase 0's CAL. The full-parameter hash is `fa77f923`; `gate_b.calib_hash` now hashes the full parameter set. The run itself is unaffected (block 20000 had not been used).

**Result (`results/gate_check_sealed_20000.json`):**

| Policy | End state ON / OFF | Attributable A (95% CI) | G-03 | Lift (CI low) | G-04 |
|---|---|---|---|---|---|
| passive | 7.7% / 0.1% | 7.6% (6.0, 9.4) | PASS | 77 (23) | PASS |
| delegating | 5.9% / 0.1% | 5.8% (4.4, 7.4) | AMBER | 59 (17) | PASS |
| aggressive | 7.7% / 0.1% | 7.6% (6.0, 9.4) | PASS | 77 (23) | PASS |

By the C0.5 rule as written, G-03 PASS and G-04 PASS. **Honest verdict: G-03 AMBER, G-04 PASS.** Passive and aggressive produced identical logs on all 1,000 seeds (in this toy, Oren's requisition score is positive exactly when he would requisition anyway), so there are only two distinct policies: one PASS and one AMBER. Plan C0.5 is amended so identical policies count once. Under C0.4, AMBER gets one extension on block 30000 with 2,000 seeds.

**Extension (seeds 30000-31999, same calibration, `results/gate_check_sealed_30000.json`):**

| Policy | End state ON / OFF | Attributable A (95% CI) | G-03 | Lift (CI low) | G-04 |
|---|---|---|---|---|---|
| passive = aggressive | 9.95% / 0.30% | 9.65% (8.4, 11.0) | PASS | 33 (18) | PASS |
| delegating | 8.1% / 0.30% | 7.8% (6.7, 9.0) | PASS | 27 (15) | PASS |

**Phase 0b verdict: PASS** on G-03 and G-04 with both distinct policies, and G-06 (no knife-edge parameter among 8). Not tested: G-05 link necessity (a Phase 7 gate). The two blocks differ more than their intervals suggest (delegating 5.8% vs 7.8%), so treat the true attributable rate as roughly 6-8%, close to the lower edge.


**What each fix did (TUNE seeds 1-1000, delegating policy, `results/phase0b_tune.json`):**
- Context blame is the main lever: alone it moves A from -0.2% to 6.2% and the OFF rate from 10.7% to 1.2%.
- Garrison diversion alone: A 4.0%, OFF 2.9%.
- Homeostasis alone does nothing for A (-0.9%) and raises the OFF rate to 14.1%: pinning the village near its reference stock left less surplus. My prediction that it would be the biggest lever was wrong. Its real job is robustness: without it `greyfen_use` and `cut_rate` at +/-25% drive A to 0.2% (knife-edge); with it they stay at 3.5-8.0% (`results/phase0b_homeostasis_knife.json`).
- Knife-edge test, 8 parameters at +/-25%: none knife-edge. Most sensitive: `coin_upkeep` (A 1.4% / 13.4%), the treasury balance.

**New concern:** with the threat off, Varos acts in 0.1% of seeds. The threat is now almost the only route to his move. Fine for this gate, but G-07 (crisis diversity) at Phase 14 needs other routes, so rivals must also react to other crises (D-004 item 4).

---

---

## D-007 Gate redesign (supersedes D-005). Phase 0 under the new gates: FAIL

**Why.** Under the old gate, Phase 0 "passed" at 5.0% while the threat added nothing (D-001). A rate-in-band gate can be met by background strain alone. The gates now measure what the system caused, on seeds nobody tuned on. Full protocol: `IMPLEMENTATION_PLAN.md` §C0-C4 (sealed seed blocks, paired ON/OFF arms, bootstrap intervals, PASS/AMBER/FAIL, knife-edge test, anti-script check, human gates H-01 to H-03).

**Phase 0 re-evaluated on sealed block 10000-10999 (1,000 seeds per arm, `gate_check.py`, `results/gate_check_sealed_10000.json`, `results/gate_log.jsonl`):**

| Calibration | Labelled chain | End state ON / OFF | Attributable A (95% CI) | G-03 (A in 5-40%) | Lift (CI low) | G-04 (>=1.5, CI>1) |
|---|---|---|---|---|---|---|
| CAL (D-002) | 6.0% | 11.9% / 10.4% | 1.5% (-0.5, 3.4) | FAIL | 1.14 (0.96) | FAIL |
| ALT1 (use 9.75) | 4.0% | 7.4% / 4.2% | 3.2% (1.7, 4.7) | FAIL | 1.76 (1.35) | PASS |
| ALT2 (use 9.0) | 2.6% | 5.2% / 2.5% | 2.7% (1.5, 4.0) | FAIL | 2.08 (1.51) | PASS |

**Verdict:** FAIL. No tested calibration meets both G-03 and G-04. The labelled chain rate (6.0%) overstated causation four-fold (A = 1.5%). Policies were not varied (the toy has a passive Anna), so C0.5 is untested here.

**Reading.** The lift is real at lower calibrations (the threat roughly doubles the end state), but the absolute attributable rate stays near 3%. The 5% lower edge was an initial guess; the toy cannot tell whether it is the right number, and the toy's coupling is weak by construction. Options for Marko: (a) accept Phase 0 with caveats and re-test in Phases 6-7 with the real engine, carrying D-004; (b) a short Phase 0b on the coupling design (D-004 items 2-5) before Phase 1. Phase 1 does not depend on these parameters.

**Rejected:** lowering the band to fit the toy (tuning the gate to the result).

**Consequences:** D-005 withdrawn. Sealed block 10000 is spent for these three calibrations. **Superseded by D-008:** Phase 0b passes.

---

## D-001 (Phase 0) Verdict: marginal pass on the letter of the old gate, not on its intent

**Update (D-007):** under the redesigned gates the verdict is FAIL (A = 1.5%, lift 1.14 at the band calibration). The text below records the original reasoning.

**Gate:** the chain Blackwood → shortage → repair risk → requisition → grievance → Varos move appears, unscripted, in 5-40% of 100 seeds.

| Version | Seeds | Chain rate |
|---|---|---|
| First build, default parameters | 1-100 | 1% (1/100) |
| First build, default parameters | 1001-1200 (holdout) | 0% (0/200) |
| Calibrated (D-002) + two design changes (D-003) | 1-100 (gate; also part of the tuning set) | **5.0% (5/100)** |
| Same | 1001-1200 (holdout A) | 8.5% (17/200) |
| Same | 2001-2400 (holdout B) | 4.5% (18/400) |
| Same, pooled holdout | 600 seeds | **5.8% (35/600), 95% Wilson CI 4.2-8.0%** (corrected in Phase 1; the original 4.0-7.7% used the normal approximation) |

So the chain does emerge, at the lower edge of the band, after calibration. Files: `final_eval.json`, `baseline_1-100.json`, `baseline_holdout.json`.

**Why this is not a clean pass.** The threat-off control (same calibration, `p_threat_start = 0`, seeds 1-600, `threat_on_vs_off.json`):

| | Threat on | Threat off |
|---|---|---|
| Any requisition | 58.2% | 77.8% |
| Any grievance | 24.2% | 27.0% |
| Any Varos move (any root) | 10.3% | 11.3% |

Under the calibration that reaches the band, the Blackwood threat adds nothing to the end state. The chain is labelled "threat-rooted" only because the threat happens to be an ancestor; the same grievances and Varos moves occur without it, driven by storms, wall decay and a poor treasury. Under the plan's own "ablation sanity" gate (disabling a system removes crises of that type), this fails.

A calibration where the threat does matter exists but gives a lower chain rate (`marginal_effect_grid.json`, seeds 1-300): `greyfen_use 9.75, coin_upkeep 21, coin_start 120` gives chain 4.3%, Varos moves 7.3% with the threat vs 3.7% without. Not evaluated on a holdout.

In this toy, high chain frequency and strong threat causation pull against each other. The only cell with chain >= 5% has zero lift.

**Brittleness (+/-25% on one parameter, seeds 1-300, calibrated baseline 5.0%):**
- `greyfen_use` 7.9 / 13.1: 1.0% / 0.0%
- `cut_rate` 9 / 15: 0.0% / 1.7%
- `coin_upkeep` 15.75 / 26.25: 0.7% / 11.7%
- `coin_start` 90 / 150: 7.3% / 4.0%
- `varos_theta` 0.30 / 0.50: 7.7% / 3.0%
- `fear_factor` 0.6 / 1.0: 6.7% / 3.7%
- `elara_alarm` 52.5 / 87.5: 6.3% / 3.0%
- `p_rumor_reach` 0.525 / 0.875: 3.3% / 7.7%
- `w_griev` 0.45 / 0.75: 5.0% / 5.0% (no effect at all)
- `p_threat_start`, `p_storm`: 3.7-5.0% (insensitive)

**Decision needed from Marko (see D-007):** proceed to Phase 1 with caveats and carry D-004 forward, or revisit the coupling design (Phase 0b) first. Phase 1 (engine, tooling) does not depend on any of these parameters; the risk sits in Phases 6-7, whose gates re-test the chain in the real engine.

---

## D-002 (Phase 0) Parameter log

Every sweep run is in `phase0/results/sweep_log.jsonl` (labels, overrides, funnel). Tuning seeds were 1-300 (so the 1-100 gate seeds are *not* independent of tuning); holdouts 1001-1200 and 2001-2400 were evaluated once, after the calibration was fixed.

Why the default parameters failed (funnel at defaults, seeds 1-100: threat 82%, shortage 17%, repair risk 7%, requisition 3%, grievance 1%, Varos 1%):
1. Greyfen's timber stock climbed to its cap (400) long before any threat, so the threat rarely made timber scarce. Median stock at purchase time during a threat was 191.
2. The crown had plenty of coin, so Oren could always buy; requisition only occurred once the village was nearly empty, by which point he believed there was nothing to take or Elara vetoed (veto at 70, village reserve at 80).
3. Requisition from a healthy village does not anger it; only a depleted one does.
4. The requisition repairs the wall, which removes the weakness signal Varos reacts to.

Calibration adopted (changes from defaults):

| Parameter | Default | Adopted | Reason |
|---|---|---|---|
| `greyfen_use` | 7.0 | 10.5 | Village runs near balance (cut 12/day), so a threat can bite |
| `coin_start` | 400 | 120 | Cash-poor frontier crown |
| `coin_upkeep` | 18 | 21 | Same (net +1 coin/day) |
| `varos_grain_range` | [20, 120] | [30, 150] | Wealthier lord; range was arbitrary |
| `varos_theta` | 0.45 | 0.40 | Median score was 0.42; threshold was a knife edge |

Forking-paths warning: five parameters and two design changes were chosen after seeing results. The holdouts guard against overfitting to seed noise, not against overfitting the design.

---

## D-003 (Phase 0) Two design changes found necessary

1. **Rivals judge crown weakness from more than one signal.** Varos now combines wall condition and treasury (merchant reports carry both). With wall condition alone, the requisition's own repair removed the opportunity. Params: `coin_ref = 300`, `w_wall_weak = 0.5`.
2. **Agents re-wake on new relevant information.** Varos keeps his unrest belief for 45 days (`varos_memory`) and re-evaluates when a new merchant report arrives, rather than judging once when the rumour lands. Effect at the calibrated settings on seeds 1-300: 4.7% before, 5.0% after (a small effect, within noise for 300 seeds; kept because it matches the intended architecture, not because the number demanded it).

---

## D-004 Carry-forward requirements for Phases 3, 6 and 7

1. **Wake on relevant belief changes, not only on the first trigger.** One-shot decisions throttle causal chains (D-003.2). Belongs in the Phase 3 subscription index.
2. **Requisition vs purchase needs a real cost model.** Purchase must be constrained by money or price, not only by surplus. Otherwise requisition is only a fallback for an empty village (Phase 7).
3. **Reserve and veto thresholds must be defined from the same quantity.** The reserve (80) and Elara's alarm (70) overlapped, leaving a tiny requisition window. Define community "winter need" once and derive both (Phase 6/7).
4. **Rival opportunity needs several independent weakness signals** (wall, treasury, garrison, legitimacy), and acting on one must not erase the others (Phase 6).
5. **The timber balance is a knife edge** (cut vs use vs crown payroll move the result between 0% and 12%). The Phase 7 economy needs self-stabilising feedback (labour shifts, prices, stockpiling) so outcomes do not hinge on a few constants.
6. **A compassion-like weight (`w_griev`) had no measurable effect.** Redesign or remove it; Oren's restraint should come from beliefs about the village, not a tunable penalty.
7. **Root-label attribution overstates causation.** A "threat-rooted" chain can occur at the same rate without the threat.
8. **(Phase 0b) Grievance must depend on context** (danger, broken promise, calm), not only on the amount taken. This was the main lever (D-008). Phase 6.
9. **(Phase 0b) Threats should create their own weakness signals** (garrison diversion), so a repair does not erase a rival's opportunity. Phase 6.
10. **(Phase 0b) Economic homeostasis is for robustness, not for causation.** It removed the knife-edge on timber parameters; the treasury balance (`coin_upkeep`) is still the most sensitive parameter. Phase 7.
11. **(Phase 0b) Scripted player policies must be behaviourally distinct**; check that their logs differ before counting them.

---

## D-005 Proposed change to the plan's C2 gate (withdrawn: superseded by D-007)

Replace "chain appears in 5-40% of seeds" with two conditions, evaluated on holdout seeds:
- chain rate in 5-40%, **and**
- end-state rate with the threat on is at least 1.5x the rate with it ablated (lift), measured over at least 300 seeds per arm.

Same pattern for the other cross-system gates (Phase 14 crisis diversity).

---

## D-006 Prototype code is throwaway

`phase0/proto.py` uses floats and daily steps, deliberately violating the plan's engine rules (A2). Do not build on it. Keep: the findings above, the funnel diagnostic idea (`diag.py`), and the threat-on/off lift measurement.
