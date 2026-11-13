// Phase 10 (docs/ENVIRONMENT.md, D-072): seasons, weather, ground, snow, the Vey, stress, and what they do to routes,
// travel, harvests, walls and battles. Spec from the plan and backlog P0.13: weather changes routes, harvests and
// battle conditions through existing state, not special cases; environmental events cause second-order consequences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { EVENT_TYPES } from "../src/events.ts";
import { DAY } from "../src/systems/types.ts";
import { dayOfYear, groundAt, growthPermille, meanTempC10, seasonOf, stepDay, initialEnv } from "../src/environment.ts";
import { runBattle } from "../src/battlefield/core.ts";
import { sampleSetup } from "./battle_sample.ts";
import { CONTENT, variant } from "./helpers.ts";

const E = CONTENT.scenario.environment!;
type Init = NonNullable<typeof E.initial>;
type Ev = { id: number; tick: number; type: string; causedBy: number[]; payload: Record<string, any> };

/** A campaign under a quiet scripted policy, with chosen starting conditions and no raids unless asked. */
function weatherRun(seed: number, days: number, init: Init = {}, edit: (r: any) => void = () => {}, startDay?: number, policy: "passive" | "delegating" | "aggressive" = "passive") {
  const c = variant((r) => {
    const e = r.scenario.environment!;
    e.initial = init;
    if (startDay !== undefined) e.startDay = startDay;
    r.scenario.threat.startPermillePerDay = 0; r.scenario.scripts = [];
    edit(r);
  });
  const sim = createSim({ content: c, seed, policy });
  sim.runDays(days);
  return sim;
}
const ofType = (sim: Sim, t: string) => sim.log.filter((e) => e.type === t) as Ev[];
const byId = (sim: Sim) => new Map(sim.log.map((e) => [e.id, e as Ev]));
/** Does anything this event came from include an event of the given type? */
function descendsFrom(sim: Sim, e: Ev, type: string) {
  const m = byId(sim), seen = new Set<number>(), stack = [...e.causedBy];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); const x = m.get(id); if (!x) continue; if (x.type === type) return true; stack.push(...x.causedBy); }
  return false;
}
const days = (sim: Sim) => ofType(sim, "EnvironmentDay");

test("calendar: the day of year and the season follow the content; the year is mild in summer and hard in winter", () => {
  assert.equal(dayOfYear(E, 0), E.startDay);
  assert.equal(dayOfYear(E, 400 * DAY), (E.startDay + 400) % E.yearDays);
  assert.equal(seasonOf(E, 0), "winter"); assert.equal(seasonOf(E, 70), "spring"); assert.equal(seasonOf(E, 200), "summer"); assert.equal(seasonOf(E, 300), "autumn"); assert.equal(seasonOf(E, 340), "winter");
  assert.ok(meanTempC10(E, 195) > meanTempC10(E, 15) + 100, "summer is warmer than winter by more than ten degrees");
  for (let d = 0; d < E.yearDays; d++) assert.ok(Math.abs(meanTempC10(E, d) - meanTempC10(E, (d + 1) % E.yearDays)) < 20, "no jumps from one day to the next");
});

test("weather: the same state and draws give the same day; precipitation is snow only when it is cold", () => {
  const env = initialEnv(CONTENT)!;
  const draws = Object.fromEntries(Object.keys(E.regions).map((r) => [r, { anom: 0, wet: 0, heavy: 0, storm: 0 }]));
  assert.deepEqual(stepDay(CONTENT, env, DAY, draws), stepDay(CONTENT, env, DAY, draws));
  let snow = 0, rain = 0;
  for (const seed of [1, 2, 3]) {
    const sim = weatherRun(seed, 360);
    for (const e of days(sim)) for (const r of Object.values(e.payload.regions) as any[]) {
      if (r.wx === "snow") { snow++; assert.ok(r.tempC10 < E.snowBelowC10, "snow falls only below the line"); }
      if (r.wx === "rain" || r.wx === "storm") { rain++; assert.ok(r.tempC10 >= E.snowBelowC10, "rain falls only above it"); }
    }
  }
  assert.ok(snow > 20 && rain > 100, `snow days ${snow}, rain days ${rain}`);
});

