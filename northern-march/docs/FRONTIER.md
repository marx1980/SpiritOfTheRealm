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

# Stage 2: the treaty, the victory, the merchant (14B, 14 Nov)
Content only again (`scenario.frontier.treaty`, `.trade`, `scenario.endings.settlementDays` and `.victoryHosts`).
- **The offer.** `TreatyProposed` now carries terms (`tributeMilli`, `truceDays`, open for `treaty.openDays`) and the ambassador writes the ruler a letter (belief `frontier.treaty`, value = the offer's event id). Only one offer is open at a time.
- **The answer.** A player action `treaty` (`target` `accept` or `refuse`, `to` the offer id) while the offer is open emits `TreatyAnswered` at once. The word takes the ambassador's road (his delay) to reach the court; on arrival: `TreatySigned` (the tribute leaves the treasury, a truce of `truceDays` begins) or `TreatyRefused` (the court reads the March `refusePermille` weaker for `refuseDays`). An answer to a lapsed or unknown offer does nothing.
- **The truce.** While it runs the court's reading is forced to `settle` (the instruction travels as any other, so a commander still on `strike` can march before it reaches him). It is not binding on a commander already marching.
- **Negotiated settlement** is read: a signed treaty with no `FrontierStrike` for `settlementDays` after it. **Military victory** is read: at least `victoryHosts` hosts at the gate ended by the March's arms (`ThreatEnded` with `endedBy` sortie, battle or assault; a host that merely goes home does not count).
- **The merchant.** While his stance is `trade` or `settle` and no host stands at the gate, every `trade.everyDays` he brings grain (`FrontierTrade`, a draw in `trade.sacks`) to `trade.dest`; the ledger counts it as `imported`.
- Not built: the player-facing screens for the offer (the view holds the belief; the court screen and affordances come with the UI), a refusal that costs standing with Houses.

# The ruler's verbs for Arven (D-090, G-07 fix 2, 14 Nov)
Content only again (`scenario.frontier.verbs`, content march-0.19; each verb optional; without the block the actions do nothing and every log is march-0.18's). Three player actions, handled in `src/systems/player.ts` like `treaty`, carried out by `frontierVerb` in `src/systems/frontier.ts`. Each pays from the treasury at once and draws only from its own keyed stream (`frontier:<verb>:<input id>`), so no shared stream's schedule moves (G-02). A verb that cannot be done now (the chest is short, the merchant does not trade, the ambassador is dead) emits `FrontierActRefused` with the reason and costs nothing.
- **`reinforce`** (target: the border fort, `frontier.target`). `ReinforcementsSent` (cost `reinforce.costMilli`), then after a draw in `reinforce.delayDays` `ReinforcementsArrived`: `reinforce.men` join the garrison as foot (a fallen fort takes no one in). They stand `reinforce.stayDays`, then `ReinforcementsLeft` (no more than stand above the fort's establishment). While they stand: more defenders against every raid (less damage, the existing mitigation per man), and the court's informants read the March `reinforce.weaknessCut` stronger at each review.
- **`envoy`**: a gift to the court. `EnvoySent` (cost `envoy.giftMilli`), carried by the ambassador on his own road (`delayDays.ambassador`); `EnvoyArrived`: for `envoy.days` the court's three thresholds sit `envoy.thresholdShift` higher (on top of the year's shift), so the court steps toward `settle` at its next review, not at once. The ambassador writes the ruler that it arrived (belief `frontier.envoy`, by the ordinary messengers).
- **`merchant`**: the merchant's grain bought outright. Only while his stance is `trade` or `settle` and no host stands at the gate. `MerchantGrainBought` (`merchant.sacks` at `merchant.priceMilliPerSack`), then after a draw in `merchant.delayDays` `MerchantGrainDelivered` at `trade.dest`, counted in `grainLedger.imported`. The `PlayerInput` records `short`: whether the ruler then believed some store held fewer than `merchant.crisisCoverDays` days of grain (her own beliefs).
- **The view.** `world.frontier` (gate, fort, the verbs' costs; public) and `self.acts` (her own acts toward Arven, which no order records) appear only with the block.
- **Scripted rulers** (`src/policies.ts`, `answerFrontier`), on Pell's `frontier.posture` letter as it reaches her: *delegating* sends a gift when he reads the commander at press or strike (once per goodwill, 90 days), and men as well when she believes the border fort's walls under 70%; *aggressive* sends men on press or strike (once per stay, 60 days) and buys the merchant's grain when he reads settle or trade (once in 40 days). `delegating-core` is unchanged. Dedupe is by `self.acts`, not `recently()`, which sees only orders.
- **Reading (D-088).** `reinforce` and `envoy` answer the frontier; `merchant` answers food_security when the input says `short`, else the frontier.
- Not built: the court screen and affordances for these verbs on the page and in the conversation layer; a gift that the court can refuse or that costs standing with the Houses; reinforcements drawn from the March's own men (muster) rather than hired.
