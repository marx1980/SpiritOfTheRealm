# Conversation layer (Phase 13)

Plan: "Typed natural language → intent parser → draft StructuredOrder; commander questions and read-back; natural affirmation
and correction; 'what would you do / why / alternatives' answered from Recommendation objects; voice-to-text adapter;
technical transcript correction. Templated phrasing remains the permanent fallback." Gate G-16: swapping the language layer
for templates leaves the event log identical (100 seeds). Design sources: ARCHITECTURE §20.11-§20.12, DESIGN_PIPELINE §6-§7,
BATTLEFIELD §2C, §3-§6.

## 1. The boundary (what the layer may and may not do)
```
player words → (transcriber) → understand → draft → [questions] → read-back → affirm / correct → PlayerAction → engine.answer
Recommendation (cached, from the sim) → speak → words
```
- The layer lives in `src/conversation/` and sees `ViewOf(player)` and the public rules only (static import check: it
  imports `../view.ts`, `../presentation/*.ts` and its own files). It never sees WorldState or Content.
- It returns **only** `PlayerAction`s that the existing validators accept (`validateDraft`, `validateBattleDraft`, the
  affordance list). A word the layer cannot resolve against what Anna knows is a *technical* prompt, never an in-world one.
- Transcripts, the speech generated and the validation verdicts are **side data** (`Exchange[]`). Only validated structured
  actions reach the log; nothing in the log depends on which layer produced them.
- The simulation never waits for or calls a language model. A layer is an object with `understand` and `say`; the
  templated layer is the permanent one and the fallback for anything another layer produces that fails validation.

## 2. Two layers
- **Templated** (`templatedLayer`): a deterministic keyword and name parser (words in `content/march/lexicon.json`) and
  sentences built from the existing phrasing words. Complete on its own: the game is playable with it.
- **Another layer** (a language model, later) implements the same interface. Its speech is checked by `validateSpeech`
  (§6); a rejected line is replaced by the templated line and the rejection is recorded. Its parse is checked like any parse
  (§3). No real model is wired in this phase; the tests use a stand-in layer (loose wording, typos, adversarial speech).

## 3. Campaign conversation (the court)
- **Orders.** A typed command is matched against `playerActions(view, rules)`: the actions the rules allow now and she can
  pay for, as far as she knows (repair with its modes, send the captain, attack or scout raiders, levy, relief, travel,
  move/buy/sell goods and grain, call men) and against `adviceChoices` ("do as Selene says"). Verbs, goods, modes and
  prepositions (`from`, `to`, `at`) narrow the candidates by their slots.
- **Technical recognition** (§5 of BATTLEFIELD): a word that is nearly a place or person she knows ("Greyfen" for "Grey Fen",
  "Hihgcairn") or a number word is snapped to it and confirmed out of the world ("Did you mean Highcairn?"). A name she
  does not know is said so, plainly. No game consequence and no game time.
- **In-world ambiguity**: more than one candidate left, or a slot missing ("repair" with two damaged forts): the nearest
  present adviser asks, from what he believes ("Which fort, Northwatch or Highcairn?"). The answer fills the slot.
- **Read-back and affirmation**: the adviser says what he understood in a sentence and asks for a yes. "Yes / agreed / do
  so / proceed" affirms; "no, I mean ..." keeps the draft and replaces what was said; "never mind / stop" drops it.
  Affirming compiles the action (an unaffirmed draft never reaches the engine).
- **Questions to advisers** (`what would you do`, `why`, `how sure are you`, `what worries you`, `what else could we do`,
  `what if it fails`) are answered from the adviser's cached `Recommendation` in her view: reasons by weight, uncertainties,
  alternatives, contingencies. Each adviser answers separately; nothing is merged.
- **Invalidation**: a Recommendation is stale when a belief it was based on is gone, or a newer belief about the same thing
  has a different value or a worse band. A stale or missing one is not voiced: she is told he must think again, and the
  layer returns `ask` (§7), which makes the adviser work out his advice again, for that adviser only.

## 4. Battle conversation
- Orders to commanders typed in words become `BattleOrderDraft`s: task (`hold`, `advance`, `attack`, `withdraw`, `give ground`,
  `protect`), place and line from the field's names, conditions ("when the enemy is engaged, attack"), sector delegation
  ("take the right and command Veyr and Ilka") and the carrier (`voice`, `runner`, a signal agreed before the fight).
- Missing slots are asked by the commander the order is for ("Hold where, my lady?"). A missing recipient is a technical prompt.
- **Game time** (BATTLEFIELD §2C, plan decision 2): 30 battle seconds per question-and-answer exchange with a commander who is
  present, 15 for the read-back and affirmation, 0 for technical corrections and for orders to distant commanders (they cost
  the runner's time instead). After `pressAfter` exchanges with one commander he says he must go to his men (his reply
  carries `pressed`). The time spent is `delay` on the `BattleOrderDraft`: the order is dated that many seconds later and the
  battle runs on meanwhile.
- Not here: commanders' proposals in battle ("what would you do" about the field); they need a commander's own picture of the
  battle, which the core does not expose to the player (Phase 12 keeps that picture inside the commander).

## 5. Voice
`Transcriber` adapter (`{ transcribe(audio) → { text, words: { w, conf }[] } }`). `correctTranscript` snaps low-confidence words to
names she knows and marks what it changed, so the transcript is shown and editable before it is understood. A scripted
transcriber stands in for tests; the page may offer the browser's recogniser when it exists (unverified, needs a human).