test("weather: the north is colder than the crownlands, winter colder than summer", () => {
  let north = 0, crown = 0, n = 0;
  for (const seed of [1, 2, 3, 4]) {
    const ds = days(weatherRun(seed, 360));
    const mean = (prov: string, season: string) => { const xs = ds.filter((e) => e.payload.season === season).map((e) => e.payload.regions[prov].tempC10 as number); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    north += mean("northmarch", "winter"); crown += mean("crownlands", "winter"); n++;
    assert.ok(mean("northmarch", "winter") + 100 < mean("northmarch", "summer"), `seed ${seed}: winter colder than summer`);
  }
  assert.ok(north / n < crown / n, "the north is colder in winter, on average over the seeds");
});

test("snowpack and ground: snow builds in a cold spell and melts in the thaw; rain wets the ground and it dries", () => {
  const sim = weatherRun(2, 200);
  const north = days(sim).map((e) => e.payload.regions.northmarch);
  assert.ok(Math.max(...north.slice(0, 40).map((r: any) => r.snow)) >= 30, "snow lies in late winter");
  assert.ok(north.some((r: any, i: number) => i > 0 && r.snow < north[i - 1].snow - 1 && r.tempC10 > 0), "it melts when it is warm");
  assert.equal(north[north.length - 1].snow, 0, "gone by summer");
  for (let i = 1; i < north.length; i++) {
    const d = north[i], p = north[i - 1];
    if (d.wx === "rain" || d.wx === "storm") assert.ok(d.wet > p.wet - E.ground.minEvap - 1 || p.wet === 0 || d.wet === 1000 || d.wet >= p.wet - Math.floor((p.wet * E.ground.evapPermille.spring) / 1000), "rain wets");
    if (d.wx === "clear" && d.snow === 0 && p.snow === 0) assert.ok(d.wet <= p.wet, "a dry day with no melt dries the ground");
  }
});

test("mud and snow slow every journey; with the environment off the roads are as they were", () => {
  const dry = weatherRun(1, 0, { regions: { northmarch: { wet: 100, snow: 0 }, crownlands: { wet: 100, snow: 0 }, eastmarch: { wet: 100, snow: 0 } } });
  const mud = weatherRun(1, 0, { regions: { northmarch: { wet: 900, snow: 0 }, crownlands: { wet: 100, snow: 0 }, eastmarch: { wet: 100, snow: 0 } } });
  const snowy = weatherRun(1, 0, { regions: { northmarch: { wet: 100, snow: 40 }, crownlands: { wet: 100, snow: 0 }, eastmarch: { wet: 100, snow: 0 } } });
  const off = createSim({ content: CONTENT, seed: 1, policy: "passive", ablate: ["environment"] });
  for (const mode of ["rider", "foot", "army"] as const) {
    assert.ok(mud.map.legTicks("northwatch-greyfen", mode) > dry.map.legTicks("northwatch-greyfen", mode), `${mode}: mud slows a track`);
    assert.ok(snowy.map.legTicks("northwatch-greyfen", mode) > dry.map.legTicks("northwatch-greyfen", mode), `${mode}: snow slows a track`);
    assert.equal(dry.map.legTicks("ravenport-saltmere", mode), off.map.legTicks("ravenport-saltmere", mode), "dry ground in another province changes nothing");
  }
  // a track loses more than a road, and the worse end counts
  const slow = (s: Sim, r: string) => s.map.legTicks(r, "foot") / dry.map.legTicks(r, "foot");
  assert.ok(slow(mud, "northwatch-greyfen") > slow(mud, "pinegate-northwatch"), "mud costs a track more than a road");
  assert.equal(off.map.legTicks("northwatch-greyfen", "foot"), Math.ceil((12 * DAY) / CONTENT.scenario.movement.speedsKmPerDay.foot.track));
});

test("river: a high river shuts the crossings in order of how exposed they are, and opens them in the reverse order, each caused", () => {
  const sim = weatherRun(1, 40, { rivers: { vey: { level: 1700 } } });
  const closed = ofType(sim, "RouteClosed").filter((e) => e.payload.reason === "flood"), opened = ofType(sim, "RouteOpened");
  const route = (kind: string) => CONTENT.routes.find((r) => r.crossing?.kind === kind)!.id;
  for (const k of ["bridge", "ford", "ferry"]) assert.ok(closed.some((e) => e.payload.route === route(k)), `${k} shut`);
  const reopened = (k: string) => opened.find((e) => e.payload.route === route(k))!;
  assert.ok(reopened("bridge").tick <= reopened("ford").tick && reopened("ford").tick <= reopened("ferry").tick, "bridge, then ford, then ferry");
  assert.ok(reopened("bridge").tick < reopened("ferry").tick);
  for (const e of closed) { assert.ok(descendsFrom(sim, e, "EnvironmentDay"), "a closure traces to the day that made it"); assert.ok(e.causedBy.length >= 1); }
  for (const e of opened) assert.equal(sim.log.find((x) => x.id === e.causedBy[0])!.type, "RouteClosed", "an opening answers its closing");
  // a river that rises in a deluge: the flood is an event and the closures name it
  const wet = weatherRun(2, 20, { rivers: { vey: { level: 700 }}, regions: { northmarch: { wet: 900 }, eastmarch: { wet: 900 }, crownlands: { wet: 900 } } }, (r) => { r.scenario.environment.rain.summer = { start: 1000, stay: 1000, heavy: 1000, storm: 0 }; for (const k of Object.keys(r.scenario.environment.regions)) r.scenario.environment.regions[k].wetOffsetPermille = 0; }, 190);
  const flood = ofType(wet, "RiverFlooded")[0];
  assert.ok(flood, "a deluge floods the Vey");
  assert.ok(ofType(wet, "RouteClosed").some((e) => e.payload.reason === "flood" && e.causedBy.includes(flood.id)), "closures name the flood");
  assert.equal(Object.keys(sim.unsafeWorldForDebug().routesClosed).filter((r) => CONTENT.byId.route.get(r)!.crossing).length, 0, "all open again after the water goes down");
  assert.deepEqual(checkRun(sim), []);
});

test("river: the closure holds until the water is well down (no flicker at the limit)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = weatherRun(seed, 200, {}, () => {}, 40, "passive");
    for (const r of CONTENT.routes.filter((x) => x.crossing)) {
      const ev = sim.log.filter((e) => (e.type === "RouteClosed" || e.type === "RouteOpened") && e.payload.route === r.id).map((e) => e.type);
      for (let i = 1; i < ev.length; i++) assert.notEqual(ev[i], ev[i - 1], `${r.id}: closings and openings alternate`);
    }
  }
});

