// WorldState is a projection of the log (A1). It changes ONLY through the reducers below, one per event type.
import type { BeliefProposition } from "./beliefs.ts";
import type { Content, Mode } from "./content.ts";
import type { SimEvent } from "./events.ts";
import type { ActionRef, Recommendation, Report, StructuredOrder } from "./schemas.ts";

export type Position = { at: string } | { transit: { from: string; dest: string; path: string[]; arrivals: number[]; departedAt: number; mode: Mode } };
export type ReportStatus = "composed" | "in_transit" | "delivered" | "lost" | "intercepted" | "undeliverable";
export interface Messenger {
  id: number; kind: "report" | "order" | "captured"; ref: number; sender: string; recipient: string;
  carries?: "report" | "order"; // what a captured messenger carries back to the interceptor
  path: string[]; arrivals: number[]; departedAt: number; redirects: number;
}
export interface IssuedRecord { orderId: number; action: string; target: string; recipient: string; tick: number }
export interface Intention { action: ActionRef; score: number; adoptedAt: number; decisionEventId: number; idle: boolean; orderId?: number }
export interface AgentState { operational: Intention | null; focus: string | null; experience: Record<string, number>; lastDecision: number | null; answerRate: Record<string, number>; lastActive: number }
export type Tier = "A" | "B" | "C";
export interface HistoryEntry { tick: number; event: "promoted" | "demoted" | "appointed"; from?: Tier; to?: Tier; role?: string; reason?: string }

export interface WorldState {
  treasuryMilli: Record<string, number>;
  fortifications: Record<string, { conditionMilli: number; lastChangeEvent: number; garrison: number }>;
  troops: Record<string, number>;
  tiers: Record<string, Tier>;
  history: Record<string, HistoryEntry[]>;
  agents: Record<string, AgentState>;
  recommendations: Record<string, Recommendation>;
  heard: Record<string, Record<string, Recommendation>>; // advice each listener heard in person, latest per adviser and target
  campaign: { ended: { tick: number; ending: string; where: string } | null; lastDanger: number };
  lastRaid: Record<string, number>;
  lastRepairStart: Record<string, number>;
  lastArrival: Record<string, Record<string, number>>;
  lastStorm: Record<string, number>;
  threats: Record<string, { intensityPermille: number; untilTick: number; eventId: number }>;
  routesClosed: Record<string, true>;
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
  advisePending: Record<string, number>; // adviser -> day their advice is due (given at the end of that day)
  ordersInForce: Record<string, number[]>;
  issued: Record<string, IssuedRecord[]>;
  repairs: Record<string, { startedAt: number; orderId: number; work: number; done: number; lastT: number; men: number; gen: number; restoredMilli: number; startedEventId: number; engineer: string }>;
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const newAgent = (): AgentState => ({ operational: null, focus: null, experience: {}, lastDecision: null, answerRate: {}, lastActive: 0 });

export function initialState(c: Content): WorldState {
  const fortifications: WorldState["fortifications"] = {};
  for (const l of [...c.locations].sort((a, b) => cmp(a.id, b.id)))
    if (l.fortification) fortifications[l.id] = { conditionMilli: l.fortification.conditionMilli, lastChangeEvent: 1, garrison: l.fortification.garrison };
  const positions: WorldState["positions"] = {};
  const troops: WorldState["troops"] = {}, agents: WorldState["agents"] = {}, tiers: WorldState["tiers"] = {};
  for (const ch of [...c.characters].sort((a, b) => cmp(a.id, b.id))) {
    positions[ch.id] = { at: ch.location };
    tiers[ch.id] = ch.tier;
    if (ch.troops) troops[ch.id] = ch.troops;
    if (ch.id !== c.scenario.ruler && ch.tier !== "C") agents[ch.id] = newAgent();
  }
  return {
    treasuryMilli: { [c.scenario.ruler]: c.scenario.treasuryMilli }, fortifications, troops, tiers, history: {}, agents, recommendations: {}, heard: {}, campaign: { ended: null, lastDanger: -1 }, lastRaid: {}, lastRepairStart: {}, lastArrival: {}, lastStorm: {}, threats: {}, routesClosed: {},
    positions, departures: {}, beliefs: {}, nextPropId: 1, reports: {}, nextReportId: 1, messengers: {}, nextMessengerId: 1,
    orders: {}, nextOrderId: 1, advisePending: {}, ordersInForce: {}, issued: {}, repairs: {},
  };
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
  UpkeepPaid: (s, p) => { s.treasuryMilli[p.holder] -= p.amountMilli; },
  FortificationsWeathered: (s, p, e) => {
    for (const [loc, d] of p.changes as [string, number][]) { const f = s.fortifications[loc]; f.conditionMilli = clampCond(f.conditionMilli - d); f.lastChangeEvent = e.id; }
  },
  Storm: (s, p, e) => {
    s.lastStorm[p.location] = e.tick;
    const f = s.fortifications[p.location]; if (f) { f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; }
  },
  ThreatBegan: (s, p, e) => { s.threats[p.site] = { intensityPermille: p.intensityPermille, untilTick: p.untilTick, eventId: e.id }; },
  RaidDamage: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; s.lastRaid[p.location] = e.tick; },
  ThreatScripted: noop,
  ThreatEnded: (s, p) => { delete s.threats[p.site]; },

