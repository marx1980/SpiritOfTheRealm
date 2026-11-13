// Phase 10 (docs/ENVIRONMENT.md): the environment's state and its daily step, as pure functions of content, the previous
// state and a fixed set of draws. No randomness here and no events: the system draws, calls these, and records the result.
import type { Content, EnvironmentParams, Season } from "./content.ts";

export const DAYSEC = 86400;

export interface RegionEnv { wx: "clear" | "rain" | "snow" | "storm"; tempC10: number; anom: number; wet: number; snow: number; dry: number }
export interface RiverEnv { level: number; ice: number; frozen: boolean; flooded: boolean; floodEvent?: number }
export interface EnvState { day: number; season: Season; regions: Record<string, RegionEnv>; rivers: Record<string, RiverEnv>; stress: Record<string, number> }
export interface RegionDraws { anom: number; wet: number; heavy: number; storm: number }
export interface ClosedRoute { eventId: number; reason: string; since: number; until?: number }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const sortedKeys = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const dayOfYear = (p: EnvironmentParams, tick: number) => (p.startDay + Math.floor(tick / DAYSEC)) % p.yearDays;
export function seasonOf(p: EnvironmentParams, doy: number): Season {
  const by = [...p.seasons].sort((a, b) => a.from - b.from);
  let cur = by[by.length - 1].id; // before the first start the previous year's last season is still running
  for (const s of by) if (doy >= s.from) cur = s.id;
  return cur;
}
/** Mean temperature (tenths of a degree) by straight lines through the monthly means, each given at the middle of its month. */
export function meanTempC10(p: EnvironmentParams, doy: number): number {
  const len = Math.floor(p.yearDays / 12), x = (doy + p.yearDays - Math.floor(len / 2)) % p.yearDays, i = Math.floor(x / len), f = x - i * len;
  const a = p.monthlyMeanC10[i % 12], b = p.monthlyMeanC10[(i + 1) % 12];
  return a + Math.floor(((b - a) * f) / len);
}
export const provinceOf = (c: Content, locationId: string) => c.byId.location.get(locationId)!.province;

export function initialEnv(c: Content): EnvState | null {
  const p = c.scenario.environment;
  if (!p) return null;
  const doy = p.startDay, regions: EnvState["regions"] = {}, rivers: EnvState["rivers"] = {}, stress: EnvState["stress"] = {};
  for (const id of sortedKeys(p.regions)) {
    const cfg = p.regions[id], t = meanTempC10(p, doy) + cfg.tempOffsetC10, o = p.initial?.regions?.[id] ?? {};
    regions[id] = { wx: "clear", tempC10: t, anom: o.anom ?? 0, wet: o.wet ?? 500, snow: o.snow ?? (t < 0 ? 40 : 0), dry: o.dry ?? 0 };
    stress[id] = p.initial?.stress?.[id] ?? cfg.stressPerDay * 120;
  }
  for (const id of sortedKeys(p.rivers)) {
    const r = p.rivers[id], o = p.initial?.rivers?.[id] ?? {};
    const mean = Math.floor(Object.entries(r.basin).reduce((n, [pr, w]) => n + regions[pr].tempC10 * w, 0) / 1000);
    const ice = o.ice ?? (mean <= r.freezeBelowC10 ? r.freezeDays : 0), level = o.level ?? r.base + 100;
    rivers[id] = { level, ice, frozen: ice >= r.freezeDays, flooded: level >= r.floodStage };
  }
  return { day: doy, season: seasonOf(p, doy), regions, rivers, stress };
}

/** One day. `draws` holds each province's four fixed draws (the system draws them whether or not they are needed). */
export function stepDay(c: Content, prev: EnvState, tick: number, draws: Record<string, RegionDraws>): EnvState {
  const p = c.scenario.environment!, doy = dayOfYear(p, tick), season = seasonOf(p, doy), rain = p.rain[season];
  const regions: EnvState["regions"] = {}, stress: EnvState["stress"] = {}, water: Record<string, number> = {};
  for (const id of sortedKeys(p.regions)) {
    const o = prev.regions[id], cfg = p.regions[id], d = draws[id];
    const anom = Math.floor((o.anom * p.anomalyKeepPermille) / 1000) + d.anom;
    const temp = meanTempC10(p, doy) + cfg.tempOffsetC10 + anom;
    const chance = clamp((o.wx !== "clear" ? rain.stay : rain.start) + cfg.wetOffsetPermille, 0, 1000);
    const wet = d.wet < chance, heavy = wet && d.heavy < rain.heavy, mm = wet ? (heavy ? p.mm.heavy : p.mm.light) : 0;
    const snowing = wet && temp < p.snowBelowC10, storm = wet && !snowing && heavy && d.storm < rain.storm;
    const fall = snowing ? mm : 0, rainMm = wet && !snowing ? mm : 0;
    const melt = temp > 0 ? Math.min(o.snow + fall, Math.floor((temp * p.meltPerC10Permille) / 1000)) : 0;
    const reach = rainMm + melt; // water that reaches the ground, in mm
    const evap = Math.max(p.ground.minEvap, Math.floor((o.wet * p.ground.evapPermille[season]) / 1000));
    regions[id] = {
      wx: !wet ? "clear" : snowing ? "snow" : storm ? "storm" : "rain", tempC10: temp, anom,
      wet: clamp(o.wet - evap + reach * p.ground.wetPerMm, 0, 1000), snow: o.snow + fall - melt - Math.floor(((o.snow + fall - melt) * p.snow.settlePermille) / 1000), dry: reach > 0 ? 0 : o.dry + 1,
    };
    water[id] = reach;
    stress[id] = Math.min(1000, (prev.stress[id] ?? 0) + cfg.stressPerDay);
  }
  const rivers: EnvState["rivers"] = {};
  for (const id of sortedKeys(p.rivers)) {
    const r = p.rivers[id], o = prev.rivers[id];
    // rain and melt run off in proportion to how wet the ground already is
    let runoff = 0, mean = 0;
    for (const [pr, w] of Object.entries(r.basin)) {
      const rf = p.ground.runoffBase + Math.floor((regions[pr].wet * (1000 - p.ground.runoffBase)) / 1000);
      runoff += water[pr] * rf * w;
      mean += regions[pr].tempC10 * w;
    }
    mean = Math.floor(mean / 1000);
    const level = clamp(r.base + Math.floor(((o.level - r.base) * (1000 - r.recessPermille)) / 1000) + Math.floor((runoff * r.gainPerMm) / 1_000_000), 0, 4000);
    const ice = clamp(o.ice + (mean <= r.freezeBelowC10 ? 1 : mean >= r.thawAboveC10 ? -2 : 0), 0, 40);
    rivers[id] = {
      level, ice, frozen: o.frozen ? ice > r.freezeDays - r.thawDays : ice >= r.freezeDays,
      flooded: o.flooded ? level > Math.floor((r.floodStage * r.floodedBelowPermille) / 1000) : level >= r.floodStage,
      ...(o.floodEvent !== undefined ? { floodEvent: o.floodEvent } : {}),
    };
  }
  return { day: doy, season, regions, rivers, stress };
}