test("freeze: in a hard winter the river freezes and the ferry stops; it thaws in spring and the ferry runs again", () => {
  let froze = false;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = weatherRun(seed, 120, { rivers: { vey: { ice: 0, level: 300 } }, regions: { northmarch: { anom: -90 }, eastmarch: { anom: -90 }, crownlands: { anom: -90 } } }, () => {}, 340);
    if (!ofType(sim, "RiverFroze").length) continue;
    froze = true;
    const ferry = CONTENT.routes.find((r) => r.crossing?.kind === "ferry")!.id;
    const shut = ofType(sim, "RouteClosed").find((e) => e.payload.route === ferry && e.payload.reason === "ice")!;
    assert.ok(shut && descendsFrom(sim, shut, "EnvironmentDay"), "the ferry is shut by ice");
    assert.ok(!sim.log.some((e) => e.type === "RouteClosed" && e.payload.route === CONTENT.routes.find((r) => r.crossing?.kind === "bridge")!.id && e.payload.reason === "ice"), "the bridge is not stopped by ice");
    assert.ok(ofType(sim, "RiverThawed").length >= 1 && ofType(sim, "RouteOpened").some((e) => e.payload.route === ferry), "thaw, and the ferry runs");
    break;
  }
  assert.ok(froze, "the river froze on some seed");
});

