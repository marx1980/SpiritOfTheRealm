// Phase 10 (docs/ENVIRONMENT.md, D-072): the environment. One daily step of weather, ground, snow, rivers and stress
// (src/environment.ts), recorded as a snapshot; storms, fires, earthquakes, floods, closures, crop damage and the news of
// them follow from that state. Nothing here changes the world except through events, and every effect has a cause.
import type { SimEvent } from "../events.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, loc, sorted } from "./types.ts";
import { cmp } from "../world.ts";
import { provinceOf, routeProvinces, stepDay, wantClosed, type EnvState, type RegionDraws } from "../environment.ts";
import { maybeAlarm, witness } from "./physical.ts";
import { observe } from "./knowledge.ts";

const START = 1800; // half past midnight: before the grain tally and the other daily steps

/** Those at either end of a route see it shut or open; a castellan at a fort on it writes at once. */
function notice(ctx: Ctx, route: string, cause: number, closing: boolean) {
  const r = ctx.content.byId.route.get(route)!;
  for (const end of [r.from, r.to]) {
    for (const who of sorted(Object.entries(ctx.s.positions).filter(([id, p]) => "at" in p && p.at === end && ctx.s.tiers[id] !== "C").map(([id]) => id), (x) => x))
      observe(ctx, who, loc(end), "road.closed", cause);
    if (closing && ctx.s.fortifications[end]) ctx.at(ctx.tick, "messenger:urgent", { location: end, cause });
  }
}

function close(ctx: Ctx, route: string, reason: string, causes: number[], until?: number) {
  const r = ctx.content.byId.route.get(route)!;
  const ev = ctx.emit("RouteClosed", causes, [loc(r.from), loc(r.to)], { route, from: r.from, to: r.to, reason, ...(until !== undefined ? { until } : {}) });
  if (until !== undefined) ctx.at(until, "environment:clear", { route, cause: ev.id });
  notice(ctx, route, ev.id, true);
}

function reopen(ctx: Ctx, route: string, closedBy: number) {
  const r = ctx.content.byId.route.get(route)!;
  const ev = ctx.emit("RouteOpened", [closedBy], [loc(r.from), loc(r.to)], { route, from: r.from, to: r.to });
  notice(ctx, route, ev.id, false);
}

