# Battlefield Command Design

## Purpose
Define the battlefield experience: real-time, limited-visibility command where the ruler gives natural-language orders to human commanders, and those orders travel through an imperfect chain of command.

Order lifecycle and schemas: `IMPLEMENTATION_PLAN.md` §B2-B4. Obedience model: `ARCHITECTURE.md` §20.8.

## Core fantasy
You are not dragging units. You are standing somewhere on a battlefield, seeing only what can be seen, asking experienced people what they think, deciding what you want, and waiting to discover what your army actually does with those instructions.

## 1. Information
Four distinct categories:
- **Observed:** physically visible from the ruler's position now.
- **Reported:** communicated by scout, messenger, signal or subordinate.
- **Inferred:** interpretation by ruler, staff or a general.
- **Unknown:** not currently known.

Never silently promote Reported or Inferred information to truth. Observed information becomes Reported-by-Anna (with age) once out of sight. Friendly formations can also become uncertain when out of sight or contact.

## 2. Battlefield perspective
The main view is anchored to the ruler's command position. The ruler may move, including forward for better observation, with corresponding risk and communication consequences.

Terrain, ridges, woods, buildings, darkness, weather, smoke and dust block or degrade perception. The command-post map shows headquarters' current belief, including stale and disputed reports.

## 2A. Prototype ruler stakes
Queen Anna is the only playable ruler. If she is killed, the campaign ends. Capture also ends it. There is no succession or perspective transfer in the prototype.

Command position is a direct risk/reward decision:
- farther back: safer, less visibility, slower communication;
- forward: better observation and conversational access, higher chance of campaign-ending injury, death or capture.

**Risk is systemic, not a hidden death roll.** Anna is exposed only through simulated threats: enemy missiles in range, enemy cavalry reaching the command post, a nearby formation breaking, or fighting reaching her position. Her bodyguard is a formation with its own state.

**Danger is always signalled before it is lethal:** arrows falling nearby, aides urging withdrawal, the guard captain forming up, a nearby line wavering. Outcome resolution uses the battle RNG stream only once a real threat is in contact.

## 2B. Battle start
- A battle begins from campaign contact: hostile forces within engagement range and at least one side choosing to engage (or unable to avoid it).
- Forces, commanders, standing orders, supply state, fatigue and weather carry over from the campaign.
- Anna is present only if she is physically with the army. If she is absent, the battle runs under her standing orders and her senior commander's judgement, and she learns the outcome by report.
- A pre-battle phase exists only if time and distance allow it (one side may be surprised).

## 2C. Time and pace (proposed default, needs playtest)
- Battle uses the shared clock (1 tick = 1 game second) at a slower default speed, adjustable and pausable.
- **Conversation consumes game time per exchange, not per real second.** Each question/answer exchange with a commander physically present costs a fixed amount of game time (for example 20-40 seconds); a read-back and affirmation costs a smaller amount. The simulation is paused while the player types or speaks.
- This keeps typing, voice and reading speed out of the outcome: "the player never wins by clicking faster" applies to talking faster too.
- Messages to distant commanders cost no conversation time but take physical travel time.
- Pausing never reveals information; it only stops the clock.

## 3. Pre-battle planning
The ruler talks with active generals while reviewing visible terrain and reports.

> Player: Put Caron's infantry on the ridge, archers behind them, and keep Veyr's cavalry hidden behind the woods.
>
> Elara: That leaves the village crossing lightly held. I would put another infantry formation there.
>
> Player: How likely are they to use it?
>
> Elara: If I were Varos, that is where I would try.
>
> Player: Fine. One formation there, but no more.
>
> Elara: Ridge to the woods, archers behind, Veyr concealed on the right, one formation at the village, remaining cavalry here in reserve?
>
> Player: Yes.

The final affirmation creates the structured plan: one StructuredOrder per recipient, with constraints, contingencies, discretion and reporting policy.

## 4. Natural conversation
No required Clarify button or fixed dialogue tree. Players can speak or type naturally:
- What would you do? / Why? / What else could we do?
- How sure are you? / What worries you? / What happens if Caron fails?
- No, that's not what I mean.
- Hold the cavalry.
- Yes. / Agreed. / Do so. / Proceed.

Commanders ask their own follow-up questions where required. Everything they say comes from their own beliefs and cached Recommendation.

## 5. Technical versus in-world misunderstanding
### Technical recognition failure
Speech-to-text mistranscribes or a name cannot be resolved. The transcript is shown and editable; low-confidence parses get an out-of-world prompt ("Did you mean Grey Hill?"). No game consequence and no game time.

### Conversational ambiguity
The commander genuinely does not know what the ruler means and asks. This is in-world and costs conversation time.

