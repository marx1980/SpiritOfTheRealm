// A7: ViewOf(agent | player). The only window UI, planners and policies get onto the world: the viewer's own
// beliefs (with staleness applied on read), reports delivered to them, their own orders and position, and the clock.
import { BANDS, effectiveBand, type BeliefProposition, type EffectiveBand } from "./beliefs.ts";
import type { BattleOrder, FieldSpec, HqFrame, Note, Task } from "./battlefield/core.ts";
import { battleRecord } from "./battlefield/record.ts";
const DAY_TICKS = 86400;
import type { Content } from "./content.ts";
import { INTENTS, type Constraint, type Contingency, type IntentKind, type Recommendation, type ReportingPolicy, type StructuredOrder } from "./schemas.ts";
import type { IssuedRecord, Position, WorldState } from "./world.ts";
import type { PlayerAction } from "./policies.ts";
// Types the presentation layer needs, re-exported here so presentation imports only this window (test/view.test.ts).
export type { PlayerAction, Recommendation, Task, BattleOrder };

/** Advice heard more than this long ago is no longer shown as standing advice. */
export const ADVICE_FRESH = 15 * 86400;

/** Skill names as people in the realm would say them. */
export const AREA: Record<string, string> = { engineering: "Construction", military: "Military", intelligence: "Intelligence", administration: "Administration" };
/** The strongest skill (ties: alphabetical) as the area someone is known for. */
export function areaOf(caps: Record<string, number>): string {
  const best = Object.entries(caps).filter(([k]) => k in AREA).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best ? AREA[best[0]] : "";
}

export type BeliefView = BeliefProposition & { effectiveBand: EffectiveBand; ageTicks: number };
export interface DeliveredReport {
  reportId: number; author: string; subject: { kind: string; id: string }; claims: BeliefProposition[];
  composedAt: number; deliveredAt: number; route: string[]; authorBias?: string[];
}
/** Static knowledge anyone in the realm has: the map and the names of places and of people they know of. */
export interface WorldKnowledge {
  places: { id: string; name: string; province: string; kind: string; terrain: string; pos: [number, number]; fortified: boolean }[];
  routes: { from: string; to: string; crossing?: string }[];
  names: Record<string, string>;
  /** The rules a standing policy can name, by area (Phase 9). */
  policy?: Record<string, string[]>;
  /** Whom a ruler sends to look into talk of the wild site (Phase 11). */
  envoy?: string;
  /** What each known person is known for: their strongest skill, in words (the area they advise on). */
  areas: Record<string, string>;
  /** What each store feeds each day, and the days of cover that mark the scarcity bands: the stewards know their own needs. */
  grain?: { places: { id: string; need: number }[]; bandDays: number[]; sacks: { requisition: number; purchase: number } };
  /** What anyone in the realm knows of the wider trade: who holds which store, where goods sell, the usual prices, what a muster takes. Not the stocks. */
  goods?: {
    kinds: string[];
    stores: { id: string; house: string; kinds: string[] }[];
    towns: { id: string; house: string; spreadPermille: number; cutPermille: number }[];
    markupPermille: number;
    price: Record<string, { baseMilli: number; minMilli: number; maxMilli: number }>;
    unitsPerOrder: Record<string, number>;
    reserveUnits: Record<string, number>;
    muster?: { arms?: Record<"foot" | "archers" | "horse", { iron: number; timber: number; horses: number }>; men: number; ironPerMan: number; mountedPermille: number; serviceDays: number; wageMilli: number; communities: string[] };
  };
}
export interface EnvironmentView {
  season: string; day: number;
  here: { place: string; wx: string; tempC10: number; snow: number; wet: number };
  roads: { from: string; to: string; reason: string; observedAt: number }[];
}
export interface View {
  readonly now: number;
  readonly self: { readonly id: string; readonly position: Position; readonly ordersInForce: readonly StructuredOrder[]; readonly orders: readonly IssuedRecord[]; readonly policies?: Readonly<Record<string, { rule: string; learnedAt: number }>> };
  readonly beliefs: Readonly<Record<string, Readonly<BeliefView>>>;
  readonly reports: readonly DeliveredReport[];
  /** What advisers told the viewer in person, latest per adviser (DESIGN_PIPELINE §5). */
  readonly advice: readonly Recommendation[];
  readonly world: WorldKnowledge;
  /** Phase 10: the season, the weather where the viewer is, and the roads they believe shut (what they saw or were told). */
  readonly environment?: EnvironmentView;
  /** The steward's books as last read out to the ruler at the seat (stocks and going prices, with his error); the ruler's view only. */
  /** The battle the ruler is fighting in (or has just fought): headquarters' picture only, never the field as it is (D-060). */
  readonly battle?: BattleView;
  readonly ledger?: { readonly tick: number; readonly stock: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly price: Readonly<Record<string, number>>; readonly town: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly paid: Readonly<Record<string, number>>; readonly buy?: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly grain?: Readonly<Record<string, number>> };
}

