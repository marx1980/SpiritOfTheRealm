# Medieval Realm Game - Design & Simulation Pipeline

## Purpose
Define how reality becomes perception, decisions, orders, autonomous action and consequences without continuous heavyweight NPC cognition.

Schemas are defined in `IMPLEMENTATION_PLAN.md` section B. Agent internals are in `ARCHITECTURE.md` §20.

# 0. Time model
- One clock: **1 tick = 1 game second**, integer.
- The scheduler jumps to the next scheduled event, so quiet campaign periods cost nothing.
- **Campaign mode:** player chooses speed (paused, slow, normal, fast). Time auto-pauses when a report needing Anna's decision arrives or an adviser requests audience.
- **Battle mode:** same clock, slower default speed. How conversation consumes game time is specified in `BATTLEFIELD.md` §2C.
- All player inputs are recorded with the tick at which they take effect, so replays are exact.

# 1. World pipeline

```text
OBJECTIVE WORLD STATE (projection of the event log)
        ↓
EVENT OCCURS (with causedBy references)
        ↓
WHO CAN OBSERVE / EXPERIENCE IT?   (position, line of sight, cohort membership)
        ↓
OBSERVATIONS (quality set by observer capability and conditions)
        ↓
SPARSE BELIEF UPDATES
        ↓
REPORTS / RUMOURS / DIRECT EXPERIENCE
        ↓
PHYSICAL OR SOCIAL TRANSMISSION   ──► lost / delayed / intercepted
        ↓
OTHER CHARACTERS / COMMUNITIES UPDATE BELIEFS
        ↓
WAKE SUBSCRIPTION INDEX → ONLY IMPLICATED AGENTS WAKE
        ↓
OBJECTIVES + ORDERS + TRAITS + RELATIONSHIPS + SKILLS
        ↓
SMALL SET OF CONTEXTUAL CANDIDATE ACTIONS
        ↓
PLAN / ADVICE / ACTION   (DecisionTrace written)
        ↓
EXECUTION THROUGH PEOPLE AND PHYSICAL SYSTEMS
        ↓
NEW WORLD EVENTS (causedBy → the decision and its trigger)
        ↓
MEMORY / REPUTATION / GRIEVANCE / RESOURCE EFFECTS
        ↓
LOOP
```

The player and all planners consume `ViewOf(...)`, never WorldState.

# 2. NPC cognition pipeline

```text
Trigger(s) for this agent, coalesced per tick
  ↓
Update relevant beliefs (lazy staleness applied on read)
  ↓
Is the current intention still viable?
  ├─ yes, and no candidate beats it by the commitment margin → continue plan
  ├─ step broken → repair the step (alternate route, different subordinate)
  └─ no / major opportunity → replan the lowest layer that can absorb it
                         ↓
                  Generate a few candidates (role/context templates)
                         ↓
                  Evaluate through beliefs, orders, objectives, traits,
                  relationships, skills, resources, precedent
                         ↓
                  Select intention/action (deterministic tie-break)
                         ↓
                  Store DecisionTrace, refresh subscriptions
                         ↓
                  Execute / communicate
                         ↓
                  Return to dormant/current plan
```

# 3. Planning layers

| Layer | Examples | Replans when |
|---|---|---|
| Strategic | preserve Northwatch; weaken Varos; protect House interests | major political/military change (significance 3); rare scheduled review |
| Operational | hold Grey Hill until Elara arrives; keep the grain road open | significant reports, route/supply changes, daily review |
| Tactical | hold the ridge; keep cavalry concealed; withdraw if the flank collapses | in battle, on observations/events that justify it |
| Immediate | move, send messenger, rally formation, issue subordinate order | every action step |

A lower layer escalates to its parent only when the parent intention becomes unachievable.

# 4. Information pipeline
Every piece of knowledge is traceable:

```text
Fact in reality
 -> observer (who could perceive it)
 -> observation quality (capability, distance, light, weather, smoke)
 -> observer interpretation (may be wrong; reliability band assigned)
 -> report or rumour
 -> sender bias / omission (honest, proud, ambitious authors differ)
 -> transmission (carrier, route, delay; may be lost or intercepted)
 -> recipient interpretation (trust in the source adjusts reliability)
 -> belief (contradictions kept, not overwritten)
```

- **Interception:** the interceptor gains the report's claims as beliefs, plus the knowledge that the sender intended them for the recipient. The intended recipient learns nothing, and the sender may not know.
- **Rumours** pass through community networks with falling fidelity and no reliable author; they may still be acted on.
- **Report age and source** are always shown to the player. Wrong beliefs are first-class state, not temporary UI fog.

