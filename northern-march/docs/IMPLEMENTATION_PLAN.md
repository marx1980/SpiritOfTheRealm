# Northern March - Implementation Plan

Version 4 (6 Nov 2026). Supersedes v1-v3. Changes from v3: Phases 6 and 7 narrowed to one closed loop (6A: four communities, no armed revolt; 7A: grain only and the Grain Crisis); the rest moves to 6B/7B; H-01/H-02 overridden at Phase 5 (DECISIONS D-020); canonical scenarios T01-T10 and I01-I03 (section C5); the handover package and its review are in `docs/handover/`.

## Goal
Build the smallest system capable of testing the game's interaction thesis: imperfect knowledge + event-driven autonomous people + conversational delegation + cross-system consequences.

Succession is excluded. Queen Anna is the only player ruler; her death, capture/deposition or decisive objective failure ends the prototype.

## Related documents
- `ARCHITECTURE.md` §20 - NPC decision architecture
- `DESIGN_PIPELINE.md` - how reality becomes belief, decision and consequence
- `BATTLEFIELD.md` - battle command design
- `BACKLOG.md` - product backlog (epics map to phases in section F)
- `GLOSSARY.md` - shared terms

---

# A. Cross-cutting engineering rules

## A1. Event-sourcing is the backbone
- The append-only event log is the single source of truth. WorldState is a projection of it.
- Replay, save/load, DecisionTrace and bug reports all derive from: seed + content version + player inputs + log.
- Snapshots are an optimisation, never the authority.

## A2. Determinism
- All simulation state uses integers or fixed-point (milli-units). No floats in sim state.
- Time is an integer tick count. **1 tick = 1 game second** for both campaign and battle. The scheduler jumps directly to the next scheduled event, so quiet periods cost nothing.
- Iteration over collections uses a defined order (stable ID), never hash order.
- Player inputs are recorded as events with the tick at which they took effect.
- Language/voice output never feeds sim state except as a validated StructuredOrder or question event.

## A3. RNG streams
- One independent seeded stream per system: `economy`, `weather`, `hydrology`, `geology`, `community:<id>`, `agent:<id>`, `battle:<id>`, `monster`, `messenger`.
- Stream seed = hash(master_seed, stream_name). Adding a draw in one system must not change another system's outcomes.

## A4. Versioned schemas
- Every event, DecisionTrace, save file and content file carries `schemaVersion`.
- Migrations are explicit, tested functions. Old replays either migrate or are rejected loudly.

## A5. Content is data
- Characters, Houses, locations, communities, traits, resources, policies and scenario setup live in validated JSON/YAML.
- A content validator runs in CI: unknown IDs, traits outside the vocabulary, orphan relationships and unreachable locations fail the build.
- The engine contains no named characters or places.

## A6. Observability from day one
- Headless batch runner: `run --seeds 1..N --days D --policy <scripted-player> --out results/`.
- Scripted player policies (passive, aggressive, delegating, random-valid) let batch runs exercise the game without a human.
- Every run emits a metrics row (section C1).
- Ablation switches per system (economy, communities, environment, monster, Arven, battle); disabled systems emit no events and consume no RNG.
- Invariant checks run on every seed in CI (section C3).

## A7. Hard boundaries
- UI and planners never read unrestricted WorldState; they receive `ViewOf(agent)` or `ViewOf(player)`.
- `ViewOf(player)` is Anna's own BeliefStore plus reports delivered to her. Advisers' private beliefs reach the player only through what advisers say.
- No LLM call is required to advance simulation time.
- The simulation is fully playable via structured debug UI with templated phrasing and no language model.

---

# B. Frozen schemas (v1 contracts)
Fields below are the minimum. Additions are allowed; removals and renames need a schema version bump and a `DECISIONS.md` entry.

## B1. Event envelope
```ts
interface SimEvent {
  schemaVersion: number;
  id: EventId;                 // monotonically increasing
  tick: Tick;
  type: EventType;
  domain: 'military'|'economic'|'political'|'social'|'environment'|'magic'|'info';
  significance: 0|1|2|3;       // 0 immediate, 1 tactical, 2 operational, 3 strategic (max layer it may wake)
  causedBy: EventId[];         // empty only for exogenous or player-input events
  subjects: SubjectRef[];      // used by the wake subscription index
  payload: unknown;            // typed per EventType
  rngStream?: string;
}
```

