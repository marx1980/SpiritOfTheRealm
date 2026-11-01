// Movement: characters travel along open routes at the speed of their mode. Departure and arrival are seen by
// whoever is present; departures leave word with locals (unless secret), which messengers use to redirect.
import type { Mode } from "../content.ts";
import type { Ctx, System } from "./types.ts";
import { chr, loc, sorted } from "./types.ts";
import { learn, observe } from "./knowledge.ts";

/** Those present who notice comings and goings: principal and locally relevant people (Tier A/B), not the background. */
const present = (ctx: Ctx, where: string, except: string) =>
  sorted(Object.entries(ctx.s.positions).filter(([id, p]) => id !== except && ctx.s.tiers[id] !== "C" && "at" in p && p.at === where).map(([id]) => id), (x) => x);

export function travel(ctx: Ctx, who: string, to: string, mode: Mode, secret: boolean, cause: number): boolean {
  const pos = ctx.s.positions[who];
  if (!("at" in pos) || pos.at === to) return false;
  const path = ctx.map.path(pos.at, to, mode, (r) => ctx.isOpen(r));
  if (!path) return false;
  let t = ctx.tick;
  const arrivals = path.legTicks.map((d) => (t += d));
  const dep = ctx.emit("Departed", [cause], [chr(who), loc(pos.at), loc(to)], { who, mode, from: pos.at, dest: to, path: path.locations, routes: path.routes, arrivals, secret });
  if (!secret) for (const other of present(ctx, pos.at, who))
    learn(ctx, other, { subject: chr(who), predicate: "character.location", value: to, observedAt: ctx.tick, band: "probable" },
      { kind: "observation", eventId: dep.id, source: other }, [dep.id]);
  ctx.at(arrivals[arrivals.length - 1], "movement:arrive", { who, at: to, departedEventId: dep.id });
  return true;
}

export const movement: System = {
  id: "movement",
  start: (ctx) => {
    ctx.content.scenario.scripts.forEach((s, i) => { if (s.kind === "travel") ctx.at(s.day * 86400, "movement:script", { i }); });
  },
  handlers: {
    "movement:script": (ctx, { i }) => {
      const s = ctx.content.scenario.scripts[i];
      if (s.kind !== "travel") return;
      const ev = ctx.emit("TravelScripted", [], [chr(s.who), loc(s.to)], { who: s.who, to: s.to, mode: s.mode, secret: !!s.secret });
      travel(ctx, s.who, s.to, s.mode, !!s.secret, ev.id);
    },
    "movement:arrive": (ctx, { who, at, departedEventId }) => {
      const arr = ctx.emit("Arrived", [departedEventId], [chr(who), loc(at)], { who, at });
      for (const other of present(ctx, at, who)) {
        observe(ctx, other, chr(who), "character.location", arr.id);
        if (ctx.s.tiers[who] !== "C") observe(ctx, who, chr(other), "character.location", arr.id);
      }
      // the ruler in person sees the walls she arrives at (P0.07 direct observation)
      if (who === ctx.content.scenario.ruler && ctx.s.fortifications[at]) observe(ctx, who, loc(at), "fortification.condition", arr.id);
      // arriving at the seat, she looks at the books
      if (who === ctx.content.scenario.ruler && at === ctx.content.scenario.regency.seat) observe(ctx, who, chr(who), "treasury.balance", arr.id);
    },
  },
};
