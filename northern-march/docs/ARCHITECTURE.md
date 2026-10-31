---
# 20. NPC Decision Architecture - Event-Driven BDI-Lite

## 20.1 Objective
Support many imperfectly informed autonomous actors without continuously running expensive cognition. Emergence comes from persistent state plus event-triggered reactions, not from every NPC thinking every tick.

Schemas referenced here (SimEvent, StructuredOrder, Recommendation, DecisionTrace, BeliefProposition) are defined in `IMPLEMENTATION_PLAN.md` section B and are the authority.

## 20.2 Agent model
Important NPCs use a lightweight Belief-Desire-Intention model:

- **Beliefs:** sparse propositions the NPC currently considers relevant and true or likely.
- **Objectives:** a small number of role, personal, political and relationship outcomes, each with a priority.
- **Intentions:** the current plan per planning layer, with a commitment strength (20.5).
- **Traits:** data-defined modifiers on how candidates are valued (vocabulary capped at 14). Traits never run separate AI loops.
- **Capabilities/experience:** domain-specific; affect what the NPC notices, how well it interprets, how many and how good its candidate plans are, and how well it executes (20.7).
- **Relationships:** trust, debt, rivalry and loyalty that modify objectives, cooperation and willingness to obey.

Target Tier A complexity: one role objective, one personal objective, one political/House objective and zero to two situational objectives.

## 20.3 Sparse knowledge
- Do not copy WorldState into characters. `BeliefStore` holds only relevant propositions.
- Planners and UI read through `ViewOf(agent)`, which exposes only that agent's BeliefStore, delivered reports, own orders and own physical surroundings.
- **Lazy staleness:** each predicate defines a half-life. On read, the effective reliability band is downgraded by age; nothing is updated per tick.
- **Contradictions are kept,** not overwritten: two propositions about the same subject/predicate coexist with their evidence until one is resolved or decays. Which one the agent acts on is a planning choice, recorded in DecisionTrace.
- **Bounded size:** each tier has a belief cap. When exceeded, evict the least relevant propositions (lowest product of reliability, recency and objective relevance). Evictions are logged, not silent.

## 20.4 Event-driven thinking
NPC planning wakes only on meaningful triggers, for example:
- order or report delivered;
- direct observation materially changes a belief;
- objective status changes;
- supply crosses a relevant threshold;
- route becomes unavailable;
- superior or subordinate becomes unavailable;
- enemy contact appears or disappears;
- local community changes cooperation;
- scheduled review for the agent's layer;
- the player asks for advice.

**Wake subscription index.** Each agent registers subscriptions as `(subject, predicate or event type, minimum significance)`, derived from its current objectives, intentions and orders. Dispatching an event looks up the index by the event's `subjects`, so cost scales with interested agents, not with population. Subscriptions are rebuilt only when intentions change.

**Coalescing.** Multiple triggers for the same agent within the same tick are batched into one wake.

**Significance to layer.** An event's `significance` sets the highest planning layer it may wake: 0 immediate, 1 tactical, 2 operational, 3 strategic.

## 20.5 Hierarchical planning and commitment
```text
Strategic/role objective
  -> current operational plan
     -> standing tactical intent
        -> immediate action
```
- A lower-level change does not trigger higher-level replanning unless the lower layer reports that its parent intention is no longer achievable.
- **Repair before replan:** first try to keep the current intention by changing the step that broke (alternate route, different subordinate).
- **Commitment and hysteresis:** a new candidate replaces the current intention only if it beats it by a margin scaled by commitment. Traits adjust it (stubborn and patient raise it; aggressive and ambitious lower it). This prevents dithering between near-equal plans.
- **Scheduled reviews:** strategic rarely (for example weekly game time), operational on significant reports or daily, tactical continuously in battle only while the agent is engaged.

## 20.6 Candidate generation and evaluation
- **Generation:** candidates come from action templates filtered by role, location, authority, orders in force and available resources. Cap the set (for example 4-8). Better planners generate more and better-formed candidates, including contingencies.
- **Scoring:** `score = Σ weight_k × term_k` in fixed-point, where terms cover order compliance, objective progress as perceived, risk as perceived, trait modifiers, relationship effects, resource cost and precedent.
- **Tie-break:** stable action ID. No randomness in selection; randomness lives only in world outcomes.
- **Output:** the selected action plus each term's contribution, which become the `Reason` objects in Recommendation and DecisionTrace.
- Everything evaluated uses the agent's beliefs and perceived consequences, never true ones.

