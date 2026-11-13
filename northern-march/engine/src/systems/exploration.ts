// Phase 11 (docs/EXPLORATION.md, D-073): the wood. A hidden predator hunts the places round the wood and is known by the
// rumours it leaves; expeditions go in under a leader a delegate chooses; what they find, and what it costs them, changes a
// leader's reputation (so a stranger like Stefan can emerge); the Stone of Vey is found, carried, kept or delivered, one event
// at a time, so its provenance can be read back from the log. Every change of state is an event with a cause.
import type { SimEvent } from "../events.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import type { ExpeditionKind } from "../content.ts";
import { best, learn } from "./knowledge.ts";
import { travel } from "./movement.ts";
import { finish } from "./orders.ts";
import { capability } from "./agents.ts";
import type { StructuredOrder } from "../schemas.ts";
import { isDead } from "../world.ts";

const P = (ctx: Ctx) => ctx.content.scenario.wilds!;
const cap = (ctx: Ctx, who: string, domain: string) => capability(ctx.s, ctx.content, who, domain);

/** The kind of expedition an order asks for (none given: scholarly). */
export function kindOf(o: StructuredOrder): ExpeditionKind {
  return o.constraints.some((c) => c.kind === "expedition" && c.textKey === "military") ? "military" : "scholarly";
}
export const isWilds = (ctx: Ctx, o: StructuredOrder) => !!ctx.content.scenario.wilds && o.intent === "investigate" && o.objective.id === P(ctx).site;


type Cand = { id: string; recommendedBy: string; score: number };
/** The delegate weighs each candidate by trust in whoever speaks for him, fitness for this kind of expedition and his record,
 *  and draws among them (keyed): the same delegate does not always choose the same man. The weights go in the event. */
export function chooseLeader(ctx: Ctx, o: StructuredOrder, cands: Cand[]): Cand & { weights: { id: string; w: number }[] } {
  const p = P(ctx), b = ctx.s.bw!, kind = kindOf(o), L = p.leader;
  const free = (id: string) => id !== o.recipient && !(ctx.s.ordersInForce[id] ?? []).length && "at" in ctx.s.positions[id] && !isDead(ctx.s, id);
  const pool: Cand[] = cands.filter((c) => !isDead(ctx.s, c.id));
  for (const id of Object.keys(b.emerged).sort()) if (!pool.some((c) => c.id === id) && free(id)) pool.push({ id, recommendedBy: "record", score: b.rep[id] ?? 0 });
  if (!pool.length) return { ...cands[0], weights: [] };
  const weights = pool.map((c) => {
    const fit = cap(ctx, c.id, p.expedition.fitness[kind]);
    const base = Math.floor((c.score * (L.fitnessFloor + Math.floor((fit * (1000 - L.fitnessFloor)) / 1000))) / 1000);
    return { id: c.id, w: Math.max(1, base + Math.floor(((b.rep[c.id] ?? 0) * L.reputationWeight) / 1000)) };
  });
  const sharp = weights.map((x) => x.w ** L.sharpen), total = sharp.reduce((n, x) => n + x, 0);
  let d = ctx.keyed(`orders:leader:${o.id}`).int(0, total - 1), i = 0;
  while (d >= sharp[i]) { d -= sharp[i]; i++; }
  return { ...pool[i], weights };
}

// ---- the creature -------------------------------------------------------------------------------------------------