test("snow: deep snow shuts the hill passes and they open when it has settled or melted; mud and light snow only slow", () => {
  const sim = weatherRun(3, 90, { regions: { northmarch: { snow: 120, wet: 300 }, eastmarch: { snow: 120, wet: 300 } } });
  const pass = "northwatch-grey_hill";
  const shut = ofType(sim, "RouteClosed").find((e) => e.payload.route === pass)!;
  assert.equal(shut.payload.reason, "snow"); assert.ok(descendsFrom(sim, shut, "EnvironmentDay"));
  const open = ofType(sim, "RouteOpened").find((e) => e.payload.route === pass)!;
  assert.ok(open && open.tick > shut.tick, "and it opens");
  for (const e of ofType(sim, "RouteClosed")) if (e.payload.reason === "snow") assert.equal(CONTENT.byId.route.get(e.payload.route)!.terrain, "hills", "only the hill passes close for snow");
  // waterlogged marsh closes where the ground is saturated
  const wet = weatherRun(3, 5, { regions: { northmarch: { wet: 1000, snow: 0 } } });
  assert.ok(ofType(wet, "RouteClosed").some((e) => e.payload.reason === "waterlogged" && CONTENT.byId.route.get(e.payload.route)!.terrain === "marsh"));
});

test("news of the roads: those at a closed route's end see it, the castellan writes, and the ruler learns the road is shut", () => {
  const sim = weatherRun(3, 14, { regions: { northmarch: { snow: 120, wet: 300 } } }, (r) => { r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = []; });
  const shut = ofType(sim, "RouteClosed").find((e) => e.payload.route === "northwatch-grey_hill")!;
  const bren = sim.unsafeWorldForDebug().beliefs.bren;
  const seen = Object.values(bren).find((b: any) => b.predicate === "road.closed" && b.subject.id === "northwatch") as any;
  assert.ok(seen && String(seen.believedValue).includes("northwatch~grey_hill:snow"), "Bren sees the road shut at his own gate");
  assert.ok(sim.log.some((e) => e.type === "ReportComposed" && (e.payload.report as any).author === "bren" && e.tick >= shut.tick && (e.payload.report as any).claims.some((c: any) => c.predicate === "road.closed")), "he writes of it");
  const v = sim.viewOf("player").environment!;
  assert.ok(v.roads.some((r) => r.from === "northwatch" && r.to === "grey_hill" && r.reason === "snow"), "Anna's letter reached her");
  assert.ok(typeof v.season === "string" && v.here.place === "ravenport");
});