## B2. StructuredOrder
```ts
interface StructuredOrder {
  schemaVersion: number;
  id: OrderId;
  issuer: CharacterId;
  recipient: CharacterId | FormationId;
  issuedAt: Tick;
  kind: 'strategic'|'standing_policy'|'tactical';
  intent: IntentKind;                   // hold, advance, withdraw, screen, escort, requisition, investigate, negotiate, report...
  objective: SubjectRef;
  constraints: Constraint[];            // "do not pursue beyond the stream", "remain concealed"
  contingencies: Contingency[];         // { when: ConditionRef, then: IntentRef }
  discretion: 'strict'|'bounded'|'delegated';
  reportingPolicy: ReportingPolicy;     // when the recipient must report back (see BATTLEFIELD §19)
  supersedes?: OrderId[];
  sourceTranscriptRef?: string;         // debug only, never read by the sim
  affirmedByPlayerAt?: Tick;
}
```
Lifecycle events, each separate: `OrderIssued → OrderDispatched → OrderReceived → OrderInterpreted → ObedienceDecided(obey|adapt|refuse) → LocalPlanFormed → SubordinateOrdersIssued → ExecutionStarted → (OrderCompleted | OrderSuperseded | OrderAbandoned)`.
Failure branches: `OrderLost`, `OrderIntercepted`, `OrderUndeliverable(recipient location unknown)`.

## B3. Recommendation and Reason
```ts
interface Recommendation {
  id: RecommendationId;
  author: CharacterId;
  question: 'what_would_you_do'|'why'|'how_sure'|'what_worries_you'|'alternatives'|'what_if';
  plan: PlanRef;
  reasons: Reason[];                    // ordered by weight
  uncertainties: Uncertainty[];         // beliefs the author knows are weak or stale
  alternatives: PlanRef[];
  contingencies: Contingency[];
  basedOnBeliefs: BeliefRef[];
  computedAt: Tick;
  validUntilEvent?: EventId;            // set when a consulted belief materially changes
}
interface Reason {
  kind: 'belief'|'objective'|'order'|'trait'|'relationship'|'capability'|'resource'|'precedent';
  ref: Ref;
  weight: number;                       // fixed-point
  textKey: string;                      // template key for the language layer
}
```

## B4. DecisionTrace
```ts
interface DecisionTrace {
  schemaVersion: number;
  agent: CharacterId | CommunityId;
  tick: Tick;
  trigger: EventId;
  layer: 'strategic'|'operational'|'tactical'|'immediate';
  beliefsConsulted: { ref: BeliefRef; ageTicks: Tick; reliability: ReliabilityBand }[];
  objectivesActive: ObjectiveRef[];
  ordersInForce: OrderId[];
  candidates: { action: ActionRef; score: number; contributions: Reason[] }[];
  selected: ActionRef;
  keptCurrentIntention: boolean;        // true when commitment/hysteresis kept the old plan
  outcome?: { eventId: EventId; failureOrigin?: 'belief'|'choice'|'communication'|'execution' };
}
```
`failureOrigin` is filled retroactively by the chronicle pass (DESIGN_PIPELINE §11).

## B5. Belief and report
```ts
interface BeliefProposition<T> {
  id: BeliefId;
  subject: SubjectRef; predicate: PredicateId; believedValue: T;
  evidenceRefs: EvidenceRef[]; observedOrLearnedAt: Tick;
  reliabilityBand: 'certain'|'probable'|'uncertain'|'doubtful';
  // staleness half-life comes from the predicate definition and is applied lazily on read
}
interface Report {
  id: ReportId; author: CharacterId; subject: SubjectRef; claims: BeliefProposition<unknown>[];
  composedAt: Tick; dispatchedAt?: Tick; route: RouteRef; carrier?: CharacterId; deliveredAt?: Tick;
  authorBias?: BiasTag[];               // omission / exaggeration tendencies
}
```
Invariant: an agent may only gain a report-derived belief after a `ReportDelivered` event to that agent.

## B6. Trait vocabulary (capped at 14)
`cautious, aggressive, proud, loyal, ambitious, pragmatic, zealous, greedy, honest, vengeful, compassionate, stubborn, curious, patient`

Each trait is a data entry defining modifiers on: risk weighting, obedience-when-disagreeing, House-vs-crown weighting, response to losses and willingness to report bad news. Adding a trait is a design decision, not an ad-hoc change.

---

# C. Emergence metrics and gates
Thresholds are initial guesses, revised after the first real batch. The protocol (C0) is not a guess: Phase 0 showed that a "rate within a band" gate can be passed by background strain alone, so gates now measure what the system *caused*, with uncertainty, on seeds nobody tuned on (DECISIONS D-001, D-007).