function hunt(ctx: Ctx) {
  const p = P(ctx), r = ctx.rng("exploration"), b = ctx.s.bw!;
  // a fixed schedule of draws per hunt, used or not (G-02)
  const pickDraw = r.int(0, 999999), stock = r.int(p.creature.livestock[0], p.creature.livestock[1]), person = r.int(0, 999), next = r.int(p.creature.intervalDays[0], p.creature.intervalDays[1]);
  ctx.extraDraws("exploration");
  if (!b.alive) return;
  const places = sorted(Object.entries(p.range), (x) => x[0]), total = places.reduce((n, x) => n + x[1], 0);
  let acc = 0, place = places[places.length - 1][0];
  for (const [id, w] of places) { acc += w; if (pickDraw * total < acc * 1000000) { place = id; break; } }
  const missing = person < p.creature.personPermille;
  const ev = ctx.emit("CreatureHunt", [], [loc(place)], { place, livestock: stock, missing }, "exploration");
  ctx.at(ctx.tick + next * DAY, "exploration:hunt", {});
  // the nearest officials hear of it, later and not quite as it was
  for (const who of sorted(Object.entries(ctx.s.positions).filter(([id, pos]) => ctx.s.tiers[id] === "A" && id !== ctx.content.scenario.ruler && "at" in pos).map(([id]) => id), (x) => x)) {
    const at = (ctx.s.positions[who] as { at: string }).at;
    const ticks = at === place ? 0 : ctx.map.path(place, at, "rider", () => true)?.ticks ?? Infinity;
    if (ticks <= p.rumour.radiusHours * HOUR) ctx.at(ctx.tick + ticks, "exploration:rumour", { who, cause: ev.id, place, missing });
  }
}

function rumour(ctx: Ctx, who: string, cause: number, missing: boolean) {
  const p = P(ctx), site = p.site;
  const k = ctx.keyed(`exploration:rumour:${cause}:${who}`);
  const ex = k.int(p.rumour.exaggeratePermille[0], p.rumour.exaggeratePermille[1]);
  const bump = Math.max(0, Math.floor((p.rumour.perHunt * (missing ? 2 : 1) * (1000 + ex)) / 1000));
  const prev = best(ctx, who, site, "site.rumour");
  const level = Math.min(1000, (prev && ctx.tick - prev.observedAt < 60 * DAY ? (prev.believedValue as number) : 0) + bump);
  learn(ctx, who, { subject: loc(site), predicate: "site.rumour", value: level, observedAt: ctx.tick, band: "uncertain" }, { kind: "observation", eventId: cause, source: who }, [cause]);
}

// ---- expeditions --------------------------------------------------------------------------------------------------

/** Called when a leader with an `investigate` order for the wood reaches it. */
export function startExpedition(ctx: Ctx, who: string, orderId: number, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, kind = kindOf(o);
  const ev = ctx.emit("ExpeditionStarted", [cause], [chr(who), loc(P(ctx).site), { kind: "order", id: String(orderId) }], { orderId, leader: who, kind, site: P(ctx).site });
  ctx.at(ctx.tick + DAY, "exploration:search", { orderId, day: 1, cause: ev.id });
}