## 6. Validation rules (the part that makes a language layer safe)
Speaking. `validateSpeech(view, act, text, lexicon)`: another layer may reword a line, but it may add nothing, drop nothing
and turn nothing round. A line is accepted only if every rule holds; a rejected line is replaced by the canonical line and
the reasons are kept with the exchange.
0. **Form**: not empty; at most twice the canonical line's length (or 80 characters more); letters, digits and ordinary
   punctuation only (no markup, line breaks or links).
1. **System lines** (out of the world: "Did you mean ...?", "I cannot do that: ...") are never reworded.
2. **Names**: every person or place it names (any short form) is one the act carries, and none the canonical line names is
   dropped. A short form that fits two people stands for both and passes only if both are allowed.
3. **No made-up names**: a capitalised word anywhere (a sentence start included) that is neither a name she knows nor a word
   of the canonical line or the register.
4. **Figures**: no number, in digits or words, plural or fraction, and no quantity word ("all", "most", "few", "first")
   the canonical line does not give.
5. **Claims**: no more of each shape than the canonical line makes: what will happen ("will", "'ll", "bound to", "soon"),
   certainty ("certainly", "no doubt", "cannot fail"), odds ("%", "likely", "three to one"), what someone else thinks or
   means ("wants", "is loyal", "is lying"), the world outside the game ("AI", "game", "player").
6. **Negation**: as many "not"s (no, never, n't, without, unless ...) as the canonical line.
7. **The closure**: once the register's courtesy words are set aside (`lexicon.speech.free`: "my lady", "indeed", ...)
   and its equivalent phrases are read as one (`lexicon.speech.same`: "let me be sure" = "if I have it right", "I would" =
   "I'd", "repair" = "mend", ...), the line must say the canonical line's words in the canonical line's order. This is the
   rule that decides: it is why reasons for and against cannot swap, from and to cannot swap, and no fact can be added.
   Rules 0-6 explain a rejection and guard against a mistake in the register list.
What this cannot see: a rewording that keeps every word in order but changes the tone. Rewording is therefore narrow by
design (courtesy and listed equivalents); a model is useful mainly in the other direction, understanding her.

Understanding. A parse is validated by what the engine accepts (`playerActions`, `adviceChoices`, `validateBattleDraft`):
it can only resolve to an action she could take, and every order is read back (in words that pass the rules above) and
needs her yes. Consent is given in the lexicon's words: another layer's "yes" that the templated reading does not also hear
as a yes sends nothing ("Is that a yes?", out of the world), so a layer cannot turn "no", "wait" or "never mind" into an
order.

## 7. Simulation changes (additive; with no conversation the log is exactly as before)
- `PlayerAction { action: "ask", target: adviser }`: `PlayerInput`, then, if the adviser is with the ruler, his advice is worked
  out now (the end-of-day delay is skipped; same planner, same view of his own). One `RecommendationMade` per piece of advice,
  as usual, then the ruler is paused again.
- `BattleOrderDraft.delay` (seconds): the order's battle time is `now + delay`.
- Saves and replays record `ask` and `delay`.

## 8. Gate G-16 (plan bar: identical, 100 seeds; no new bars to confirm)
Tool `tools/phase13_gate.ts`. For 100 seeds of a sealed block, a scripted conversational player runs 60 days in each of two
conversation setups with the same intent script and the same seed: the **templated** layer fed canonical sentences, and the
**stand-in** layer fed loose paraphrases, typos and voice-style transcripts and speaking adversarial lines. At each decision
point the script says in words what it wants (an order, a question, a correction, an affirmation); every conversation is
driven to its end.
- (a) The two event logs are identical (hash) on every seed.
- (b) Every adversarial line (an unknown name, an invented number, a claim about the future) is rejected and replaced; none
  reaches the transcript shown as the speaker's words.
- (c) Questions leave no trace in the log (a log with questions asked equals one without), except an `ask`.
- (d) Every action that reached the engine passed validation; every refused draft is a technical or in-world reply, not an error.
Also an invariant test on a few seeds: the log is identical when the language layer is swapped. G-16 shows that wording and
speech cannot change the event log; it does **not** show that a real language model understands the player well, or that
conversation is pleasant. That needs people (H-02) and a layer to judge.

## 9. Not in this phase
A real language model or speech recogniser; commander proposals and questions inside a battle (§4); policies by conversation
(by the Policy tab); orders to the realm's other officials beyond the actions the rules list (the free-form composer);
multi-language input; text-to-speech.

## 10. As built (13 Nov)
- `src/conversation/` (court and battle), `content/march/lexicon.json` (language data, outside the content hash), `ui/talk.ts` (panel: transcript, text box, Yes/No while a read-back waits, a Speak button only where the browser has speech recognition).
- Simulation additions, both additive: the `ask` player action (a question to an adviser whose answer is missing or stale: AdviceScheduled and agents:advise at the same tick; the adviser answers only if present) and `BattleOrderDraft.delay` (battle seconds spent talking in the pause; the order is dated now + delay).
- Quantities ("send 300 men") are not understood; orders take the usual size, as the forms do.
- Battle: orders to commanders only. Commanders do not yet ask or propose. Questions to advisers are court only.
- The page's panel and the G-16 tool use the same `createConversation`; nothing wording-dependent reaches the log.
- Voice: `correctTranscript` and the scripted transcriber are tested; the browser recogniser button is written but not verified.
