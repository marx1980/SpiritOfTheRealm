# Medieval Realm Game - Product Backlog

## Priorities
- **P0:** Northern March interaction prototype
  - **P0-Core:** Phases 0-8 of `IMPLEMENTATION_PLAN.md` (ship and evaluate first)
  - **P0-Full:** Phases 9-15
- **P1:** Realm vertical slice
- **P2:** Medieval Alpha
- **P3:** later eras/expansion

Each epic lists its phase, scope and acceptance criterion ("Done when"). Detailed tests live in the implementation plan.

# P0 - Northern March Interaction Prototype

## P0.00 Tooling and contracts — Phases 0-2, Core
- [x] Phase 0 paper prototype of the cross-system chain (throwaway)
- [x] Headless batch runner with scripted player policies
- [x] Per-run metrics row and results aggregation
- [x] Ablation switches per system, with paired ON/OFF arms
- [x] Gate evaluator: sealed seed blocks, bootstrap intervals, three-state verdicts (PASS / AMBER / FAIL), gate log (plan §C0)
- [ ] Scripted player policies: passive, delegating, aggressive done; follow-best-adviser, follow-worst-adviser wait for Phase 5
- [x] Invariant test harness run on every seed in CI
- [x] Content-as-data loader and validator
- [ ] Frozen schemas: SimEvent, StructuredOrder, Recommendation/Reason, BeliefProposition, Report done; DecisionTrace in Phase 3
- [x] Capped trait vocabulary (14) as data
- [x] `STATE.md` and `DECISIONS.md` maintained per session

Done when: 1,000 seeds per arm run headless overnight, emit metrics, all invariants pass, and the evaluator reproduces the Phase 0 verdicts (DECISIONS D-007).

## P0.01 Simulation foundation — Phase 1, Core
- [x] Event-sourced core (log is the source of truth)
- [x] Integer tick clock (1 tick = 1 game second) and scheduler that jumps to the next event
- [x] Per-system seeded RNG streams
- [x] Fixed-point state, stable iteration order
- [x] Save/load and event schemas with versions and migrations
- [x] Headless simulation
- [x] Debug inspectors and replay

Done when: G-01 and G-02 pass (identical log hash on two machines; RNG streams isolated).

## P0.02 Physical world — Phase 2, Core
- [x] 20-25 locations across three small provinces
- [x] Roads, terrain, rivers, crossings and travel times
- [x] Character, army and messenger positions (expeditions arrive with Phase 11)

Done when: messengers and armies move along routes with correct travel times.

## P0.03 Reality, observation and belief — Phase 2, Core
- [x] Separate WorldState and BeliefState; `ViewOf(agent)` / `ViewOf(player)` accessors
- [x] Character observations with quality by capability and conditions
- [x] Evidence and reliability bands
- [x] Contradictory and stale beliefs (lazy staleness, contradictions kept)
- [x] Belief caps and logged eviction per tier
- [x] Ruler knowledge projection
- [x] Static and runtime checks preventing UI/AI access to hidden truth

Done when: two NPCs hold conflicting beliefs about one fact, and no module reads WorldState directly.

## P0.04 Reports, messengers and orders — Phases 2 and 5, Core
- [x] Report authorship, source, time and author bias
- [x] Physical transmission and redirection
- [x] Lost, delayed and intercepted reports (interceptor gains the beliefs)
- [x] Undeliverable orders when recipient location is unknown
- [ ] Structured strategic orders with constraints, contingencies, discretion and reporting policy (schema frozen and validated in Phase 2; composed with real constraints in Phase 5)
- [x] Full order lifecycle events
- [x] Previous-order persistence and supersession on receipt

Done when: an order's lifecycle is fully visible in the inspector, including failure branches.