export interface BattleView {
  readonly id: number; readonly place: string; readonly site: string; readonly startTick: number; readonly t: number; readonly endsBy: number;
  readonly field: FieldSpec; readonly hq: HqFrame; readonly history: readonly HqFrame[];
  /** What headquarters knows happened: her orders going out, reports coming in, warnings, the end. */
  readonly notes: readonly Note[];
  readonly myOrders: readonly BattleOrder[];
  readonly commanders: readonly { readonly id: string; readonly name: string; readonly formations: readonly string[] }[];
  readonly signals: readonly { readonly id: string; readonly task: Task }[];
  readonly ended?: { readonly winner: string; readonly reason: string };
}
const HQ_NOTES = new Set(["report_received", "danger", "end", "fall_known"]);
function battleView(s: Readonly<WorldState>, c: Content, who: string, now: number): BattleView | undefined {
  if (who !== c.scenario.ruler) return undefined;
  const st = Object.values(s.battles).filter((b) => b.setup.ruler.present && (b.status === "running" || now - (b.startTick + (b.result?.endT ?? 0)) < DAY_TICKS)).sort((a, b) => b.startTick - a.startTick)[0];
  if (!st) return undefined;
  const t = Math.max(0, Math.min(now - st.startTick, st.result?.endT ?? st.setup.endT));
  const r = battleRecord(st, st.status === "running" ? t : undefined);
  const hist = r.hq.filter((h) => h.t <= t);
  const mine = new Set(st.orders.map((o) => o.id));
  return {
    id: st.setup.battleId, place: st.setup.place, site: st.site, startTick: st.startTick, t, endsBy: st.setup.endT, field: structuredClone(st.setup.field),
    hq: structuredClone(hist[hist.length - 1] ?? r.hq[0]), history: structuredClone(hist),
    notes: structuredClone(r.notes.filter((n) => n.t <= t && ((n.kind === "order_sent" && mine.has(n.orderId ?? -1)) || (HQ_NOTES.has(n.kind) && (n.kind !== "end" || st.status === "ended"))))),
    myOrders: structuredClone(st.orders),
    commanders: st.setup.commanders.filter((x) => x.side === "crown" && x.id !== who).map((x) => ({ id: x.id, name: x.name, formations: [...x.formations] })),
    signals: structuredClone(st.setup.signals),
    ...(st.status === "ended" && st.result ? { ended: { winner: st.result.winner, reason: st.result.reason } } : {}),
  };
}

/** A battle order is valid against what headquarters knows: a commander in this battle (or herself), places on the
 *  field, a formation headquarters has seen, a signal only for a meaning agreed before the fight. */