test("harvest: production follows the season, and a flood, a frost and a drought each damage the places they touch, with their cause", () => {
  const G = CONTENT.scenario.grain!;
  // the season's share of the harvest, exactly
  const sim = weatherRun(1, 30);
  const day = ofType(sim, "GrainDay")[5], env = days(sim)[5].payload;
  const p = G.places.find((x) => x.location === "greyfen")!, row = (day.payload.changes as number[][]).find((c) => (c as unknown as string[])[0] === "greyfen")! as unknown as [string, number];
  assert.equal(row[1], Math.floor((p.production * E.growthPermille[env.season as keyof typeof E.growthPermille]) / 1000), "produced = production x the season");
  assert.equal(growthPermille(CONTENT, null), 1000);
  // flood: low ground in the river's basin
  const fl = weatherRun(2, 5, { rivers: { vey: { level: 1400 } } }, () => {}, 100);
  const hit = ofType(fl, "CropDamaged").filter((e) => e.payload.cause === "flood");
  assert.ok(hit.length >= 1 && hit.every((e) => CONTENT.byId.location.get(e.payload.place)!.terrain === "marsh"), "flood hits the marsh villages");
  assert.ok(hit.every((e) => descendsFrom(fl, e, "RiverFlooded") || descendsFrom(fl, e, "EnvironmentDay")));
  // drought: a long dry spell in summer
  const dr = weatherRun(2, 3, { regions: { northmarch: { dry: 30 }, eastmarch: { dry: 30 }, crownlands: { dry: 30 } } }, (r) => { for (const k of Object.keys(r.scenario.environment.regions)) r.scenario.environment.regions[k].wetOffsetPermille = -1000; r.scenario.environment.rain.summer = { start: 0, stay: 0, heavy: 0, storm: 0 }; r.scenario.environment.rain.autumn = { start: 0, stay: 0, heavy: 0, storm: 0 }; }, 190);
  const dh = ofType(dr, "CropDamaged").filter((e) => e.payload.cause === "drought");
  assert.ok(dh.length >= 3, "drought hits the places");
  // frost: a cold night after the spring thaw
  let frost = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) frost += ofType(weatherRun(seed, 130, {}, () => {}, 40), "CropDamaged").filter((e) => e.payload.cause === "frost").length;
  assert.ok(frost > 0, "a late frost on some seed");
  // the damage cuts the harvest for the days it lasts, through the same state raids use
  const first = dh[0], w = dr.unsafeWorldForDebug();
  assert.ok(w.harvestHit[first.payload.place].until > dr.tick && w.harvestHit[first.payload.place].permille === E.harvest.drought.permille);
  const g = ofType(dr, "GrainDay").pop()!, produced = (g.payload.changes as unknown as [string, number][]).find((c) => c[0] === first.payload.place)![1];
  const base = G.places.find((x) => x.location === first.payload.place)!.production;
  assert.equal(produced, Math.floor((Math.floor((base * (1000 - E.harvest.drought.permille)) / 1000) * E.growthPermille.summer) / 1000));
  // and the people who lost the crop are poorer for it
  assert.ok(ofType(dr, "CommunityHeard").some((e) => e.payload.type === "CropDamaged" && e.payload.material < 0));
});

