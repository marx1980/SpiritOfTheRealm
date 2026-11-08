// Wider economy, stage 2 (D-040): a muster calls men from a community's hands to a fort. They come armed from the fort's iron,
// some riding the fort's horses, they are paid every day of their service, and they go home at the end. No random draws.
import type { Ctx, System } from "./types.ts";
import { DAY, loc } from "./types.ts";
import { finish } from "./orders.ts";
import { contribution } from "./communities.ts";

/** The steward's muster order begins: the word has to reach the community first. */
export function startMuster(ctx: Ctx, orderId: number, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, community = o.objective.id, fort = o.constraints.find((c) => c.kind === "deliverTo")?.textKey ?? "";
  if (!ctx.content.scenario.manpower || !ctx.s.fortifications[fort] || ctx.s.hands[community] === undefined) return finish(ctx, orderId, "abandoned", cause, "noDestination");
  const pos = ctx.s.positions[o.recipient], from = "at" in pos ? pos.at : pos.transit.dest;
  const there = ctx.map.path(from, community, "rider", (r) => ctx.isOpen(r));
  if (!there) return finish(ctx, orderId, "abandoned", cause, "noRoute");
  ctx.at(ctx.tick + there.ticks, "manpower:call", { orderId, community, fort, cause });
}

export const manpower: System = {
  id: "manpower",
  start: () => {},
  handlers: {
    "manpower:call": (ctx, { orderId, community, fort, cause }) => {
      const mp = ctx.content.scenario.manpower!, o = ctx.s.orders[String(orderId)];
      if (!o || o.status !== "executing") return;
      const stop = (reason: string) => finish(ctx, orderId, "abandoned", cause, reason);
      const base = ctx.content.communities.communities.find((x) => x.id === community)?.hands ?? 0;
      const spare = Math.max(0, ctx.s.hands[community] - Math.ceil((base * mp.handsReservePermille) / 1000));
      if (spare <= 0) return stop("noHands");
      const iron = ctx.s.goods?.iron?.[fort] ?? 0;
      if (iron < mp.ironPerMan) return stop("noIron");
      const men = Math.floor((Math.min(mp.musterMen, spare, Math.floor(iron / mp.ironPerMan)) * contribution(ctx, "recruits", community)) / 1000); // a hostile people sends fewer
      if (men <= 0) return stop("refused");
      const mounted = Math.min(Math.floor((men * mp.mountedPermille) / 1000), ctx.s.goods?.horses?.[fort] ?? 0);
      const trip = ctx.map.path(community, fort, "foot", (r) => ctx.isOpen(r));
      if (!trip) return stop("noRoute");
      const musterId = ctx.s.nextMusterId;
      const ev = ctx.emit("MusterCalled", [cause], [loc(community), loc(fort), { kind: "order", id: String(orderId) }], { musterId, orderId, community, fort, men, mounted, ironUsed: men * mp.ironPerMan,
        sharePermille: base > 0 ? Math.min(1000, Math.floor((men * 1000) / base)) : 1000, until: ctx.tick + mp.serviceDays * DAY, arrivesAt: ctx.tick + trip.ticks, by: o.order.recipient });
      ctx.at(ctx.tick + trip.ticks, "manpower:arrive", { musterId, cause: ev.id });
      ctx.at(ctx.tick + mp.serviceDays * DAY, "manpower:end", { musterId, cause: ev.id });
      finish(ctx, orderId, "completed", ev.id);
    },
    "manpower:arrive": (ctx, { musterId, cause }) => {
      const m = ctx.s.musters[String(musterId)];
      if (m && !m.arrived) ctx.emit("MusterArrived", [cause], [loc(m.fort), loc(m.community)], { musterId, fort: m.fort, community: m.community, men: m.men, mounted: m.mounted });
    },
    "manpower:end": (ctx, { musterId, cause }) => {
      const m = ctx.s.musters[String(musterId)];
      if (m) ctx.emit("MusterEnded", [cause], [loc(m.fort), loc(m.community)], { musterId, fort: m.fort, community: m.community, men: m.men, mounted: m.mounted });
    },
  },
};
