// Phase 7A grain: stores, harvests and the daily tally. Whole sacks; no random draws (the shortage is caused by the raids,
// not by chance). Conservation: store = start + produced - consumed - spilled, exactly, at every place.
import type { System } from "./types.ts";
import { DAY, HOUR, loc } from "./types.ts";
import { bandOf } from "../world.ts";

export const grain: System = {
  id: "grain",
  start: (ctx) => { if (ctx.content.scenario.grain) ctx.at(DAY + 2 * HOUR, "grain:day", {}); },
  onEvent: (ctx, e) => {
    const g = ctx.content.scenario.grain;
    if (e.type === "RaidDamage" && g?.places.some((p) => p.location === e.payload.location)) ctx.at(ctx.tick, "grain:harvest", { place: e.payload.location, cause: e.id });
  },
  handlers: {
    "grain:harvest": (ctx, { place, cause }) => {
      const g = ctx.content.scenario.grain!;
      ctx.emit("HarvestDamaged", [cause], [loc(place)], { place, permille: g.harvestHitPermille, until: ctx.tick + g.harvestHitDays * DAY });
    },
    "grain:day": (ctx) => {
      const g = ctx.content.scenario.grain!;
      const changes: [string, number, number, number, number][] = [];
      const after: Record<string, number> = {};
      for (const p of [...g.places].sort((a, b) => (a.location < b.location ? -1 : 1))) {
        const hit = ctx.s.harvestHit[p.location], cut = hit && hit.until > ctx.tick ? hit.permille : 0;
        const produced = Math.floor((p.production * (1000 - cut)) / 1000);
        const have = ctx.s.grain[p.location] + produced;
        const consumed = Math.min(have, p.need), spilled = Math.max(0, have - consumed - p.cap);
        changes.push([p.location, produced, consumed, spilled, p.need - consumed]);
        after[p.location] = have - consumed - spilled;
      }
      const day = ctx.emit("GrainDay", [], changes.map(([l]) => loc(l)), { changes });
      for (const p of g.places) {
        const to = bandOf(after[p.location], p.need, g.bandDays), from = ctx.s.grainBand[p.location];
        if (to !== from) ctx.emit("ScarcityChanged", [day.id], [loc(p.location)], { place: p.location, from, to, store: after[p.location] });
      }
      ctx.at(ctx.tick + DAY, "grain:day", {});
    },
  },
};
