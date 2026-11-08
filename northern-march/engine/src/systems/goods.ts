// Wider economy, stage 1 (D-039): timber, iron and horses. Whole units held at named places, a daily tally, a realm price
// from total stock against a target, and orders that move or buy stock as convoys, as with grain. No random draws in
// the stores themselves; only a convoy on the road can be lost. Conservation:
// store + on the road = start + produced - spilled - lost - seized - used, exactly, for every good.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, loc } from "./types.ts";
import type { ActionRef } from "../agents/model.ts";
import { finish } from "./orders.ts";
import { observeTreasury, skill } from "./knowledge.ts";
import type { Books } from "../world.ts";

const holder = (ctx: Ctx, place: string, good: string) => ctx.content.scenario.goods!.places.find((p) => p.location === place && p.cap[good] !== undefined);

/** The realm's price of a good: dearer as the stock falls short of its target, cheaper as it grows, clamped to [base/2, 3 x base]. */
export function priceOf(ctx: Ctx, good: string, total: number): number {
  const c = ctx.content.scenario.goods!.price[good];
  const raw = Math.floor((c.baseMilli * (1000 * c.target + c.slope * (c.target - total))) / (1000 * c.target));
  return Math.min(3 * c.baseMilli, Math.max(Math.floor(c.baseMilli / 2), raw));
}

/** A goods order (requisition moves stock free of coin; purchase pays today's price): the word has to reach the source first. */
export function startGoodsOrder(ctx: Ctx, orderId: number, a: ActionRef, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, g = ctx.content.scenario.goods;
  const good = o.constraints.find((c) => c.kind === "good")?.textKey ?? "", source = a.target!, dest = o.constraints.find((c) => c.kind === "deliverTo")?.textKey ?? "";
  const sell = o.constraints.some((c) => c.kind === "sell");
  if (!g || !g.kinds.includes(good) || !holder(ctx, source, good) || source === dest) return finish(ctx, orderId, "abandoned", cause, "noDestination");
  if (sell ? !g.market.towns.some((t) => t.location === dest) : !holder(ctx, dest, good)) return finish(ctx, orderId, "abandoned", cause, sell ? "noMarket" : "noDestination");
  if ((sell || a.kind === "requisition") && (holder(ctx, source, good)!.house ?? "crown") !== "crown") return finish(ctx, orderId, "abandoned", cause, "houseHolds"); // another House keeps what is its own
  const pos = ctx.s.positions[o.recipient];
  const from = "at" in pos ? pos.at : pos.transit.dest;
  const there = ctx.map.path(from, source, "rider", (r) => ctx.isOpen(r));
  if (!there) return finish(ctx, orderId, "abandoned", cause, "noRoute");
  ctx.at(ctx.tick + there.ticks, "goods:ship", { orderId, kind: a.kind, source, dest, good, sell, cause });
}