## C0. Gate evaluation protocol
1. **Seed blocks.** TUNE seeds 1-9,999: free use for development, diagnostics and sweeps. GATE blocks of 1,000: 10,000-10,999, 20,000-20,999, 30,000-30,999 and so on. A GATE block gives one verdict per calibration: a hash of the full parameter set and content (defaults included, not only the overrides) plus a hash of the engine source, since a code change is a change too (added in Phase 4). After any change, that block is spent and the next one is used. Never tune on a GATE block. Every evaluation is appended to `results/gate_log.jsonl`, and the first evaluation on a block is the verdict.
2. **Sample size.** Proportion gates use at least 1,000 seeds per arm. Phase 0 check: a true 6.0% measured on 1,000 seeds had a 95% Wilson interval of 4.7-7.6%; 600 seeds is too wide to decide a 5% edge.
3. **Paired arms.** ON and OFF arms use the same master seed and per-system RNG streams (A3) and differ only in one ablation switch. Differences and ratios use a paired bootstrap (2,000 resamples) over seeds. The two logs must match until the ablated system first emits an event (C3).
4. **Three-state verdicts.** For a metric with band [lo, hi]: **PASS** if its 95% interval lies inside the band; **AMBER** if the point estimate is inside but the interval crosses an edge; **FAIL** if the point estimate is outside. AMBER gets one extension (double the seeds on a fresh GATE block); still AMBER counts as FAIL. A phase is complete only on PASS, or a recorded override by Marko.
5. **Policies.** Behavioural gates run under at least three scripted player policies (passive, delegating, aggressive). Policies whose logs differ on fewer than 10% of the block's seeds form one group, which takes its worst verdict. The gate passes if no group FAILs and at least min(2, groups) groups PASS. A gate passed with a single group is reported as single-policy and cannot close Phase 7 or 14. Report per-policy numbers. (Phase 0b: all three policies formed one group.)
6. **Knife-edge test.** Each phase declares up to 8 key parameters in its DECISIONS entry. Re-run the headline metric at +/-25% on TUNE seeds. A parameter is *knife-edge* if either run drives the metric to 0 or above twice the band's upper edge. At most 2 knife-edge parameters are tolerated at Phase 7, each with a written redesign plan; none at Phase 14.
7. **Anti-script check.** Every event in a gated chain must trace to an agent's DecisionTrace or to a physical or exogenous process. A scripted trigger fails the gate whatever the rates.
8. **Tuning log.** Every parameter change is recorded with before/after values and metrics. Tuning never uses GATE blocks.

## C1. Per-run metrics row
- `dominantCrisis` (definition in G1), `crisisCount` by type
- `timeToFirstCrisis`, `timeToEnding`, `endingType`, `endingFirstCause` (exogenous or agent decision), `endingAncestryDomains`
- `decisionsTotal`, `decisionsUsingStaleOrWrongBelief`, `badOutcomesByFailureOrigin`, `badOutcomeByBeliefQuality` (wrong-belief vs correct-belief decisions)
- `causalChainMaxLength`, `crossSystemChains` (chains spanning 3 or more domains)
- `endStateFlags` per named end state, recorded in every arm
- `ordersLost`, `ordersIntercepted`, `ordersRefused`, `ordersAdapted`
- `disobedienceEvents` and outcome (helped / harmed / neutral)
- `agentWakesPerSimDay` by tier, `wallClockPerSimYear`
- `communityRevolts`, `communityRevoltsWithoutNamedLeader` (must be 0)
- `armId`, `policyId`, `calibrationHash`, `seedBlock`

## C2. Gate registry (automated)
**Definitions.** *End state* of the Phase 7 chain: Varos acts on Greyfen's grievance. R_on and R_off are the shares of seeds with the end state in the ON and OFF arms (OFF = Blackwood threat ablated). *Attributable rate* A = R_on - R_off. *Lift* = R_on / R_off. The *labelled chain rate* (end states whose ancestry runs back to the threat) is reported but no longer gated: in Phase 0 it was 6.0% while A was 1.5%.

