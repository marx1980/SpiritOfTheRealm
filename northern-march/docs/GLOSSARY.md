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
