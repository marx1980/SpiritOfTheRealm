// Phase 7A grain: stores, harvests and the daily tally. Whole sacks; no random draws (the shortage is caused by the raids,
// not by chance). Conservation: store = start + produced - consumed - spilled, exactly, at every place.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc } from "./types.ts";
import { BANDS, bandOf } from "../world.ts";
import type { ActionRef } from "../agents/model.ts";
import { finish } from "./orders.ts";
import { best, observe, observeTreasury } from "./knowledge.ts";
import { contribution, inputsOf } from "./communities.ts";
import { delayTicks } from "./goods.ts";
import { blockedBy } from "./environment.ts";
import { growthPermille } from "../environment.ts";

/** The grain price at each market (D-050): dearer with a shortage across the realm, a tight or short granary nearest the market, a spoiled harvest there, and raiders about. */
export function grainPrices(ctx: Ctx, after: Record<string, number>): Record<string, number> | undefined {
  const g = ctx.content.scenario.grain!, m = g.market, gm = ctx.content.scenario.goods;
  if (!m || !gm) return undefined;
  const need = g.places.reduce((n, p) => n + p.need, 0), total = g.places.reduce((n, p) => n + (after[p.location] ?? 0), 0);
  const coverX10 = need > 0 ? Math.floor((total * 10) / need) : 0;
  const stockTerm = coverX10 < m.targetDays * 10 ? Math.floor(((m.targetDays * 10 - coverX10) * m.stockSlopePermille) / (m.targetDays * 10)) : 0;
  const raid = Math.max(0, ...Object.values(ctx.s.threats).map((t) => t.untilTick > ctx.tick ? t.intensityPermille : 0));
  const pos = (id: string) => ctx.content.byId.location.get(id)!.pos;
  const out: Record<string, number> = {};
  for (const t of [...gm.market.towns].sort((a, b) => (a.location < b.location ? -1 : 1))) {
    const [x, y] = pos(t.location);
    const near = [...g.places].sort((a, b) => { const da = (pos(a.location)[0] - x) ** 2 + (pos(a.location)[1] - y) ** 2, db = (pos(b.location)[0] - x) ** 2 + (pos(b.location)[1] - y) ** 2; return da - db || (a.location < b.location ? -1 : 1); })[0];
    const days = near.need > 0 ? Math.floor((after[near.location] ?? 0) / near.need) : 99, at = g.bandDays;
    const band = days >= at[0] ? 0 : days >= at[1] ? 1 : days >= at[2] ? 2 : days >= at[3] ? 3 : 4;
    const hit = ctx.s.harvestHit[near.location], spoiled = hit && hit.until > ctx.tick ? m.harvestPermille : 0;
    const term = stockTerm + band * m.bandPermille + spoiled + Math.floor((raid * m.raidPermille) / 1000);
    out[t.location] = Math.min(m.maxMilli, Math.max(m.minMilli, Math.floor((m.baseMilli * (1000 + term)) / 1000)));
  }
  return out;
}
const place = (ctx: Ctx, l: string) => ctx.content.scenario.grain!.places.find((p) => p.location === l);