export const goods: System = {
  id: "goods",
  start: (ctx) => { if (ctx.content.scenario.goods) ctx.at(DAY + 3 * HOUR, "goods:day", {}); },
  handlers: {
    "goods:day": (ctx) => {
      const g = ctx.content.scenario.goods!, day = Math.floor(ctx.tick / DAY);
      const changes: [string, string, number, number][] = [], total: Record<string, number> = {};
      for (const k of g.kinds) total[k] = 0;
      for (const p of [...g.places].sort((a, b) => (a.location < b.location ? -1 : 1))) for (const k of g.kinds) {
        if (p.cap[k] === undefined) continue;
        const every = p.everyDays?.[k] ?? 1, made = day % every === 0 ? p.production[k] ?? 0 : 0;
        const have = ctx.s.goods[k][p.location] + made, spilled = Math.max(0, have - p.cap[k]);
        changes.push([p.location, k, made, spilled]);
        total[k] += have - spilled;
      }
      const prices: Record<string, number> = {};
      for (const k of g.kinds) prices[k] = priceOf(ctx, k, total[k]);
      // town markets recover from what the crown sold them
      const glutNow = ctx.s.townGlut ?? {}, glut: Record<string, Record<string, number>> = {};
      let anyGlut = false;
      for (const [town, byGood] of Object.entries(glutNow)) { glut[town] = {}; for (const [k, v] of Object.entries(byGood)) { glut[town][k] = Math.max(0, v - g.market.glutRecoverPermillePerDay); if (v > 0) anyGlut = true; } }
      // the steward keeps books every day (stores, prices, each town's price, what the crown has paid each House); the ruler is read them when she is at the seat
      const seat = ctx.content.scenario.regency.seat, rulerPos = ctx.s.positions[ctx.content.scenario.ruler];
      const steward = [...ctx.content.characters].filter((c) => c.role === "steward").sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id;
      const atSeat = "at" in rulerPos && rulerPos.at === seat;
      let books: Omit<Books, "tick"> | undefined;
      if (steward) {
        const q = skill(ctx, steward, "administration");
        books = { stock: {}, price: {}, town: {}, paid: { ...(ctx.s.housePaid ?? {}) } };
        for (const k of g.kinds) {
          books.stock[k] = {};
          for (const [l, good, made, spilled] of changes) if (good === k) {
            const truth = ctx.s.goods[k][l] + made - spilled, err = Math.floor((truth * (1000 - Math.floor(q / 2))) / 1200);
            books.stock[k][l] = Math.max(0, truth + ctx.keyed(`goods:books:${day}:${l}:${k}`).int(-err, err));
          }
          const e = Math.floor((prices[k] * (1000 - q)) / 3000);
          books.price[k] = Math.max(0, prices[k] + ctx.keyed(`goods:books:${day}:price:${k}`).int(-e, e));
        }
        for (const t of g.market.towns) { books.town[t.location] = {}; for (const k of g.kinds) books.town[t.location][k] = Math.floor((books.price[k] * Math.max(0, 1000 - t.spreadPermille - (glut[t.location]?.[k] ?? 0))) / 1000); }
      }
      const day0 = ctx.emit("GoodsDay", [], changes.map(([l]) => loc(l)), { changes, prices, ...(anyGlut ? { glut } : {}), ...(books ? { books, atSeat } : {}) });
      // a House spends part of what it has been paid on refilling its own store, at the usual price
      const rs = g.market.restock;
      if (rs && day > 0 && day % rs.everyDays === 0) for (const p of [...g.places].filter((x) => (x.house ?? "crown") !== "crown").sort((a, b) => (a.location < b.location ? -1 : 1))) {
        const house = p.house!, k = g.kinds.find((x) => p.cap[x] !== undefined && (p.production[x] ?? 0) > 0);
        if (!k) continue;
        const have = ctx.s.goods[k][p.location] + (changes.find(([l, good]) => l === p.location && good === k)?.[2] ?? 0) - (changes.find(([l, good]) => l === p.location && good === k)?.[3] ?? 0);
        const units = Math.min(Math.floor((Math.floor(((ctx.s.houseCoin[house] ?? 0) * rs.permille) / 1000)) / g.price[k].baseMilli), Math.max(0, p.cap[k] - have));
        if (units > 0) ctx.emit("HouseRestocked", [day0.id], [loc(p.location)], { house, place: p.location, good: k, units, costMilli: units * g.price[k].baseMilli });
      }
      ctx.at(ctx.tick + DAY, "goods:day", {});
    },
    "goods:ship": (ctx, { orderId, kind, source, dest, good, sell, cause }) => {
      const g = ctx.content.scenario.goods!, o = ctx.s.orders[String(orderId)]?.order;
      if (!o || ctx.s.orders[String(orderId)].status !== "executing") return;
      const stop = (reason: string) => finish(ctx, orderId, "abandoned", cause, reason);
      const rule = g.buy[good], buy = kind === "purchase" && !sell, house = holder(ctx, source, good)!.house ?? "crown";
      const price = buy && house !== "crown" ? Math.floor((ctx.s.goodsPrice[good] * (1000 + g.market.houseMarkupPermille)) / 1000) : ctx.s.goodsPrice[good]; // a House sells dearer
      const spare = Math.max(0, ctx.s.goods[good][source] - rule.reserveUnits);
      let units = Math.min(rule.units, spare);
      if (buy) units = Math.min(units, Math.floor(Math.max(0, ctx.s.treasuryMilli[ctx.content.scenario.ruler]) / price));
      if (units <= 0) return stop(spare <= 0 ? "noSurplus" : "funds");
      const trip = ctx.map.path(source, dest, "foot", (r) => ctx.isOpen(r)); // carts walk
      if (!trip) return stop("noRoute");
      const costMilli = buy ? units * price : 0;
      const sh = ctx.emit("GoodsShipped", [cause], [loc(source), loc(dest), { kind: "order", id: String(orderId) }], { by: o.recipient, convoyId: ctx.s.nextGoodsConvoyId, good, from: source, to: dest, units,
        departedAt: ctx.tick, arrivesAt: ctx.tick + trip.ticks, orderId, how: sell ? "sale" : buy ? "purchase" : "requisition", costMilli, priceMilli: price, payer: ctx.content.scenario.ruler, ...(buy && house !== "crown" ? { payee: house } : {}) });
      if (costMilli) observeTreasury(ctx, sh.id);
      ctx.at(ctx.tick + trip.ticks, "goods:arrive", { convoyId: sh.payload.convoyId, cause: sh.id });
      finish(ctx, orderId, "completed", sh.id);
    },
    "goods:arrive": (ctx, { convoyId, cause }) => {
      const c = ctx.s.goodsConvoys[String(convoyId)], g = ctx.content.scenario.goods!;
      if (!c) return;
      const r = ctx.keyed(`goods:convoy:${convoyId}`);
      const days = Math.max(1, Math.ceil((c.arrivesAt - c.departedAt) / DAY));
      const lost = r.chancePermille(Math.min(1000, g.convoy.lossPermillePerDay * days));
      const intensity = Math.max(0, ...ctx.content.scenario.threat.sites.filter((x) => x.target === c.from || x.target === c.to).map((x) => ctx.s.threats[x.site]?.intensityPermille ?? 0));
      const seized = r.chancePermille(Math.floor((g.convoy.seizurePermilleAtFull * intensity) / 1000));
      if (lost || seized) { ctx.emit("GoodsLost", [cause], [loc(c.from), loc(c.to)], { convoyId, good: c.good, from: c.from, to: c.to, units: c.units, reason: seized ? "seized" : "lost", orderId: c.orderId }); return; }
      if (c.how === "sale") {
        const town = g.market.towns.find((t) => t.location === c.to)!, price = ctx.s.goodsPrice[c.good], glutBefore = ctx.s.townGlut?.[c.to]?.[c.good] ?? 0;
        const proceedsMilli = Math.floor((c.units * price * Math.max(0, 1000 - town.spreadPermille - glutBefore)) / 1000), houseCutMilli = town.house === "crown" ? 0 : Math.floor((proceedsMilli * town.cutPermille) / 1000);
        const sold = ctx.emit("GoodsSold", [cause], [loc(c.from), loc(c.to)], { convoyId, good: c.good, from: c.from, to: c.to, units: c.units, priceMilli: price, proceedsMilli, houseCutMilli, house: town.house, crown: ctx.content.scenario.ruler, orderId: c.orderId, glut: Math.min(g.market.glutMaxPermille, glutBefore + c.units * g.market.glutPermillePerUnit) });
        observeTreasury(ctx, sold.id);
        return;
      }
      const spilled = Math.max(0, ctx.s.goods[c.good][c.to] + c.units - holder(ctx, c.to, c.good)!.cap[c.good]);
      ctx.emit("GoodsDelivered", [cause], [loc(c.from), loc(c.to)], { convoyId, good: c.good, from: c.from, to: c.to, units: c.units, spilled, orderId: c.orderId });
    },
  },
};