function search(ctx: Ctx, orderId: number, day: number, cause: number) {
  const p = P(ctx), x = ctx.s.bw!.expeditions[String(orderId)];
  if (!x || x.ended || ctx.s.bw!.dead[x.leader]) return;
  const k = ctx.keyed(`exploration:search:${orderId}:${day}`);
  const fit = cap(ctx, x.leader, p.expedition.fitness[x.kind]);
  let outcome: string | null = null, cEv: SimEvent | null = null;
  if (ctx.s.bw!.alive && k.chancePermille(p.expedition.encounterPermille)) {
    const odds = { ...p.expedition.encounter[x.kind] };
    const shift = Math.max(-odds.killed, Math.min(odds.mauled + odds.fell > 0 ? odds.mauled : 0, Math.floor((p.expedition.skillShift * (fit - 500)) / 500)));
    odds.killed += shift; odds.mauled -= shift;
    const d = k.int(0, 999);
    const res = d < odds.killed ? "killed" : d < odds.killed + odds.fled ? "fled" : d < odds.killed + odds.fled + odds.mauled ? "mauled" : "fell";
    cEv = ctx.emit("CreatureEncountered", [cause], [chr(x.leader), loc(p.site)], { orderId, leader: x.leader, kind: x.kind, outcome: res, odds }, "exploration");
    if (res !== "killed") outcome = res;
  }
  let signs = false, hollow = false, stoneFound = false;
  if (!outcome) {
    const factor = Math.max(p.leader.fitnessFloor, fit);
    signs = !x.signs && k.chancePermille(Math.floor((p.expedition.signsPermille * factor) / 500));
    hollow = !x.hollow && k.chancePermille(Math.floor((p.expedition.hollowPermille * factor) / 500));
    const st = ctx.s.bw!.stone;
    stoneFound = (x.hollow || hollow) && !x.stone && st.at === p.site && (st.status === "hollow" || st.status === "lost") && k.chancePermille(p.stone.foundPermillePerDay);
  }
  const se = ctx.emit("SiteSearched", [cEv?.id ?? cause], [chr(x.leader), loc(p.site)], { orderId, leader: x.leader, day, signs, hollow, stone: stoneFound }, "exploration");
  if (signs) {
    learn(ctx, x.leader, { subject: loc(p.site), predicate: "site.signs", value: 700, observedAt: ctx.tick, band: "probable" }, { kind: "observation", eventId: se.id, source: x.leader }, [se.id]);
    learn(ctx, x.leader, { subject: loc(p.site), predicate: "creature.nature", value: "predator", observedAt: ctx.tick, band: "probable" }, { kind: "observation", eventId: se.id, source: x.leader }, [se.id]);
  }
  if (stoneFound) {
    const f = ctx.emit("StoneFound", [se.id], [chr(x.leader), loc(p.site)], { by: x.leader, at: p.site, orderId }, "exploration");
    const t = ctx.emit("StoneTaken", [f.id], [chr(x.leader), loc(p.site)], { holder: x.leader, at: p.site, orderId }, "exploration");
    learn(ctx, x.leader, { subject: loc(p.site), predicate: "stone.found", value: true, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: t.id, source: x.leader }, [t.id]);
    learn(ctx, x.leader, { subject: loc(p.site), predicate: "stone.properties", value: p.stone.believedLegitimacy, observedAt: ctx.tick, band: "uncertain" }, { kind: "observation", eventId: t.id, source: x.leader }, [t.id]);
  }
  const last = se.id;
  if (outcome === "fell") return end(ctx, orderId, "fell", last);
  if (outcome) return end(ctx, orderId, outcome, last);
  if (day >= p.expedition.searchDays) return end(ctx, orderId, "completed", last);
  ctx.at(ctx.tick + DAY, "exploration:search", { orderId, day: day + 1, cause: last });
}

function end(ctx: Ctx, orderId: number, outcome: string, cause: number) {
  const p = P(ctx), b = ctx.s.bw!, x = b.expeditions[String(orderId)], o = ctx.s.orders[String(orderId)].order;
  const killedHere = x.killed;
  const ee = ctx.emit("ExpeditionEnded", [cause], [chr(x.leader), loc(p.site)], { orderId, leader: x.leader, kind: x.kind, outcome, signs: x.signs, hollow: x.hollow, stone: x.stone, creatureKilled: killedHere }, "exploration");
  // performance: what he found, whether he came back, what it cost
  const R = p.reputation, why: string[] = [];
  let delta = 0;
  const add = (n: number, w: string) => { if (n) { delta += n; why.push(w); } };
  add(x.signs ? R.signs : 0, "signs"); add(x.hollow ? R.hollow : 0, "hollow"); add(x.stone ? R.stone : 0, "stone"); add(killedHere ? R.killed : 0, "killed");
  add(outcome === "completed" ? R.survived : outcome === "fled" ? R.fled : outcome === "mauled" ? R.mauled : R.fell, outcome);
  const re = ctx.emit("ReputationChanged", [ee.id], [chr(x.leader)], { who: x.leader, delta, why, orderId }, "exploration");
  if (!b.emerged[x.leader] && (b.rep[x.leader] ?? 0) >= R.activeAt)
    ctx.emit("CharacterEmerged", [re.id], [chr(x.leader)], { who: x.leader, reputation: ctx.s.bw!.rep[x.leader] }, "exploration");
  if (outcome === "fell") {
    const fe = ctx.emit("LeaderFell", [ee.id], [chr(x.leader), loc(p.site)], { leader: x.leader, at: p.site, orderId }, "exploration");
    if (b.stone.holder === x.leader) ctx.emit("StoneLost", [fe.id], [loc(p.site)], { from: x.leader, at: p.site }, "exploration");
    finish(ctx, orderId, "abandoned", fe.id, "the leader fell");
    return;
  }
  finish(ctx, orderId, outcome === "completed" ? "completed" : "abandoned", ee.id, outcome === "completed" ? undefined : "driven off by the creature");
  // home: with the Stone to whoever sent him, else to his own post
  const ch = ctx.content.byId.character.get(x.leader)!;
  if (b.stone.holder === x.leader) {
    const to = ctx.content.byId.character.get(o.issuer)!.location;
    if (!travel(ctx, x.leader, to, "rider", false, ee.id)) ctx.at(ctx.tick, "exploration:custody", { holder: x.leader, at: p.site, cause: ee.id, next: o.issuer });
  } else travel(ctx, x.leader, ch.location, "rider", false, ee.id);
}