## P0.05 Core characters and autonomous decisions — Phase 3, Core
- [ ] Anna, Elara, Caron, Varos, Bren, Oren, Mara, Selene
- [ ] Cast sheet: role, House, objectives and traits for each (Bren, Oren, Mara, Selene roles decided 31 Oct, see IMPLEMENTATION_PLAN §G)
- [ ] Capabilities by domain, limitations, knowledge and relationships
- [ ] Wake subscription index and trigger coalescing
- [ ] Candidate actions evaluated from beliefs only, deterministic tie-break
- [ ] Intention commitment and hysteresis
- [ ] Order interpretation and obedience decision (obey / adapt / refuse)
- [ ] DecisionTrace

Done when: Elara and Caron reach different, explainable plans from the same evidence, and no agent dithers between near-equal plans.

## P0.06 Court and Map — Phase 5, Core
- [ ] Prioritised Court issues
- [ ] Adviser interpretation and disagreement, shown per adviser
- [ ] Belief-based Map
- [ ] Report age, source and uncertainty
- [ ] No exact hidden stats
- [ ] Auto-pause on reports needing a decision

Done when: H-01 passes (plan §C4): at least 4 of 5 testers explain their decisions and consequences from the information shown.

## P0.07 Personal presence — Phase 5, Core
- [ ] Ravenport, Greybridge and Northwatch travel
- [ ] Local characters and direct observations
- [ ] Capital delegation while absent (who governs, with what authority)
- [ ] Reports physically follow Anna while she travels
- [ ] Personal danger (systemic, signalled before lethal)

Done when: Anna can leave Ravenport, decisions at court continue within delegated authority, and she learns of them by report.

## P0.08 Character network and Houses — Phases 4 and 14, Core (basic) / Full
- [ ] Tier A/B/C with promotion and demotion
- [ ] 25-30 active characters
- [ ] 20-30 background characters
- [ ] Houses Varos, Veyr, Greyfen and Caron
- [ ] Recommendation and appointment chains
- [ ] Patronage, debt, rivalry and promotion to relevance

Done when: a background character promotes to a commanding role without pre-running full AI, and keeps history on demotion.

## P0.09 Population communities — Phase 6, Core
- [ ] 8-12 communities
- [ ] Relevant cohorts only
- [ ] Material condition
- [ ] Collective beliefs and competing narratives
- [ ] Rumour spread with falling fidelity
- [ ] Community memories
- [ ] Specific grievances linked to cause events, and remedies
- [ ] Trusted leaders and information sources
- [ ] Organisation and mobilisation state
- [ ] Cooperation, evasion, protest, migration, sabotage and revolt

Done when: identical policy yields different reactions in different communities.

## P0.10 Rebellion mechanics — Phase 6, Core
- [ ] No generic unrest threshold
- [ ] Hard gates: grievance, shared narrative, named/institutional leadership, trigger event
- [ ] Mobilisation score from narrative, leadership, communication network, resources and expected success
- [ ] Per-community parameters as data
- [ ] Support for competing characters or claimants
- [ ] De-escalation paths (remedy, co-opting, removing leaders, enforcement, negotiation memory)

Done when: G-13 passes: maximum grievance alone never produces revolt, and every revolt has a named leader.

## P0.11 Material economy — Phase 7, Core
- [ ] Grain, timber, iron, horses and coin
- [ ] Harvest, consumption and stores
- [ ] Taxation and requisition
- [ ] Repairs, expeditions and military supply
- [ ] House and community resource control
- [ ] Causal references across systems

Done when: G-03 to G-06 pass: the chain's end state is caused by the Blackwood threat (attributable rate 5-40%, lift >= 1.5), each named link is necessary, and at most 2 parameters are knife-edge.

## P0.12 Standing policy and precedent — Phase 9, Full
- [ ] Military policy
- [ ] Economic emergency policy
- [ ] Negotiation/punishment policy
- [ ] Institutional memory and precedent

Done when: officials act under standing policy when no immediate order covers a situation, and cite precedent in their reasons.