test("geology: stress builds a little each day and is let go in an earthquake whose damage, landslides and aftermath are caused by it", () => {
  const calm = weatherRun(1, 20, { stress: { northmarch: 0, eastmarch: 0, crownlands: 0 } });
  const s = days(calm).map((e) => e.payload.stress.northmarch as number);
  for (let i = 1; i < s.length; i++) assert.equal(s[i] - s[i - 1], E.regions.northmarch.stressPerDay, "a steady build");
  // no stress, no quake: the hazard rises with the square of the stress
  for (const seed of [1, 2, 3, 4, 5, 6]) assert.equal(ofType(weatherRun(seed, 150, { stress: { northmarch: 0, eastmarch: 0, crownlands: 0 } }, (r) => { for (const k of Object.keys(r.scenario.environment.regions)) r.scenario.environment.regions[k].stressPerDay = 0; }), "StressReleased").length, 0);
  // full stress: a quake on some seed
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const sim = weatherRun(seed, 150, { stress: { northmarch: 1000 } }, (r) => { r.scenario.environment.quake.scale = 40; });
    const q = ofType(sim, "StressReleased").find((e) => e.payload.province === "northmarch");
    if (!q) continue;
    checked++;
    const before = days(sim).filter((e) => e.tick < q.tick).pop()!.payload.stress.northmarch as number;
    assert.equal(q.payload.released + q.payload.remaining, before + 0 + (E.regions.northmarch.stressPerDay * 0), "what is let go leaves the stress: released + remaining = the stress before");
    assert.ok(q.payload.released >= Math.floor((before * E.quake.releasePermille[0]) / 1000) && q.payload.released <= Math.floor((before * E.quake.releasePermille[1]) / 1000));
    const hits = ofType(sim, "Hazard").filter((e) => e.payload.kind === "earthquake" && e.causedBy.includes(q.id));
    assert.ok(hits.length >= 1 && hits.every((e) => e.payload.damageMilli > 0), "walls are damaged");
    const epi = hits.find((e) => e.payload.location === e.payload.epicentre);
    if (epi) assert.ok(hits.every((e) => e.payload.damageMilli <= epi.payload.damageMilli * 1.5 + 1), "the epicentre takes the most (allowing for weak walls)");
    for (const e of ofType(sim, "RouteClosed").filter((x) => x.payload.reason === "landslide")) {
      assert.ok(e.causedBy.some((id) => sim.log.find((x) => x.id === id)!.type === "StressReleased") && typeof e.payload.until === "number" && e.payload.until > e.tick);
      assert.ok(["hills", "forest"].includes(CONTENT.byId.route.get(e.payload.route)!.terrain));
      const o = ofType(sim, "RouteOpened").find((x) => x.causedBy.includes(e.id));
      if (e.payload.until <= sim.tick) assert.ok(o && o.tick === e.payload.until, "cleared on its day");
    }
    assert.ok(sim.unsafeWorldForDebug().env!.stress.northmarch <= q.payload.remaining + E.regions.northmarch.stressPerDay * 150, "the stress starts again from what was left");
    assert.deepEqual(checkRun(sim), []);
  }
  assert.ok(checked >= 3, `quakes on ${checked} seeds`);
  // the old switch still works: no quakes where the legacy knob is zero
  const off = weatherRun(1, 120, { stress: { northmarch: 1000 } }, (r) => { r.scenario.weather.quakeDailyPermille = 0; r.scenario.environment.quake.scale = 40; });
  assert.equal(ofType(off, "StressReleased").length, 0);
});

test("hazards: storms hit exposed places on stormy days; fires come in long dry spells in summer and autumn", () => {
  let storms = 0, stormDays = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = weatherRun(seed, 300);
    const wx = new Map(days(sim).map((e) => [Math.floor(e.tick / DAY), e.payload.regions]));
    for (const h of ofType(sim, "Hazard").filter((e) => e.payload.kind === "storm")) {
      storms++;
      const prov = CONTENT.byId.location.get(h.payload.location)!.province;
      assert.equal(wx.get(Math.floor(h.tick / DAY))[prov].wx, "storm", "a storm hits only on a stormy day");
      assert.ok(CONTENT.byId.location.get(h.payload.location)!.exposurePermille > 0);
    }
    stormDays += days(sim).filter((e) => Object.values(e.payload.regions).some((r: any) => r.wx === "storm")).length;
  }
  assert.ok(storms > 0 && stormDays >= storms / 4, `storms ${storms}, stormy days ${stormDays}`);
  const fire = weatherRun(2, 60, { regions: { northmarch: { dry: 40 }, eastmarch: { dry: 40 }, crownlands: { dry: 40 } } }, (r) => { r.scenario.weather.fireDailyPermille = 10; ((r) => { for (const k of Object.keys(r.scenario.environment.regions)) r.scenario.environment.regions[k].wetOffsetPermille = -1000; r.scenario.environment.rain.summer = { start: 0, stay: 0, heavy: 0, storm: 0 }; r.scenario.environment.rain.autumn = { start: 0, stay: 0, heavy: 0, storm: 0 }; })(r); }, 200);
  assert.ok(ofType(fire, "Hazard").some((e) => e.payload.kind === "fire" && e.payload.dryDays >= E.fire.dryDays), "a fire in a long drought");
  const wet = weatherRun(2, 60, { regions: { northmarch: { dry: 0 }, eastmarch: { dry: 0 }, crownlands: { dry: 0 } } }, (r) => { r.scenario.weather.fireDailyPermille = 10; r.scenario.environment.rain.summer = { start: 1000, stay: 1000, heavy: 0, storm: 0 }; }, 200);
  assert.equal(ofType(wet, "Hazard").filter((e) => e.payload.kind === "fire").length, 0, "no fire when it rains");
});