| ID | Phase | Metric | Arms and n | Pass rule |
|---|---|---|---|---|
| G-01 | 1 | Same seed and inputs give an identical log hash on two machines | 100 seeds | all identical |
| G-02 | 1 | Adding RNG draws to one stream changes nothing before that system's own outcomes change: the first event that differs between the two runs belongs to the perturbed system (redefined in Phase 4: once systems interact, later differences are cause and effect) | 100 seeds | all seeds |
| G-03 | 7, 14 | Attributable rate A of the chain end state | ON/OFF paired, 1,000 seeds, 3 policies | A in [5%, 40%] (C0.4) |
| G-04 | 7, 14 | Lift R_on / R_off | same | PASS: ratio >= 1.5 and interval lower bound > 1.0; AMBER: ratio >= 1.5 only; else FAIL |
| G-05 | 7 | Link necessity: disabling any one named link cuts A by at least 50% | 600 seeds per link | every link (links named in DECISIONS at Phase 7 start) |
| G-06 | 7, 14 | Knife-edge parameters (C0.6) | TUNE seeds | <= 2 at Phase 7; 0 at Phase 14 |
| G-07 | 14 | `dominantCrisis` share per type | 1,000 seeds | each type in [5%, 45%] |
| G-08 | 14 | `endingType` shares | 1,000 seeds | at least 4 types, each in [5%, 60%] |
| G-09 | 14 | Not a random branch: (a) endings whose first cause is exogenous with no agent decision in the ancestry; (b) endings whose ancestry spans 3 or more domains | 1,000 seeds | (a) <= 20%; (b) >= 60% |
| G-10 | 3, 14 | Bad outcomes with `failureOrigin` attributed | at least 300 bad outcomes | PASS: point >= 95% and interval lower bound >= 90%; AMBER: point >= 95% only |
| G-11 | 3, 14 | Wrong beliefs matter: (a) decisions using stale or wrong beliefs; (b) bad-outcome rate after wrong-belief decisions divided by the rate after correct-belief decisions | 1,000 seeds | (a) in [5%, 35%]; (b) >= 1.5 with interval lower bound > 1.0 |
| G-12 | 5, 14 | Advisers matter: objective-success rate of "follow the best adviser" minus "follow the worst adviser" | paired policies, 1,000 seeds | difference >= 10 points, interval lower bound > 0 |
| G-13 | 6 | Revolts without a named leader; revolts triggered by maximum grievance alone; (v4) escalations past "delay" with any D2 gate unmet | all seeds | 0; 0; 0 |
| G-14 | 4, 14 | Wakes within tier budgets; doubling background characters raises Tier A wakes by less than 20%; wall-clock per sim year | 100 seeds | all three within limits (wall-clock <= 60 s) |
| G-15 | 14 | Ablation sanity: disabling a system cuts crises of its own type to <= 20% of the ON-arm rate and moves other types by < 5 points | 1,000 seeds per system | every system |
| G-16 | 13 | Swapping the language layer for templates leaves the event log identical | 100 seeds | identical |

## C3. Invariant tests (every seed, in CI)
- No agent acts on a report before its `ReportDelivered` event.
- No UI or planner module reads WorldState directly (static import check plus runtime proxy).
- No inactive agent produces a DecisionTrace without a trigger.
- Every revolt has a named leader or institution and all gates satisfied at trigger time.
- (v4) Every community escalation past "delay" (withhold, refuse, support) has all D2 gates satisfied in its recorded inputs, and a named leader.
- Every order lifecycle is a valid path through B2.
- Every `causedBy` reference points to an earlier event.
- The language layer can be swapped for the templated layer with an identical event log.
- ON and OFF arm logs are identical until the ablated system first emits an event (valid pairing).
- Every event with an empty `causedBy` has a type on the list of exogenous or player-input types.
- No scripted trigger in a gated chain (C0.7).
- Scripted policies used in a gate produce different logs on at least 10% of the block's seeds.
- Gate runs refuse seeds below 10,000 and refuse a block already used for the same calibration hash.