## P0.13 Environment — Phase 10, Full
- [ ] Seasonal cycle
- [ ] Rain, snow, mud
- [ ] River level and freeze/thaw
- [ ] Flooding and route changes
- [ ] Harvest effects
- [ ] Geological stress

Done when: weather changes routes, harvests and battle conditions through existing state, not special cases.

## P0.14 Magic — deferred to P1 (decided 31 Oct)
Removed from the prototype so Phase 10 covers environment only. Items are listed under P1.

## P0.15 Blackwood exploration — Phase 11, Full
- [ ] Rumours and partial discovery
- [ ] Military, scholarly and magical expeditions
- [ ] Senior delegate selects subordinate leader
- [ ] Stefan Veyr emergence path (thresholds defined)
- [ ] Delayed and contested reports
- [ ] No single completion state

Done when: Stefan can emerge through recommendation and performance in some seeds and not others.

## P0.16 Monster and artefact — Phase 11, Full
- [ ] Hidden ecological threat
- [ ] Livestock loss, missing persons and witness reports
- [ ] Stone of Vey actual and believed properties
- [ ] Custody, theft, capture and competing claims
- [ ] Provenance timeline

Done when: the artefact can end a run outside Anna's possession, and its provenance is reconstructable.

## P0.17 Arvenese frontier network — Phase 14, Full
- [ ] Ambassador
- [ ] Border commander
- [ ] Merchant intermediary
- [ ] Royal representative
- [ ] Conflicting motives and delayed instructions from Arven

Done when: Arvenese actors act on different, delayed instructions and can contradict each other.

## P0.18 Limited-visibility battlefield — Phases 8 and 12, Core (basic) / Full
- [ ] Battle entry from campaign contact; exit back to campaign
- [ ] Command-post-centred viewpoint
- [ ] Line-of-sight and occlusion
- [ ] Smoke, dust and weather degrading identification
- [ ] Observed / reported / inferred / stale markers with age
- [ ] Uncertain friendly status
- [ ] Command-post belief map
- [ ] Battle time pace and conversation time cost (BATTLEFIELD §2C)
- [ ] Readable formation behaviours without morale bars

Done when: H-03 passes: testers read formation behaviour and tell observed from reported markers without numbers.

## P0.19 Conversational commands — Phase 13, Full
- [ ] Typed natural-language interface
- [ ] Voice speech-to-text adapter
- [ ] Technical transcript correction (out of world, no game time)
- [ ] Multi-turn conversation state
- [ ] Commander recommendation and questions
- [ ] Read-back and summarisation
- [ ] Natural affirmation and correction
- [ ] Structured-order compilation and validation against `ViewOf(player)`
- [ ] Output validation: generated speech references only the speaker's beliefs
- [ ] Templated phrasing as permanent fallback

Done when: G-16 passes: swapping the language layer for templates leaves the event log identical.

## P0.20 Commander advice — Phases 3 and 13, Core (structured) / Full
- [ ] "What would you do?" and "Why?"
- [ ] Alternatives and contingencies
- [ ] Domain-specific expertise
- [ ] Uncertainty recognition
- [ ] Challenge bad royal ideas
- [ ] Advice from commander beliefs only
- [ ] Cached Recommendation with invalidation

Done when: G-12 passes: "follow the best adviser" beats "follow the worst adviser" by at least 10 points of objective success.

## P0.21 Physical battle communication — Phases 8 and 12, Core (basic) / Full
- [ ] Messengers and pre-agreed signals
- [ ] Delivery affected by distance and conditions
- [ ] Recipient-location uncertainty
- [ ] Subordinate propagation delay
- [ ] Order-in-transit status
- [ ] Previous-order persistence

Done when: a formation continues its old instruction while a new order travels.

## P0.22 Obedience and interpretation — Phases 3, 8, 12, Core
- [ ] Separate receipt, comprehension, willingness and execution
- [ ] Loyalty, trust and legitimacy
- [ ] Pride, stubbornness, ambition and rivalry
- [ ] House/local loyalty and ulterior motives
- [ ] Changed-circumstance initiative
- [ ] No random disobedience roll
- [ ] Trace non-receipt, misunderstanding, adaptation, disobedience and failure