## 20.7 Capability and experience
Skill acts at four points, per domain (cavalry, siege, logistics, diplomacy, magic, scouting, administration):
- **Observation:** what evidence the agent notices from the same scene.
- **Interpretation:** how accurately it assigns reliability; low skill tends to treat "probable" as "certain" (overconfidence), high skill flags what it does not know.
- **Planning:** number and quality of candidates, contingency planning, awareness of logistics and terrain.
- **Execution:** quality of the resulting local plan and outcome variance.

Experience grows from relevant events and outcomes. A brilliant cavalry commander need not understand magic or sieges.

## 20.8 Order interpretation and obedience
Receipt, comprehension, willingness and execution are separate steps (lifecycle in plan §B2).

1. **Interpretation:** comprehension depends on order clarity (constraints, contingencies, discretion stated) and the recipient's capability. Ambiguity resolves toward the recipient's own beliefs and preferences, and is recorded.
2. **Willingness:** the recipient scores "obey as understood" against its best alternative. It adapts or refuses only if the alternative wins by a margin set by loyalty, trust in the issuer, perceived legitimacy, discretion granted and traits (proud, stubborn, ambitious, loyal). Changed circumstances lower the margin needed for adaptation, not for refusal.
3. **Decision:** `obey | adapt | refuse`, with Reasons. No random disobedience roll; same state gives the same decision.
4. **Execution:** local plan built with the recipient's own skill. Successful disobedience is still recorded as disobedience.

## 20.9 Simulation tiers
### Tier A - Active decision-makers
Full model. About 10-30 relevant characters, few planning at the same instant.

### Tier B - Locally relevant NPCs
Sparse beliefs, fewer objectives, lightweight event-driven planning.

### Tier C - Background NPCs
Identity, household/family, occupation, location, minimal relationships and traits. No planning.

**Promotion** when given independent responsibility, recommended for a post, becoming politically or militarily important, or implicated in a significant event. **Demotion** when the role ends and no subscriptions fire for a configured period; memories, relationships and reputation are kept, plans are dropped.

Each tier has a wake budget per sim day (set in Phase 4 from measured costs). Exceeding it is a test failure, not a silent slowdown.

Population communities are aggregated collective agents with the same belief/objective machinery at community scale.

## 20.10 Battlefield scale
Do not simulate soldiers cognitively. Use the overall commander, wing/sector commanders, formation officers where materially relevant, and aggregated formations. Formation response uses deterministic morale, discipline and cohesion models plus officer influence.

## 20.11 Natural-language boundary
Language technology is never authoritative game AI.

```text
Simulation planner -> Recommendation (structured) -> language layer -> character speech
Player speech -> transcription -> intent parser -> draft StructuredOrder -> validation -> simulation
```

- **Inputs** to the language layer are limited to `ViewOf(speaker)` and the Recommendation being voiced. It never sees hidden WorldState.
- **Output validation:** every entity, place, number or claim in generated speech must resolve to a belief or Reason the speaker holds. Unresolvable content is rejected and the templated phrasing is used instead.
- **Parsed orders** are validated against the StructuredOrder schema and against `ViewOf(player)`: the player can only order action on things Anna knows about. Unresolved references produce a technical clarification, not an in-world one.
- **Determinism:** transcripts and generated text are stored as side data for debugging. Only the validated structured events enter the event log.
- Never ask a language model what Caron does. The planner decides; language expresses.

## 20.12 Cached explanations
Recommendations store structured reasons. "Why?", "What worries you?" and "How sure are you?" are answered from the cached Recommendation until `validUntilEvent` fires; then the planner reruns for that agent only.

## 20.13 Performance invariants
- No full-world knowledge copy per NPC.
- No per-tick strategic planning for inactive NPCs.
- No individual-soldier cognition.
- No LLM call required to advance simulation time.
- No objective with dozens of competing motivations.
- Promotion and demotion supported.
- Expensive planning only on events or scheduled reviews.
- Wake budgets per tier enforced by tests.

## 20.14 Debug requirement
Every consequential Tier A choice records a DecisionTrace: trigger, beliefs consulted with age and reliability, active objectives, orders in force, candidates with score contributions, selected action, whether the current intention was kept, and later the failure origin (belief, choice, communication or execution).

**Retention:** full traces for Tier A and for any decision referenced by a later consequential event; compressed (selected action, trigger, top reasons) for Tier B; none for Tier C. Traces live in the event log so replay reproduces them.
