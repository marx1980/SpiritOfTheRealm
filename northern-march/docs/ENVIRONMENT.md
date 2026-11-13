# Environment (Phase 10)

Plan: "Seasonal cycle, rain/snow/mud, river level and freeze/thaw, flooding and route changes, harvest effects,
geological stress. Environment changes existing state only (routes, harvests, battle conditions)." Backlog P0.13
done-when: weather changes routes, harvests and battle conditions through existing state, not special cases.
Gate (plan): environmental events cause second-order consequences (route -> supply -> grievance) without an arbitrary
catastrophe function.

## 1. One daily step, state in the world
The `environment` system (ablatable) takes one step a day and records it as `EnvironmentDay` (a clock-driven snapshot).
Everything else is derived from that state; no effect is rolled on its own.

| Part | State (per province / river) | What moves it |
|---|---|---|
| Calendar | day of year, season | the day (content `startDay`, 360-day year, four seasons) |
| Weather | clear / rain / snow / storm, temperature (tenths of a degree) | season, province offset, a persistent daily anomaly, a wet/dry spell (two-state chain) |
| Ground | wetness 0-1000, days since rain | rain and melt wet it, evaporation (by season) dries it |
| Snowpack | depth in cm | snowfall when the day is cold, melt with warmth |
| River | level (1000 = flood stage), ice, flooded, frozen | rain and melt run off in proportion to wetness; the level recedes a share a day; cold days freeze it, warm days thaw it |
| Stress | 0-1000 per province | rises a little each day; released by an earthquake |

All integer arithmetic. Daily draws come from the `environment` stream on a fixed schedule (four per province a day,
used or not), so the stream stays aligned whatever else happens (G-02). Rarer hazards (fire, quake, landslide, storm
hits) use keyed draws.

## 2. How it changes what already exists
- **Routes.** A crossing closes when the river stands above its limit and reopens below a lower one (bridge 1500/1250,
  ford 950/800, ferry 750/650, and the ferry also while the river is frozen). A hill pass closes under deep snow
  (60 cm, reopens below 40) and a marsh track when the ground is waterlogged. A quake can bring a landslide down on a
  hill or forest route and it stays shut until cleared. Each closure is a `RouteClosed` event caused by the event
  that made it (`RiverFlooded`, the daily step, the quake) and a `RouteOpened` when it ends. Pathing treats a closed
  route as absent (`isOpen`), as before.
- **Travel time.** Mud and snow lose a share of speed by terrain (content `slow`), applied in `MapGraph.legTicks` for
  riders, caravans and armies alike.
- **Harvest.** Production follows the season (`growth`, mean 1000). A flood on low ground, a late frost in spring and
  a long dry spell in summer each damage the harvest of the places they touch (`CropDamaged`, the same `harvestHit`
  state raids use).
- **Fortifications.** Storms hit exposed places on stormy days (the content `exposurePermille` is the chance scale),
  fires start in long dry spells in summer and autumn, earthquakes come with stress. All three are `Hazard` events (the `Storm` event's twin, owned by `environment` so that ablating `weather` cannot break them), so condition, witnesses and letters work as before. The placeholder daily draws of the
  `weather` system run only when a scenario has no `environment` block.
- **Battle.** The setup carries the day's weather (clear / rain / snow) and the ground (mud slows every formation).
- **Supply.** An official sending for grain skips a source he cannot reach and, if none is left, the blocked attempt
  is an event (`SupplyBlocked`) caused by the closures; his later request cites both that and any damaged harvest at
  his own place.
- **What people know.** Those at either end of a route see it close or open (belief `road.closed`, the closed routes at
  their place). A castellan at a fort on the route writes at once; routine letters repeat it while it is recent. The
  ruler sees the weather where she is and the closed roads she believes in.

## 3. Gate proposal (G-18, Phase 10)
Paired arms on a sealed block, `environment` ablated (OFF) against on (ON), same seeds, 240 days from day 40:
- (a) Second-order chains: the share of ON games with a chain from an environmental first-order event (route closed,
  crop damaged) through a supply consequence (blocked supply, a delayed or refused convoy, a request caused by a damaged
  harvest) to a community grievance, found by walking `causedBy`. The attributable rate (ON minus OFF) at least 10%
  of games, lower bound of a 90% bootstrap interval above zero.
- (b) Every `RouteClosed` and `CropDamaged` has a recorded cause that reaches an `EnvironmentDay` or a quake (100%).
- (c) No catastrophe function: no event of an environmental type without a cause, and no closure or damage while the
  state it needs is absent (replayed from the log): 0 violations.
- (d) Invariants hold under three scripted policies: 0 violations.

Tool: `tools/phase10_gate.ts`. Proposals for Marko to confirm; run once when Phase 10 is frozen.

## 4. Not in this phase
- No magic (P1), no enemy that reads the weather, no weather forecasts or Selene's advice.
- Battles use the day's weather at the fort, not the hour; no night.
- Agents' planning estimates (travel times in plans) use the usual speeds, not today's mud.
- The player's order composer does not yet show today's travel times.
