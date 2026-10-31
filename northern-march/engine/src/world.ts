// WorldState is a projection of the log (A1). It changes ONLY through the reducers below, one per event type.
import type { SimEvent } from "./events.ts";
import type { Content } from "./content.ts";

export interface ReportState {
  author: string; recipient: string; subject: string; predicate: string; value: number;
  observedAt: number; composedAt: number; deliveredAt: number | null; lost: boolean;
}
export interface Belief { value: number; observedAt: number; learnedAt: number; reportId: number }
export interface OrderRecord { action: string; target: string | null; tick: number; inputEventId: number }

export interface WorldState {
  treasuryMilli: Record<string, number>;
  fortifications: Record<string, { conditionMilli: number; lastChangeEvent: number }>;
  threats: Record<string, { intensityPermille: number; untilTick: number; eventId: number }>;
  reports: Record<string, ReportState>;
  beliefs: Record<string, Record<string, Belief>>;
  orders: Record<string, OrderRecord[]>;
  repairs: Record<string, { startedAt: number; inputEventId: number }>;
  nextReportId: number;
}

export function initialState(c: Content): WorldState {
  const fortifications: WorldState["fortifications"] = {};
  for (const l of [...c.locations].sort((a, b) => cmp(a.id, b.id)))
    if (l.fortification) fortifications[l.id] = { conditionMilli: l.fortification.conditionMilli, lastChangeEvent: 1 };
  return {
    treasuryMilli: { [c.scenario.ruler]: c.scenario.treasuryMilli }, fortifications, threats: {},
    reports: {}, beliefs: {}, orders: {}, repairs: {}, nextReportId: 1,
  };
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clampCond = (v: number) => Math.max(0, Math.min(100000, v));
type P = Record<string, any>;

export const REDUCERS: Record<string, (s: WorldState, p: P, e: SimEvent) => void> = {
  ScenarioStarted: () => {},
  TreasuryCollected: (s, p) => { s.treasuryMilli[p.holder] = (s.treasuryMilli[p.holder] ?? 0) + p.amountMilli; },
  UpkeepPaid: (s, p) => { s.treasuryMilli[p.holder] -= p.amountMilli; },
  FortificationsWeathered: (s, p, e) => {
    for (const [loc, d] of p.changes as [string, number][]) { const f = s.fortifications[loc]; f.conditionMilli = clampCond(f.conditionMilli - d); f.lastChangeEvent = e.id; }
  },
  Storm: (s, p, e) => { const f = s.fortifications[p.location]; if (f) { f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; } },
  ThreatBegan: (s, p, e) => { s.threats[p.site] = { intensityPermille: p.intensityPermille, untilTick: p.untilTick, eventId: e.id }; },
  RaidDamage: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli - p.damageMilli); f.lastChangeEvent = e.id; },
  ThreatEnded: (s, p) => { delete s.threats[p.site]; },
  ReportComposed: (s, p) => {
    s.reports[String(p.reportId)] = { author: p.author, recipient: p.recipient, subject: p.subject, predicate: p.predicate, value: p.value,
      observedAt: p.observedAt, composedAt: p.composedAt, deliveredAt: null, lost: false };
    s.nextReportId = p.reportId + 1;
  },
  ReportLost: (s, p) => { s.reports[String(p.reportId)].lost = true; },
  ReportDelivered: (s, p, e) => { s.reports[String(p.reportId)].deliveredAt = e.tick; },
  BeliefUpdated: (s, p, e) => {
    (s.beliefs[p.holder] ??= {})[p.key] = { value: p.value, observedAt: p.observedAt, learnedAt: e.tick, reportId: p.reportId };
  },
  OrderDelivered: () => {},
  OrderLost: () => {},
  PlayerInput: (s, p, e) => {
    (s.orders[p.player] ??= []).push({ action: p.action, target: p.target ?? null, tick: e.tick, inputEventId: e.id });
  },
  RepairStarted: (s, p) => { s.repairs[p.location] = { startedAt: p.startedAt, inputEventId: p.inputEventId }; s.treasuryMilli[p.payer] -= p.costMilli; },
  RepairCompleted: (s, p, e) => { const f = s.fortifications[p.location]; f.conditionMilli = clampCond(f.conditionMilli + p.restoredMilli); f.lastChangeEvent = e.id; delete s.repairs[p.location]; },
  RepairRefused: () => {},
  LevyRaised: (s, p) => { s.treasuryMilli[p.payer] += p.amountMilli; },
};

export function applyEvent(s: WorldState, e: SimEvent): void {
  const r = REDUCERS[e.type];
  if (!r) throw new Error(`no reducer for ${e.type}`);
  r(s, e.payload, e);
}