  TravelScripted: noop,
  Departed: (s, p, e) => {
    s.positions[p.who] = { transit: { from: p.from, dest: p.dest, path: p.path, arrivals: p.arrivals, departedAt: e.tick, mode: p.mode } };
    (s.departures[p.from] ??= {})[p.who] = { to: p.secret ? null : p.dest, tick: e.tick };
  },
  Arrived: (s, p, e) => { s.positions[p.who] = { at: p.at }; (s.lastArrival[p.at] ??= {})[p.who] = e.tick; },
  RouteClosed: (s, p) => { s.routesClosed[p.route] = true; },
  RouteOpened: (s, p) => { delete s.routesClosed[p.route]; },

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
  RepairStarted: (s, p, e) => { s.repairs[p.location] = { startedAt: p.startedAt, orderId: p.orderId, work: p.work, done: 0, lastT: e.tick, men: p.men, gen: 0, restoredMilli: p.restoredMilli, startedEventId: e.id, engineer: p.engineer }; s.treasuryMilli[p.payer] -= p.costMilli; s.lastRepairStart[p.location] = e.tick; },
  AdviceScheduled: (s, p) => { s.advisePending[p.agent] = p.day; },
  AdviceSettled: (s, p) => { delete s.advisePending[p.agent]; },
  RepairResynced: (s, p, e) => { const r = s.repairs[p.location]; r.done = p.done; r.lastT = e.tick; r.men = p.men; r.gen = p.gen; },
  RepairCompleted: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli + p.restoredMilli); f.lastChangeEvent = e.id; delete s.repairs[p.location]; },
  LevyRaised: (s, p) => { s.treasuryMilli[p.payer] += p.amountMilli; },
  PlayerInput: noop,
  RecommendationMade: (s, p) => {
    s.recommendations[p.recommendation.author] = p.recommendation;
    const t = (JSON.parse(p.recommendation.plan.id) as { target?: string }).target ?? "*";
    for (const who of p.audience ?? []) (s.heard[who] ??= {})[`${p.recommendation.author}|${t}`] = p.recommendation;
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
  SortieLaunched: noop,
  SortieResolved: noop,
  LossesTaken: (s, p) => {
    if (p.garrisonLost) s.fortifications[p.location].garrison -= p.garrisonLost;
    for (const [who, n] of Object.entries(p.troopsLost as Record<string, number>)) s.troops[who] -= n;
  },
  DetachmentSent: (s, p) => { s.troops[p.commander] -= p.men; },
  DetachmentArrived: (s, p, e) => { s.fortifications[p.to].garrison += p.men; (s.lastArrival[p.to] ??= {})[p.commander] = e.tick; },
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
