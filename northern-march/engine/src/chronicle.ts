// Chronicle pass (DESIGN_PIPELINE §11, plan B4 outcome.failureOrigin). Runs after the simulation, over the log only.
// Judged: every new choice (an intention adopted, an order answered); daily re-affirmations are not new choices.
// A choice's outcome is bad when, within the planning horizon, it is more than `tol` worse than the decider itself
// expected (surprise), or with the truth another option was more than `tol` better (regret). Losses = fort condition
// lost + men lost + a breach penalty, valued as the planner values them, on both the expected and the realized side.
// Failure origin of a bad outcome:
//   communication: a message the decision sent or depended on was lost, intercepted, undeliverable or very late;
//   belief:        its decisive beliefs (about the decision's fort and the threats near it) were wrong or stale and
//                  misled it (expectations or choice differ from what the truth gives);
//   choice:        regret with correct beliefs (a poor or self-interested choice);
//   execution:     a surprise with correct beliefs (bad luck, weather, a sortie that failed).
// The log is never modified: attribution is derived data.
import type { Content } from "./content.ts";
import type { SimEvent } from "./events.ts";
import type { DecisionTrace, StructuredOrder } from "./schemas.ts";
import { buildView } from "./view.ts";
import { applyEvent, initialState, type WorldState } from "./world.ts";
import { actionKey, type ActionRef, type Perceiver, type Situation } from "./agents/model.ts";
import { expect } from "./agents/terms.ts";
import { interpret } from "./agents/obedience.ts";
import { plan } from "./agents/planner.ts";
import { buildSituation, defenceAt, perceiverFromView, truthPerceiver } from "./systems/agents.ts";
import { orderChoice } from "./systems/orders.ts";

const DAY = 86400;
export type Origin = "belief" | "choice" | "communication" | "execution";
const COMM_FAIL = new Set(["ReportLost", "OrderLost", "ReportIntercepted", "OrderIntercepted", "ReportUndeliverable", "OrderUndeliverable"]);
const TOLERANCE: Record<string, number> = { "fortification.condition": 5000, "threat.intensity": 150, "treasury.balance": 20000 };

export interface DecisionVerdict {
  eventId: number; tick: number; agent: string; kind: string; selected: ActionRef; oracle: ActionRef | null; subject: string;
  wrong: boolean; stale: boolean; wrongOrStale: boolean; evaluated: boolean; bad: boolean; failureOrigin: Origin | null; why: string[];
  expectedLoss: number; trueExpectedLoss: number; oracleExpectedLoss: number; realizedLoss: number | null;
  /** Raw verdict before the luck adjustment (storm damage beyond its expected value counted against the decision). */
  badRaw: boolean;
}
const TOL = 10000;

/** Expected loss at the decision's fort over the horizon for one action, as a given perceiver sees the world. */
function expectedLoss(sit: Situation, per: Perceiver, a: ActionRef, fort: string, cond: number | null) {
  const e = expect(sit, per, a);
  const net = (e.loss[fort] ?? 0) - (e.restore[fort] ?? 0);
  const breach = cond !== null && cond - net < sit.p.breachMilli ? sit.p.agents.values.breachPenaltyMilli : 0;
  return net + breach + e.menLost * sit.p.agents.values.manMilli;
}
export interface Breach { tick: number; fort: string; decisionEventId: number | null; failureOrigin: Origin | null; responsible: string | null; why: string }

interface Open {
  v: DecisionVerdict; until: number; condStart: number; minCond: number; condEnd: number; menStart: number;
  comm: boolean; sortieFailed: boolean; menLost: number; stormMilli: number; expectedStormMilli: number;
}

function subjectOf(s: WorldState, t: DecisionTrace, order?: StructuredOrder): string | null {
  const isFort = (x?: string) => !!x && !!s.fortifications[x];
  if (t.kind === "obedience") return order && isFort(order.objective.id) ? order.objective.id : null;
  const a = t.selected, pos = s.positions[t.agent];
  const here = "at" in pos ? pos.at : undefined;
  if (a.kind === "march_to" || a.kind === "send_detachment") return isFort(a.target) ? a.target! : null;
  if (a.kind === "sortie") return here && isFort(here) ? here : null;
  if (isFort(here)) return here!;
  return null;
}

function beliefQuality(s: WorldState, c: Content, t: DecisionTrace, subject: string) {
  let wrong = false, stale = false;
  const decisive = new Set([subject, ...c.scenario.threat.sites.filter((x) => x.target === subject).map((x) => x.site)]);
  for (const b of t.beliefsConsulted) {
    const pred = b.predicate!, id = b.subject!.id;
    if (!decisive.has(id)) continue; // only beliefs about the decision's own fort and the threats near it
    const tol = TOLERANCE[pred];
    if (tol === undefined) continue; // only physical facts can be checked against the truth
    const truth = pred === "fortification.condition" ? s.fortifications[id]?.conditionMilli : pred === "threat.intensity" ? (s.threats[id]?.intensityPermille ?? 0) : s.treasuryMilli[id];
    if (truth !== undefined && Math.abs((b.believedValue as number) - truth) > tol) wrong = true;
    const hl = c.byId.predicate.get(pred)!.halfLifeTicks;
    if (hl > 0 && b.ageTicks > hl) stale = true;
  }
  return { wrong, stale };
}

