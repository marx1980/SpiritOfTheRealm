// WorldState is a projection of the log (A1). It changes ONLY through the reducers below, one per event type.
import type { BeliefProposition } from "./beliefs.ts";
import type { Content, FrontierStance, Mode } from "./content.ts";
import type { SimEvent } from "./events.ts";
import type { ActionRef, Recommendation, Report, StructuredOrder } from "./schemas.ts";
import { initialEnv, type ClosedRoute, type EnvState } from "./environment.ts";

export type Position = { at: string } | { transit: { from: string; dest: string; path: string[]; arrivals: number[]; departedAt: number; mode: Mode } };
export type ReportStatus = "composed" | "in_transit" | "delivered" | "lost" | "intercepted" | "undeliverable";
export interface Precedent { id: number; kind: "sortie" | "negotiate" | "punish"; place: string; site?: string; community?: string; oddsPermille?: number; outcome: "won" | "lost" | "eased" | "escalated" | "unchanged"; tick: number; knownBy: string[] }
export interface BattleState {
  setup: import("./battlefield/core.ts").BattleSetup; orders: import("./battlefield/core.ts").BattleOrder[];
  startTick: number; status: "running" | "ended"; launchedEventId: number; commander: string; from: string; site: string;
  enemy: number; men: number; ambushed: boolean; beganEventId: number;
  result?: { winner: string; reason: string; endT: number; ruler: string };
}
export interface Messenger {
  id: number; kind: "report" | "order" | "captured"; ref: number; sender: string; recipient: string;
  carries?: "report" | "order"; // what a captured messenger carries back to the interceptor
  path: string[]; arrivals: number[]; departedAt: number; redirects: number;
}
/** The steward's books: stocks and going prices with his error, each town's price, and what the crown has paid each House. */
export interface Books { tick: number; stock: Record<string, Record<string, number>>; price: Record<string, number>; town: Record<string, Record<string, number>>; paid: Record<string, number>; /** What a market charges per unit (D-050) and the grain price at each market. */ buy?: Record<string, Record<string, number>>; grain?: Record<string, number> }
export interface IssuedRecord { orderId: number; action: string; target: string; recipient: string; tick: number }
export interface Intention { action: ActionRef; score: number; adoptedAt: number; decisionEventId: number; idle: boolean; orderId?: number }
export interface AgentState { operational: Intention | null; focus: string | null; experience: Record<string, number>; lastDecision: number | null; answerRate: Record<string, number>; lastActive: number }
export type Tier = "A" | "B" | "C";
export interface HistoryEntry { tick: number; event: "promoted" | "demoted" | "appointed"; from?: Tier; to?: Tier; role?: string; reason?: string }

export interface Grievance { id: number; kind: string; intensity: number; blameCrown: number; cause: number; since: number; last: number; petitionedAt: number | null; petitionedFelt: number }
export interface Memory { kind: string; actor: string; at: string; tick: number; eventId: number; weight: number; count: number; about?: string; broken?: boolean }
export interface CommunityState {
  material: number; grievances: Grievance[]; memories: Memory[]; trust: Record<string, number>;
  stance: string; stanceSince: number; supports: string | null; told: string; lastTrigger: number; lastTriggerEvent: number; nextGrievance: number;
}
/** Phase 11: the wood creature, the expeditions, reputations and the Stone (docs/EXPLORATION.md). Null when a scenario has none. */
export interface StoneState { status: "hollow" | "carried" | "transit" | "held" | "lost"; at: string; holder: string | null; found: boolean; examined: boolean; foundBy: string | null; toward: string | null }
export interface ExpeditionState { orderId: number; leader: string; kind: "scholarly" | "military"; since: number; days: number; signs: boolean; hollow: boolean; stone: boolean; killed: boolean; ended: string | null }
export interface WildsState {
  alive: boolean; kills: number; missing: number; lastHunt: number;
  stone: StoneState;
  rep: Record<string, number>; emerged: Record<string, number>; dead: Record<string, number>;
  expeditions: Record<string, ExpeditionState>;
}

/** The court across the border and what its actors hold (Phase 14B). Not visible to the player: she has only what her representative writes. */
export interface FrontierState {
  stance: FrontierStance; since: number; weakness: number | null;
  /** What each instructed actor now acts on, and the event in which the instruction reached him. */
  current: Record<string, { stance: FrontierStance; since: number; event: number }>;
  /** The ambassador and the commander hold stances that cannot both be served (one peaceful, one hostile). */
  clash: boolean;
  lastStrike: number; lastTreaty: number; strikes: number; declined: number; proposals: number;
  /** The offer of terms that is open (its event, and when it lapses), the truce a signed treaty makes, the weakness a refusal adds, and when the merchant last came. */
  offer: { id: number; lapsesAt: number; answered: boolean } | null; truceUntil: number; refusedUntil: number; signed: number; lastTrade: number;
}

