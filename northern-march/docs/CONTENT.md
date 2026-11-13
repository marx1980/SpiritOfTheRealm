# Phase 14: content and the pressure cooker

Plan: `IMPLEMENTATION_PLAN.md` Phase 14, backlog P0.08, P0.17, P0.24. Gate: G-03, G-04, G-06, G-07, G-08, G-09, G-10, G-11, G-12, G-14, G-15 on a sealed block of 1,000+ seeds under three policies, and H-02. AMBER does not count.

## Slices (agreed with Marko, 13 Nov)
- **14A, measure.** Read the six endings and the five pressures out of the event log, without changing the world, and write the gate tool for G-07, G-08, G-09. Run on TUNE seeds only. Finding the gaps comes first, so 14B builds what is missing, not what is guessed.
- **14B, content.** What 14A shows is missing: the Arvenese frontier network (ambassador, border commander, merchant intermediary, royal representative, with different and delayed instructions), characters to 25-30 active, Houses with patronage and debt, the fifth pressure, the endings the world cannot yet reach.
- **14C, the round.** Sealed block, three policies, every gate in the list, H-02 with testers.

## 14A, what is measured

### Endings (`src/endings.ts`, reads the log; changes nothing)
Six endings, plus `unresolved` when none has happened by the horizon (`scenario.endings.horizonDays`, 240 like every gate so far).

| Ending | Read from | Reachable today |
|---|---|---|
| death | `CampaignEnded` with ending `killed` | yes |
| capture_deposition | `CampaignEnded` with ending `captured` | yes (deposition by a House: 14B) |
| coalition_fracture | at least `fractureCommunities` communities in stance `support` of the same actor, for `fractureDays` days | yes |
| territorial_authority_failure | at least `lostForts` objective forts held by raiders at once (`FortFell` not undone by `FortRetaken`) | yes |
| military_victory | no event yet: needs a threat that can be ended for good | no (14B) |
| negotiated_settlement | no event yet: needs a parley or treaty | no (14B) |

The first ending to happen counts. The world does not stop at the last four (no event ends the campaign); that is a 14B decision, and the measure only says when it would have.

For an ending the trigger event is the one that completed the condition. Its **ancestry** is the trigger and everything its `causedBy` chain reaches.
- `firstCause`: `decision` if any event in the ancestry is an agent's decision (`DECISION_TYPES`: a player input, an order issued, an obedience decision, a local plan, subordinate orders, an expedition started, a community's change of stance), else `exogenous`. G-09(a) is the share of exogenous endings.
- `ancestryDomains`: the domains of the events in the ancestry. G-09(b) is the share with three or more.

### Pressures and `dominantCrisis` (`readAttention`)
Five pressures, named in code `rebellion`, `food_security`, `wilds` (the Blackwood pressure: raiders and the wood), `frontier` (Arven) and `environment` (the engine never carries a content name). A pressure is read from the **system of the root event** (the events with no cause: weather and environment, threat and exploration, communities, grain, goods, economy and manpower). The frontier has no system yet, so it reads zero until 14B.
- Anna's attention is her `PlayerInput` events. Each is traced through `causedBy` to the roots it came from; its weight is split equally between the pressures those roots belong to. An input with no roots (a checkpoint with no cause) is routine and is not counted.
- `dominantCrisis` is the pressure with the largest share; the runner-up and each pressure's busiest 30 days are recorded. G-07 asks that each type is dominant in 5-45% of seeds.

### Bars not in the plan (proposed; Marko confirms before any sealed run)
- G-08 is read pooled over the three policies, each ending's share taken over all games; "at least four types in 5-60%" counts the six endings only and no ending may exceed 60%; `unresolved` is reported, not counted. The plan names no policy split; each policy is reported as well.
- Verdicts use the Wilson 90% interval: PASS if inside the bar, AMBER if only the point is, else FAIL. G-07 and G-09 use the same rule.
- Endings parameters (`fractureCommunities` 2, `fractureDays` 10, `lostForts` 2, horizon 240) are first guesses, tuned only on TUNE seeds.

## Not built in 14A
Anything that changes the world: new characters, Arven, events that end the campaign, victory and settlement.