/** The steward's grain order begins: the word has to reach the place (and, if told to, the people there are consulted first). */
export function startGrainOrder(ctx: Ctx, orderId: number, a: ActionRef, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, g = ctx.content.scenario.grain;
  const source = a.target!, dest = o.constraints.find((c) => c.kind === "deliverTo")?.textKey ?? "";
  const consult = o.constraints.some((c) => c.kind === "consult" && c.textKey === "yes"), market = o.constraints.some((c) => c.kind === "market");
  if (market) { // buying at a market for a granary of the realm
    const gm = ctx.content.scenario.goods;
    if (!g || !gm || a.kind !== "purchase" || !gm.market.towns.some((t) => t.location === source) || !place(ctx, dest)) return finish(ctx, orderId, "abandoned", cause, "noDestination");
    const p0 = ctx.s.positions[o.recipient], at0 = "at" in p0 ? p0.at : p0.transit.dest, word = ctx.map.path(at0, source, "rider", (r) => ctx.isOpen(r));
    if (!word) return finish(ctx, orderId, "abandoned", blockedBy(ctx, at0, source, "rider")[0] ?? cause, "noRoute");
    const asked0 = Number(o.constraints.find((c) => c.kind === "units")?.textKey);
    return void ctx.at(ctx.tick + word.ticks, "grain:ship", { orderId, kind: "purchase", source, dest, consult: false, market: true, cause, ...(asked0 > 0 ? { asked: asked0 } : {}) });
  }
  if (!g || !place(ctx, source) || !place(ctx, dest) || source === dest) return finish(ctx, orderId, "abandoned", cause, "noDestination");
  const pos = ctx.s.positions[o.recipient];
  const from = "at" in pos ? pos.at : pos.transit.dest;
  const there = ctx.map.path(from, source, "rider", (r) => ctx.isOpen(r));
  if (!there) return finish(ctx, orderId, "abandoned", blockedBy(ctx, from, source, "rider")[0] ?? cause, "noRoute");
  const asked = Number(o.constraints.find((c) => c.kind === "units")?.textKey);
  ctx.at(ctx.tick + there.ticks + (consult ? g.requisition.consultDays * DAY : 0), "grain:ship", { orderId, kind: a.kind, source, dest, consult, cause, ...(asked > 0 ? { asked } : {}) });
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
      if ((ctx.s.harvestHit[place]?.until ?? 0) > ctx.tick) return; // a spoiled harvest is spoiled once; the next raid after it recovers hits it again
      ctx.emit("HarvestDamaged", [cause], [loc(place)], { place, permille: g.harvestHitPermille, until: ctx.tick + g.harvestHitDays * DAY });
    },
    "grain:ship": (ctx, { orderId, kind, source, dest, consult, cause, official, asked, market }) => {
      const g = ctx.content.scenario.grain!, o = ctx.s.orders[String(orderId)]?.order;
      if (!official && (!o || ctx.s.orders[String(orderId)].status !== "executing")) return;
      const stop = (reason: string, why = cause) => { if (!official) finish(ctx, orderId, "abandoned", why, reason); };
      const by = official ?? o!.recipient;
      if (market) { // a purchase at a market: paid at once at the market's grain price; the sacks come from the granary with the most to spare
        const gp = g.market, price = ctx.s.grainPrice?.[source] ?? g.purchase.priceMilliPerSack, gd = place(ctx, dest);
        if (!gd) return stop("noDestination");
        const sup = [...g.places].filter((p) => p.location !== dest).map((p) => ({ p, spare: Math.max(0, ctx.s.grain[p.location] - g.purchase.reserveDays * p.need) })).filter((x) => x.spare > 0)
          .sort((x, y) => y.spare - x.spare || (x.p.location < y.p.location ? -1 : 1))[0];
        if (!sup) return stop("noSurplus");
        const sacks = Math.min(asked > 0 ? Math.min(asked, g.purchase.sacks) : g.purchase.sacks, sup.spare, Math.floor(Math.max(0, ctx.s.treasuryMilli[ctx.content.scenario.ruler]) / price));
        if (sacks <= 0) return stop("funds");
        const trip = ctx.map.path(source, dest, "foot", (r) => ctx.isOpen(r)) ?? (source === dest ? { ticks: 0 } : null);
        if (!trip) return stop("noRoute", blockedBy(ctx, source, dest, "foot")[0] ?? cause);
        void gp;
        const late = delayTicks(ctx, `g${orderId}`, trip.ticks, g.convoy);
        const sh = ctx.emit("GrainShipped", [cause], [loc(source), loc(dest), loc(sup.p.location), { kind: "order", id: String(orderId) }], { by: o!.recipient, convoyId: ctx.s.nextConvoyId, from: sup.p.location, via: source, to: dest, sacks, departedAt: ctx.tick,
          arrivesAt: ctx.tick + trip.ticks + late, orderId, how: "purchase", consulted: false, costMilli: sacks * price, payer: ctx.content.scenario.ruler, priceMilli: price, ...(late ? { delayTicks: late } : {}) });
        observeTreasury(ctx, sh.id);
        ctx.at(ctx.tick + trip.ticks + late, "grain:arrive", { convoyId: sh.payload.convoyId, cause: sh.id });
        finish(ctx, orderId, "completed", sh.id);
        return;
      }
      const sp = place(ctx, source)!, buy = kind === "purchase", rule = buy ? g.purchase : g.requisition;
      const spare = Math.max(0, ctx.s.grain[source] - rule.reserveDays * sp.need);
      let sacks = Math.min(asked > 0 ? Math.min(asked, rule.sacks) : rule.sacks, spare);
      if (buy) sacks = Math.min(sacks, Math.floor(Math.max(0, ctx.s.treasuryMilli[ctx.content.scenario.ruler]) / g.purchase.priceMilliPerSack));
      else sacks = Math.floor((sacks * contribution(ctx, "levy", source)) / 1000); // a community that refuses gives nothing
      if (sacks <= 0) return stop(spare <= 0 ? "noSurplus" : buy ? "funds" : "refused");
      const rf = g.requisition.refuse;
      if (!buy && rf && ctx.enabled("communities") && ctx.s.communities[source]) { // angry people may say no, and say it less when they were asked first
        const stood = rf.standDays !== undefined && ctx.s.grainRefusedAt[source] !== undefined && ctx.tick - ctx.s.grainRefusedAt[source] < rf.standDays * DAY; // having said no, they keep saying it for a while
        const G = inputsOf(ctx, source).G, base = Math.min(1000, Math.max(0, ((G - rf.gFloor) * rf.chancePerG) / 1000)), chance = stood ? 1000 : consult ? Math.floor((base * rf.consultedPermille) / 1000) : Math.floor(base);
        if (chance > 0 && ctx.keyed(`grain:refuse:${source}:${dest}:${ctx.tick}`).chancePermille(chance)) {
          ctx.emit("GrainRefused", [cause], [loc(source), loc(dest), ...(official ? [] : [{ kind: "order" as const, id: String(orderId) }])], { community: source, to: dest, by, orderId, grievance: G, chance, consulted: consult, stood });
          return stop("refused");
        }
      }
      const trip = ctx.map.path(source, dest, "foot", (r) => ctx.isOpen(r)); // carts walk
      if (!trip) {
        const shut = blockedBy(ctx, source, dest, "foot");
        if (official && shut.length) ctx.emit("SupplyBlocked", shut, [chr(by), loc(dest)], { place: dest, by, sources: [source] }); // he set out, and the road was shut by the time the cart was ready
        return stop("noRoute", shut[0] ?? cause);
      }
      const consulted = !buy && consult;
      const talk = consulted ? ctx.emit("GrainConsulted", [cause], [loc(source), { kind: "order", id: String(orderId) }], { community: source, orderId, by, days: g.requisition.consultDays }) : null;
      const costMilli = buy ? sacks * g.purchase.priceMilliPerSack : 0;
      const sh = ctx.emit("GrainShipped", [talk?.id ?? cause], [loc(source), loc(dest), ...(official ? [] : [{ kind: "order" as const, id: String(orderId) }])], { by, convoyId: ctx.s.nextConvoyId, from: source, to: dest, sacks, departedAt: ctx.tick,
        arrivesAt: ctx.tick + trip.ticks, orderId, how: buy ? "purchase" : "requisition", consulted, costMilli, payer: ctx.content.scenario.ruler });
      if (costMilli) observeTreasury(ctx, sh.id);
      ctx.at(ctx.tick + trip.ticks, "grain:arrive", { convoyId: sh.payload.convoyId, cause: sh.id });
      if (!official) finish(ctx, orderId, "completed", sh.id);
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
        const growth = ctx.enabled("environment") ? growthPermille(ctx.content, ctx.s.env) : 1000; // the season's share of the harvest (Phase 10)
        const raw = Math.floor((Math.floor((p.production * (1000 - cut)) / 1000) * growth) / 1000), mp = ctx.content.scenario.manpower, gone = ctx.s.musterAway[p.location] ?? 0, base = ctx.content.communities.communities.find((x) => x.id === p.location)?.hands ?? 0;
        const produced = gone > 0 && mp && base > 0 ? Math.floor((raw * (1000 - Math.min(1000, Math.floor((mp.harvestPermille * gone) / base)))) / 1000) : raw; // the men who are away are not at the harvest
        const have = ctx.s.grain[p.location] + produced;
        const consumed = Math.min(have, p.need), spilled = Math.max(0, have - consumed - p.cap);
        changes.push([p.location, produced, consumed, spilled, p.need - consumed]);
        after[p.location] = have - consumed - spilled;
      }
      const prices = grainPrices(ctx, after);
      const day = ctx.emit("GrainDay", [], changes.map(([l]) => loc(l)), { changes, ...(prices ? { prices } : {}) });
      // a fort whose stores are empty loses men to hunger
      const starving = g.places.filter((p) => after[p.location] === 0 && p.need > 0 && ctx.s.fortifications[p.location] && !ctx.s.fallen[p.location] && ctx.s.fortifications[p.location].garrison > 0)
        .map((p): [string, number] => [p.location, Math.max(1, Math.floor((ctx.s.fortifications[p.location].garrison * g.hungerPermille) / 1000))]);
      if (starving.length) ctx.emit("GarrisonStarved", [day.id], starving.map(([l]) => loc(l)), { changes: starving });
      for (const p of g.places) {
        const to = bandOf(after[p.location], p.need, g.bandDays), from = ctx.s.grainBand[p.location];
        if (to !== from) {
          // a place that got worse after its supply was blocked, or its harvest was damaged by the weather, says so (Phase 10)
          const worse = BANDS.indexOf(to as (typeof BANDS)[number]) > BANDS.indexOf(from as (typeof BANDS)[number]), sb = ctx.s.supplyBlocked[p.location], hit = ctx.s.harvestHit[p.location];
          const why = worse ? [...(sb && ctx.tick - sb.tick <= 40 * DAY ? [sb.eventId] : []), ...(hit && hit.env && hit.until > ctx.tick ? [hit.eventId] : [])] : [];
          ctx.emit("ScarcityChanged", [day.id, ...why], [loc(p.location)], { place: p.location, from, to, store: after[p.location] });
        }
      }
      // a castellan at his post looks at his own store; if it would feed his place for too few days he sends for grain himself
      for (const p of g.places) {
        const who = [...ctx.content.characters].filter((c) => c.location === p.location && c.reportsTo === ctx.content.scenario.ruler && ctx.s.tiers[c.id] !== "C").sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id;
        const pos = who ? ctx.s.positions[who] : null;
        if (!who || !pos || !("at" in pos) || pos.at !== p.location || !ctx.s.fortifications[p.location] || p.need <= 0) continue;
        const upd = observe(ctx, who, loc(p.location), "grain.stock", day.id)!;
        const cover = Math.floor(((upd.payload.prop as { believedValue: number }).believedValue) / p.need);
        const askCover = Math.max(g.official.cover, g.official.consultCover ?? 0); // below this he asks the people first; below official.cover he takes without asking
        if (cover >= askCover || Object.values(ctx.s.convoys).some((c) => c.to === p.location)) continue;
        const consult = cover >= g.official.cover;
        const asked = ctx.s.grainAsked[p.location + (consult ? "" : "!")];
        if (asked !== undefined && ctx.tick - asked < g.official.cooldownDays * DAY) continue;
        const sources = g.places.filter((x) => x.location !== p.location).map((x) => ({ x, b: best(ctx, who, x.location, "grain.stock") })).filter(({ x, b }) => b && (b.believedValue as number) >= 12 * x.need && !(g.requisition.refuse?.standDays !== undefined && ctx.s.grainRefusedAt[x.location] !== undefined && ctx.tick - ctx.s.grainRefusedAt[x.location] < g.requisition.refuse.standDays * DAY))
          .sort((a, b) => (b.b!.believedValue as number) - (a.b!.believedValue as number) || (a.x.location < b.x.location ? -1 : 1));
        // a source he cannot reach (the roads are shut) is passed over; what shut them is remembered (Phase 10)
        const shut: number[] = [];
        let from: (typeof sources)[number] | undefined, there: ReturnType<typeof ctx.map.path> = null;
        for (const cand of sources) {
          const way = ctx.map.path(p.location, cand.x.location, "rider", (r) => ctx.isOpen(r));
          if (way) { from = cand; there = way; break; }
          shut.push(...blockedBy(ctx, p.location, cand.x.location, "rider"));
        }
        const closures = [...new Set(shut)].sort((a, b) => a - b);
        if (!from || !there) {
          const sb = ctx.s.supplyBlocked[p.location];
          if (closures.length && (!sb || ctx.tick - sb.tick >= g.official.cooldownDays * DAY))
            ctx.emit("SupplyBlocked", [...closures], [chr(who), loc(p.location)], { place: p.location, by: who, sources: sources.map((x) => x.x.location) });
          continue;
        }
        const crop = ctx.s.harvestHit[p.location];
        const ask = ctx.emit("GrainAsked", [upd.id, ...closures, ...(crop && crop.env && crop.until > ctx.tick ? [crop.eventId] : [])], [chr(who), loc(p.location), loc(from.x.location)], { place: p.location, by: who, source: from.x.location, consult });
        ctx.at(ctx.tick + there.ticks + (consult ? g.requisition.consultDays * DAY : 0), "grain:ship", { orderId: 0, kind: "requisition", source: from.x.location, dest: p.location, consult, cause: ask.id, official: who });
      }
      ctx.at(ctx.tick + DAY, "grain:day", {});
    },
  },
};