export function validateBattleDraft(v: View, d: { to: string; task: Task; via: string; signal?: string; delay?: number } | undefined): string[] {
  const b = v.battle, out: string[] = [];
  if (!b || b.ended) return ["there is no battle in progress here"];
  if (!d) return ["no battle order"];
  if (d.to !== v.self.id && !b.commanders.some((c) => c.id === d.to)) out.push(`${d.to} is not in this battle`);
  if (!["hold", "advance", "attack", "withdraw", "give_ground", "protect"].includes(d.task.kind)) out.push(`unknown task ${d.task.kind}`);
  if (d.task.place && !b.field.places.some((p) => p.id === d.task.place)) out.push(`no place ${d.task.place} on this field`);
  if (d.task.limit && !b.field.lines.some((l) => l.id === d.task.limit)) out.push(`no line ${d.task.limit} on this field`);
  if (d.task.target && !b.hq.marks.some((m) => m.id === d.task.target)) out.push(`headquarters knows of no ${d.task.target}`);
  // Phase 12 sector delegation: only commanders in this battle can be put under another
  for (const id of d.task.command ?? []) if (id === d.to || id === v.self.id || !b.commanders.some((c) => c.id === id)) out.push(`${id} cannot be put under ${d.to}`);
  if (!["runner", "signal", "voice"].includes(d.via)) out.push(`cannot send by ${d.via}`);
  if (d.delay !== undefined && !(Number.isInteger(d.delay) && d.delay >= 0 && d.delay <= 3600)) out.push("the time spent talking must be 0 to 3,600 seconds");
  if (d.via === "signal" && !b.signals.some((s) => s.id === d.signal)) out.push("a signal must be one agreed before the battle");
  return out;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

function envView(s: Readonly<WorldState>, c: Content, who: string, beliefs: Record<string, BeliefView>): EnvironmentView {
  const pos = s.positions[who], place = "at" in pos ? pos.at : pos.transit.from, reg = s.env!.regions[c.byId.location.get(place)!.province];
  const roads: EnvironmentView["roads"] = [];
  const bs = Object.values(beliefs).filter((b) => b.predicate === "road.closed");
  for (const r of c.routes) {
    const at = bs.filter((b) => b.subject.id === r.from || b.subject.id === r.to).sort((a, b) => b.observedAt - a.observedAt || b.id - a.id)[0];
    const tok = at && String(at.believedValue).split(",").find((t) => t.startsWith(`${r.from}~${r.to}:`));
    if (tok) roads.push({ from: r.from, to: r.to, reason: tok.split(":")[1], observedAt: at.observedAt });
  }
  return { season: s.env!.season, day: s.env!.day, here: { place, wx: reg.wx, tempC10: reg.tempC10, snow: reg.snow, wet: reg.wet }, roads };
}

export function buildView(s: Readonly<WorldState>, c: Content, who: string, now: number): View {
  const beliefs: Record<string, BeliefView> = {};
  for (const [id, p] of Object.entries(s.beliefs[who] ?? {})) {
    const band = effectiveBand(p, now, c.byId.predicate.get(p.predicate)?.halfLifeTicks ?? 0);
    if (band !== "stale") beliefs[id] = { ...structuredClone(p), effectiveBand: band, ageTicks: now - p.observedAt };
  }
  const reports: DeliveredReport[] = Object.values(s.reports)
    .filter((r) => r.recipient === who && r.status === "delivered")
    .map((r) => ({ reportId: r.id, author: r.author, subject: r.subject, claims: structuredClone(r.claims), composedAt: r.composedAt, deliveredAt: r.deliveredAt!,
      route: [...r.route], ...(r.authorBias ? { authorBias: [...r.authorBias] } : {}) }))
    .sort((a, b) => a.deliveredAt - b.deliveredAt || a.reportId - b.reportId); // in the order they arrived
  const known = new Set<string>([who, ...Object.values(beliefs).filter((b) => b.subject.kind === "character").map((b) => b.subject.id), ...reports.map((r) => r.author)]);
  return deepFreeze({
    now,
    self: { id: who, position: structuredClone(s.positions[who]), ordersInForce: (s.ordersInForce[who] ?? []).map((id) => structuredClone(s.orders[String(id)].order)),
      orders: structuredClone(s.issued[who] ?? []), ...(s.policyKnown?.[who] ? { policies: structuredClone(s.policyKnown[who]) } : {}) },
    beliefs,
    reports,
    ...(who === c.scenario.ruler && s.ledger ? { ledger: structuredClone(s.ledger) } : {}),
    ...((): { battle?: BattleView } => { const bv = battleView(s, c, who, now); return bv ? { battle: bv } : {}; })(),
    advice: Object.values(s.heard[who] ?? {}).filter((r) => now - r.computedAt <= ADVICE_FRESH).map((r) => structuredClone(r))
      .sort((a, b) => (a.author < b.author ? -1 : a.author > b.author ? 1 : b.computedAt - a.computedAt || a.id - b.id)),
    ...(c.scenario.environment && s.env ? { environment: envView(s, c, who, beliefs) } : {}),
    world: {
      places: c.locations.map((l) => ({ id: l.id, name: l.name, province: l.province, kind: l.kind, terrain: l.terrain, pos: [...l.pos] as [number, number], fortified: !!l.fortification })),
      routes: c.routes.map((r) => ({ from: r.from, to: r.to, ...(r.crossing ? { crossing: r.crossing.kind } : {}) })),
      ...(c.scenario.policy ? { policy: structuredClone(c.scenario.policy.rules) } : {}),
      ...(c.scenario.wilds ? { envoy: c.scenario.wilds.envoy } : {}),
      names: Object.fromEntries([...c.locations.map((l) => [l.id, l.name]), ...[...known].sort().map((id) => [id, c.byId.character.get(id)?.name ?? id])]),
      areas: Object.fromEntries([...known].sort().map((id) => [id, areaOf(c.byId.character.get(id)?.capabilities ?? {})])),
      ...(c.scenario.goods ? { goods: {
        kinds: [...c.scenario.goods.kinds],
        stores: c.scenario.goods.places.map((p) => ({ id: p.location, house: p.house ?? "crown", kinds: Object.keys(p.cap).sort() })),
        towns: c.scenario.goods.market.towns.map((t) => ({ id: t.location, house: t.house, spreadPermille: t.spreadPermille, cutPermille: t.cutPermille })),
        markupPermille: c.scenario.goods.market.houseMarkupPermille,
        price: Object.fromEntries(c.scenario.goods.kinds.map((k) => [k, { baseMilli: c.scenario.goods!.price[k].baseMilli, minMilli: Math.floor(c.scenario.goods!.price[k].baseMilli / 2), maxMilli: 3 * c.scenario.goods!.price[k].baseMilli }])),
        unitsPerOrder: Object.fromEntries(c.scenario.goods.kinds.map((k) => [k, c.scenario.goods!.buy[k].units])),
        reserveUnits: Object.fromEntries(c.scenario.goods.kinds.map((k) => [k, c.scenario.goods!.buy[k].reserveUnits])),
        ...(c.scenario.manpower ? { muster: { ...(c.scenario.manpower.arms ? { arms: c.scenario.manpower.arms } : {}), men: c.scenario.manpower.musterMen, ironPerMan: c.scenario.manpower.ironPerMan, mountedPermille: c.scenario.manpower.mountedPermille, serviceDays: c.scenario.manpower.serviceDays, wageMilli: c.scenario.manpower.wageMilli, communities: c.communities.communities.map((x) => x.id).sort() } } : {}),
      } } : {}),
      ...(c.scenario.grain ? { grain: { places: c.scenario.grain.places.map((p) => ({ id: p.location, need: p.need })), bandDays: [...c.scenario.grain.bandDays], sacks: { requisition: c.scenario.grain.requisition.sacks, purchase: c.scenario.grain.purchase.sacks } } } : {}),
    },
  });
}

/** What the viewer believes about one subject and predicate, best first (band, then freshness, then id). */
export function beliefsAbout(v: View, subjectId: string, predicate: string): BeliefView[] {
  return Object.values(v.beliefs).filter((b) => b.subject.id === subjectId && b.predicate === predicate)
    .sort((a, b) => BANDS.indexOf(b.effectiveBand) - BANDS.indexOf(a.effectiveBand) || b.observedAt - a.observedAt || a.id - b.id);
}

export interface OrderDraft {
  recipient: string; intent: IntentKind; objective: { kind: "location" | "character"; id: string };
  discretion?: StructuredOrder["discretion"]; constraints?: Constraint[]; contingencies?: Contingency[]; reportingPolicy?: ReportingPolicy;
}

/** A draft order is valid only against what the issuer knows (A7, ARCHITECTURE §20.11): a recipient they know where
 *  to find, a place on their map or a person they know of, an intent from the frozen list. */
export function validateDraft(v: View, d: OrderDraft): string[] {
  const out: string[] = [];
  if (!INTENTS.includes(d.intent)) out.push(`unknown intent ${d.intent}`);
  // The ruler may order herself (for now, in the debug UI); anyone else must be known to her.
  if (d.recipient !== v.self.id && !beliefsAbout(v, d.recipient, "character.seat").length && !beliefsAbout(v, d.recipient, "character.location").length) out.push(`you do not know who or where ${d.recipient} is`);
  if (d.objective?.kind === "location" && !v.world.places.some((p) => p.id === d.objective.id)) out.push(`no place called ${d.objective.id} on your map`);
  if (d.objective?.kind === "character" && !(d.objective.id in v.world.names)) out.push(`you know of no one called ${d.objective.id}`);
  if (!d.objective || !["location", "character"].includes(d.objective.kind)) out.push("an order needs an objective");
  if (d.discretion && !["strict", "bounded", "delegated"].includes(d.discretion)) out.push(`unknown discretion ${d.discretion}`);
  for (const c of d.constraints ?? []) if (typeof c.kind !== "string" || typeof c.textKey !== "string") out.push("malformed constraint");
  return out;
}