export function analyzeRun(sim: { log: readonly SimEvent[]; content: Content; tick: number }) {
  const c = sim.content, W = c.scenario.agents.horizonDays * DAY, breachAt = c.scenario.endStates.fortificationBreachedBelowMilli;
  const s = initialState(c);
  const decisions: DecisionVerdict[] = [], breaches: Breach[] = [];
  const open: Open[] = [];
  const desc = new Map<number, Open[]>();
  const issuedAt = new Map<number, number>(), receivedAt = new Map<number, number>();
  const condBefore = (f: string) => s.fortifications[f].conditionMilli;
  for (const e of sim.log) {
    // a decision is judged on the world as it stood when it was taken (before its own event is applied)
    if (e.type === "DecisionMade") {
      const t = e.payload.trace as DecisionTrace;
      if ((t.kind === "plan" && !t.keptCurrentIntention) || t.kind === "obedience") {
        const order = t.kind === "obedience" ? s.orders[String(e.payload.orderId)]?.order : undefined;
        const subject = subjectOf(s, t, order);
        if (subject) {
          const q = beliefQuality(s, c, t, subject);
          const view = buildView(s, c, t.agent, e.tick), per = truthPerceiver(s, view), own = perceiverFromView(view);
          let oracle: ActionRef | null = null, sit: Situation;
          if (t.kind === "plan") {
            sit = buildSituation(s, c, t.agent, e.tick, "act", view);
            oracle = plan({ ...sit, current: null }, per)?.selected ?? null;
          } else {
            sit = buildSituation(s, c, t.agent, e.tick, "obey", view, order);
            oracle = orderChoice(sit, per, order!, interpret(order!, sit).understood, false).chosen.action;
          }
          const v: DecisionVerdict = { eventId: e.id, tick: e.tick, agent: t.agent, kind: t.kind, selected: t.selected, oracle, subject,
            wrong: q.wrong, stale: q.stale, wrongOrStale: q.wrong || q.stale, evaluated: false, bad: false, failureOrigin: null, why: [],
            expectedLoss: expectedLoss(sit, own, t.selected, subject, (own.get(subject, "fortification.condition")?.value as number) ?? null),
            trueExpectedLoss: expectedLoss(sit, per, t.selected, subject, s.fortifications[subject].conditionMilli),
            oracleExpectedLoss: expectedLoss(sit, per, oracle ?? t.selected, subject, s.fortifications[subject].conditionMilli), realizedLoss: null, badRaw: false };
          const cond = condBefore(subject);
          const fortInfo = sit.forts.find((f) => f.id === subject)!;
          const o: Open = { v, until: e.tick + W, condStart: cond, minCond: cond, condEnd: cond, menStart: defenceAt(s, subject) ?? 0, comm: false, sortieFailed: false, menLost: 0,
            stormMilli: 0, expectedStormMilli: Math.floor((fortInfo.stormMilliPerDay * W) / DAY) };
          if (order) {
            const sent = issuedAt.get(order.id), got = receivedAt.get(order.id);
            if (sent !== undefined && got !== undefined && got - sent > W / 2) { o.comm = true; v.why.push("order arrived late"); }
          }
          decisions.push(v); open.push(o); desc.set(e.id, [o]);
        }
      }
    }
    // causal descendants of each open decision (its letters, orders, sorties, losses)
    const inherited = new Set<Open>();
    for (const cId of e.causedBy) for (const o of desc.get(cId) ?? []) if (e.tick <= o.until) inherited.add(o);
    if (inherited.size && !desc.has(e.id)) desc.set(e.id, [...inherited]);
    for (const o of inherited) {
      if (COMM_FAIL.has(e.type)) { o.comm = true; o.v.why.push(e.type); }
      if (e.type === "SortieResolved" && e.payload.found && !e.payload.success) o.sortieFailed = true;
      if (e.type === "LossesTaken") o.menLost += (e.payload.garrisonLost as number) + Object.values(e.payload.troopsLost as Record<string, number>).reduce((a, b) => a + b, 0);
    }
    if (e.type === "Storm") for (const o of open) if (o.v.subject === e.payload.location && e.tick <= o.until && e.tick > o.v.tick) o.stormMilli += e.payload.damageMilli as number;
    if (e.type === "OrderIssued") issuedAt.set((e.payload.order as StructuredOrder).id, e.tick);
    if (e.type === "OrderReceived") receivedAt.set(e.payload.orderId as number, e.tick);

    const before = Object.fromEntries(Object.entries(s.fortifications).map(([k, f]) => [k, f.conditionMilli]));
    applyEvent(s, e);
    for (const [f, fs] of Object.entries(s.fortifications)) {
      if (before[f] >= breachAt && fs.conditionMilli < breachAt) breaches.push({ tick: e.tick, fort: f, decisionEventId: null, failureOrigin: null, responsible: null, why: "" });
      for (const o of open) if (o.v.subject === f && e.tick <= o.until) { o.minCond = Math.min(o.minCond, fs.conditionMilli); o.condEnd = fs.conditionMilli; }
    }
  }
  const manMilli = c.scenario.agents.values.manMilli;
  for (const o of open) {
    const v = o.v;
    v.evaluated = o.until <= sim.tick;
    const breached = o.minCond < breachAt;
    v.realizedLoss = (o.condStart - o.condEnd) + o.menLost * manMilli + (breached ? c.scenario.agents.values.breachPenaltyMilli : 0);
    // Luck adjustment: storm damage beyond what the climate leads anyone to expect is weather, not the decision.
    const stormLuck = Math.max(0, o.stormMilli - o.expectedStormMilli);
    const surprise = v.realizedLoss - stormLuck - v.expectedLoss > TOL;
    const differs = !!v.oracle && actionKey(v.oracle) !== actionKey(v.selected);
    const regret = differs && v.trueExpectedLoss - v.oracleExpectedLoss > TOL;
    v.badRaw = v.realizedLoss - v.expectedLoss > TOL || regret;
    v.bad = surprise || regret; // a breach that was expected, and that no option would have prevented, is not this decision's failure
    if (stormLuck > TOL) v.why.push("storm beyond expectation (not counted against the decision)");
    if (breached) v.why.push("breached"); if (surprise) v.why.push("worse than expected"); if (regret) v.why.push("a better option existed");
    if (o.sortieFailed) v.why.push("sortie failed");
    if (!v.bad) continue;
    const misled = v.wrongOrStale && (differs || Math.abs(v.expectedLoss - v.trueExpectedLoss) > TOL / 2);
    v.failureOrigin = o.comm ? "communication" : misled ? "belief" : regret ? "choice" : "execution";
  }
  // A breach is traced to the agent decision that failed, or else to the ruler: what was she told, what did she order,
  // and what became of the order.
  const ruler = c.scenario.ruler;
  const fortOf = (o: StructuredOrder) => o.objective.id;
  for (const b of breaches) {
    const resp = [...decisions].reverse().find((d) => d.subject === b.fort && d.tick <= b.tick && b.tick - d.tick <= W && d.bad);
    if (resp) { b.decisionEventId = resp.eventId; b.failureOrigin = resp.failureOrigin; b.responsible = resp.agent; b.why = "agent decision"; continue; }
    const from = b.tick - W;
    const inWindow = (e: SimEvent) => e.tick >= from && e.tick <= b.tick;
    const orders = sim.log.filter((e) => e.type === "OrderIssued" && inWindow(e) && (e.payload.order as StructuredOrder).issuer === ruler && fortOf(e.payload.order as StructuredOrder) === b.fort)
      .map((e) => (e.payload.order as StructuredOrder).id);
    const fate = (types: string[]) => sim.log.some((e) => types.includes(e.type) && orders.includes(e.payload.orderId as number) && e.tick <= b.tick);
    b.responsible = ruler;
    if (orders.length) {
      if (fate(["OrderLost", "OrderIntercepted", "OrderUndeliverable"])) { b.failureOrigin = "communication"; b.why = "the ruler's order did not arrive"; }
      else if (fate(["OrderAbandoned"])) { b.failureOrigin = "execution"; b.why = "the ruler's order could not be carried out"; }
      else if (sim.log.some((e) => e.type === "ObedienceDecided" && orders.includes(e.payload.orderId as number) && e.payload.decision === "refuse")) { b.failureOrigin = "choice"; b.why = "the order was refused"; }
      else { b.failureOrigin = "execution"; b.why = "help was ordered but came too late"; }
      continue;
    }
    const told = sim.log.some((e) => e.type === "ReportDelivered" && inWindow(e) && e.payload.recipient === ruler &&
      (s.reports[String(e.payload.reportId)]?.claims ?? []).some((cl) => cl.subject.id === b.fort));
    if (told) { b.failureOrigin = "choice"; b.why = "the ruler was told and gave no order"; continue; }
    b.failureOrigin = "communication"; b.why = "no report of the fort reached the ruler";
  }
  const evaluated = decisions.filter((d) => d.evaluated);
  const bad = evaluated.filter((d) => d.bad);
  const outcomes = bad.length + breaches.length;
  const attributed = bad.filter((d) => d.failureOrigin).length + breaches.filter((b) => b.failureOrigin).length;
  return {
    decisions, breaches,
    summary: {
      evaluated: evaluated.length, bad: bad.length, breaches: breaches.length, outcomes, attributed,
      byOrigin: Object.fromEntries((["belief", "choice", "communication", "execution"] as const).map((k) => [k, bad.filter((d) => d.failureOrigin === k).length])),
      wrongOrStale: evaluated.filter((d) => d.wrongOrStale).length,
      badWhenWrong: evaluated.filter((d) => d.wrongOrStale && d.bad).length,
      badWhenRight: evaluated.filter((d) => !d.wrongOrStale && d.bad).length,
      badRawWhenWrong: evaluated.filter((d) => d.wrongOrStale && d.badRaw).length,
      badRawWhenRight: evaluated.filter((d) => !d.wrongOrStale && d.badRaw).length,
    },
  };
}
