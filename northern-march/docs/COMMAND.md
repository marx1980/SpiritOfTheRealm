# Full battlefield (Phase 12)

Plan: "Full command hierarchy, line-of-sight and occlusion, observed/reported/inferred/stale markers, signals, panic
propagation and rout, local adaptation and deliberate disobedience, commander incapacitation and local succession, sector
delegation, recorded disobedience outcomes." Design source: BATTLEFIELD §1-§24. Builds on the Phase 8 slice (D-060..D-068).

Everything new is switched by `battle.tactics.full` in content. Without it a battle runs exactly as in Phase 8 (the
`LEGACY` fixture of the tests). Each part of `full` can be left out on its own, which is how the gate's paired arms
switch one mechanism off.

## 1. Command hierarchy and sector delegation (§12, §19)
- Every commander has a `superior` (none: he answers to headquarters) and may have a `deputy` (the pre-set order of
  command, §15). The army's tree is the chain of superiors: headquarters → wing commanders → formation commanders.
- **Reports go up the chain** (`full.chain`): a commander's runner goes to his superior, who folds what he hears into his
  own picture (marked reported, with the original age) and passes it on with his own next report. Headquarters therefore
  learns about a far flank later than about the commander next to it. Decisions about headquarters' orders are passed up
  at once.
- **Sector delegation**: a task may carry `command: [ids]` ("take the right; use Veyr as you think best"). A commander who
  accepts it becomes the listed commanders' superior and plans for them by his own judgement (`planSector`, pure,
  traced): a capable commander (skill ≥ `sector.capableAt`) puts foot on the place, archers behind them and holds horse
  back as a reserve that attacks when the enemy is engaged; a bold one sends the horse in too; an unskilled one gives
  everyone the same order, with no reserve and no contingency (§11, the brittle line). His orders travel by voice or by
  his own runners, and each subordinate decides on them like any other order. He re-plans when his own task changes.
- Wing commanders set at the start (the lab army) plan for their wings the same way.

## 2. Sight and occlusion (§2, §16)
- Woods block and shorten sight, rain and snow shorten it, melee dust halves it, standing on a ridge lengthens it (Phase 8).
- **Dead ground** (`full.deadGround`): the ground just behind a ridge (within `deadGround` metres of its far edge along the
  line of sight) cannot be seen from lower ground on the other side. From the gate the ford is hidden; from the ridge it
  is not. This makes the forward command post worth its risk (§2A).
- **Failing light** (`full.dusk`): when a battle ends at nightfall, sight falls linearly to `sightPermille` over the last
  `lastSeconds`. Night battles stay excluded (§24.4, plan G11 revisited: still excluded).

## 3. What headquarters believes (§1, §16, §17)
- Marks stay observed (seen now), reported (with source and age), inferred, stale (older than `staleAfter`).
- **Inferred enemy movement** (`full.inferEnemy`): an enemy formation seen twice and then lost from sight is drawn where
  its last heading would have taken it, for at most `maxSeconds`, marked inferred. Only headquarters' own sightings
  are used.
- **The command network** shows, per commander, what headquarters believes his task is, the order's status, the last
  contact and now his state as headquarters believes it: commanding, fallen (only once seen or reported) or, for a
  successor, who now commands his men.