### Execution interpretation
The commander understood the order but later decides what it means under changing conditions. This is gameplay.

## 6. Advice quality
The player can always ask a commander to propose the plan first.

Better commanders tend to:
- notice more relevant evidence;
- know what they do not know;
- identify causes rather than visible symptoms;
- propose better alternatives and contingencies;
- recognise logistics and terrain implications;
- defer to specialists where appropriate;
- challenge poor royal ideas.

Worse commanders can:
- miss important facts;
- be overconfident;
- oversimplify plans;
- react impulsively;
- recommend what suits their preferences rather than the situation.

Advice is domain-specific. A brilliant cavalry commander need not understand magic or sieges.

## 7. Command disagreement
> Player: Attack across the Vey tonight.
>
> Elara: I strongly advise against it. We have not found Varos's second force and the river is rising.
>
> Player: I know. Attack anyway.
>
> Elara: Then give me until midnight to establish another crossing.

The ruler remains free to insist. Objections are recorded and become part of the history, and of the commander's later trust in the ruler if events prove them right.

## 8. Orders during battle
Formations always have a current instruction until superseded:
- hold the ridge;
- give ground rather than break formation;
- remain concealed;
- protect the archers;
- do not pursue beyond the stream;
- attack if enemy cavalry commits;
- withdraw to Grey Hill if the flank collapses.

The player does not need to reissue commands. Conditional instructions ("if…then") are evaluated against the recipient's beliefs, not reality: a commander who wrongly believes the flank has collapsed will withdraw.

## 9. Communication delay
Orders travel physically. A spoken order has no effect until received.

Sequence:
1. ruler/general formulates the order;
2. player affirms it;
3. messenger or signal is dispatched;
4. recipient receives it;
5. recipient interprets it;
6. recipient decides how faithfully to follow it;
7. local plan is formed;
8. subordinate orders propagate;
9. formations attempt execution.

Distance, terrain, visibility, weather, combat and uncertainty about the commander's position affect delivery. Messengers can be killed, captured or sent to where the commander was rather than where they are. Meanwhile formations continue their previous instructions.

## 9A. Signals
- Flags, horns and drums are fast but carry only **pre-agreed meanings** set before battle (for example "advance", "hold", "withdraw to the fallback position", "reserve commit").
- A signal can be missed in smoke, noise or poor light, and can be seen by the enemy.
- Anything not pre-agreed needs a messenger.
- Agreeing signals is part of pre-battle planning.

## 10. Human friction and obedience
Receipt does not mean obedience. A commander may intentionally alter or ignore an understood order because of:
- stubbornness or pride;
- ambition or rivalry;
- aggression or excessive caution;
- low trust in the ruler;
- loyalty to House or local community;
- personal political goals;
- hatred of an enemy;
- fear or self-preservation;
- belief that circumstances make the order disastrous.

This is always a reasoned, traceable decision, never a random disobedience roll. Disobedience may save the army or destroy it.

## 11. Execution skill
Obedience and competence are separate:
- loyal + capable;
- loyal + incapable;
- disobedient + brilliant;
- disobedient + incompetent.

Two generals can both follow "hold the ridge" while one builds reserves, fallback positions and messenger relays and the other produces a brittle line with no contingency.

## 12. Command radius and hierarchy
No magical command aura. Influence propagates via:
- physical presence;
- banners;
- messengers and signals;
- subordinate officers;
- prior planning;
- standing instructions;
- troop familiarity with a commander.

A general influences nearby and connected formations more directly than remote ones.

## 13. Troops and formation behaviour
Formation performance depends on training, discipline, combat experience, fatigue, casualties, supply and physical condition, terrain, flank security, what neighbouring units appear to be doing, local officer competence, higher-command coherence and the current understood task.

No player-facing morale bars. The player sees behaviours:
- in good order;
- yielding ground;
- becoming disorganised;
- officers rallying men;
- withdrawing in order;
- uncontrolled retreat;
- rout;
- pursuing (D-063): men who see the enemy break run after them out of formation, unless discipline, a commander close by or an order to keep their ground holds them. A limit ("do not pursue beyond the stream") stops them at the line. Pursuers are out of formation: they take harm as if disorganised, tire faster, leave a gap and are harder for runners to find.

Each behaviour has a distinct visual and audio signature so it can be read without numbers. Every state but good order also carries its word on the unit, taken from headquarters' belief and drawn as observed or reported like the unit itself (D-063). How units seen breaking are made to stand out (no flash, a light pink flash, or a pale flash of their own colour) is decided by the Phase 8 test (H-03).

