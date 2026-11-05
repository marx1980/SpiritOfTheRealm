# Northern March Interaction Prototype

## Core rules
- Simulation is UI-independent.
- Objective reality and agent beliefs are separate.
- AI acts from beliefs, not WorldState.
- Information and orders travel physically.
- Decisions are deterministic/reconstructable under the same seed.
- Natural language parses/expresses structured state; it never owns simulation truth.

## Event-driven BDI-lite NPCs
Each relevant NPC has sparse beliefs, a few objectives, a current intention, traits, capabilities/experience, and relationships. NPCs wake on meaningful events rather than thinking every tick.

### Planning layers
Strategic objective -> operational plan -> tactical intent -> immediate action. Low-level events should not trigger high-level replanning unless materially relevant.

### Tiers
- Tier A: full active reasoning for rulers, advisers, commanders and major actors.
- Tier B: lightweight local reasoning.
- Tier C: background identity promoted when relevant.

## Population communities
Collective political NPCs have cohorts, material condition, sparse beliefs, memories, grievances, organisations and mobilisation potential. They are not hive minds and do not know hidden truth.

## Rebellion
Requires grievance, shared narrative, leadership, organisation, resources, confidence and a trigger. No unrest-threshold spawning.

## Battlefield
Separate BattleReality, BattleObservation, BattleBeliefState, BattleReport and BattlePlayerProjection. Orders pass through draft, affirmation, transmission, receipt, interpretation, obedience/adaptation and execution. Formation-level simulation replaces individual-soldier cognition.

## LLM boundary
Simulation planner produces structured recommendations/reasons. Language layer turns these into speech. Player speech is transcribed and parsed into structured intent. The game must run with language generation disabled.