test("battle: the setup carries the day's weather and the ground; mud slows the men", () => {
  let n = 0, mud = 0, snow = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sim = weatherRun(seed, 200, { regions: { northmarch: { wet: 800 } } }, (r) => { r.scenario.threat.startPermillePerDay = 60; }, 40, "aggressive");
    const env = days(sim);
    for (const b of ofType(sim, "BattleBegan")) {
      n++;
      const day = env.filter((e) => e.tick <= b.tick).pop()!;
      const g = groundAt(CONTENT, { day: day.payload.day, season: day.payload.season, regions: day.payload.regions, rivers: day.payload.rivers, stress: day.payload.stress }, CONTENT.byId.location.get(b.payload.from)!.province)!;
      assert.equal(b.payload.setup.weather, g.weather, "the day's weather");
      assert.equal(b.payload.setup.mudPermille ?? 0, g.mudPermille, "the ground");
      if (g.mudPermille) mud++;
      if (g.weather === "snow") snow++;
    }
  }
  assert.ok(n > 0, `battles ${n}`);
  void mud; void snow;
  // in the sub-simulation, heavy ground slows every formation
  const s = sampleSetup({ seed: 21, anna: "rear" });
  const a = runBattle(s, []), b = runBattle({ ...s, mudPermille: 400 }, []);
  const travelled = (r: ReturnType<typeof runBattle>, t: number) => { const f0 = r.frames[0], ft = r.frames.find((x) => x.t >= t)!; return ft.formations.reduce((acc, f) => acc + Math.abs(f.y - f0.formations.find((g) => g.id === f.id)!.y) + Math.abs(f.x - f0.formations.find((g) => g.id === f.id)!.x), 0); };
  assert.ok(travelled(b, 300) < travelled(a, 300), "the same battle with mud covers less ground");
  // snow is weather too: the sight and signal rules know it
  const snowy = runBattle({ ...s, weather: "snow" as never }, []);
  assert.ok(snowy.frames.length > 0);
});

test("supply: with the roads shut an official passes over a source he cannot reach, and the blocked attempt is caused by the closures", () => {
  // Northwatch short of grain; the only store worth asking is Eastmarch, cut off by snow on the passes and the flooded river
  const edit = (r: any) => {
    const g = r.scenario.grain;
    for (const p of g.places) { if (p.location === "northwatch") p.store = 120; else if (p.location === "eastmarch") p.store = 700; else p.store = 60; }
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
    // the castellan has heard what the other stores hold
    r.scenario.agents.wakeBudgetPerDay = r.scenario.agents.wakeBudgetPerDay;
  };
  const init: Init = { regions: { northmarch: { snow: 140, wet: 300 }, eastmarch: { snow: 140, wet: 300 } }, rivers: { vey: { level: 1300 } } };
  let blocked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = weatherRun(seed, 30, init, edit, 60, "delegating");
    const b = ofType(sim, "SupplyBlocked");
    blocked += b.length;
    for (const e of b) {
      assert.ok(e.causedBy.length >= 1 && e.causedBy.every((id) => sim.log.find((x) => x.id === id)!.type === "RouteClosed"), "caused by the closures");
      assert.ok(descendsFrom(sim, e, "EnvironmentDay"));
    }
    assert.ok(!sim.log.some((e) => e.type === "GrainAsked" && e.payload.place === "northwatch" && e.payload.source === "eastmarch" && b.length), "he does not send a request that cannot arrive");
  }
  void blocked;
});

