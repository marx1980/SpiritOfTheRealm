# Exploration, creature and artefact (Phase 11)

Plan: "Blackwood site and rumours; military/scholarly expeditions; senior delegate selects subordinate leader; hidden
creature ecology with witness reports; Stone of Vey actual vs believed properties, custody and provenance." Gate: unknown
Stefan can emerge through recommendation and performance; the artefact may never enter Anna's possession.
Marko's choices (13 Nov): the creature is a natural apex predator; the Stone gives prestige and legitimacy (fixed
properties, no magic); this session builds the core loop, with contested claims and theft left for later.

## 1. What is true and what is believed
| Truth (world state `bw`, content `scenario.wilds`) | Who learns it, how |
|---|---|
| A creature: hunger, alive or not | Only by hunts (events people witness) and by expeditions that find its signs or meet it |
| Hunts: livestock taken, sometimes a person | The place hears at once (loss, memory, a small grievance); officials near enough hear a rumour, later, exaggerated |
| The Stone: where it lies, who holds it, what it really does | A search that finds the hollow; its believed properties are a legend and larger than the real ones; examination at the seat shows the real ones |
| Reputation of each person, who has emerged | Visible in who gets recommended |

Rumour is a belief `site.rumour` about Blackwood (0-1000, how bad it sounds), `uncertain`, exaggerated by a draw per
hearer, decaying with its half-life. Routine letters carry it, so Anna learns it late and bigger or smaller than the
truth.

## 2. The ecology (system `exploration`)
Hunts are scheduled, not checked daily: after each hunt the next is drawn (a renewal process, keyed RNG, no daily event).
A hunt (`CreatureHunt`, a clock-driven root) takes livestock from a place in its range (weights in content) and,
sometimes, a person. The place hears the event as witnesses, nearby places as rumour. A dead creature hunts no more.

## 3. Expeditions
An `investigate` order for Blackwood with an `expedition` constraint (`scholarly` or `military`; none means scholarly).
The senior delegate picks a leader from the candidates as before (own retainers, people recommended by someone they
trust) and now also anyone who has emerged; each is weighed by trust and recommendation, by fitness for the kind of
expedition (intelligence for scholars, military for soldiers) and by reputation, and the choice is a weighted draw
(keyed), so the same delegate does not always pick the same man. The weights are recorded in `LeaderAppointed`.
At the site the party searches for `searchDays` days (`SiteSearched` each day): each day it may find the creature's
signs, the hollow, and the Stone; and if the creature lives it may meet it (`CreatureEncountered`: the creature is
killed, the party flees, is mauled, or the leader falls; the odds depend on the kind of party and the leader's skill).
`ExpeditionEnded` records what was found and the outcome. The leader's report carries the claims he now believes
(`site.signs`, `creature.nature`, `stone.found`, `stone.properties`), as a letter: delayed, and wrong in the ways his
observation can be.

## 4. Reputation and emergence of Stefan
Each expedition changes the leader's reputation (found, survived, fled, fell, creature killed, Stone brought): a
`ReputationChanged`. Crossing `activeAt` once is `CharacterEmerged`: he keeps his tier, is a candidate for any delegate
(by his record, not by someone's word), and is no longer a stranger. Stefan Veyr starts as a scout nobody but Bren
speaks for; he emerges only if a delegate picks him (recommendation) and he does well (performance). Other candidates
(Tobin, Corwin, Ilka, Neve) are drawn from the same pool, so in some seeds he never leads, or leads and fails.

## 5. The Stone: custody and provenance
Custody is state (`hollow`, `carried`, `in transit`, `held`, `lost`) changed only by events: `StoneFound`,
`StoneTaken` (the leader carries it), `StoneKept` / `StoneSent` / `StoneDelivered` (each holder decides, by loyalty to the
issuer, his own traits and ties, and what he believes it is worth; the reasons are recorded), `StoneLost` (the leader
fell: it stays where he lay), `StoneExamined` (at the seat a scholar learns the real properties). The provenance of the
Stone is the chain of these events, reconstructable from the log (`provenance(log)`). Nothing forces it to reach Anna: a
holder may keep it, and it may stay in the wood. Delivered to the crown's seat it raises the people's trust by what it is
really worth (a prestige effect, not a rule of the world).

## 6. Gate proposal (G-19; bars for Marko to confirm)
Three scripted policies on a sealed block, 240 days:
- (a) Stefan emerges in 20-40% of the games where an expedition goes out (Wilson 90% interval inside or touching the band; AMBER if the point is inside and the interval crosses an edge).
- (b) Every emergence has the chain recommendation -> appointment -> expedition -> reputation -> emergence in its causes: 100%.
- (c) The Stone ends a run outside the crown's hands (kept, lost or still in the wood) in at least 10% of the games where it was found, and provenance is reconstructable in every game (custody chain without gaps): 100%.
- (d) Invariants: 0 violations.
Tool: `tools/phase11_gate.ts`. Run once on frozen code.

## 7. Not in this phase
Contested reports between expeditions, theft and capture, competing claims (Varos and the Houses asserting the Stone),
magical expeditions and the Stone's magic (P1), a creature that changes (breeds, migrates), several creatures, hired
hunters, an artefact effect beyond trust. Planning does not yet weigh the creature when choosing routes.
