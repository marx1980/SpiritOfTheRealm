// Phase 14 (D-089): the year's moods. One draw per mood at the start of a game, each from its own keyed stream (`year:<mood>`), so no shared
// stream's draw schedule changes. The choice is recorded as a root event (YearDrawn) and kept in world state; the systems read the effects
// through the small functions below. With no `scenario.year` block nothing is drawn, nothing is emitted and every function is the identity.
import type { Content, YearEffect } from "./content.ts";
import type { WorldState } from "./world.ts";
import type { Rng } from "./rng.ts";

export interface YearState { moods: Record<string, string>; effects: YearEffect[] }

/** The draws: for each mood in content order, one integer over the sum of the option weights. Returns the payload of YearDrawn, or null with no block. */
export function drawYear(c: Content, keyed: (name: string) => Rng): YearState | null {
  const y = c.scenario.year;
  if (!y) return null;
  const moods: Record<string, string> = {}, effects: YearEffect[] = [];
  for (const m of y.moods) {
    const total = m.options.reduce((n, o) => n + o.weight, 0);
    let roll = keyed(`year:${m.id}`).int(0, total - 1);
    const pick = m.options.find((o) => (roll -= o.weight) < 0)!;
    moods[m.id] = pick.id;
    const { id: _id, weight: _w, ...effect } = pick;
    effects.push(effect);
  }
  return { moods, effects };
}

type Y = Readonly<Pick<WorldState, "year">>;
const pct = (n: number | undefined) => n ?? 1000;

/** How the raiders at `site` are scaled this year, in permille of the content's numbers (1000 = as written). */
export function threatScale(s: Y, site: string): { start: number; intensity: number; duration: number } {
  let start = 1000, intensity = 1000, duration = 1000;
  for (const e of s.year?.effects ?? []) {
    const t = e.threat;
    if (!t || (t.sites && !t.sites.includes(site))) continue;
    start = Math.floor((start * pct(t.startPct)) / 1000); intensity = Math.floor((intensity * pct(t.intensityPct)) / 1000); duration = Math.floor((duration * pct(t.durationPct)) / 1000);
  }
  return { start, intensity, duration };
}

/** How far the court's thresholds move this year. */
export function courtShift(s: Y): number {
  return (s.year?.effects ?? []).reduce((n, e) => n + (e.frontier?.thresholdShift ?? 0), 0);
}

/** What the year adds to one season's weather. */
export function weatherShift(s: Y, season: string): { tempC10: number; wetPermille: number; stormPermille: number } {
  const out = { tempC10: 0, wetPermille: 0, stormPermille: 0 };
  for (const e of s.year?.effects ?? []) {
    const w = e.environment;
    if (!w || w.season !== season) continue;
    out.tempC10 += w.tempC10 ?? 0; out.wetPermille += w.wetPermille ?? 0; out.stormPermille += w.stormPermille ?? 0;
  }
  return out;
}
