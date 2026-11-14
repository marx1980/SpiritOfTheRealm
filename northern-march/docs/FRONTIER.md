# The frontier (Phase 14B, stage 1)

Plan: backlog P0.17 "Arvenese actors act on different, delayed instructions and can contradict each other"; pressure `frontier` in `CONTENT.md`. This stage builds the court, the four actors, the instructions and what a strike does. The treaty Anna can accept, and the victory over a host, are stage 2 (they end the campaign, so they come with the endings).

## 1. Who and where
Content, not code (`scenario.frontier`, optional: without it nothing here runs and old tests are unchanged).
- The court of Arven is not a character. It sits offstage at `arven_market`, reads the March from its informants, and sends instructions.
- Four actors, all tier C (the frontier system moves them, the agents system does not wake them):
  - **ambassador** (Halvard Korsk), at Ravenport: speaks for the court to the crown. Acts on `settle`.
  - **border commander** (Ingrid Voss), at the Arven Gate (a post across the eastern border): holds the host. Acts on `strike`.
  - **merchant intermediary** (Dagny Orlek), at `arven_market`: trades across the border. Acts on `trade` and `settle` (stage 2: grain for the March).
  - **royal representative** (Pell Wardin, the crown's man at the gate): sends the crown letters about what the court's people are doing. Not a servant of Arven.
- Two new places (`arven_gate`, `arven_market`, province `arven`) joined to the March by one road from Thornfield.

## 2. The court and its instructions
- Every `reviewDays` (a draw between two limits, clock-driven `FrontierReview`, a root) the court reads the March through its informants: the worst of the objective forts' condition and whether any has fallen, each blurred by a keyed draw (`informantNoise`). That is its **weakness** reading, 0 to 1000.
- Weakness picks a stance: `settle`, `trade`, `press`, `strike`, by thresholds in the content, with hysteresis (it moves one step at a time and holds a stance for at least `holdDays`).
- A new stance goes to each of the four actors as its own `FrontierInstruction`, each with its own delay (`delayDays` per actor, a keyed draw). When it arrives (`FrontierInstructionArrived`) the actor acts on it from then on. Because the delays differ and reviews come faster than the slowest delay, two actors can hold different stances at once: the commander on `strike` while the ambassador still holds `settle`. Such a pair, one peaceful and one hostile, is recorded as a `FrontierContradiction` (caused by the arrival that made it).

## 3. What the actors do
- **Commander on `strike`:** decides (a keyed draw weighted by traits and what he is told, reasons recorded) whether to march, once per `strikeCooldownDays`. `FrontierStrike` starts a threat at the Arven Gate against the target fort (content: `target`), as a `ThreatBegan` carrying the site; the raid mechanics, battles and sorties are the existing ones. He may decline (`FrontierDeclined`), with the reason.
- **Commander on `press`:** no event in this stage.
- **Ambassador on `settle`:** proposes terms (`TreatyProposed`, once per `treatyCooldownDays`). Nothing answers it yet (stage 2).
- **Representative:** every `reportDays` he sends the crown a letter with what he saw of the commander's and the ambassador's stance (`frontier.posture`, a band a little blurred), by the ordinary messenger system. So the crown learns of a changed court late and sometimes wrong.
- **Merchant:** no effect in this stage.

## 4. Pressure reading
Threat events with the frontier site, and the frontier system's own events, belong to the `frontier` pressure (`endings.ts`). A raid from the gate that makes the ruler answer is therefore frontier attention, not wilds attention.

## 5. Tests (written first, `test/frontier.test.ts`)
Nothing runs without the content block; same seed same log; ablating `frontier` emits nothing and draws nothing; arrivals follow instructions by the drawn delay; with different delays a contradiction can happen and is caused by an arrival; a strike's threat names the gate and reaches the target fort; weakness follows fort condition (repaired forts calm the court, ruined ones raise it); the representative's letter reaches the ruler no sooner than a rider; the threat refactor leaves every old trajectory byte-identical; no information leak (the view never holds court state).

## 6. Not built in this stage
The merchant's trade, the treaty answer, victory, the court reading anything but the forts, tier A actors.