export interface WorldState {
  treasuryMilli: Record<string, number>;
  /** garrison: all men in the fort; archers and horse: how many of them are bowmen and riders, the rest foot (D-067). */
  fortifications: Record<string, { conditionMilli: number; lastChangeEvent: number; garrison: number; establishment: number; archers: number; horse: number; estArchers: number }>;
  troops: Record<string, number>;
  tiers: Record<string, Tier>;
  history: Record<string, HistoryEntry[]>;
  agents: Record<string, AgentState>;
  recommendations: Record<string, Recommendation>;
  heard: Record<string, Record<string, Recommendation>>; // advice each listener heard in person, latest per adviser and plan
  campaign: { ended: { tick: number; ending: string; where: string } | null; lastDanger: number };
  lastRaid: Record<string, number>;
  lastRepairStart: Record<string, number>;
  lastArrival: Record<string, Record<string, number>>;
  sortieOpen: Record<string, number>; // commander -> tick of the sortie still being fought
  /** Phase 8 battles (D-060): the setup and the ruler's battle orders; the record is recomputed from them. */
  battles: Record<string, BattleState>;
  /** Standing policy each person knows of (Phase 9): area → the rule, the proclamation, when they learned it. */
  policyKnown: Record<string, Record<string, { rule: string; proclaimed: number; learnedAt: number }>>;
  /** Institutional memory (D-070): what was done and how it went, and who remembers it ("fort:<id>" for a fort's own). */
  precedents: Precedent[];
  /** Battlefield prestige and the record of how each commander answered battle orders (BATTLEFIELD §20). */
  prestige: Record<string, number>;
  conduct: Record<string, { obey: number; adapt: number; keep: number; defy?: number }>;
  /** Phase 12: commanders wounded or killed in battle (docs/COMMAND.md §7). */
  commandersFallen: Record<string, { tick: number; fate: "wounded" | "killed" }>;
  lastStorm: Record<string, number>;
  fallen: Record<string, true>; // forts held by the raiders
  threats: Record<string, { intensityPermille: number; untilTick: number; eventId: number; since: number }>;
  /** Phase 10: the environment (null when a scenario has none): weather, ground, snow, rivers, stress. */
  env: EnvState | null;
  /** Phase 11: the wood (null when a scenario has none). */
  bw: WildsState | null;
  fr: FrontierState | null;
  /** Routes that are shut, and why (flood, ice, snow, waterlogged, landslide), with the event that shut them. */
  routesClosed: Record<string, ClosedRoute>;
  /** The last time an official could not send for grain to a place because the roads were shut (the event, and when). */
  supplyBlocked: Record<string, { eventId: number; tick: number }>;
  positions: Record<string, Position>;
  departures: Record<string, Record<string, { to: string | null; tick: number }>>;
  beliefs: Record<string, Record<string, BeliefProposition>>;
  nextPropId: number;
  reports: Record<string, Report & { status: ReportStatus }>;
  nextReportId: number;
  messengers: Record<string, Messenger>;
  nextMessengerId: number;
  orders: Record<string, { order: StructuredOrder; status: string }>;
  nextOrderId: number;
  dayEndDay: number; // last day a day-end decision was set up (interactive play)
  advisePending: Record<string, number>; // adviser -> day their advice is due or was given (given at the end of that day)
  ordersInForce: Record<string, number[]>;
  issued: Record<string, IssuedRecord[]>;
  communities: Record<string, CommunityState>;
  grain: Record<string, number>;
  grainLedger: Record<string, { produced: number; consumed: number; spilled: number; unmet: number; lost: number; seized: number; imported: number }>;
  convoys: Record<string, { id: number; from: string; to: string; sacks: number; departedAt: number; arrivesAt: number; orderId: number; how: string; consulted: boolean }>;
  nextConvoyId: number;
  goods: Record<string, Record<string, number>>; // good -> place -> units
  goodsLedger: Record<string, Record<string, { produced: number; spilled: number; lost: number; seized: number; used: number; sold: number }>>;
  goodsPrice: Record<string, number>;
  /** Grain price at each market, set each day (D-050). */
  grainPrice?: Record<string, number>;
  /** The steward's books as last read out to the ruler at the seat: stocks and going prices with the error of his skill (D-044). Read only by the ruler's view. */
  books?: Books;
  /** What the ruler was last told at the seat: the books as they stood then. */
  ledger?: Books;
  /** Coin the crown has paid each House in all (purchases and a House's cut at its market); `houseCoin` is what is left after the House spends. */
  housePaid?: Record<string, number>;
  /** How glutted a town's market is for a good, in permille off the price (D-045). */
  townGlut?: Record<string, Record<string, number>>;
  houseCoin: Record<string, number>; // coin each House has earned from the crown (D-041)
  goodsConvoys: Record<string, { id: number; good: string; from: string; to: string; units: number; departedAt: number; arrivesAt: number; orderId: number; how: string; via?: string; owedMilli?: number; owedTo?: string }>;
  nextGoodsConvoyId: number;
  hands: Record<string, number>; // men still at home and available to a muster
  musterAway: Record<string, number>;
  musters: Record<string, { id: number; community: string; fort: string; men: number; mounted: number; horse: number; archers: number; until: number; arrived: boolean }>;
  nextMusterId: number;
  grainAsked: Record<string, number>; // place -> tick its castellan last sent for grain himself
  grainRefusedAt: Record<string, number>; // community -> tick it last refused to give grain
  grainBand: Record<string, string>;
  harvestHit: Record<string, { permille: number; until: number; eventId: number; env?: true }>;
  repairs: Record<string, { mode: string; startedAt: number; orderId: number; work: number; done: number; lastT: number; men: number; gen: number; restoredMilli: number; startedEventId: number; engineer: string }>;
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A policy in force from the start is known to everyone. */
function initialWilds(c: Content): WildsState | null {
  const b = c.scenario.wilds;
  if (!b) return null;
  return { alive: true, kills: 0, missing: 0, lastHunt: -1, stone: { status: "hollow", at: b.site, holder: null, found: false, examined: false, foundBy: null, toward: null }, rep: {}, emerged: {}, dead: {}, expeditions: {} };
}

function initialFrontier(c: Content): FrontierState | null {
  const f = c.scenario.frontier;
  if (!f) return null;
  const cur = (): FrontierState["current"][string] => ({ stance: f.court.startStance, since: 0, event: 1 });
  return { stance: f.court.startStance, since: 0, weakness: null, current: { ambassador: cur(), commander: cur(), merchant: cur() }, clash: false, lastStrike: -1, lastTreaty: -1, strikes: 0, declined: 0, proposals: 0, offer: null, truceUntil: -1, refusedUntil: -1, signed: -1, lastTrade: -1 };
}

function initialPolicies(c: Content) {
  const out: WorldState["policyKnown"] = {};
  const init = Object.entries(c.scenario.policy?.initial ?? {}).sort(([a], [b]) => cmp(a, b));
  if (init.length) for (const ch of [...c.characters].sort((a, b) => cmp(a.id, b.id))) out[ch.id] = Object.fromEntries(init.map(([area, rule]) => [area, { rule: rule as string, proclaimed: 0, learnedAt: 0 }]));
  return out;
}
type Fort = WorldState["fortifications"][string];
/** Men leave a fort: bowmen and riders go in their share of the garrison, unless the kinds lost are known. */
export function loseMen(f: Fort, n: number, kinds?: { archers?: number; horse?: number }) {
  n = Math.max(0, Math.min(n, f.garrison));
  if (!n) return;
  const a = kinds ? Math.min(f.archers, kinds.archers ?? 0) : Math.floor((n * f.archers) / Math.max(1, f.garrison));
  const h = kinds ? Math.min(f.horse, kinds.horse ?? 0) : Math.floor((n * f.horse) / Math.max(1, f.garrison));
  f.archers -= a; f.horse -= h; f.garrison -= n;
  // never more bowmen and riders than men
  const over = f.archers + f.horse - f.garrison;
  if (over > 0) { const da = Math.min(f.archers, Math.ceil((over * f.archers) / Math.max(1, f.archers + f.horse))); f.archers -= da; f.horse -= Math.min(f.horse, over - da); }
}
/** Men join a fort: local recruits are trained to the bow until the fort has its usual bowmen, the rest stand as foot. */
/** Dead: fallen on an expedition (Phase 11) or killed in battle (Phase 12). */
export function isDead(s: Readonly<WorldState>, id: string): boolean { return !!s.bw?.dead[id] || s.commandersFallen?.[id]?.fate === "killed"; }
function recruit(f: Fort, n: number) { if (n <= 0) return; f.garrison += n; f.archers += Math.max(0, Math.min(n, f.estArchers - f.archers)); }
export const newAgent = (): AgentState => ({ operational: null, focus: null, experience: {}, lastDecision: null, answerRate: {}, lastActive: 0 });

export function initialState(c: Content): WorldState {
  const fortifications: WorldState["fortifications"] = {};
  const archShare = c.scenario.battle?.forces?.garrison.find((g) => g.kind === "archers")?.sharePermille ?? 0;
  for (const l of [...c.locations].sort((a, b) => cmp(a.id, b.id))) if (l.fortification) {
    const g = l.fortification.garrison, archers = l.fortification.archers ?? Math.floor((g * archShare) / 1000), horse = l.fortification.horse ?? 0;
    fortifications[l.id] = { conditionMilli: l.fortification.conditionMilli, lastChangeEvent: 1, garrison: g, establishment: g, archers, horse, estArchers: archers };
  }
  const positions: WorldState["positions"] = {};
  const troops: WorldState["troops"] = {}, agents: WorldState["agents"] = {}, tiers: WorldState["tiers"] = {};
  for (const ch of [...c.characters].sort((a, b) => cmp(a.id, b.id))) {
    positions[ch.id] = { at: ch.location };
    tiers[ch.id] = ch.tier;
    if (ch.troops) troops[ch.id] = ch.troops;
    if (ch.id !== c.scenario.ruler && ch.tier !== "C") agents[ch.id] = newAgent();
  }
  return {
    treasuryMilli: { [c.scenario.ruler]: c.scenario.treasuryMilli }, fortifications, troops, tiers, history: {}, agents, recommendations: {}, heard: {}, campaign: { ended: null, lastDanger: -1 }, lastRaid: {}, lastRepairStart: {}, lastArrival: {}, sortieOpen: {}, battles: {}, policyKnown: initialPolicies(c), precedents: [], prestige: {}, conduct: {}, commandersFallen: {}, lastStorm: {}, fallen: {}, threats: {}, routesClosed: {}, supplyBlocked: {}, env: initialEnv(c), bw: initialWilds(c), fr: initialFrontier(c),
    positions, departures: {}, beliefs: {}, nextPropId: 1, reports: {}, nextReportId: 1, messengers: {}, nextMessengerId: 1,
    orders: {}, nextOrderId: 1, advisePending: {}, dayEndDay: -1, ordersInForce: {}, issued: {}, repairs: {}, communities: initialCommunities(c), ...initialGrain(c), ...initialGoods(c), hands: Object.fromEntries(c.communities.communities.map((x) => [x.id, x.hands ?? 0])), musterAway: {}, musters: {}, nextMusterId: 1,
  };
}

export const BANDS = ["plenty", "adequate", "tight", "short", "famine"] as const;
/** Scarcity band from days of cover (store over daily need). */
export function bandOf(store: number, need: number, bandDays: readonly number[]): string {
  if (need <= 0) return BANDS[0];
  const cover = Math.floor(store / need);
  const i = bandDays.findIndex((d) => cover >= d);
  return BANDS[i < 0 ? 4 : i];
}
function initialGoods(c: Content): Pick<WorldState, "goods" | "goodsLedger" | "goodsPrice" | "goodsConvoys" | "nextGoodsConvoyId" | "houseCoin"> {
  const g = c.scenario.goods, out = { goods: {} as WorldState["goods"], goodsLedger: {} as WorldState["goodsLedger"], goodsPrice: {} as WorldState["goodsPrice"], houseCoin: Object.fromEntries((g?.houses ?? []).map((h) => [h, 0])) as WorldState["houseCoin"], goodsConvoys: {} as WorldState["goodsConvoys"], nextGoodsConvoyId: 1 };
  for (const k of g?.kinds ?? []) { out.goods[k] = {}; out.goodsLedger[k] = {}; out.goodsPrice[k] = g!.price[k].baseMilli; }
  for (const p of [...(g?.places ?? [])].sort((a, b) => cmp(a.location, b.location))) for (const k of g!.kinds) {
    if (p.cap[k] === undefined) continue;
    out.goods[k][p.location] = p.store[k] ?? 0; out.goodsLedger[k][p.location] = { produced: 0, spilled: 0, lost: 0, seized: 0, used: 0, sold: 0 };
  }
  return out;
}
function initialGrain(c: Content): Pick<WorldState, "grain" | "grainLedger" | "grainBand" | "harvestHit" | "convoys" | "nextConvoyId" | "grainAsked" | "grainRefusedAt"> {
  const g = c.scenario.grain, out = { grain: {} as WorldState["grain"], grainLedger: {} as WorldState["grainLedger"], grainBand: {} as WorldState["grainBand"], harvestHit: {} as WorldState["harvestHit"], convoys: {} as WorldState["convoys"], nextConvoyId: 1, grainAsked: {} as WorldState["grainAsked"], grainRefusedAt: {} as WorldState["grainRefusedAt"] };
  for (const p of [...(g?.places ?? [])].sort((a, b) => cmp(a.location, b.location))) {
    out.grain[p.location] = p.store; out.grainLedger[p.location] = { produced: 0, consumed: 0, spilled: 0, unmet: 0, lost: 0, seized: 0, imported: 0 };
    out.grainBand[p.location] = bandOf(p.store, p.need, g!.bandDays);
  }
  return out;
}
function initialCommunities(c: Content): WorldState["communities"] {
  const out: WorldState["communities"] = {};
  for (const d of [...(c.communities?.communities ?? [])].sort((a, b) => cmp(a.id, b.id)))
    out[d.id] = { material: d.material, grievances: [], trust: { ...d.trust }, stance: "cooperate", stanceSince: 0, supports: null, told: "cooperate", lastTrigger: -1, lastTriggerEvent: 0, nextGrievance: 1,
      memories: d.memories.map((m) => ({ kind: m.kind, actor: m.actor, at: d.id, tick: 0, eventId: 1, weight: m.weight, count: 1, ...(m.about ? { about: m.about } : {}) })) };
  return out;
}
const clamp1000 = (v: number) => Math.max(0, Math.min(1000, v));
/** A community remembers few things: the same kind of thing at the same place by the same actor is one memory, and the
 *  least weighty old memory is forgotten when there are too many (a promise is never forgotten). */
function remember(c: CommunityState, m: Memory, cap: number) {
  const same = c.memories.find((x) => x.kind === m.kind && x.at === m.at && x.actor === m.actor && x.about === m.about);
  if (same) { same.tick = m.tick; same.eventId = m.eventId; same.count += 1; same.weight = Math.max(same.weight, m.weight); return; }
  c.memories.push(m);
  while (c.memories.length > cap) {
    const drop = c.memories.map((x, i) => ({ x, i })).filter(({ x }) => x.kind !== "promise").sort((a, b) => a.x.weight - b.x.weight || a.x.tick - b.x.tick || a.i - b.i)[0];
    if (!drop) break;
    c.memories.splice(drop.i, 1);
  }
}
/** Effects a community's experience has on it, worked out by the communities system and applied here. */
function applyEffects(s: WorldState, p: P, e: SimEvent) {
  const c = s.communities[p.community];
  if (p.memory) remember(c, { ...p.memory, tick: e.tick, eventId: e.id, count: 1 }, p.memoryCap);
  if (p.material) c.material = clamp1000(c.material + p.material);
  for (const [src, d] of (p.trust ?? []) as [string, number][]) c.trust[src] = clamp1000((c.trust[src] ?? 0) + d);
  for (const [gid, v] of (p.eased ?? []) as [number, number][]) { const g = c.grievances.find((x) => x.id === gid); if (g) g.intensity = v; }
  c.grievances = c.grievances.filter((g) => g.intensity > 0);
  for (const g of (p.grievances ?? []) as { kind: string; delta: number; blameCrown: number }[]) {
    const open = c.grievances.find((x) => x.kind === g.kind);
    if (open) { open.intensity = clamp1000(open.intensity + g.delta); open.last = e.tick; open.cause = e.id; }
    else c.grievances.push({ id: c.nextGrievance++, kind: g.kind, intensity: clamp1000(g.delta), blameCrown: g.blameCrown, cause: e.id, since: e.tick, last: e.tick, petitionedAt: null, petitionedFelt: 0 });
    c.lastTrigger = e.tick; c.lastTriggerEvent = e.id;
  }
  if (p.breaks) for (const m of c.memories) if (m.kind === "promise" && m.about === p.breaks) m.broken = true;
}
const clampCond = (v: number) => Math.max(0, Math.min(100000, v));
const noop = () => {};
type P = Record<string, any>;
const removeFromForce = (s: WorldState, who: string, id: number) => { s.ordersInForce[who] = (s.ordersInForce[who] ?? []).filter((x) => x !== id); };
const setOrder = (status: string) => (s: WorldState, p: P) => { s.orders[String(p.orderId)].status = status; };
const endOrder = (status: string) => (s: WorldState, p: P) => {
  const o = s.orders[String(p.orderId)]; o.status = status; removeFromForce(s, o.order.recipient, p.orderId);
  const a = s.agents[o.order.recipient];
  if (a?.operational?.orderId === p.orderId) a.operational = null; // the order's intention ends with the order
};
const messenger = (s: WorldState, p: P, kind: Messenger["kind"], ref: number, e: SimEvent) => {
  s.messengers[String(p.messengerId)] = { id: p.messengerId, kind, ref, sender: p.sender, recipient: p.recipient, path: p.path, arrivals: p.arrivals, departedAt: e.tick, redirects: 0 };
  s.nextMessengerId = p.messengerId + 1;
};
const dropMessenger = (s: WorldState, p: P) => { if (p.messengerId != null) delete s.messengers[String(p.messengerId)]; };
const capture = (s: WorldState, p: P, kind: "report" | "order", e: SimEvent) => {
  dropMessenger(s, p);
  s.messengers[String(p.captureMessengerId)] = { id: p.captureMessengerId, kind: "captured", carries: kind, ref: kind === "report" ? p.reportId : p.orderId,
    sender: p.at, recipient: p.by, path: p.path, arrivals: p.arrivals, departedAt: e.tick, redirects: 0 };
  s.nextMessengerId = p.captureMessengerId + 1;
};

export const REDUCERS: Record<string, (s: WorldState, p: P, e: SimEvent) => void> = {
  ScenarioStarted: noop,
  TreasuryCollected: (s, p) => { s.treasuryMilli[p.holder] = (s.treasuryMilli[p.holder] ?? 0) + p.amountMilli; },
  UpkeepPaid: (s, p) => { s.treasuryMilli[p.holder] -= p.amountMilli; }, // includes any muster wages (p.musterMen)
  GarrisonRecovered: (s, p) => { for (const [loc, n] of p.changes as [string, number][]) { const f = s.fortifications[loc]; recruit(f, Math.min(f.establishment, f.garrison + n) - f.garrison); } },
  CompanyRecovered: (s, p) => { for (const [who, n] of p.changes as [string, number][]) s.troops[who] += n; },
  FortificationsWeathered: (s, p, e) => {
    for (const [loc, d] of p.changes as [string, number][]) { const f = s.fortifications[loc]; f.conditionMilli = clampCond(f.conditionMilli - d); f.lastChangeEvent = e.id; }
  },
  Storm: (s, p, e) => {
    s.lastStorm[p.location] = e.tick;
    const f = s.fortifications[p.location]; if (f) { f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; }
  },
  ThreatBegan: (s, p, e) => { s.threats[p.site] = { intensityPermille: p.intensityPermille, untilTick: p.untilTick, eventId: e.id, since: e.tick }; },
  ThreatGrew: (s, p) => { if (s.threats[p.site]) s.threats[p.site].intensityPermille = p.intensityPermille; },
  RaidDamage: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; s.lastRaid[p.location] = e.tick; },
  ThreatScripted: noop,
  ThreatEnded: (s, p) => { delete s.threats[p.site]; },
  // the raiders take the fort: its men scatter and nothing is repaired or recovered while they hold it
  FortFell: (s, p) => { s.fallen[p.fort] = true; const f = s.fortifications[p.fort]; f.garrison = 0; f.archers = 0; f.horse = 0; },
  FortAssaulted: noop,
  FortRetaken: (s, p) => { delete s.fallen[p.fort]; const f = s.fortifications[p.fort]; f.conditionMilli = Math.max(f.conditionMilli, p.conditionMilli); f.garrison = 0; f.archers = 0; f.horse = 0; recruit(f, p.garrison); },

