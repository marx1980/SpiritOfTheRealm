# Standing policy and precedent (Phase 9)

Plan: "Military, economic emergency and negotiation/punishment policy; officials merge policy with immediate orders and
local beliefs; institutional precedent." Backlog P0.12 done-when: officials act under standing policy when no immediate
order covers a situation, and cite precedent in their reasons.

## 1. A policy is a proclamation people come to know
- Anna proclaims one policy per area. A later proclamation in the same area replaces the earlier one.
- The proclamation is a letter. Each official learns it as a belief, `policy.<area>` about the ruler, when the letter
  reaches him. Officials present at court learn it at once. Until his letter arrives, an official acts as before.
- There are three areas, each with a few named rules (content: `scenario.policy`):

| Area | Rule | Who acts on it | What it does |
|---|---|---|---|
| military | `hold_walls` | castellans, captains | do not sally; keep the men inside |
| military | `cautious` | same | sally only when the odds are judged at 70% or better |
| military | `bold` | same | sally when the odds are judged at 30% or better |
| emergency | `repairs` | the regent, while Anna is away | may order repairs up to the policy's cost limit (otherwise she may order none) |
| communities | `negotiate` | the crown's officer for a people | when they withhold or refuse: parley and remit part of the dues |
| communities | `punish` | same | when they withhold or refuse: seize the dues with the garrison |
| communities | `tolerate` | same | do nothing (the behaviour before Phase 9) |

No proclamation means no policy: each official uses his own judgement, as before.

## 2. Merging policy with orders and local beliefs
- **An order in force wins.** A policy reason applies only when no order in force covers the situation. A castellan
  with an order to hold or attack follows the order and the obedience model, as before.
- **Weight.** `policyMilli × loyalty to the ruler / 1000` (content `policy.policyMilli`, 20,000; chosen on TUNE
  seeds 1-8: at 20,000 Bren and Varos keep "hold the walls" entirely and Caron, ambitious, still sallies for renown
  about half as often; at 40,000 even Caron almost never does). It is traced as reason kind `order` with ref
  `{ kind: "policy", id: "<area>:<rule>" }` and text key `reason.policy_for` or `reason.policy_against`. The frozen
  Reason schema is unchanged.
- **Local beliefs decide whether the rule applies.** "Cautious" is judged against the official's own estimate of the
  odds, from what he believes about the raiders. "Punish" needs the garrison he believes he has (at least
  `punishMinMen`), otherwise he cannot do it. A regent's repair is judged against the condition he believes the
  walls are in.
- **Traits.** A policy is a reason, not a switch. A strong enough case can still beat it, and the trace shows by how
  much.

## 3. Precedent: institutional memory
- **What becomes a precedent.** A sortie and its result, with the odds the commander judged at the time. A parley or
  a punishment and what the people did in the next 20 days: their stance fell (eased) or rose (escalated).
- **Who knows it.** The people present (the battle's commanders, or the officer), and the fort itself (`fort:<id>`):
  whoever holds that post knows the fort's precedents. The court does not keep them in this phase.
- **Use.** When an official weighs a sortie, the known precedents against the same raiders, with odds within ±150‰
  of his own (the precedent's odds are the battle's as fought: men against the raiders met, no second band), count
  (at most 3, the most recent first): +`precedentMilli` for a win, −`precedentMilli` for a loss. Their weight halves
  every `precedentHalfLifeDays`. Each is cited as reason kind `precedent`, ref `{ kind: "event", id }`, text key
  `reason.precedent_won` or `reason.precedent_lost`. A parley or punishment is weighed the same way against what
  happened last time with those people.

## 4. Gate proposal (G-17, Phase 9)
Paired arms on a sealed block, under the delegating policy plus one proclamation (ON) against none (OFF), with the
same seeds:
- (a) Under `hold_walls`, sorties launched without an order in force, ON / OFF pooled: at most 0.6 (90% bootstrap
  interval over seeds). Changed from "fall by 80%" after the TUNE measurement above: a policy is a reason, and an
  ambitious captain still overrides it.
- (b) Of the ON arm's sortie weighings with no order in force, at least 95% weigh the policy.
- (c) Of the OFF arm's sortie weighings by someone who knows an earlier sortie against the same raiders, at least
  50% cite a precedent (bar set before any gate data).

Tool: `tools/phase9_gate.ts` (shard / eval, 160 days). These are proposals for Marko to confirm. Behavioural gates run under three scripted policies, as C0 requires. The
gate runs once, when Phase 9 is frozen.

## 5. Not in this phase
- No policy for trade, muster or grain purchase, and no relief by the regent.
- Precedents are not carried by letters between forts, except to the court.
- The enemy keeps no precedents.