// ---- the Stone: custody -------------------------------------------------------------------------------------------

const loyaltyTo = (ctx: Ctx, who: string, to: string) => {
  const rel = ctx.content.byId.character.get(who)!.relationships;
  return rel.find((r) => r.to === to && r.kind === "loyalty")?.value ?? rel.find((r) => r.to === to && r.kind === "trust")?.value ?? 500;
};

/** The holder of the Stone decides whether to hand it on or keep it; the reasons are recorded. */
function custody(ctx: Ctx, holder: string, at: string, cause: number, next: string) {
  const p = P(ctx), c = p.custody, b = ctx.s.bw!, ruler = ctx.content.scenario.ruler;
  if (b.stone.holder !== holder || (b.stone.status !== "carried" && b.stone.status !== "held")) return;
  const ch = ctx.content.byId.character.get(holder)!, nx = ctx.content.byId.character.get(next)!;
  const reasons: { kind: string; ref: string; weight: number }[] = [];
  let deliver = Math.floor((loyaltyTo(ctx, holder, next) * c.deliverLoyalty) / 1000);
  reasons.push({ kind: "loyalty", ref: next, weight: deliver });
  if (ch.traits.includes("loyal")) { deliver += c.deliverTrait; reasons.push({ kind: "trait", ref: "loyal", weight: c.deliverTrait }); }
  let keep = c.keepBase; reasons.push({ kind: "ambition", ref: "base", weight: -c.keepBase });
  for (const t of ["ambitious", "greedy", "proud"]) if (ch.traits.includes(t)) { keep += c.keepTrait; reasons.push({ kind: "trait", ref: t, weight: -c.keepTrait }); }
  if (ch.house !== nx.house) { keep += c.keepOtherHouse; reasons.push({ kind: "house", ref: ch.house, weight: -c.keepOtherHouse }); }
  const lure = Math.floor((c.believedWorth * p.stone.believedLegitimacy) / 1000); keep += lure; reasons.push({ kind: "belief", ref: "stone.properties", weight: -lure });
  const k = ctx.keyed(`exploration:custody:${ctx.tick}:${holder}`);
  const keeps = k.int(0, deliver + keep - 1) >= deliver;
  if (holder === ruler) return;
  if (keeps) { ctx.emit("StoneKept", [cause], [chr(holder), loc(at)], { holder, at, wouldHaveGivenTo: next, deliver, keep, reasons }, "exploration"); return; }
  const seat = nx.location;
  if (at === seat) { deliverTo(ctx, holder, next, at, cause, reasons); return; }
  const ticks = ctx.map.path(at, seat, "foot", (r) => ctx.isOpen(r))?.ticks;
  if (ticks === undefined) { ctx.emit("StoneKept", [cause], [chr(holder), loc(at)], { holder, at, wouldHaveGivenTo: next, deliver, keep, reasons: [...reasons, { kind: "road", ref: seat, weight: 0 }] }, "exploration"); return; }
  const s = ctx.emit("StoneSent", [cause], [chr(holder), chr(next), loc(at)], { holder, to: next, from: at, ticks, reasons }, "exploration");
  ctx.at(ctx.tick + ticks, "exploration:arrive", { to: next, at: seat, cause: s.id, from: holder });
}