/** Storms hit exposed places on stormy days, fires start in long dry spells, earthquakes come with stress. */
function hazards(ctx: Ctx, env: EnvState, day: SimEvent) {
  const c = ctx.content, sc = c.scenario, p = sc.environment!, forts = Object.keys(ctx.s.fortifications).sort(cmp);
  const hit = (where: string, kind: string, damageMilli: number, cause: number, extra: Record<string, unknown> = {}) => {
    const before = ctx.s.fortifications[where]?.conditionMilli ?? 0;
    const e = ctx.emit("Hazard", [cause], [loc(where)], { location: where, damageMilli, kind, ...extra }, "environment");
    maybeAlarm(ctx, where, before, e.id);
    witness(ctx, where, kind, e.id);
  };
  for (const prov of Object.keys(p.regions).sort()) {
    if (env.regions[prov].wx !== "storm") continue;
    for (const l of sorted(c.locations.filter((x) => x.province === prov && x.exposurePermille > 0), (x) => x.id)) {
      const k = ctx.keyed(`environment:storm:${ctx.tick}:${l.id}`);
      if (!k.chancePermille(Math.min(1000, l.exposurePermille * p.storm.hitScale))) continue;
      hit(l.id, "storm", k.int(sc.weather.stormDamageMilli[0], sc.weather.stormDamageMilli[1]), day.id);
    }
  }
  if (sc.weather.fireDailyPermille > 0 && p.fire.seasons.includes(env.season)) {
    for (const f of forts) {
      const dry = env.regions[provinceOf(c, f)].dry;
      if (dry < p.fire.dryDays) continue;
      const k = ctx.keyed(`environment:fire:${ctx.tick}:${f}`);
      if (!k.chancePermille(Math.min(p.fire.maxPermille, sc.weather.fireDailyPermille * (dry - p.fire.dryDays + 1)))) continue;
      hit(f, "fire", k.int(sc.weather.fireDamageMilli[0], sc.weather.fireDamageMilli[1]), day.id, { dryDays: dry });
    }
  }
  if (sc.weather.quakeDailyPermille > 0) {
    for (const prov of Object.keys(p.regions).sort()) {
      const stress = env.stress[prov];
      const k = ctx.keyed(`environment:quake:${ctx.tick}:${prov}`);
      // the hazard rises with the square of the stress: nothing at low stress, a few in a hundred days at high
      if (k.int(0, 999999) >= Math.floor((sc.weather.quakeDailyPermille * p.quake.scale * stress * stress) / 1000)) continue;
      const released = Math.floor((stress * k.int(p.quake.releasePermille[0], p.quake.releasePermille[1])) / 1000);
      const sr = ctx.emit("StressReleased", [day.id], [], { province: prov, released, remaining: stress - released }, "environment");
      const places = sorted(c.locations.filter((x) => x.province === prov), (x) => x.id), epicentre = places[k.int(0, places.length - 1)].id;
      const [lo, hi] = sc.weather.quakeDamageMilli, base = lo + Math.floor(((hi - lo) * released) / 1000);
      for (const f of forts.filter((x) => provinceOf(c, x) === prov)) {
        const cond = ctx.s.fortifications[f].conditionMilli, weak = cond < 70000 ? 1000 + Math.floor(((70000 - cond) * 500) / 70000) : 1000; // old walls fall further
        hit(f, "earthquake", Math.floor((Math.floor((base * (f === epicentre ? 1000 : p.quake.neighbourPermille)) / 1000) * weak) / 1000), sr.id, { province: prov, epicentre, releasedPermille: released });
      }
      for (const r of [...c.routes].sort((a, b) => cmp(a.id, b.id))) {
        if (!p.quake.landslideTerrains.includes(r.terrain) || !routeProvinces(c, r.id).includes(prov) || ctx.s.routesClosed[r.id]) continue;
        const kk = ctx.keyed(`environment:landslide:${ctx.tick}:${r.id}`);
        if (!kk.chancePermille(Math.floor((p.quake.landslidePermilleAtFull * released) / 1000))) continue;
        close(ctx, r.id, "landslide", [sr.id], ctx.tick + kk.int(p.quake.clearDays[0], p.quake.clearDays[1]) * DAY);
      }
    }
  }
}

/** A flood on low ground, a late frost and a long dry spell damage the harvest of the places they touch, once per spell. */
function crops(ctx: Ctx, env: EnvState, day: SimEvent) {
  const sc = ctx.content.scenario, p = sc.environment!, g = sc.grain;
  if (!g) return;
  const places = sorted(g.places, (x) => x.location);
  const free = (l: string) => (ctx.s.harvestHit[l]?.until ?? 0) <= ctx.tick;
  const damage = (place: string, cause: string, h: { permille: number; days: number }, causes: number[]) =>
    ctx.emit("CropDamaged", causes, [loc(place)], { place, cause, permille: h.permille, until: ctx.tick + h.days * DAY, province: provinceOf(ctx.content, place) }, "environment");
  const spring = p.seasons.find((x) => x.id === "spring")!.from;
  for (const pl of places) {
    if (!free(pl.location)) continue;
    const prov = provinceOf(ctx.content, pl.location), reg = env.regions[prov], terrain = ctx.content.byId.location.get(pl.location)!.terrain;
    if (env.season !== "winter" && p.harvest.flood.terrains.includes(terrain)) {
      const river = Object.entries(p.rivers).find(([id, r]) => (r.basin[prov] ?? 0) > 0 && env.rivers[id].level >= p.harvest.flood.atLevel);
      if (river) { const rv = env.rivers[river[0]]; damage(pl.location, "flood", p.harvest.flood, [rv.flooded && rv.floodEvent !== undefined ? rv.floodEvent : day.id]); continue; }
    }
    const since = (env.day - spring + p.yearDays) % p.yearDays;
    if (env.season === "spring" && since >= p.harvest.frost.fromDays && since < p.harvest.frost.fromDays + p.harvest.frost.windowDays && reg.tempC10 <= p.harvest.frost.belowC10) { damage(pl.location, "frost", p.harvest.frost, [day.id]); continue; }
    if (env.season === "summer" && reg.dry >= p.harvest.drought.dryDays) damage(pl.location, "drought", p.harvest.drought, [day.id]);
  }
}