# 5. Player knowledge pipeline
```text
Anna's own observations (only where she physically is)
 + reports delivered to Anna
 + what advisers say in Court (their beliefs, filtered by their honesty and bias)
 = ViewOf(player)
```
- The Map, Court issues and command map are all built from `ViewOf(player)`.
- When Anna travels, Court reports must physically follow her; the regent/council at Ravenport decides within the authority she left them (open decision: plan G3).

# 6. Ruler-command pipeline

```text
Player speaks/types
  ↓
Transcription / normalisation
  ├─ technical uncertainty (unclear words, unresolved names)
  │     → out-of-world correction prompt, no game consequence, no game time
  ↓
Intent draft (structured fields)
  ↕
Adviser/general, from own beliefs: questions, recommends, challenges
  │     (in-world conversation; consumes game time, see BATTLEFIELD §2C)
  ↓
Character reads back the understood instruction
  ↓
Player affirms ("Yes", "Agreed", "Do so") or corrects ("No, I mean…" → back to intent draft)
  ↓
StructuredOrder created, validated against ViewOf(player)
  ↓
Dispatched physically if the recipient is not present
  ├─ lost / intercepted / undeliverable (recipient location unknown)
  ↓
Received → interpreted → obey / adapt / refuse
  ↓
Local plan built with the recipient's skill
  ↓
Subordinate orders propagate (same pipeline, one level down)
  ↓
Execution; reports flow back per the order's reportingPolicy
```

A new order supersedes old ones only when received. Until then the previous order stays in force.

# 7. Advice pipeline
When Anna asks "What would you do?":

```text
Question
 -> adviser's ViewOf
 -> domain expertise selects relevant evidence (low skill misses some)
 -> planner generates candidate plans
 -> evaluates risks and contingencies as the adviser perceives them
 -> Recommendation (plan + reasons + uncertainties + alternatives)
 -> language layer, or templated phrasing, in character voice
```
"Why?", "How sure are you?" and "What worries you?" reuse the cached Recommendation until a consulted belief materially changes.

Advisers can disagree. The Court shows each adviser's recommendation separately; the player is never shown a merged "correct" answer.

# 8. Population-community pipeline

```text
Material/political event
 -> affected community/cohort experiences it or hears about it (rumour)
 -> community belief update
 -> memory and/or specific grievance (linked to cause event)
 -> local narratives compete (whom do they blame?)
 -> cooperation/support changes (taxes, supplies, intelligence, levies)
 -> mobilisation score and hard gates (plan section D)
 -> collective behaviour: cooperate / evade / protest / migrate / sabotage / revolt
 -> new events (causedBy → grievance and trigger)
```

Rebellion is an emergent mobilisation state behind hard gates (grievance, narrative, named leadership, trigger), never an unrest threshold.

# 9. Battle pipeline

```text
Campaign contact (armies within engagement range, both or one side willing)
 -> battle entry: terrain area, forces, commanders, standing orders carried over
 -> BattleReality
 -> line-of-sight observation / messenger reports / signals
 -> headquarters and each commander hold different BattleBeliefs
 -> standing tactical orders continue
 -> player and generals converse when in contact
 -> order transmitted physically
 -> receipt → interpretation → obedience/adaptation → local plan
 -> subordinate propagation
 -> aggregated formations execute
 -> morale/cohesion effects
 -> observed/reported consequences
 -> battle exit: withdrawal, rout, nightfall, weather, or one side leaves the area
 -> campaign state updated: losses (reported imperfectly), prisoners, wounded commanders,
    prestige, community memory of protection or looting
```

# 10. Natural-language boundary
Language systems may:
- transcribe voice;
- parse player intent into structured fields;
- phrase structured advice, reports and dialogue;
- answer follow-ups from cached structured reasons.

Language systems must not:
- read hidden WorldState on behalf of characters;
- decide authoritative simulation results;
- invent facts, forces, relationships or orders (output is validated against the speaker's beliefs);
- replace deterministic, event-driven planning;
- appear in the event log except as validated structured events.

# 11. Chronicle pipeline
```text
Event log + DecisionTraces
 -> player-known timeline (only what Anna learned, when she learned it)
 -> objective reconstruction (what really happened; unlocked at the end, or in debug)
 -> failure attribution for bad outcomes:
      belief        (acted on wrong/stale information)
      choice        (right information, poor or self-interested decision)
      communication (order lost, late, intercepted or misunderstood)
      execution     (sound plan, poorly carried out or overwhelmed)
 -> causal chains across systems (via causedBy)
```

# 12. Performance pipeline
At an event:
1. update only the affected domain state;
2. identify observers and affected communities;
3. update only relevant beliefs;
4. look up the wake subscription index; coalesce triggers per agent;
5. use simulation tier to select planning depth;
6. write actions/events back to the scheduler;
7. return agents to dormant/current-plan state;
8. count wakes against per-tier budgets.

This is the core mechanism that makes emergence computationally feasible.