/** The provinces a route touches (its two ends). */
export const routeProvinces = (c: Content, routeId: string): string[] => {
  const r = c.byId.route.get(routeId)!;
  return [...new Set([provinceOf(c, r.from), provinceOf(c, r.to)])];
};

/** Which routes the weather and the water want closed now, and why. `closed` is what is shut already (hysteresis: a route
 *  that is shut stays shut until the water or the snow is well down). Landslides are not decided here. */
export function wantClosed(c: Content, env: EnvState, closed: Readonly<Record<string, { reason: string }>>): Record<string, string> {
  const p = c.scenario.environment!, out: Record<string, string> = {};
  for (const r of [...c.routes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const was = closed[r.id]?.reason;
    if (r.crossing) {
      const lvl = env.rivers[r.crossing.river], cr = p.crossings[r.crossing.kind];
      if (lvl.level >= cr.closeAbove || (was === "flood" && lvl.level > cr.openBelow)) { out[r.id] = "flood"; continue; }
      if (lvl.frozen && cr.frozenClosed) { out[r.id] = "ice"; continue; }
    }
    const provs = routeProvinces(c, r.id);
    if (p.snow.closes.includes(r.terrain)) {
      const depth = Math.max(...provs.map((x) => env.regions[x].snow));
      if (depth >= p.snow.closeAtCm || (was === "snow" && depth >= p.snow.openBelowCm)) { out[r.id] = "snow"; continue; }
    }
    if (p.snow.waterloggedCloses.includes(r.terrain)) {
      const wet = Math.max(...provs.map((x) => env.regions[x].wet));
      if (wet >= p.ground.waterloggedAt || (was === "waterlogged" && wet >= p.ground.waterloggedOpen)) out[r.id] = "waterlogged";
    }
  }
  return out;
}

/** Speed on a route today, in permille of the usual: mud and snow cost a share by terrain, the worse end counts. */
export function routeSpeedPermille(c: Content, env: EnvState | null, routeId: string): number {
  const p = c.scenario.environment;
  if (!p || !env) return 1000;
  const r = c.byId.route.get(routeId)!, provs = routeProvinces(c, routeId);
  const mud = Math.max(...provs.map((x) => (env.regions[x].wet >= p.ground.mudAt ? p.slow.mud[r.terrain] ?? 0 : 0)));
  const snow = Math.max(...provs.map((x) => (env.regions[x].snow >= p.snow.slowAtCm ? p.slow.snow[r.terrain] ?? 0 : 0)));
  return 1000 - Math.min(900, mud + snow);
}

/** The ground at a place today, for a battle: weather, and how much mud slows the men (permille of speed lost). */
export function groundAt(c: Content, env: EnvState | null, province: string): { weather: "clear" | "rain" | "snow"; mudPermille: number } | null {
  const p = c.scenario.environment;
  if (!p || !env) return null;
  const r = env.regions[province];
  return { weather: r.wx === "snow" ? "snow" : r.wx === "rain" || r.wx === "storm" ? "rain" : "clear", mudPermille: r.wet >= p.ground.mudAt ? p.battle.mudSlowPermille : 0 };
}

/** What the harvest does with the season: production is multiplied by this (permille; 1000 with no environment). */
export function growthPermille(c: Content, env: EnvState | null): number {
  const p = c.scenario.environment;
  return p && env ? p.growthPermille[env.season] : 1000;
}

/** Routes closed that touch a place, sorted. */
export const closedAt = (c: Content, closed: Readonly<Record<string, unknown>>, where: string): string[] =>
  c.routes.filter((r) => (r.from === where || r.to === where) && closed[r.id]).map((r) => r.id).sort();
