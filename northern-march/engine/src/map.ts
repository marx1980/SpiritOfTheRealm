// Map: routes with terrain and crossings; travel time per mode; deterministic shortest paths over open routes.
import type { Content, Mode } from "./content.ts";

const DAY = 86400;
export interface Path { locations: string[]; routes: string[]; legTicks: number[]; ticks: number }

export class MapGraph {
  private c: Content;
  private adj = new Map<string, { route: string; to: string }[]>();
  /** How fast a route is today, in permille of its usual speed (mud, snow). Unset: always the usual (Phase 10). */
  speedPermille?: (routeId: string) => number;

  constructor(c: Content) {
    this.c = c;
    for (const l of c.locations) this.adj.set(l.id, []);
    for (const r of c.routes) { this.adj.get(r.from)!.push({ route: r.id, to: r.to }); this.adj.get(r.to)!.push({ route: r.id, to: r.from }); }
    for (const list of this.adj.values()) list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.route < b.route ? -1 : 1));
  }

  legTicks(routeId: string, mode: Mode): number {
    const r = this.c.byId.route.get(routeId);
    if (!r) throw new Error(`unknown route ${routeId}`);
    const speed = this.c.scenario.movement.speedsKmPerDay[mode][r.terrain];
    const f = this.speedPermille ? this.speedPermille(routeId) : 1000;
    return (f === 1000 ? Math.ceil((r.km * DAY) / speed) : Math.ceil((r.km * DAY * 1000) / (speed * f))) + (r.crossing ? this.c.scenario.movement.crossingDelayTicks[r.crossing.kind] : 0);
  }

  /** Dijkstra; ties broken by location id, then route id, so the result never depends on hash order. */
  path(from: string, to: string, mode: Mode, isOpen: (routeId: string) => boolean): Path | null {
    if (from === to) return { locations: [from], routes: [], legTicks: [], ticks: 0 };
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, { loc: string; route: string; ticks: number }>();
    const done = new Set<string>();
    for (;;) {
      let cur: string | undefined, best = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && (d < best || (d === best && cur !== undefined && k < cur))) { best = d; cur = k; }
      if (cur === undefined) return null;
      if (cur === to) break;
      done.add(cur);
      for (const { route, to: n } of this.adj.get(cur)!) {
        if (done.has(n) || !isOpen(route)) continue;
        const t = this.legTicks(route, mode), nd = best + t;
        if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, { loc: cur, route, ticks: t }); }
      }
    }
    const locations = [to], routes: string[] = [], legTicks: number[] = [];
    for (let x = to; x !== from; ) { const p = prev.get(x)!; locations.unshift(p.loc); routes.unshift(p.route); legTicks.unshift(p.ticks); x = p.loc; }
    return { locations, routes, legTicks, ticks: dist.get(to)! };
  }
}
