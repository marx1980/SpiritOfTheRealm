# DECISIONS

Newest first. Numbers come from `phase0/results/` (files named in each entry). All parameters are toy-world values; they say something about the *shape* of the design, not about final magnitudes.

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
