// Phase 7A grain: stores, harvests and the daily tally. Whole sacks; no random draws (the shortage is caused by the raids,
// not by chance). Conservation: store = start + produced - consumed - spilled, exactly, at every place.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, loc } from "./types.ts";
import { bandOf } from "../world.ts";
import type { ActionRef } from "../agents/model.ts";
import { finish } from "./orders.ts";
import { observeTreasury } from "./knowledge.ts";
import { contribution } from "./communities.ts";

const place = (ctx: Ctx, l: string) => ctx.content.scenario.grain!.places.find((p) => p.location === l);

/** The steward's grain order begins: the word has to reach the place (and, if told to, the people there are consulted first). */
export function startGrainOrder(ctx: Ctx, orderId: number, a: ActionRef, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, g = ctx.content.scenario.grain;
  const source = a.target!, dest = o.constraints.find((c) => c.kind === "deliverTo")?.textKey ?? "";
  const consult = o.constraints.some((c) => c.kind === "consult" && c.textKey === "yes");
  if (!g || !place(ctx, source) || !place(ctx, dest) || source === dest) return finish(ctx, orderId, "abandoned", cause, "noDestination");
  const pos = ctx.s.positions[o.recipient];
  const from = "at" in pos ? pos.at : pos.transit.dest;
  const there = ctx.map.path(from, source, "rider", (r) => ctx.isOpen(r));
  if (!there) return finish(ctx, orderId, "abandoned", cause, "noRoute");
  ctx.at(ctx.tick + there.ticks + (consult ? g.requisition.consultDays * DAY : 0), "grain:ship", { orderId, kind: a.kind, source, dest, consult, cause });
}

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
    "grain:ship": (ctx, { orderId, kind, source, dest, consult, cause }) => {
      const g = ctx.content.scenario.grain!, o = ctx.s.orders[String(orderId)]?.order;
      if (!o || ctx.s.orders[String(orderId)].status !== "executing") return;
      const sp = place(ctx, source)!, buy = kind === "purchase", rule = buy ? g.purchase : g.requisition;
      const spare = Math.max(0, ctx.s.grain[source] - rule.reserveDays * sp.need);
      let sacks = Math.min(rule.sacks, spare);
      if (buy) sacks = Math.min(sacks, Math.floor(Math.max(0, ctx.s.treasuryMilli[ctx.content.scenario.ruler]) / g.purchase.priceMilliPerSack));
      else sacks = Math.floor((sacks * contribution(ctx, "levy", source)) / 1000); // a community that refuses gives nothing
      if (sacks <= 0) return finish(ctx, orderId, "abandoned", cause, spare <= 0 ? "noSurplus" : buy ? "funds" : "refused");
      const trip = ctx.map.path(source, dest, "foot", (r) => ctx.isOpen(r)); // carts walk
      if (!trip) return finish(ctx, orderId, "abandoned", cause, "noRoute");
      const consulted = !buy && consult;
      const talk = consulted ? ctx.emit("GrainConsulted", [cause], [loc(source), { kind: "order", id: String(orderId) }], { community: source, orderId, by: o.recipient, days: g.requisition.consultDays }) : null;
      const costMilli = buy ? sacks * g.purchase.priceMilliPerSack : 0;
      const sh = ctx.emit("GrainShipped", [talk?.id ?? cause], [loc(source), loc(dest), { kind: "order", id: String(orderId) }], { convoyId: ctx.s.nextConvoyId, from: source, to: dest, sacks, departedAt: ctx.tick,
        arrivesAt: ctx.tick + trip.ticks, orderId, how: buy ? "purchase" : "requisition", consulted, costMilli, payer: ctx.content.scenario.ruler });
      if (costMilli) observeTreasury(ctx, sh.id);
      ctx.at(ctx.tick + trip.ticks, "grain:arrive", { convoyId: sh.payload.convoyId, cause: sh.id });
      finish(ctx, orderId, "completed", sh.id);
    },
    "grain:arrive": (ctx, { convoyId, cause }) => {
      const c = ctx.s.convoys[String(convoyId)], g = ctx.content.scenario.grain!;
      if (!c) return;
      const r = ctx.keyed(`grain:convoy:${convoyId}`);
      const days = Math.max(1, Math.ceil((c.arrivesAt - c.departedAt) / DAY));
      const lost = r.chancePermille(Math.min(1000, g.convoy.lossPermillePerDay * days));
      const intensity = Math.max(0, ...ctx.content.scenario.threat.sites.filter((x) => x.target === c.from || x.target === c.to).map((x) => ctx.s.threats[x.site]?.intensityPermille ?? 0));
      const seized = r.chancePermille(Math.floor((g.convoy.seizurePermilleAtFull * intensity) / 1000));
      if (lost || seized) { ctx.emit("GrainLost", [cause], [loc(c.from), loc(c.to)], { convoyId, from: c.from, to: c.to, sacks: c.sacks, reason: seized ? "seized" : "lost", orderId: c.orderId }); return; }
      const spilled = Math.max(0, ctx.s.grain[c.to] + c.sacks - place(ctx, c.to)!.cap);
      ctx.emit("GrainDelivered", [cause], [loc(c.from), loc(c.to)], { convoyId, from: c.from, to: c.to, sacks: c.sacks, spilled, orderId: c.orderId });
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