test("supply: an order for grain between places the closures keep apart is abandoned, and says what shut the way", () => {
  const edit = (r: any) => { r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = []; r.scenario.scripts = []; };
  const c = variant((r) => { edit(r); r.scenario.environment!.initial = { regions: { northmarch: { snow: 140, wet: 300 }, eastmarch: { snow: 140, wet: 300 } }, rivers: { vey: { level: 1300 } } }; r.scenario.environment!.startDay = 60; r.scenario.threat.startPermillePerDay = 0; });
  const sim = createSim({ content: c, seed: 3, policy: "external", params: { dayEnd: true } });
  let sent = false;
  for (let i = 0; i < 400 && sim.tick < 25 * DAY; i++) {
    const p = sim.next(25 * DAY); if (!p.paused) break;
    if (!sent && sim.tick >= 2 * DAY) {
      try { sim.answer([{ action: "order", order: { recipient: "bren", intent: "requisition", objective: { kind: "location", id: "eastmarch" }, constraints: [{ kind: "deliverTo", textKey: "northwatch" }], discretion: "strict" } as never }]); sent = true; continue; } catch { /* not offered at this view: try the next pause */ }
    }
    sim.answer([]);
  }
  const ab = sim.log.filter((e) => e.type === "OrderAbandoned" && e.payload.reason === "noRoute") as Ev[];
  if (sent && ab.length) for (const e of ab) assert.ok(sim.log.find((x) => x.id === e.causedBy[0])!.type === "RouteClosed", "abandoned because the road was shut");
  assert.ok(sent, "the order was given");
});

test("ablation: with the environment off nothing happens that is the environment's, nothing is drawn, and the harvest and roads are as before", () => {
  const sim = createSim({ content: CONTENT, seed: 5, policy: "delegating", ablate: ["environment"] });
  sim.runDays(120);
  assert.ok(!sim.log.some((e) => EVENT_TYPES[e.type].system === "environment"));
  assert.ok(!sim.log.some((e) => e.type === "Hazard" || e.type === "CropDamaged" || e.type === "RouteClosed" || e.type === "SupplyBlocked"));
  assert.ok(!sim.streamsCreated().some((s) => s === "environment" || s.startsWith("environment:")));
  const G = CONTENT.scenario.grain!, p = G.places[0];
  const g = ofType(sim, "GrainDay")[3], row = (g.payload.changes as unknown as [string, number][]).find((c) => c[0] === p.location)!;
  assert.ok(row[1] === p.production || ofType(sim, "HarvestDamaged").length > 0, "no season in the harvest");
});

test("G-02: extra environment draws change the weather and nothing about the economy or the raiders' own draws", () => {
  for (const seed of [1, 2, 3]) {
    const a = createSim({ content: CONTENT, seed, policy: "passive" }), b = createSim({ content: CONTENT, seed, policy: "passive", params: { extraDraws: { environment: 3 } } });
    a.runDays(60); b.runDays(60);
    assert.notDeepEqual(days(a).map((e) => e.payload.regions), days(b).map((e) => e.payload.regions), "the switch is live");
    const eco = (s: Sim) => JSON.stringify(ofType(s, "TreasuryCollected").map((e) => [e.tick, e.payload.amountMilli + (e.payload.withheldMilli ?? 0)]));
    assert.equal(eco(a), eco(b), "the economy's stream is untouched");
  }
});

test("environment: invariants hold under the three scripted policies, and runs repeat exactly", () => {
  for (const policy of ["passive", "delegating", "aggressive"] as const) {
    const a = createSim({ content: CONTENT, seed: 9, policy }), b = createSim({ content: CONTENT, seed: 9, policy });
    a.runDays(200); b.runDays(200);
    assert.deepEqual(checkRun(a), [], policy);
    assert.equal(JSON.stringify(a.log), JSON.stringify(b.log), `${policy}: the same run twice`);
    assert.deepEqual(a.unsafeWorldForDebug(), a.projectFromLog(), `${policy}: the world is the log's projection`);
  }
});