  TravelScripted: noop,
  Departed: (s, p, e) => {
    s.positions[p.who] = { transit: { from: p.from, dest: p.dest, path: p.path, arrivals: p.arrivals, departedAt: e.tick, mode: p.mode } };
    (s.departures[p.from] ??= {})[p.who] = { to: p.secret ? null : p.dest, tick: e.tick };
  },
  Arrived: (s, p, e) => { s.positions[p.who] = { at: p.at }; (s.lastArrival[p.at] ??= {})[p.who] = e.tick; },
  RouteClosed: (s, p, e) => { s.routesClosed[p.route] = { eventId: e.id, reason: p.reason, since: e.tick, ...(p.until !== undefined ? { until: p.until } : {}) }; },
  RouteOpened: (s, p) => { delete s.routesClosed[p.route]; },
  // environment (Phase 10): the daily snapshot replaces the weather, ground, snow, river and stress state
  EnvironmentDay: (s, p) => { s.env = structuredClone({ day: p.day, season: p.season, regions: p.regions, rivers: p.rivers, stress: p.stress }) as EnvState; }, // a copy: later reducers change the state, never the logged event
  RiverFlooded: (s, p, e) => { if (s.env) s.env.rivers[p.river].floodEvent = e.id; },
  RiverReceded: noop, RiverFroze: noop, RiverThawed: noop,
  StressReleased: (s, p) => { if (s.env) s.env.stress[p.province] = p.remaining; },
  Hazard: (s, p, e) => {
    s.lastStorm[p.location] = e.tick;
    const f = s.fortifications[p.location]; if (f) { f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; }
  },
  CropDamaged: (s, p, e) => {
    const cur = s.harvestHit[p.place];
    if (!cur || cur.until <= e.tick || p.permille >= cur.permille) s.harvestHit[p.place] = { permille: p.permille, until: Math.max(p.until, cur && cur.until > e.tick ? cur.until : 0), eventId: e.id, env: true };
  },
  SupplyBlocked: (s, p, e) => { s.supplyBlocked[p.place] = { eventId: e.id, tick: e.tick }; },
  // Phase 11: the wood. Custody and reputation change only through these.
  FrontierReview: (s, p, e) => { const f = s.fr!; f.weakness = p.weakness; if (p.stance !== f.stance) { f.stance = p.stance; f.since = e.tick; } },
  FrontierInstruction: noop,
  FrontierInstructionArrived: (s, p, e) => {
    const f = s.fr!;
    f.current[p.actor] = { stance: p.stance, since: e.tick, event: e.id };
    const peaceful = (x: string) => x === "settle" || x === "trade", a = f.current.ambassador.stance, c = f.current.commander.stance;
    f.clash = (peaceful(a) && !peaceful(c)) || (!peaceful(a) && peaceful(c));
  },
  FrontierContradiction: noop,
  FrontierObserved: noop,
  FrontierStrike: (s, _p, e) => { s.fr!.lastStrike = e.tick; s.fr!.strikes++; },
  FrontierDeclined: (s, _p, e) => { s.fr!.lastStrike = e.tick; s.fr!.declined++; },
  TreatyProposed: (s, p, e) => { s.fr!.lastTreaty = e.tick; s.fr!.proposals++; s.fr!.offer = { id: e.id, lapsesAt: e.tick + p.openDays * 86400, answered: false }; },
  TreatyAnswered: (s) => { if (s.fr!.offer) s.fr!.offer.answered = true; },
  TreatySigned: (s, p, e) => { const f = s.fr!; f.offer = null; f.signed = e.tick; f.truceUntil = p.truceUntil; s.treasuryMilli[p.payer] -= p.tributeMilli; },
  TreatyRefused: (s, p) => { const f = s.fr!; f.offer = null; f.refusedUntil = p.until; },
  FrontierTrade: (s, p, e) => { s.grain[p.to] += p.sacks; s.grainLedger[p.to].imported += p.sacks; s.fr!.lastTrade = e.tick; },
  CreatureHunt: (s, p, e) => { const b = s.bw!; b.kills += p.livestock; b.missing += p.missing ? 1 : 0; b.lastHunt = e.tick; },
  ExpeditionStarted: (s, p, e) => { s.bw!.expeditions[String(p.orderId)] = { orderId: p.orderId, leader: p.leader, kind: p.kind, since: e.tick, days: 0, signs: false, hollow: false, stone: false, killed: false, ended: null }; },
  SiteSearched: (s, p) => { const x = s.bw!.expeditions[String(p.orderId)]; if (!x) return; x.days = p.day; x.signs ||= !!p.signs; x.hollow ||= !!p.hollow; x.stone ||= !!p.stone; },
  CreatureEncountered: (s, p) => { if (p.outcome === "killed") { s.bw!.alive = false; const x = s.bw!.expeditions[String(p.orderId)]; if (x) x.killed = true; } },
  ExpeditionEnded: (s, p) => { const x = s.bw!.expeditions[String(p.orderId)]; if (x) x.ended = p.outcome; },
  LeaderFell: (s, p, e) => { s.bw!.dead[p.leader] = e.tick; s.troops[p.leader] = 0; },
  ReputationChanged: (s, p) => { const b = s.bw!; b.rep[p.who] = Math.max(0, Math.min(1000, (b.rep[p.who] ?? 0) + p.delta)); },
  CharacterEmerged: (s, p, e) => { s.bw!.emerged[p.who] = e.tick; },
  StoneFound: (s, p) => { const st = s.bw!.stone; st.found = true; st.foundBy = p.by; },
  StoneTaken: (s, p) => { const st = s.bw!.stone; st.status = "carried"; st.holder = p.holder; st.at = p.at; st.toward = null; },
  StoneKept: (s, p) => { const st = s.bw!.stone; st.status = "held"; st.holder = p.holder; st.at = p.at; st.toward = null; },
  StoneSent: (s, p) => { const st = s.bw!.stone; st.status = "transit"; st.holder = p.holder; st.toward = p.to; },
  StoneDelivered: (s, p) => { const st = s.bw!.stone; st.status = "held"; st.holder = p.to; st.at = p.at; st.toward = null; },
  StoneLost: (s, p) => { const st = s.bw!.stone; st.status = "lost"; st.holder = null; st.at = p.at; st.toward = null; st.found = false; },
  StoneExamined: (s) => { s.bw!.stone.examined = true; },

