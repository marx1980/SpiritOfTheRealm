# Glossary

| Term | Meaning |
|---|---|
| **WorldState** | Objective truth; a projection of the event log. Never read by UI or planners. |
| **Event log** | Append-only list of SimEvents; the single source of truth. |
| **Tick** | Integer game time unit; 1 tick = 1 game second. |
| **ViewOf(agent / player)** | The only way UI and planners see the world: own beliefs, delivered reports, own orders and physical surroundings. |
| **BeliefStore** | Sparse set of BeliefPropositions held by one character or community. |
| **BeliefProposition** | A believed value about a subject/predicate, with evidence, time learned and reliability band. |
| **Reliability band** | certain / probable / uncertain / doubtful; downgraded lazily by age. |
| **Report** | Authored, timed message carrying claims; travels physically and can be lost or intercepted. |
| **Rumour** | Unauthored claim spreading through communities with falling fidelity. |
| **Observed / Reported / Inferred / Unknown** | The four information categories shown to the player, especially in battle. |
| **StructuredOrder** | The validated, machine-readable order produced after the player affirms. |
| **Order lifecycle** | Issued → dispatched → received → interpreted → obey/adapt/refuse → local plan → subordinate orders → execution. |
| **Discretion** | strict / bounded / delegated: how much freedom the recipient is given. |
| **Reporting policy** | When the recipient of an order must report back. |
| **Standing order / policy** | Instruction that stays in force until superseded. |
| **Recommendation** | A character's structured advice: plan, reasons, uncertainties, alternatives, contingencies. |
| **Reason** | One weighted contribution to a decision, used for "why?" answers. |
| **DecisionTrace** | Record of a consequential decision: trigger, beliefs, objectives, orders, candidates, choice, later failure origin. |
| **Failure origin** | belief / choice / communication / execution: why a bad outcome happened. |
| **BDI-lite** | Belief-Desire-Intention agent model, kept small and event-driven. |
| **Planning layers** | strategic / operational / tactical / immediate. |
| **Significance** | 0-3 on each event; the highest planning layer it may wake. |
| **Wake subscription index** | Lookup from event subjects to interested agents, so only they wake. |
| **Commitment / hysteresis** | Margin a new plan must beat the current one by before the agent switches. |
| **Tier A / B / C** | Active decision-makers / locally relevant / background characters. |
| **Promotion / demotion** | Moving a character between tiers as relevance changes. |
| **Community** | Aggregated collective agent (village, town quarter, guild) with beliefs, memories and grievances. |
| **Cohort** | Relevant sub-group within a community (farmers, timber workers, soldiers' families). |
| **Grievance** | Specific complaint linked to a cause event or policy, with a possible remedy. |
| **Mobilisation score** | Rebellion potential, active only after hard gates are met. |
| **BattleReality / BattleBeliefs** | True battle state versus what each headquarters and commander believes. |
| **Formation** | Aggregated body of troops; no individual soldiers are simulated. |
| **Signal** | Flag, horn or drum carrying only pre-agreed meanings. |
| **Ablation switch** | Config flag disabling one system for diagnosis. |
| **Gate** | Pass/fail checkpoint that must be met before the next phases start. |
| **P0-Core / P0-Full** | Phases 0-8 / Phases 9-15 of the prototype. |
| **Chronicle** | End-of-run history: player-known timeline plus objective reconstruction. |
| **Ablation arm (paired)** | A run with one system switched off, using the same seeds and RNG streams as the ON arm, so differences measure that system's effect. |
| **Attributable rate** | R_on - R_off for an end state: the share of seeds where the end state occurs because of the ablated system. |
| **Lift** | R_on / R_off for an end state. A gate requires it to be clearly above 1. |
| **Labelled chain rate** | Share of seeds where an end state's causal ancestry runs back to a root event. Reported, not gated: it can be high without the root causing anything. |
| **TUNE / GATE seeds** | TUNE seeds 1-9,999 are free to use. GATE blocks (10,000-10,999, 20,000-20,999, ...) give one verdict per calibration. |
| **Sealed seed block** | A GATE block never used for tuning; the first evaluation on it is the verdict. |
| **PASS / AMBER / FAIL** | PASS: 95% interval inside the band. AMBER: point estimate inside, interval crosses an edge (one extension, then FAIL). FAIL: point estimate outside. |
| **Knife-edge parameter** | A parameter whose +/-25% change drives the headline metric to 0 or above twice the band's upper edge. |
| **Gate IDs (G-nn, H-nn)** | Automated gates (plan §C2) and human gates (plan §C4). |
| **Seat** | Where a character normally resides (`character.seat`, never decays). Messengers go to the last known whereabouts while that belief is alive, otherwise to the seat. |
| **Lazy staleness** | A belief's band drops one step per half-life of its predicate, computed when read; nothing is updated per tick. Four half-lives: stale (hidden from views). |
| **Resolution (beliefs)** | Contradictory propositions coexist, except: a first-hand observation at probable or better replaces other values, and a source's newer account replaces its own older one. |
| **Interception point** | A place where someone's agents may seize passing messengers. The papers are carried to that person, who learns their contents and who wrote to whom; the intended recipient learns nothing. |
| **Redirect** | A messenger who misses the recipient follows word left with locals of where they went (up to a limit). Without such word, or after a secret departure, the message is undeliverable. |
| **Scripted event** | `TravelScripted` / `OrderScripted`: test and scenario hooks. Allowed in tests; a gated chain containing one fails the anti-script check (plan C0.7). |
| **Material belief change** | A belief update that crosses a band of the predicate's `materialDelta` (or changes a non-numeric value, or is new). Only material changes to an agent's own beliefs wake it. |
| **Wake / review** | A wake runs an agent's planning on triggers (coalesced per tick). A review is a daily wake that happens only while the agent pursues a live intention (marching, deployed, sortie pending). |
| **Focus** | The objective an agent's strategic layer attends to (re-chosen on significance-3 wakes); its terms weigh 25% more. |
| **Answer rate** | How often an agent's requests to someone have been answered, learned from its own experience; it sets how much the agent expects from asking. |
| **Surprise / regret** | Chronicle tests for a bad decision outcome: more than 10 points worse than the decider expected, or with the truth another option was more than 10 points better. |
| **Luck adjustment** | Storm damage beyond its climatic expectation is not counted against a decision when judging surprise. |
| **Council at court** | Characters reporting to the ruler and present with her; dispatches delivered to her are read out to them (`ReportShared`). |