export const environment: System = {
  id: "environment",
  start: (ctx) => { if (ctx.content.scenario.environment) ctx.at(DAY + START, "environment:day", {}); },
  handlers: {
    "environment:day": (ctx) => {
      const c = ctx.content, p = c.scenario.environment!, r = ctx.rng("environment"), prev = ctx.s.env!;
      // a fixed schedule of draws, four per province a day, used or not, so the stream stays aligned whatever else happens (G-02)
      const draws: Record<string, RegionDraws> = {};
      for (const id of Object.keys(p.regions).sort()) draws[id] = { anom: r.int(-p.anomalyC10, p.anomalyC10), wet: r.int(0, 999), heavy: r.int(0, 999), storm: r.int(0, 999) };
      const next = stepDay(c, prev, ctx.tick, draws);
      const day = ctx.emit("EnvironmentDay", [], [], { day: next.day, season: next.season, regions: next.regions, rivers: next.rivers, stress: next.stress }, "environment");
      const env = ctx.s.env!;
      for (const id of Object.keys(p.rivers).sort()) {
        const was = prev.rivers[id], now = env.rivers[id];
        if (now.flooded && !was.flooded) ctx.emit("RiverFlooded", [day.id], [], { river: id, level: now.level });
        else if (!now.flooded && was.flooded) ctx.emit("RiverReceded", [was.floodEvent ?? day.id], [], { river: id, level: now.level });
        if (now.frozen && !was.frozen) ctx.emit("RiverFroze", [day.id], [], { river: id, level: now.level });
        else if (!now.frozen && was.frozen) ctx.emit("RiverThawed", [day.id], [], { river: id, level: now.level });
      }
      hazards(ctx, env, day);
      crops(ctx, env, day);
      // routes: shut where the water or the snow says so, opened when it has gone down well below that
      const want = wantClosed(c, ctx.s.env!, ctx.s.routesClosed);
      for (const rt of [...c.routes].sort((a, b) => cmp(a.id, b.id))) {
        const cur = ctx.s.routesClosed[rt.id];
        if (cur?.reason === "landslide") continue; // a landslide is cleared by hand, on its own schedule
        const why = want[rt.id];
        if (why && !cur) {
          const river = rt.crossing ? ctx.s.env!.rivers[rt.crossing.river] : null;
          close(ctx, rt.id, why, [why === "flood" && river?.flooded && river.floodEvent !== undefined ? river.floodEvent : day.id]);
        } else if (!why && cur) reopen(ctx, rt.id, cur.eventId);
      }
      ctx.extraDraws("environment");
      ctx.at(ctx.tick + DAY, "environment:day", {});
    },
    "environment:clear": (ctx, { route, cause }) => {
      const cur = ctx.s.routesClosed[route];
      if (cur && cur.eventId === cause) reopen(ctx, route, cause);
    },
  },
};

/** The closures that keep two places apart: none if there is an open way, else the events that shut the routes of the way that would be shortest if they were open. */
export function blockedBy(ctx: Ctx, from: string, to: string, mode: "rider" | "foot" | "army"): number[] {
  if (from === to || ctx.map.path(from, to, mode, (r) => ctx.isOpen(r))) return [];
  const free = ctx.map.path(from, to, mode, () => true);
  return free ? [...new Set(free.routes.filter((r) => ctx.s.routesClosed[r]).map((r) => ctx.s.routesClosed[r].eventId))].sort((a, b) => a - b) : [];
}