## 14. Panic and misunderstanding
Troops observe other troops, not objective state. An ordered withdrawal may look like a rout to a neighbouring formation. A poor command chain can turn it into a real rout; a capable nearby commander can stabilise it. Pre-agreed signals for planned withdrawals reduce this risk.

## 15. Generals as physical actors
General location matters. A commander riding with one part of the line communicates and rallies there better but is unavailable elsewhere.

If a general is killed, wounded or cut off:
- nearby units may notice first;
- local succession follows the pre-set order of command, or is unclear if none was set;
- headquarters may learn only later;
- different formations may briefly follow inconsistent instructions.

## 16. Limited-visibility UI
### Main view
Only physically visible battlefield reality.

### Command map
Believed locations, reports and plans, each marked observed, reported, inferred or stale, with age.

### Command network
Current instructions per formation as headquarters believes them, last contact time, messenger/order status (dispatched, presumed delivered, confirmed received, unknown) and hierarchy.

The UI never shows exact enemy counts, morale, casualties or hidden locations.

## 17. Reports
Reports show provenance and age:

> Enemy cavalry reported beyond East Ridge.
> Source: Captain Maret.
> Received: 8 minutes ago.
> Current location unknown.

Friendly reports are also imperfect, and shaped by the author's traits (a proud commander under-reports trouble).

## 18. Unknown reasons
The ruler should not immediately know why a unit moved unexpectedly. Possible explanations:
- order never arrived;
- commander misunderstood;
- deliberate disobedience;
- local tactical adaptation;
- subordinate disobedience;
- forced movement;
- incorrect headquarters information.

The truth may emerge during the battle, in the debrief (§22), or never.

## 19. Delegation within battle
> Elara, take the right. Hold the woods and keep the road open. Use Veyr as you think best.

Elara generates and transmits subordinate orders by her own judgement and knowledge. The player can focus elsewhere until she reports, requests a decision, or conditions demand intervention.

**Reporting policy** is part of every order (default set by the commander's traits, overridable by the ruler): report on contact, on significant losses, when a contingency triggers, when the objective is achieved or abandoned, and at least every N minutes. Honest commanders report bad news promptly; proud or ambitious ones may delay it.

## 20. Political consequences
Battlefield behaviour persists outside battle:
- a successful disobedient commander becomes a popular hero;
- punishment may restore discipline but anger soldiers or communities;
- rewarding disobedience may encourage future initiative or indiscipline;
- troops may become personally loyal to a successful commander;
- a defended town remembers who saved it;
- a looted community remembers whose troops were responsible;
- battlefield prestige affects a commander's influence, House standing and support in a rebellion. (Effects on succession are P1, since the prototype has none.)

## 21. Design objective
Battlefield skill comes from:
- choosing capable people;
- understanding their limitations and motives;
- creating a sound plan, with agreed signals and fallback positions;
- asking good questions;
- placing commanders and the ruler appropriately;
- issuing clear intent;
- recognising when information is stale;
- allowing time for commands to propagate;
- knowing when to intervene and when not to.

The player never wins by clicking, typing or talking faster than the AI.

## 22. Battle end and aftermath
**Ends when** one side withdraws or routs, nightfall or weather stops fighting, or one side leaves the battle area. Either side may break off; pursuit is a decision under standing orders ("do not pursue beyond the stream").

**Aftermath feeds the campaign:**
- losses, prisoners and wounded commanders, reported imperfectly and revised as reports arrive;
- formations' fatigue, cohesion and experience;
- commander prestige, trust in the ruler, and recorded obedience/disobedience;
- community memories of protection or looting;
- enemy beliefs about Anna's army.

**Debrief:** commanders report what they believe happened, in their own words and biases. Contradictions between reports are visible. The objective reconstruction is available only in the chronicle at the end of the run (or in debug).

## 23. Prototype scale
- Phase 8 slice: one battlefield area, about 6 formations a side, 3 friendly commanders, Anna and her guard.
- Phase 12: up to about 15 formations a side, wing and sector commanders, full signal and messenger system.
- No individual soldiers; formations are aggregated.

## 24. Decided defaults (31 Oct)
1. **Conversation cost:** 30 game seconds per question-and-answer exchange, 15 for read-back and affirmation, 0 for technical corrections. Commanders press after about 5 exchanges. Tune in playtest.
2. **Delegating command:** Anna may hand overall command to a commander and watch from the command post. Her visible presence gives a small morale effect whoever commands. Taking command back is an order that must travel.
3. **Signals:** six slots per army. Four are standard (advance, hold, withdraw to fallback, commit reserve); two are custom, agreed before battle. Range depends on line of sight, smoke and noise.
4. **Night battles:** excluded from the prototype. Battles end at nightfall; night movement and surprise attacks happen on the campaign map only. Revisit in Phase 12.