  Observed: noop,
  BeliefUpdated: (s, p) => { (s.beliefs[p.holder] ??= {})[String(p.prop.id)] = p.prop; s.nextPropId = Math.max(s.nextPropId, p.prop.id + 1); },
  BeliefResolved: (s, p) => { for (const id of p.dropped) delete s.beliefs[p.holder][String(id)]; },
  BeliefEvicted: (s, p) => { for (const id of p.propIds) delete s.beliefs[p.holder][String(id)]; },

  ReportComposed: (s, p) => { s.reports[String(p.report.id)] = { ...p.report, status: "composed" }; s.nextReportId = p.report.id + 1; },
  ReportDispatched: (s, p, e) => {
    const r = s.reports[String(p.reportId)];
    r.status = "in_transit"; r.dispatchedAt = e.tick; r.route = [...p.path]; r.carrier = `messenger:${p.messengerId}`;
    messenger(s, p, "report", p.reportId, e);
  },
  MessengerRedirected: (s, p) => {
    const m = s.messengers[String(p.messengerId)];
    m.path = p.path; m.arrivals = p.arrivals; m.departedAt = p.departedAt; m.redirects += 1;
    if (m.kind === "report") s.reports[String(m.ref)].route.push(...p.path.slice(1));
  },
  ReportDelivered: (s, p, e) => { const r = s.reports[String(p.reportId)]; r.status = "delivered"; r.deliveredAt = e.tick; dropMessenger(s, p); },
  ReportLost: (s, p) => { s.reports[String(p.reportId)].status = "lost"; dropMessenger(s, p); },
  ReportIntercepted: (s, p, e) => { s.reports[String(p.reportId)].status = "intercepted"; capture(s, p, "report", e); },
  InterceptedReportReceived: (s, p) => dropMessenger(s, p),
  ReportShared: noop,
  ReportUndeliverable: (s, p) => { s.reports[String(p.reportId)].status = "undeliverable"; dropMessenger(s, p); },