## C4. Human gates
**H-01 Court → Map → delegate → delayed consequence (Phase 5, GO/NO-GO).**
Protocol: 5 testers (minimum 3) who have not seen the design; a scripted 25-30 minute scenario with at least 3 delayed consequences; think-aloud, recorded; each tester states a reason before every decision.
Per tester: (a) at least 80% of stated reasons cite information actually on screen (a report, its age or source, an adviser's statement); (b) after a consequence they can say why it happened, using the shown information or the inspector, in at least 70% of cases; (c) they never act on information Anna could not have (observer checks).
PASS: at least 4 of 5 testers (all, if only 3) meet a, b and c. On FAIL, fix the interface or information design and re-test with new testers. Record the testers' own words for every failure.

**H-02 Trust is learnable (Phase 5 sessions; re-check at Phase 14).**
After two sessions of at least 30 minutes, testers rank at least 3 advisers by reliability without seeing statistics. PASS: mean rank agreement with the advisers' true quality (Spearman) >= 0.5, and no tester ranks the worst adviser first.

**H-03 Battle readability (Phase 8).**
Testers watch clips of formations in each of the 7 behaviours, with no numbers shown. PASS: at least 80% correct identification of behaviour, and at least 90% correct distinction between observed and reported markers.

## C5. Canonical scenarios (v4)
Named tests in `engine/test/canonical.test.ts`; each maps to an automated check.
| ID | Scenario | Phase |
|---|---|---|
| T01 | Stale scout report: an old belief stays in force until new word arrives; stale beliefs are flagged | 2-3 (that they *matter* is G-11) |
| T02 | Contradictory intelligence: contradictions from different sources are kept; first-hand and same-source resolve | 2 |
| T03 | Bad royal order: the recipient adapts or refuses an order he judges wrong, with reasons | 3 |
| T04 | Opportunity versus order: obey/adapt/refuse follow margins, and change gradually (no cliff edges) as the margin moves | 3 |
| T05 | Missing messenger: the old order stays in force until the new one is received | 2 |
| T06 | Resource shock: an empty treasury changes plans (repairs abandoned for funds) without spawning unrest | 5 (grain version at 7A) |
| T07 | Community grievance: the same burden helps or hurts communities differently | 6 (levy), 7A (requisition) |
| T08 | Emergent candidate: Stefan rises through recommendation | 4 |
| T09 | Controlled withdrawal misread as rout | battlefield (Phase 8) |
| T10 | Same reality, different beliefs: councillors advise differently from the same dispatch | 3 |
| I01 | Grain Crisis: full material-political loop | 7A |
| I02 | Two-community divergence: one stimulus, opposite interpretations | 6 (raids and levy), 7A (shipment) |
| I03 | Mobilisation without a revolt meter: maximum grievance alone never escalates past "delay" | 6 |

---

# D. Rebellion combination function (crude v1)
Rebellion is a mobilisation state with structural gates plus a continuous score. There is no generic unrest threshold.

## D1. Inputs (per community, fixed-point 0..1000)
- `G` specific grievance intensity, tied to an identifiable cause event or policy
- `N` shared narrative strength (how much of the community attributes G to the same actor)
- `L` leadership (named character or institution trusted above a floor)
- `C` communication network (internal cohesion and links to neighbours)
- `R` resources and arms available
- `E` expected success (beliefs about enforcement weakness, allies, past outcomes)
- `T` trigger event within a recent window

## D2. Hard gates
`G ≥ gMin`, `N ≥ nMin`, `L ≥ lMin` with a named leader, and `T` present. If any gate fails, there is no revolt.

## D3. Mobilisation score
`M = G × geometricMean(N, L, C, R, E) / 1000`
- `M ≥ m1`: organisation, evasion, protest and sabotage become available.
- `M ≥ m2` with all gates: open revolt, possibly in support of a competing character or claimant.
- `gMin, nMin, lMin, m1, m2` are per-community data with defaults.

## D4. De-escalation
- A remedy for the specific grievance lowers `G` and `N`.
- A co-opted, imprisoned or killed leader lowers `L` (and may raise `G` through memory).
- Visible enforcement raises or lowers `E` depending on the community's beliefs about it.
- Negotiation outcomes become community memories that shift future `gMin`.

## D5. Tests
- Identical policy in two communities with different `L`, `C` and memories gives different outcomes.
- Maximum `G` alone never produces a revolt.
- A community reacts only to what it observed or heard, never to hidden ruler intent.

---

# E. Phases

## Phase 0 - Paper prototype (throwaway)
**Deliver:** one province, 5 agents, 3 resources (timber, grain, coin), 1 community, one threat event. Minimal code, no persistence.
**Question:** does the Phase 7 chain emerge without a script, at plausible frequency?
**Gate:** G-03 and G-04 (section C2), run with the threat on and off on a sealed seed block. Toy magnitudes are only indicative; the question is whether the couplings can produce chains the threat actually causes. If not, revisit the resource/community/agent coupling before building the engine. Discard the code; keep findings and parameters in `DECISIONS.md`.
**Result (31 Oct):** FAIL under these gates; passed only the original rate-in-band gate. See DECISIONS D-001 and D-007.

## Phase 1 - Engine invariants and tooling
**Deliver:** event-sourced core, integer ticks, per-system RNG streams, scheduler, save/load with schema versions, replay, `ViewOf` accessors, batch runner with scripted player policies, metrics emitter, ablation flags with paired ON/OFF arms, gate evaluator (C0: sealed seed blocks, bootstrap intervals, three-state verdicts, gate log), invariant harness, content loader and validator, debug inspectors.
**Gate:** G-01, G-02.
**Result (31 Oct):** PASS. G-01 checked across two JavaScript engines (Node/V8, Bun/JavaScriptCore), three time zones and two locales; a second physical machine is still to do. See DECISIONS D-009.
**Tests:** identical log hash across two machines; RNG stream isolation; presentation cannot access unrestricted WorldState.

## Phase 2 - Map, beliefs, reports and contracts
**Deliver:** 20-25 locations across three provinces with roads, crossings and travel times; character/messenger positions; Observation, Evidence, BeliefProposition, sparse BeliefStore, lazy staleness; report transmission; lost/delayed/intercepted hooks; StructuredOrder (B2) and Recommendation (B3) schemas frozen with lifecycle events.
**Result (31 Oct):** built; all tests pass; G-01 and G-02 still PASS on the new map. See DECISIONS D-010.
**Tests:** conflicting beliefs about one fact; staleness without per-tick updates; no action on an undelivered report; intercepted report updates the interceptor's beliefs, not the intended recipient's; lifecycle events validate.

## Phase 3 - Event-driven BDI-lite agents
**Deliver:** objectives, intentions with commitment/hysteresis, trait vocabulary (B6), capabilities and domain experience, relationships, wake subscription index, layered planning, obedience decision (ARCHITECTURE §20.8), DecisionTrace, Recommendation generation.
**Tests:** inactive characters do no work; a meaningful event wakes only implicated agents; same evidence gives different, explainable plans for Elara and Caron; an agent does not flip between two near-equal plans on successive minor events.
**Gate:** G-10, G-11 on scripted runs.
**Result (1 Nov):** G-10 PASS; G-11 FAIL (wrong beliefs do not lead to worse outcomes under passive or delegating rulers; they do under aggressive). Proceeded at Marko's instruction with G-11 open. See DECISIONS D-012 and D-013.

## Phase 4 - Simulation tiers
**Deliver:** Tier A/B/C, promotion/demotion, background representation, relevance triggers, measured wake budgets per tier.
**Tests:** Stefan promotes from background to expedition commander without pre-running full AI; demoted people keep history and relationships.
**Gate:** G-14.
**Result (1 Nov):** PASS (block 30000). See DECISIONS D-014.

## Phase 5 - Court, Map and personal presence (GO/NO-GO)
**Deliver:** Court issue aggregator; adviser interpretation and disagreement; belief-based map with report age, source and uncertainty; structured order composer; messenger delivery; Anna's travel between Ravenport, Greybridge and Northwatch; who holds court and decides while she is absent; campaign objective tracking; defeat on Anna's death or capture; debug UI with templated phrasing.
**Gate:** H-01 (protocol in C4), plus G-12 and H-02. If testers cannot explain their decisions from the information shown, fix this before any further phase.
**Result (1 Nov):** built; G-12 AMBER (5.9 points, interval 4.4-7.5, block 50000); H-01 and H-02 waiting for testers (docs/H01_PROTOCOL.md). See DECISIONS D-015.
**Override (6 Nov, D-020):** proceed to Phase 6 without H-01/H-02; they run with the first serious human playtests at Phase 7A.

## Phase 6 (6A) - Four population communities
**Deliver:** Northwatch, Greyfen, Eastmarch and Coldmere (the Blackwood settlement); 2-3 cohorts each; material condition; sparse memory; specific grievances with a cause, someone blamed and a remedy; source trust; competing narratives told by people with access (Varos, Bren, Anna); a named leader where there is one; the section D inputs and hard gates; a behaviour ladder (cooperate, petition, delay, withhold, refuse a demand, support a named actor) with effects on income, recruits and levies; petitions and officers' letters back to Anna; relief as a remedy. No armed revolt. The second, non-grain grievance is built here: troops quartered away from home (misconduct), alongside raids, levies and a broken promise.
**Tests:** section D5; I02, I03, T07 (levy); invariant "no escalation past delay without the D2 gates".
**Gate:** G-13, plus the regression gates (G-01, G-02, invariants) and G-12 still PASS with communities on.

## Phase 6B - Wider population and rebellion (deferred)
8-12 communities, migration, sabotage, open revolt (section D3 m2), leaders co-opted or imprisoned (D4). After the 6A-7A loop is validated.

## Phase 7 (7A) - Grain and the Grain Crisis
**Deliver:** grain only: stores, production, consumption, requisition delegated to officials, physical convoys with loss and seizure, scarcity bands, exact stock conservation; purchase constrained by coin (D-004.2). The Grain Crisis fixture without outcome branches: Northwatch needs grain, Greyfen can give some at real cost and remembers the crown's promise to consult, Anna has imperfect estimates, Varos can exploit grievance only with access and organisation. The shortage must be caused by the Blackwood raids (damaged harvest or roads), so the ON/OFF threat arms differ.
**Tests:** T06 and T07 (grain versions), I01, I02 (shipment), a log classifier for the four outcomes (cooperative support; material success with political damage; political caution with military danger; misinformation failure).
**Gate:** G-03, G-04, G-05, G-06 on a sealed seed block with the end state "Varos acts on Greyfen's grievance"; each Grain Crisis outcome at least 5% of 1,000 seeds; the second-grievance test (misconduct) passes on the same community architecture; first serious human playtests.

## Phase 7B - Wider economy (deferred)
Timber, iron, horses, prices and markets, House control of resources, full levy system and manpower. Then choose the timber/Blackwood loop or the Grey Hill battlefield laboratory from the evidence.

## Phase 8 - Minimal battle slice
**Deliver:** battle entry from campaign contact and exit back to campaign (BATTLEFIELD §2B, §22); BattleReality vs BattleBeliefs; about 6 formations and 3 commanders; physical order transmission; receipt/interpretation/obedience split; one formation behaviour model; Anna's command position and exposure risk; post-battle imperfect reports.
**Tests:** a formation continues its old instruction while a new order travels; obedience decisions are traceable, never rolled; battle results flow back into campaign state (losses, prestige, community memory).
**Gate:** H-03.

**--- End of P0-Core. Review metrics and tester feedback before continuing. ---**

## Phase 9 - Standing policy and precedent
Military, economic emergency and negotiation/punishment policy; officials merge policy with immediate orders and local beliefs; institutional precedent.

## Phase 10 - Environment
Seasonal cycle, rain/snow/mud, river level and freeze/thaw, flooding and route changes, harvest effects, geological stress. Environment changes existing state only (routes, harvests, battle conditions). Magic is deferred to P1 (see BACKLOG P0.14).
**Gate:** environmental events cause second-order consequences (route → supply → grievance) without an arbitrary catastrophe function.

## Phase 11 - Exploration, monster and artefact
Blackwood site and rumours; military/scholarly expeditions; senior delegate selects subordinate leader; hidden creature ecology with witness reports; Stone of Vey actual vs believed properties, custody and provenance.
**Gate:** unknown Stefan can emerge through recommendation and performance; the artefact may never enter Anna's possession.

## Phase 12 - Full battlefield
Full command hierarchy, line-of-sight and occlusion, observed/reported/inferred/stale markers, signals, panic propagation and rout, local adaptation and deliberate disobedience, commander incapacitation and local succession, sector delegation, recorded disobedience outcomes.

## Phase 13 - Conversation layer
Typed natural language → intent parser → draft StructuredOrder; commander questions and read-back; natural affirmation and correction; "what would you do / why / alternatives" answered from Recommendation objects; voice-to-text adapter; technical transcript correction. Templated phrasing remains the permanent fallback.
**Gate:** G-16.

## Phase 14 - Content and emergence pressure cooker
25-30 active and 20-30 background characters, four Houses, Arvenese frontier network (ambassador, border commander, merchant intermediary, royal representative), five overlapping pressures (rebellion, food/security, Blackwood, Arven, environment), all ending paths (military victory, negotiated settlement, coalition fracture, death, capture/deposition, territorial/authority failure).
**Gate:** every G-gate in C2 PASSes on a sealed block of 1,000+ seeds under three player policies, and H-02 passes. AMBER does not count.

## Phase 15 - Chronicle and balancing
Player-known timeline, objective reconstruction, DecisionTrace explorer, community memory and grievance history, artefact provenance, battle obedience history, cross-system causal chains, `failureOrigin` attribution pass, conclusive epilogue.

---

# F. Backlog-to-phase map
| Backlog epic | Phase | Scope |
|---|---|---|
| P0.00 Tooling and contracts | 1-2 | Core |
| P0.01 Simulation foundation | 1 | Core |
| P0.02 Physical world | 2 | Core |
| P0.03 Reality, observation, belief | 2 | Core |
| P0.04 Reports, messengers, orders | 2, 5 | Core |
| P0.05 Core characters, decisions | 3 | Core |
| P0.06 Court and Map | 5 | Core |
| P0.07 Personal presence | 5 | Core |
| P0.08 Character network, Houses | 4, 14 | Core (basic), Full |
| P0.09 Population communities | 6 (6A), 6B | Core |
| P0.10 Rebellion mechanics | 6B | Core |
| P0.11 Material economy | 7 (7A grain), 7B | Core |
| P0.12 Standing policy | 9 | Full |
| P0.13 Environment | 10 | Full |
| P0.14 Magic | P1 (deferred) | — |
| P0.15 Blackwood exploration | 11 | Full |
| P0.16 Monster and artefact | 11 | Full |
| P0.17 Arvenese frontier | 14 | Full |
| P0.18 Limited-visibility battlefield | 8, 12 | Core (basic), Full |
| P0.19 Conversational commands | 13 | Full |
| P0.20 Commander advice | 3, 13 | Core (structured), Full |
| P0.21 Physical battle communication | 8, 12 | Core (basic), Full |
| P0.22 Obedience and interpretation | 3, 8, 12 | Core |
| P0.23 Commander skill, formations | 8, 12 | Core (basic), Full |
| P0.24 Objective and ending | 5, 14 | Core (death/capture), Full |
| P0.25 Chronicle and emergence tests | 1, 15 | Core (metrics), Full |

---

# G. Design decisions

## Adopted (31 Oct)
1. **`dominantCrisis`:** each order, Court issue and committed resource is traced to its root crisis via `causedBy`. Score = share of Anna's attention over the run. Log the runner-up and when each crisis peaked.
2. **Battle conversation cost:** 30 game seconds per question-and-answer exchange, 15 for read-back and affirmation, 0 for technical corrections. Commanders press after about 5 exchanges. Tune in Phase 8.
3. **Ravenport while Anna travels:** a regent appointed from her council handles routine administration and emergencies within standing policy. Anna reserves war and peace, treaties, executions and arrests of nobles, and requisitions above a set size. The regent has their own objectives.
4. **Magic:** moved out of the prototype to P1 (BACKLOG P0.14). Phase 10 covers environment only.
5. **Stefan Veyr:** a candidate only if a known character recommends him and the delegate trusts that character enough. Good reports and survival raise reputation. He becomes active with independent command or a reputation threshold. Target: emerges in 20-40% of seeds.
6. **Wake budgets (initial):** campaign 20 wakes per active character per day, locally relevant 3, background 0. Battle 1 tactical replan per commander per 10 game seconds. A game year runs headless in under 60 seconds.
7. **Roles:** Bren, castellan of Northwatch (loyal, stubborn; repair and timber). Oren, royal steward and treasurer (pragmatic, greedy; requisition and taxation). Mara, Greyfen spokeswoman (honest, vengeful; natural leader if Greyfen rebels). Selene, scholar-engineer of the environment in P0 (curious, zealous; weather, river and route knowledge). Her Earth/Frost court-mage role moves to P1 with magic.
8. **Balancing:** all tuning values sit in one versioned parameters folder. They change only after a batch run, and each change is recorded in `DECISIONS.md` with before/after metrics.
9. **Battle command delegation:** Anna may hand overall command to a commander and watch from the command post. Her visible presence gives a small morale effect. Taking command back is an order that must travel.
10. **Signals:** six slots per army. Four are standard (advance, hold, withdraw to fallback, commit reserve); two are custom, agreed before battle. Range depends on line of sight, smoke and noise.
11. **Night battles:** excluded from the prototype. Battles end at nightfall; night movement and surprise attacks happen on the campaign map only. Revisit in Phase 12.
12. **Gate protocol:** adopted 31 Oct (section C0). Gates measure the effect of a system (ON/OFF paired arms), use sealed seed blocks and three-state verdicts. Supersedes the single rate-in-band gate (DECISIONS D-007).

## Still open
- Stefan's numeric thresholds: set after the first 100-seed batch.
- Wake budgets: confirm once Phase 4 measures real costs.
- Regent's exact authority limits: tune in the Phase 5 playtest.

# H. Prototype success criteria
- Surprising outcomes are retrospectively understandable.
- NPC mistakes read as consequences of beliefs, traits and skills, not broken AI.
- Good advisers materially improve player decision quality.
- The player can learn whom to trust without stats.
- Load stays bounded because most agents are dormant most of the time.
- Language or voice failure cannot corrupt authoritative state.
- Runs differ because systems interact, not because a story branch is randomly chosen.
- All C2 gates PASS and H-01 to H-03 pass.