## 4. Signals (§9A, §24.3)
- Six slots: the four standard (advance, hold, withdraw to the fallback, commit the reserve) and two custom, agreed
  before the fight (content: fall back to the ridge; strike from the wood's edge). Only agreed meanings can be signalled.
- A signal reaches the addressee and every commander under him who can see headquarters' banners within range; each may
  miss it in rain, snow or dust (Phase 8 odds).
- **The enemy reads signals** (`full.enemySignals`): if a raider band can see headquarters, the chief notices the signal
  and re-plans at once. The four standard signals are understood: a withdrawal is pressed (riders go for the withdrawing
  men), an advance or a reserve commit is met by bands that brace where they stand. Custom signals are seen but not
  understood, which is the reason to agree them.

## 5. Panic and rout (§13, §14)
- Phase 8: friends breaking within 400 m shake a formation; an unannounced withdrawal looks like a retreat.
- **Seen, not known** (`full.contagion`): men also lose heart at friends they can see breaking farther off (up to
  `range`), less the farther away; each further breaking formation they see adds `chainPerExtra`; men whose commander has
  fallen or is out of voice range lose `leaderless` more. Panic thus runs along a line and is checked where a commander
  is present.
- **Commanders ride to trouble** (`full.rally`): a commander with several formations goes (at horse speed) to the one
  in the worst state below `below`, so his presence (the near bonus) is where it is needed; he is then away from the
  others.

## 6. Local adaptation and deliberate disobedience (§10, §18)
- Phase 8: on receipt, obey, adapt or keep (scored, `decideBattleObedience`).
- **Review** (`full.review.every` seconds): a commander holding an order from someone else re-weighs it against what he
  now believes: stay with it, adapt it (part of its purpose), or take another course (attack the nearest enemy he
  sees, or fall back to the gate). The same scores, duty and margins as on receipt, with changed circumstances; his
  commitment to what he is doing now is a reason to stay with it (no flip-flopping). Only a change is acted on, and every
  change is a trace (`trigger: "review"`) with its reasons: `adapt` (local adaptation) or `defy` (deliberate
  disobedience). Never rolled. A course once changed is given `review.settle` seconds before it is weighed again (without
  it, a commander falling back from the enemy saw better odds and turned round every minute).
- **Odds in a line of battle**: on the full battlefield a commander's believed local odds count the friendly formations he
  sees within 900 m as well as his own men (a captain of 120 archers in a line of 1,600 is not alone against the host).

## 7. Commanders fall (§15, §22)
- **Hazard** (`full.hazard`): a crown commander is where his men are. While his formation is in melee, or under fire, the
  battle's random stream is drawn for him (and only then): `meleePerMyriad` or `missilePerMyriad` per step, scaled by his
  boldness ((500 + risk)/1000). He is wounded or killed (`killedPermille`). He gives no more orders, his men lose the
  near bonus and take a shock (`shock`) if they see it.
- **Succession**: his deputy takes his men (the pre-set order). The deputy learns after `noticeSeconds` plus a runner's
  time (at once if within voice range); until then the men keep their last instruction, and his and the deputy's men may
  follow different instructions (§15). With no deputy, his superior takes them when he learns; with neither, they
  fight on leaderless.
- A runner who arrives for a fallen commander hands the order to his successor if there is one, else is lost ("he has
  fallen").
- Headquarters marks him fallen only once it sees the fall (within `observeRange` and in sight) or a report says so
  (the successor's first report carries it).
- Campaign: `CommanderFell` (wounded or killed). A killed commander takes no further part (agents and leader choice skip
  him: `isDead`); he is not fielded in later battles, letters to him are undeliverable ("recipient is dead"), a dead
  captain's surviving men return to the fort's garrison. Wounded commanders recover off the field (no campaign effect
  this phase beyond the record).

## 8. Recorded disobedience outcomes (§10, §20)
- After a battle, each deliberate departure from an order (`keep` on receipt, `defy` or `adapt` on review) is judged
  against the same battle replayed with that one decision forced to obedience (the battle is a pure function of its setup
  and orders, so the counterfactual is exact): `saved` (the crown did better: a better result, or the same result with
  at least `outcome.lossMargin` fewer crown losses), `ruined` (the reverse) or `no_difference`. Recorded in the result
  (`disobedience`) and on `BattleConduct` (`outcome`). This is the objective record, for the chronicle (Phase 15);
  prestige still follows what people see (the result), as in Phase 8.

## 9. Scale
Campaign battles stay small (a fort's garrison and the captains present). The lab army (`test/battle_army.ts`, built by
`buildArmySetup`) fields three wings and about 15 formations a side against a large raider host on the same field, for
tests and the gate. The raider host is set by seed (1,600, 2,200 or 2,800 men: an even fight, a hard one, a hopeless one).

## 10. Gate proposal (G-20; bars for Marko to confirm)
Lab army battles, 240 seeds × three scripted headquarters plans (hold; delegate the wings; attack), plus campaign battles
from the three scripted rulers:
- (a) Disobedience is reasoned: every departure from an order has a trace whose chosen option is the one the margins
  pick from its scores, with no random draw: 100%.
- (b) Disobedience matters both ways: every departure has a recorded outcome (100%), and among departures with a
  difference, both `saved` and `ruined` are at least 15%.
- (c) Panic spreads by sight: paired arms (`full.contagion` off vs on, same seeds): the share of breaks (retreat or rout,
  either side) that come within 120 s of a friend breaking 400-1,000 m away; lift on/off ≥ 1.3 with the 90% bootstrap
  (over seeds) lower bound above 1.0. (A first metric, battles with a rout cascade, was saturated: cascades of three
  happen with or without it, and panic is symmetric, so the raiders' many bands break sooner too.)
- (d) Succession: every fall with a deputy or superior alive is followed by a succession or the battle's end; headquarters
  never marks a commander fallen before it saw the fall or a report of it reached it: 0 violations.
- (e) Information integrity: no observed mark differs from reality (the ruler's guard keeps its last place once gone, as
  in Phase 8); invariants on campaign runs (every 4th seed, three scripted rulers, 160 days): 0 violations.
Tool: `tools/phase12_gate.ts`. Run once on frozen code, from a worktree. H-03 (human, battle screen) remains owed.

## 11. Not in this phase
Typed conversation and commander questions (Phase 13); night battles; audio signatures; the enemy's own hierarchy and
deception; prisoners; artillery or smoke; morale effects of banners and music; the ruler handing over overall command
during a battle (§24.2) beyond what sector delegation gives.