function deliverTo(ctx: Ctx, from: string, to: string, at: string, cause: number, reasons: unknown[]) {
  const ruler = ctx.content.scenario.ruler;
  const d = ctx.emit("StoneDelivered", [cause], [chr(from), chr(to), loc(at)], { from, to, at, reasons }, "exploration");
  if (to === ruler) ctx.at(ctx.tick + P(ctx).stone.examineDays * DAY, "exploration:examine", { cause: d.id });
  else {
    const nx = ctx.content.byId.character.get(to)!;
    ctx.at(ctx.tick, "exploration:custody", { holder: to, at, cause: d.id, next: nx.reportsTo && nx.reportsTo !== to ? nx.reportsTo : ruler });
  }
}

export const exploration: System = {
  id: "exploration",
  start: (ctx) => {
    const p = ctx.content.scenario.wilds;
    if (!p) return;
    const r = ctx.rng("exploration");
    ctx.at(r.int(p.creature.firstHuntDays[0], p.creature.firstHuntDays[1]) * DAY + 20 * HOUR, "exploration:hunt", {});
  },
  onEvent: (ctx, e) => {
    // the leader who carries the Stone has come to the end of his road
    if (e.type === "Arrived" && ctx.s.bw && ctx.s.bw.stone.status === "carried" && ctx.s.bw.stone.holder === e.payload.who && e.payload.at !== P(ctx).site) {
      const who = e.payload.who as string, exp = Object.values(ctx.s.bw.expeditions).find((x) => x.leader === who && x.ended);
      const o = exp ? ctx.s.orders[String(exp.orderId)]?.order : null;
      ctx.at(ctx.tick, "exploration:custody", { holder: who, at: e.payload.at, cause: e.id, next: o ? o.issuer : ctx.content.scenario.ruler });
    }
  },
  handlers: {
    "exploration:hunt": (ctx) => hunt(ctx),
    "exploration:rumour": (ctx, { who, cause, missing }) => rumour(ctx, who, cause, missing),
    "exploration:search": (ctx, { orderId, day, cause }) => search(ctx, orderId, day, cause),
    "exploration:custody": (ctx, { holder, at, cause, next }) => custody(ctx, holder, at, cause, next),
    "exploration:arrive": (ctx, { to, at, cause, from }) => {
      const st = ctx.s.bw!.stone;
      if (st.status !== "transit" || st.toward !== to) return;
      deliverTo(ctx, from, to, at, cause, []);
    },
    "exploration:examine": (ctx, { cause }) => {
      const p = P(ctx), ruler = ctx.content.scenario.ruler;
      const ev = ctx.emit("StoneExamined", [cause], [chr(ruler)], { holder: ruler, believed: p.stone.believedLegitimacy, actual: p.stone.actualLegitimacy }, "exploration");
      learn(ctx, ruler, { subject: loc(p.site), predicate: "stone.properties", value: p.stone.actualLegitimacy, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: ev.id, source: ruler }, [ev.id]);
    },
  },
};

/** The provenance of the Stone: its custody events in order, each naming the one before it. Reconstructable from the log alone. */
export function provenance(log: readonly SimEvent[]) {
  const stone = new Set(["StoneFound", "StoneTaken", "StoneKept", "StoneSent", "StoneDelivered", "StoneLost", "StoneExamined"]);
  return log.filter((e) => stone.has(e.type)).map((e) => ({ id: e.id, tick: e.tick, type: e.type, payload: e.payload, causedBy: e.causedBy }));
}