Done when: Caron can knowingly disobey for traceable motives, and successful disobedience is still recorded as disobedience.

## P0.23 Commander skill and formation behaviour — Phases 8 and 12, Core (basic) / Full
- [ ] Domain experience
- [ ] Deployment, reserves and fallback planning
- [ ] Rally and retreat sequencing
- [ ] Command hierarchy, location and pre-set order of command
- [ ] Commander incapacity and local succession
- [ ] Training, discipline, fatigue, losses and cohesion
- [ ] Panic propagation and rout
- [ ] No player-facing morale percentage

Done when: two commanders following the same order produce visibly different line quality.

## P0.24 Campaign objective and ending — Phases 5 and 14, Core (death/capture) / Full
- [ ] Preserve effective royal control of Northern March (measurable definition)
- [ ] Military victory path
- [ ] Negotiated settlement path
- [ ] Coalition fracture/containment path
- [ ] Anna death defeat
- [ ] Capture/deposition defeat
- [ ] Decisive territorial/authority failure
- [ ] Conclusive epilogue
- [ ] No prototype succession or perspective transfer

Done when: G-08 and G-09 pass: at least 4 ending types in the 5-60% band, and endings are not decided by an exogenous random event alone.

## P0.25 Chronicle and emergence tests — Phases 1 and 15, Core (metrics) / Full
- [ ] Player-known timeline
- [ ] Objective reconstruction
- [ ] Decision reasons and DecisionTrace explorer
- [ ] Failure attribution (belief / choice / communication / execution)
- [ ] Community memories and grievances
- [ ] Artefact provenance
- [ ] Battlefield obedience evidence
- [ ] Cross-system causal chains
- [ ] Repeated-run diversity tests against the plan's C2 gates

Done when: every C2 gate PASSes on a sealed block of 1,000+ seeds (AMBER does not count) and H-01 to H-03 pass.

### P0 acceptance
The prototype succeeds when several runs create different, understandable histories through imperfect knowledge, human agency, population politics, environment, exploration and battle command, while always remaining Anna's campaign, and the measurable gates in `IMPLEMENTATION_PLAN.md` §C2 and §C4 pass.

# P1 - Realm Vertical Slice
- [ ] Expanded Valoria
- [ ] 40-60 consequential characters
- [ ] Deeper Houses, families and economy
- [ ] Multiple armies and sieges
- [ ] Full AI Arven Realm
- [ ] Human diplomacy and ambassadors
- [ ] Fertility, children and family continuity
- [ ] Heir designation/anointment
- [ ] Succession laws, regencies and disputed succession
- [ ] Battlefield prestige affecting succession
- [ ] Ruler perspective/knowledge transfer
- [ ] Personal unions, vassalisation, occupation and Realm continuity
- [ ] Earth and Frost magic moved from P0.14: freeze water, reinforce fortification, landslide
- [ ] Magic preparation, material and local-condition dependencies; defined whitelist of state variables; persistent side effects
- [ ] Selene as Earth/Frost court mage

# P2 - Medieval Alpha
- [ ] Multiple playable Realms
- [ ] Hundreds of tiered characters
- [ ] Expanded religions/cultures/governments
- [ ] Full ruins and expeditions
- [ ] Monster ecology and intelligent creatures
- [ ] Artefact political/cultural history
- [ ] Full living-world events
- [ ] Earth, Weather, Life and Sight magic
- [ ] Realm selection and historical ambitions

# P3 - Deferred
- [ ] Gunpowder and early-modern transition
- [ ] Industrialisation and railways
- [ ] Class/occupation economy
- [ ] Mass politics and mobilisation
- [ ] Global markets
- [ ] Advanced naval simulation
- [ ] Free-roaming Personal mode