  OrderScripted: noop,
  OrderIssued: (s, p, e) => {
    const o = p.order as StructuredOrder;
    s.orders[String(o.id)] = { order: o, status: "issued" };
    s.nextOrderId = o.id + 1;
    (s.issued[o.issuer] ??= []).push({ orderId: o.id, action: o.intent, target: o.objective.id, recipient: o.recipient, tick: e.tick });
  },
  OrderDispatched: (s, p, e) => { s.orders[String(p.orderId)].status = "dispatched"; messenger(s, p, "order", p.orderId, e); },
  OrderLost: (s, p) => { s.orders[String(p.orderId)].status = "lost"; dropMessenger(s, p); },
  OrderIntercepted: (s, p, e) => { s.orders[String(p.orderId)].status = "intercepted"; capture(s, p, "order", e); },
  InterceptedOrderReceived: (s, p) => dropMessenger(s, p),
  OrderUndeliverable: (s, p) => { s.orders[String(p.orderId)].status = "undeliverable"; dropMessenger(s, p); },
  OrderReceived: (s, p, e) => {
    s.orders[String(p.orderId)].status = "received";
    if (s.agents[p.recipient]) s.agents[p.recipient].lastActive = e.tick;
    (s.ordersInForce[p.recipient] ??= []).push(p.orderId);
    dropMessenger(s, p);
  },
  OrderInterpreted: setOrder("interpreted"),
  ObedienceDecided: (s, p) => { if (p.decision === "refuse") endOrder("refused")(s, p); else setOrder("accepted")(s, p); },
  LocalPlanFormed: setOrder("planned"),
  SubordinateOrdersIssued: setOrder("delegating"),
  ExecutionStarted: setOrder("executing"),
  OrderCompleted: endOrder("completed"),
  OrderSuperseded: endOrder("superseded"),
  OrderAbandoned: endOrder("abandoned"),
  RepairStarted: (s, p, e) => { s.repairs[p.location] = { mode: p.mode ?? "standard", startedAt: p.startedAt, orderId: p.orderId, work: p.work, done: 0, lastT: e.tick, men: p.men, gen: 0, restoredMilli: p.restoredMilli, startedEventId: e.id, engineer: p.engineer }; s.treasuryMilli[p.payer] -= p.costMilli; s.lastRepairStart[p.location] = e.tick; if (p.timberUsed) { s.goods.timber[p.location] -= p.timberUsed; s.goodsLedger.timber[p.location].used += p.timberUsed; } },
  DayEndScheduled: (s, p) => { s.dayEndDay = p.day; },
  AdviceScheduled: (s, p) => { s.advisePending[p.agent] = p.day; },
  AdviceSettled: (s, p) => { s.advisePending[p.agent] = p.day; },
  RepairResynced: (s, p, e) => { const r = s.repairs[p.location]; r.done = p.done; r.lastT = e.tick; r.men = p.men; r.gen = p.gen; },
  RepairCompleted: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli + p.restoredMilli); f.lastChangeEvent = e.id; delete s.repairs[p.location]; },
  LevyRaised: (s, p) => { s.treasuryMilli[p.payer] += p.amountMilli; },
  ReliefSent: (s, p) => { s.treasuryMilli[p.payer] -= p.amountMilli; },
  // grain (Phase 7A)
  GrainDay: (s, p) => {
    if (p.prices) s.grainPrice = { ...(p.prices as Record<string, number>) };
    for (const [loc, produced, consumed, spilled, unmet] of p.changes as [string, number, number, number, number][]) {
      s.grain[loc] += produced - consumed - spilled;
      const l = s.grainLedger[loc]; l.produced += produced; l.consumed += consumed; l.spilled += spilled; l.unmet += unmet;
    }
  },
  HarvestDamaged: (s, p, e) => { s.harvestHit[p.place] = { permille: p.permille, until: p.until, eventId: e.id }; },
  GarrisonStarved: (s, p) => { for (const [loc, n] of p.changes as [string, number][]) loseMen(s.fortifications[loc], n); },
  GrainAsked: (s, p, e) => { s.grainAsked[p.place + (p.consult ? "" : "!")] = e.tick; }, // a consulted ask and an emergency take have their own cooldowns
  GrainConsulted: noop,
  GrainRefused: (s, p, e) => { if (!p.stood) s.grainRefusedAt[p.community] = e.tick; },
  GrainShipped: (s, p) => {
    s.grain[p.from] -= p.sacks;
    s.convoys[String(p.convoyId)] = { id: p.convoyId, from: p.from, to: p.to, sacks: p.sacks, departedAt: p.departedAt, arrivesAt: p.arrivesAt, orderId: p.orderId, how: p.how, consulted: p.consulted };
    s.nextConvoyId = p.convoyId + 1;
    if (p.costMilli) s.treasuryMilli[p.payer] -= p.costMilli;
  },
  GrainDelivered: (s, p) => { s.grain[p.to] += p.sacks - p.spilled; s.grainLedger[p.to].spilled += p.spilled; delete s.convoys[String(p.convoyId)]; },
  GrainLost: (s, p) => { s.grainLedger[p.from][p.reason === "seized" ? "seized" : "lost"] += p.sacks; delete s.convoys[String(p.convoyId)]; },
  ScarcityChanged: (s, p) => { s.grainBand[p.place] = p.to; },
  // levy and manpower (D-040)
  MusterCalled: (s, p) => {
    s.hands[p.community] -= p.men; s.musterAway[p.community] = (s.musterAway[p.community] ?? 0) + p.men;
    if (p.ironUsed) { s.goods.iron[p.fort] -= p.ironUsed; s.goodsLedger.iron[p.fort].used += p.ironUsed; }
    if (p.mounted) { s.goods.horses[p.fort] -= p.mounted; s.goodsLedger.horses[p.fort].used += p.mounted; }
    if (p.timberUsed) { s.goods.timber[p.fort] -= p.timberUsed; s.goodsLedger.timber[p.fort].used += p.timberUsed; }
    // before D-067 the payload had no kinds: the riders were the mounted men
    s.musters[String(p.musterId)] = { id: p.musterId, community: p.community, fort: p.fort, men: p.men, mounted: p.mounted, horse: p.horse ?? p.mounted, archers: p.archers ?? 0, until: p.until, arrived: false };
    s.nextMusterId = p.musterId + 1;
  },
  // the riders are among the men called (D-067: before, they were counted twice)
  MusterArrived: (s, p) => { const m = s.musters[String(p.musterId)]; if (m) { m.arrived = true; const f = s.fortifications[m.fort]; f.garrison += m.men; f.archers += m.archers; f.horse += m.horse; } },
  MusterEnded: (s, p) => {
    const m = s.musters[String(p.musterId)]; if (!m) return;
    // the called men go home, as many as the fort holds above its establishment, their own kinds first
    const f = s.fortifications[m.fort], surplus = Math.min(m.arrived ? m.men : 0, Math.max(0, f.garrison - f.establishment));
    if (surplus) loseMen(f, surplus, { horse: Math.floor((surplus * m.horse) / Math.max(1, m.men)), archers: Math.floor((surplus * m.archers) / Math.max(1, m.men)) }); s.hands[m.community] += m.men; s.musterAway[m.community] -= m.men; delete s.musters[String(p.musterId)];
  },
  // wider economy (D-039)
  GoodsDay: (s, p, e) => {
    for (const [place, good, produced, spilled] of p.changes as [string, string, number, number][]) { s.goods[good][place] += produced - spilled; const l = s.goodsLedger[good][place]; l.produced += produced; l.spilled += spilled; }
    s.goodsPrice = { ...(p.prices as Record<string, number>) };
    if (p.glut) s.townGlut = p.glut as Record<string, Record<string, number>>;
    if (p.books) { s.books = { tick: e.tick, ...(p.books as Omit<Books, "tick">) }; if (p.atSeat) s.ledger = s.books; }
  },
  HouseRestocked: (s, p) => { s.goods[p.good][p.place] += p.units; s.goodsLedger[p.good][p.place].produced += p.units; s.houseCoin[p.house] -= p.costMilli; },
  GoodsShipped: (s, p) => {
    s.goods[p.good][p.from] -= p.units;
    s.goodsConvoys[String(p.convoyId)] = { id: p.convoyId, good: p.good, from: p.from, to: p.to, units: p.units, departedAt: p.departedAt, arrivesAt: p.arrivesAt, orderId: p.orderId, how: p.how, ...(p.via ? { via: p.via } : {}), ...(p.owedMilli ? { owedMilli: p.owedMilli, owedTo: p.owedTo } : {}) };
    s.nextGoodsConvoyId = p.convoyId + 1;
    if (p.costMilli) s.treasuryMilli[p.payer] -= p.costMilli;
    if (p.costMilli && p.payee) { s.houseCoin[p.payee] += p.costMilli; (s.housePaid ??= {})[p.payee] = (s.housePaid[p.payee] ?? 0) + p.costMilli; }
  },
  GoodsSold: (s, p) => {
    s.treasuryMilli[p.crown] += p.proceedsMilli - p.houseCutMilli; if (p.houseCutMilli) { s.houseCoin[p.house] += p.houseCutMilli; (s.housePaid ??= {})[p.house] = (s.housePaid[p.house] ?? 0) + p.houseCutMilli; }
    ((s.townGlut ??= {})[p.to] ??= {})[p.good] = p.glut;
    s.goodsLedger[p.good][p.from].sold += p.units; delete s.goodsConvoys[String(p.convoyId)];
  },
  GoodsDelivered: (s, p) => {
    if (p.owedMilli) { if (p.owedTo === "crown") s.treasuryMilli[p.crown] += p.owedMilli; else { s.houseCoin[p.owedTo] += p.owedMilli; (s.housePaid ??= {})[p.owedTo] = (s.housePaid[p.owedTo] ?? 0) + p.owedMilli; } } // the seller is paid when the caravan arrives
    s.goods[p.good][p.to] += p.units - p.spilled; s.goodsLedger[p.good][p.to].spilled += p.spilled; delete s.goodsConvoys[String(p.convoyId)]; },
  GoodsLost: (s, p) => { s.goodsLedger[p.good][p.from][p.reason === "seized" ? "seized" : "lost"] += p.units; delete s.goodsConvoys[String(p.convoyId)]; },
  // communities (Phase 6)
  CommunityHeard: applyEffects,
  NarratorVisited: applyEffects,
  TroopMisconduct: noop,
  ReliefDelivered: noop,
  PetitionMade: (s, p, e) => { const g = s.communities[p.community].grievances.find((x) => x.id === p.grievanceId); if (g) { g.petitionedAt = e.tick; g.petitionedFelt = (p.felt as number | undefined) ?? 0; } },
  CommunitiesDrifted: (s, p) => {
    for (const ch of p.changes as { community: string; material: number; grievances: [number, number, number][] }[]) {
      const c = s.communities[ch.community];
      c.material = ch.material;
      for (const [gid, intensity, blame] of ch.grievances) { const g = c.grievances.find((x) => x.id === gid); if (g) { g.intensity = intensity; g.blameCrown = blame; } }
      c.grievances = c.grievances.filter((g) => g.intensity > 0);
    }
  },
  CommunityStanceChanged: (s, p, e) => { const c = s.communities[p.community]; c.stance = p.to; c.stanceSince = e.tick; c.supports = p.supports ?? null; if (p.tell) c.told = p.to; },
  PlayerInput: noop,
  RecommendationMade: (s, p) => {
    s.recommendations[p.recommendation.author] = p.recommendation;
    for (const who of p.audience ?? []) (s.heard[who] ??= {})[`${p.recommendation.author}|${p.recommendation.plan.id}`] = p.recommendation;
  },
  DangerSignalled: (s, p, e) => { s.campaign.lastDanger = e.tick; },
  CampaignEnded: (s, p, e) => { s.campaign.ended = { tick: e.tick, ending: p.ending, where: p.where }; },
  AgentWoke: (s, p, e) => { s.agents[p.agent].lastActive = e.tick; },
  DecisionMade: (s, p, e) => {
    const t = p.trace, a = s.agents[t.agent];
    a.lastDecision = e.id; a.lastActive = e.tick;
    if (t.kind === "focus") a.focus = t.selected.target ?? null;
    else if (t.kind === "plan" || t.kind === "obedience") {
      if (t.keptCurrentIntention && a.operational) a.operational = { ...a.operational, score: p.score };
      else a.operational = { action: t.selected, score: p.score, adoptedAt: e.tick, decisionEventId: e.id, idle: p.idle, ...(p.orderId != null ? { orderId: p.orderId } : {}) };
    }
  },
  ExperienceGained: (s, p) => { const x = s.agents[p.agent].experience; x[p.domain] = Math.min(p.cap, (x[p.domain] ?? 0) + p.amount); },
  SortieLaunched: (s, p, e) => { s.sortieOpen[p.commander] = e.tick; },
  SortieResolved: (s, p) => { delete s.sortieOpen[p.commander]; },
  BattleBegan: (s, p, e) => { s.battles[String(p.battleId)] = { setup: p.setup, orders: [], startTick: e.tick, status: "running", launchedEventId: p.launchedEventId, commander: p.commander, from: p.from, site: p.site, enemy: p.enemy, men: p.men, ambushed: p.ambushed, beganEventId: e.id }; },
  BattleOrderGiven: (s, p) => { s.battles[String(p.battleId)].orders.push(p.order); },
  PolicyProclaimed: () => {}, PolicyApplied: () => {},
  PolicyLearned: (s, p) => { (s.policyKnown[p.holder] ??= {})[p.area] = { rule: p.rule, proclaimed: p.proclaimed, learnedAt: p.learnedAt }; },
  PrecedentRecorded: (s, p, e) => { s.precedents.push({ id: e.id, kind: p.kind, place: p.place, ...(p.site ? { site: p.site } : {}), ...(p.community ? { community: p.community } : {}), ...(p.oddsPermille !== undefined ? { oddsPermille: p.oddsPermille } : {}), outcome: p.outcome, tick: e.tick, knownBy: p.knownBy }); },
  CommunityParley: (s, p) => { s.treasuryMilli[p.payer] -= p.remitMilli; },
  CommunityPunished: (s, p) => { s.treasuryMilli[p.payer] += p.seizedMilli; },
  BattleEnded: (s, p) => { const b = s.battles[String(p.battleId)]; b.status = "ended"; b.result = { winner: p.winner, reason: p.reason, endT: p.endT, ruler: p.ruler }; },
  ThreatWeakened: (s, p) => { if (s.threats[p.site]) s.threats[p.site].intensityPermille = p.intensityPermille; },
  PrestigeChanged: (s, p) => { s.prestige[p.who] = (s.prestige[p.who] ?? 0) + p.delta; },
  BattleConduct: (s, p) => { const c = (s.conduct[p.commander] ??= { obey: 0, adapt: 0, keep: 0 }); const d = p.decision as "obey" | "adapt" | "keep" | "defy"; c[d] = (c[d] ?? 0) + 1; },
  // a commander killed in battle takes no further part; a dead captain's men go back to the fort they fought from
  CommanderFell: (s, p, e) => {
    s.commandersFallen[p.who] = { tick: e.tick, fate: p.fate };
    if (p.fate === "killed" && (s.troops[p.who] ?? 0) > 0) { const f = s.fortifications[p.from]; if (f && !s.fallen[p.from]) recruit(f, s.troops[p.who]); s.troops[p.who] = 0; }
  },
  LossesTaken: (s, p) => {
    if (p.garrisonLost) loseMen(s.fortifications[p.location], p.garrisonLost, p.garrisonKinds);
    for (const [who, n] of Object.entries(p.troopsLost as Record<string, number>)) s.troops[who] -= n;
  },
  DetachmentSent: (s, p) => { s.troops[p.commander] -= p.men; },
  DetachmentArrived: (s, p, e) => { if (s.fortifications[p.to]) s.fortifications[p.to].garrison += p.men; (s.lastArrival[p.to] ??= {})[p.commander] = e.tick; },
  ResponseAssessed: (s, p) => { s.agents[p.agent].answerRate[p.of] = p.rate; },
  CharacterPromoted: (s, p, e) => {
    s.tiers[p.who] = p.to;
    const a = (s.agents[p.who] ??= newAgent());
    a.lastActive = e.tick;
    (s.history[p.who] ??= []).push({ tick: e.tick, event: "promoted", from: p.from, to: p.to, reason: p.reason });
  },
  CharacterDemoted: (s, p, e) => {
    s.tiers[p.who] = p.to;
    const a = s.agents[p.who];
    a.operational = null; a.focus = null; // plans are dropped; experience, learned trust and memories are kept
    a.lastActive = e.tick; // each step down needs its own quiet period
    (s.history[p.who] ??= []).push({ tick: e.tick, event: "demoted", from: p.from, to: p.to, reason: p.reason });
  },
  LeaderAppointed: (s, p, e) => { (s.history[p.leader] ??= []).push({ tick: e.tick, event: "appointed", role: p.role, reason: `by ${p.by}` }); },
};

export function applyEvent(s: WorldState, e: SimEvent): void {
  const r = REDUCERS[e.type];
  if (!r) throw new Error(`no reducer for ${e.type}`);
  r(s, e.payload, e);
}
