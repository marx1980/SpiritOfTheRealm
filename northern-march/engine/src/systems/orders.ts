// StructuredOrder lifecycle (B2, DESIGN_PIPELINE §6, ARCHITECTURE §20.8). Every step is its own event:
// received -> interpreted (clarity x skill) -> obedience decided (obey / adapt / refuse, with reasons, traced) ->
// local plan (the recipient's own skill) -> execution -> completed / abandoned / superseded.
import { validateOrder, type IntentKind, type Reason, type StructuredOrder } from "../schemas.ts";
import type { SubjectRef } from "../events.ts";
import { buildView } from "../view.ts";
import { act, actionKey, type ActionRef, type Perceiver, type Situation } from "../agents/model.ts";
import { adaptations, decideObedience, interpret, margins, obeyForms } from "../agents/obedience.ts";
import { plan } from "../agents/planner.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, chr, loc } from "./types.ts";
import { best, learn, observe, observeTreasury, skill } from "./knowledge.ts";
import { battleClaims, buildSituation, capability, defenceAt, execute, isIdle, perceiverFromView, promote, traceOf } from "./agents.ts";
import { travel } from "./movement.ts";
import { menAt, resyncRepair, scheduleRepairEnd } from "./repairs.ts";

const oref = (id: number) => ({ kind: "order" as const, id: String(id) });

export function issue(ctx: Ctx, issuer: string, recipient: string, intent: IntentKind, objective: SubjectRef, cause: number, supersedesPrevious = false,
  opts: { discretion?: StructuredOrder["discretion"]; parentOrderId?: number; constraints?: StructuredOrder["constraints"]; contingencies?: StructuredOrder["contingencies"];
    reportingPolicy?: StructuredOrder["reportingPolicy"] } = {}) {
  const id = ctx.s.nextOrderId;
  const supersedes = supersedesPrevious
    ? (ctx.s.issued[issuer] ?? []).filter((r) => r.recipient === recipient && r.target === objective.id).map((r) => r.orderId)
    : [];
  const order: StructuredOrder = {
    schemaVersion: 1, id, issuer, recipient, issuedAt: ctx.tick, kind: "strategic", intent, objective,
    constraints: opts.constraints ?? [], contingencies: opts.contingencies ?? [], discretion: opts.discretion ?? "bounded",
    reportingPolicy: opts.reportingPolicy ?? { onReceipt: false, onCompletion: true, onFailure: true },
    ...(supersedes.length ? { supersedes } : {}), ...(opts.parentOrderId ? { parentOrderId: opts.parentOrderId } : {}),
  };
  const problems = validateOrder(order);
  if (problems.length) throw new Error(`invalid order: ${problems.join("; ")}`);
  const ev = ctx.emit("OrderIssued", [cause], [chr(issuer), chr(recipient), objective, oref(id)], { order });
  const a = ctx.s.positions[issuer], b = ctx.s.positions[recipient];
  if ("at" in a && "at" in b && a.at === b.at) {
    const r = ctx.emit("OrderReceived", [ev.id], [chr(recipient), oref(id)], { orderId: id, recipient, at: b.at, messengerId: null });
    process(ctx, id, r.id);
  } else ctx.at(ctx.tick, "messenger:dispatchOrder", { orderId: id, cause: ev.id });
  return id;
}

const SERVES = (o: StructuredOrder, a: ActionRef, understood: ActionRef) =>
  actionKey(a) === actionKey(understood) || [...obeyForms(o), ...adaptations(o)].some((x) => actionKey(x) === actionKey(a));
const OBEYS = (o: StructuredOrder, a: ActionRef) => obeyForms(o).some((x) => actionKey(x) === actionKey(a));

/** Score the ways to answer an order (obey, adapt, or the recipient's own alternatives) and decide. Shared with the
 *  chronicle's oracle, which calls it with the true state of the world instead of the recipient's beliefs. */
export function orderChoice(sit: Situation, per: Perceiver, o: StructuredOrder, understood: ActionRef, changed: boolean) {
  const usable = (a: ActionRef) => a.kind !== "delegate_investigation" || sit.leaderCandidates.length > 0;
  const res = plan({ ...sit, current: null }, per, [...obeyForms(o), ...adaptations(o)].filter(usable))!;
  res.candidates = res.candidates.filter((c) => usable(c.action));
  const duty = Math.floor((sit.p.agents.obedience.dutyMilli * sit.loyalty(o.issuer)) / 1000);
  for (const c of res.candidates) if (SERVES(o, c.action, understood)) {
    const r: Reason = { kind: "order", ref: { kind: "order", id: String(o.id) }, weight: duty, textKey: "reason.duty" };
    c.contributions = [...c.contributions, r]; c.score += duty;
  }
  res.candidates.sort((a, b) => b.score - a.score || (actionKey(a.action) < actionKey(b.action) ? -1 : 1));
  const obeyC = res.candidates.find((c) => OBEYS(o, c.action))!; // best of the ways that count as obeying
  const serving = res.candidates.filter((c) => !OBEYS(o, c.action) && SERVES(o, c.action, understood));
  const other = res.candidates.filter((c) => !SERVES(o, c.action, understood));
  const m = margins(sit, o, changed);
  const d = decideObedience({ obey: obeyC.score, bestServing: serving[0]?.score ?? -1e12, bestOther: other[0]?.score ?? -1e12, ...m });
  const chosen = d.decision === "obey" ? obeyC : d.decision === "adapt" ? serving[0] : other[0];
  return { res, chosen, d, m };
}

/** The fort that answers a site: the nearest fortified place on the map. */
function fortAnswering(ctx: Ctx, site: string): string | undefined {
  const s = ctx.content.byId.location.get(site);
  if (!s) return undefined;
  const d = (p: { pos: [number, number] }) => (p.pos[0] - s.pos[0]) ** 2 + (p.pos[1] - s.pos[1]) ** 2;
  return ctx.content.locations.filter((l) => l.fortification).sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1))[0]?.id;
}
/** An order to attack raiders: the captain goes to the fort that answers the site (if he is not there) and sorties from it with the men there. */
function startAttack(ctx: Ctx, orderId: number, receivedId: number) {
  const o = ctx.s.orders[String(orderId)].order, who = o.recipient, site = o.objective.id, fort = fortAnswering(ctx, site);
  const subj = [chr(who), oref(orderId)];
  const ex = ctx.emit("ExecutionStarted", [receivedId], subj, { orderId, action: act("sortie", site) });
  const pos = ctx.s.positions[who];
  if (!fort || !("at" in pos)) return finish(ctx, orderId, "abandoned", ex.id, "cannotAttack");
  if (pos.at === fort) return launchAttack(ctx, orderId, ex.id);
  travel(ctx, who, fort, "army", false, ex.id);
}
function launchAttack(ctx: Ctx, orderId: number, cause: number) {
  const o = ctx.s.orders[String(orderId)].order, who = o.recipient, pos = ctx.s.positions[who];
  if (!("at" in pos) || (defenceAt(ctx.s, pos.at) ?? 0) <= 0) return finish(ctx, orderId, "abandoned", cause, "noMen");
  execute(ctx, who, act("sortie", o.objective.id), cause);
}

/** A captain who marches into a fort the raiders hold must fight for it. Win and it is ours again (ruined, with a few men); lose and he falls back. */
function assault(ctx: Ctx, who: string, fort: string, cause: number) {
  const sc = ctx.content.scenario, sp = sc.battle.sortie;
  const site = sc.threat.sites.find((x) => x.target === fort)?.site, th = site ? ctx.s.threats[site] : undefined;
  const men = ctx.s.troops[who] ?? 0;
  const S = Math.floor((men * (sp.skillBasePermille + capability(ctx.s, ctx.content, who, "military"))) / 1000), I = th ? Math.floor((th.intensityPermille * sp.intensityFactorPermille) / 1000) : 0;
  const p = th ? Math.floor((1000 * S) / Math.max(1, S + I)) : 1000;
  const success = ctx.keyed(`battle:assault:${cause}`).int(0, 999) < p;
  const res = ctx.emit("FortAssaulted", [cause], [chr(who), loc(fort)], { commander: who, fort, site, success, pPermille: p, men });
  const lost = Math.floor((men * (success ? sp.lossOnSuccessPermille : sp.lossOnFailurePermille)) / 1000);
  if (lost) ctx.emit("LossesTaken", [res.id], [loc(fort)], { location: fort, garrisonLost: 0, troopsLost: { [who]: lost }, cause: "assault" });
  learn(ctx, who, { subject: loc(fort), predicate: "battle.result", value: success ? "won" : "lost", observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: res.id, source: who }, [res.id]);
  if (success) {
    ctx.emit("FortRetaken", [res.id], [loc(fort), chr(who)], { fort, by: who, conditionMilli: sc.threat.retakeConditionMilli, garrison: Math.floor((ctx.s.fortifications[fort].establishment * sc.threat.retakeGarrisonPermille) / 1000) });
    if (site && th) ctx.emit("ThreatEnded", [res.id], [loc(site)], { site, endedBy: "assault" });
    // word that the fort is ours again reaches those whose post it is, and the captain sees its state
    for (const c of ctx.content.characters.filter((x) => (x.location === fort || x.id === who) && ctx.s.tiers[x.id] !== "C"))
      learn(ctx, c.id, { subject: loc(fort), predicate: "fortification.holder", value: "ours", observedAt: ctx.tick, band: "certain" }, c.id === who ? { kind: "observation", eventId: res.id, source: who } : { kind: "scenario", eventId: res.id, source: who }, [res.id]);
    observe(ctx, who, loc(fort), "fortification.condition", res.id);
  } else {
    const home = ctx.content.byId.character.get(who)!.location;
    travel(ctx, who, home === fort ? (Object.keys(ctx.s.fortifications).filter((f) => f !== fort).sort()[0] ?? home) : home, "army", false, res.id);
  }
  if (success && site) learn(ctx, who, { subject: loc(site), predicate: "threat.intensity", value: 0, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: res.id, source: who }, [res.id]);
  const superior = ctx.content.byId.character.get(who)?.reportsTo;
  if (superior) ctx.at(ctx.tick, "messenger:compose", { author: who, recipient: superior, claims: [...battleClaims(ctx, who, fort, fort, res.id), ...(success && site ? [best(ctx, who, site, "threat.intensity")].filter((x): x is NonNullable<typeof x> => !!x).map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as "certain" })) : [])], cause: res.id, purpose: `battle:${fort}` });
}

function process(ctx: Ctx, orderId: number, receivedId: number) {
  const o = ctx.s.orders[String(orderId)].order;
  const who = o.recipient;
  const subj = [chr(who), oref(orderId)];
  for (const old of o.supersedes ?? [])
    if ((ctx.s.ordersInForce[who] ?? []).includes(old))
      ctx.emit("OrderSuperseded", [receivedId], [chr(who), oref(old)], { orderId: old, by: orderId, recipient: who });
  if (!ctx.s.agents[who]) return; // no agent behind the recipient (e.g. the ruler herself): the order simply stays in force
  if (o.intent === "attack") return startAttack(ctx, orderId, receivedId);

  const view = buildView(ctx.s, ctx.content, who, ctx.tick), per = perceiverFromView(view);
  const sit = buildSituation(ctx.s, ctx.content, who, ctx.tick, "obey", view, o);
  // 1. interpretation
  const it = interpret(o, sit);
  const int = ctx.emit("OrderInterpreted", [receivedId], subj, { orderId, intent: o.intent, objective: o.objective, clarityPermille: it.clarity,
    comprehensionPermille: it.comprehension, understood: it.understood, ...(it.ambiguity ? { ambiguity: it.ambiguity } : {}) });
  // 2. willingness: "obey as understood" against the recipient's own best alternative
  const objBelief = per.get(o.objective.id, "fortification.condition") ?? per.get(o.objective.id, "threat.intensity");
  const changed = !!objBelief && ctx.tick - objBelief.ageTicks > o.issuedAt; // the recipient knows something newer than the order
  const { res, chosen, d, m } = orderChoice(sit, per, o, it.understood, changed);
  const trace = traceOf(sit, per, { candidates: res.candidates, selected: chosen.action, kept: false, margin: d.decision === "refuse" ? m.refuseMargin : m.adaptMargin }, receivedId, "operational", "obedience");
  const dec = ctx.emit("DecisionMade", [int.id, receivedId], [chr(who), oref(orderId)],
    { trace, score: chosen.score, idle: isIdle(chosen.action, sit) && d.decision === "refuse", orderId });
  const reasons = [...chosen.contributions].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 4);
  const ob = ctx.emit("ObedienceDecided", [dec.id], subj, { orderId, decision: d.decision, executes: chosen.action, reasons, margins: m, byMilli: d.by, changedCircumstances: changed });
  if (d.decision === "refuse") {
    execute(ctx, who, chosen.action, dec.id); // what the recipient does instead
    return report(ctx, o, "refused", ob.id);
  }
  // 3. local plan with the recipient's own skill, then execution
  const pl = ctx.emit("LocalPlanFormed", [ob.id], subj, { orderId, steps: [chosen.action], skillPermille: skill(ctx, who, it.domain) });
  if (chosen.action.kind === "delegate_investigation") return delegate(ctx, o, sit.leaderCandidates[0], pl.id);
  const ex = ctx.emit("ExecutionStarted", [pl.id], subj, { orderId, action: chosen.action });
  const sc = ctx.content.scenario;
  const a = chosen.action;
  if (a.kind === "repair_works" || a.kind === "partial_repair") {
    const where = a.target!;
    const cond = ctx.s.fortifications[where]?.conditionMilli;
    const to = a.kind === "repair_works" ? sc.player.repairRestoreToMilli : sc.agents.values.goodConditionMilli;
    if (cond === undefined) return finish(ctx, orderId, "abandoned", ex.id, "noFortification");
    if (ctx.s.fallen[where]) return finish(ctx, orderId, "abandoned", ex.id, "fallen");
    if (ctx.s.repairs[where]) return finish(ctx, orderId, "abandoned", ex.id, "inProgress");
    if (to - cond <= 0) return finish(ctx, orderId, "abandoned", ex.id, "notNeeded");
    const costMilli = (to - cond) * sc.player.repairCostMilliPerMilli;
    if (ctx.s.treasuryMilli[sc.ruler] < costMilli) return finish(ctx, orderId, "abandoned", ex.id, "funds");
    // execution quality: a skilled engineer works faster and lands closer to the target
    const eng = skill(ctx, who, "engineering");
    // the job is measured as the garrison's days of work; captains' companies at the fort add men and speed it up
    const garrison = Math.max(1, ctx.s.fortifications[where].garrison);
    const base = Math.floor((sc.player.repairDays * DAY * (1500 - eng)) / 1000);
    const work = base * garrison;
    const men = Math.max(1, menAt(ctx, where));
    const durationTicks = Math.ceil(work / men);
    const r = ctx.keyed(`orders:repair:${orderId}`);
    const spread = (1000 - eng) * 10;
    // a full repair can fall short of its target by at most 5 points, so the walls are never worse than "sound"
    const jitter = a.kind === "repair_works" ? r.int(-Math.min(spread, 5000), 0) : r.int(-spread, Math.floor(spread / 4));
    const restoredMilli = Math.max(0, to - cond + jitter);
    const st = ctx.emit("RepairStarted", [ex.id], [loc(where), oref(orderId)], { location: where, payer: sc.ruler, costMilli, startedAt: ctx.tick, orderId, durationTicks, restoreToMilli: to,
      work, men, restoredMilli, engineer: who });
    observeTreasury(ctx, st.id);
    scheduleRepairEnd(ctx, where);
  } else if (a.kind === "levy" || a.kind === "half_levy") {
    const amount = a.kind === "levy" ? sc.player.levyMilli : Math.floor(sc.player.levyMilli / 2);
    const lv = ctx.emit("LevyRaised", [ex.id], [chr(sc.ruler), oref(orderId)], { payer: sc.ruler, amountMilli: amount, orderId });
    observeTreasury(ctx, lv.id);
    finish(ctx, orderId, "completed", lv.id);
  } else if (a.kind === "march_to" && "at" in ctx.s.positions[who] && (ctx.s.positions[who] as { at: string }).at === a.target) {
    finish(ctx, orderId, "completed", ex.id);
  } else if (a.kind === "investigate") {
    const pos = ctx.s.positions[who];
    if ("at" in pos && pos.at === a.target) scouted(ctx, who, orderId, ex.id);
    else travel(ctx, who, a.target!, "rider", false, ex.id);
  } else {
    execute(ctx, who, a, dec.id); // march, detachment, hold: completion comes from arrival events
  }
}

/** The senior delegate picks a leader (ARCHITECTURE §20.9: independent responsibility promotes), orders them, and waits. */
function delegate(ctx: Ctx, o: StructuredOrder, leader: { id: string; recommendedBy: string; score: number }, cause: number) {
  const who = o.recipient;
  const ap = ctx.emit("LeaderAppointed", [cause], [chr(who), chr(leader.id), o.objective], { by: who, leader: leader.id, recommendedBy: leader.recommendedBy,
    score: leader.score, role: "expedition leader", objective: o.objective, orderId: o.id });
  promote(ctx, leader.id, "A", "given independent responsibility", ap.id);
  // the delegate knows where to find the leader from whoever recommended them
  learn(ctx, who, { subject: chr(leader.id), predicate: "character.seat", value: ctx.content.byId.character.get(leader.id)!.location, observedAt: ctx.tick, band: "probable" },
    { kind: "scenario", eventId: ap.id, source: leader.recommendedBy }, [ap.id]);
  const sub = issue(ctx, who, leader.id, o.intent, o.objective, ap.id, false, { parentOrderId: o.id });
  const so = ctx.emit("SubordinateOrdersIssued", [ap.id], [chr(who), oref(o.id)], { orderId: o.id, subordinateOrderIds: [sub], leader: leader.id });
  ctx.emit("ExecutionStarted", [so.id], [chr(who), oref(o.id)], { orderId: o.id, action: { kind: "delegate_investigation", target: o.objective.id } });
}

/** At the place: look, then report as the order asks, and head home. */
function scouted(ctx: Ctx, who: string, orderId: number, cause: number) {
  const o = ctx.s.orders[String(orderId)].order;
  const site = o.objective.id;
  if (ctx.content.scenario.threat.sites.some((x) => x.site === site)) observe(ctx, who, loc(site), "threat.intensity", cause);
  else if (ctx.s.fortifications[site]) observe(ctx, who, loc(site), "fortification.condition", cause);
  finish(ctx, orderId, "completed", cause);
  const home = ctx.content.byId.character.get(who)!.location;
  travel(ctx, who, home, "rider", false, cause);
}

function report(ctx: Ctx, o: StructuredOrder, outcome: string, cause: number) {
  learn(ctx, o.recipient, { subject: oref(o.id), predicate: "order.status", value: outcome, observedAt: ctx.tick, band: "certain" },
    { kind: "observation", eventId: cause, source: o.recipient }, [cause]);
  const p = ctx.s.positions[o.recipient];
  if (o.intent === "repair" && "at" in p && p.at === o.objective.id) observe(ctx, o.recipient, loc(o.objective.id), "fortification.condition", cause);
  if (o.intent === "attack" && "at" in p) {
    const st = best(ctx, o.recipient, String(o.id), "order.status");
    const claims = [...(st ? [{ ...st, reliabilityBand: st.band as "certain" }] : []).map(({ band: _b, ...rest }: any) => rest), ...battleClaims(ctx, o.recipient, p.at, o.objective.id, cause)];
    if (o.recipient !== o.issuer) ctx.at(ctx.tick, "messenger:compose", { author: o.recipient, recipient: o.issuer, claims, cause });
    return;
  }
  const claims = [best(ctx, o.recipient, String(o.id), "order.status"),
    o.intent === "repair" ? best(ctx, o.recipient, o.objective.id, "fortification.condition") : null,
    (o.intent === "investigate" || o.intent === "attack") ? best(ctx, o.recipient, o.objective.id, "threat.intensity") ?? best(ctx, o.recipient, o.objective.id, "fortification.condition") : null]
    .filter((x): x is NonNullable<typeof x> => !!x).map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as "certain" }));
  if (o.recipient !== o.issuer) ctx.at(ctx.tick, "messenger:compose", { author: o.recipient, recipient: o.issuer, claims, cause });
}

export function finish(ctx: Ctx, orderId: number, outcome: "completed" | "abandoned", cause: number, reason?: string) {
  const o = ctx.s.orders[String(orderId)].order;
  if (!["executing"].includes(ctx.s.orders[String(orderId)].status)) return;
  const ev = ctx.emit(outcome === "completed" ? "OrderCompleted" : "OrderAbandoned", [cause], [chr(o.recipient), oref(orderId)],
    { orderId, recipient: o.recipient, ...(reason ? { reason } : {}) });
  const wants = outcome === "completed" ? o.reportingPolicy.onCompletion : o.reportingPolicy.onFailure;
  if (wants) report(ctx, o, outcome, ev.id);
  // a delegated task ends when the delegate HEARS that the subordinate order ended (orders:reportArrived), not before
}

export const orders: System = {
  id: "orders",
  start: (ctx) => {
    ctx.content.scenario.scripts.forEach((s, i) => { if (s.kind === "order") ctx.at(s.day * DAY, "orders:script", { i }); });
  },
  handlers: {
    "orders:script": (ctx, { i }) => {
      const s = ctx.content.scenario.scripts[i];
      if (s.kind !== "order") return;
      const ev = ctx.emit("OrderScripted", [], [chr(s.from), chr(s.to)], { from: s.from, to: s.to, intent: s.intent, objective: s.objective });
      issue(ctx, s.from, s.to, s.intent as IntentKind, s.objective, ev.id, !!s.supersedesPrevious, { discretion: s.discretion });
    },
    "orders:received": (ctx, { orderId, receivedEventId }) => process(ctx, orderId, receivedEventId),
    "orders:regentOrder": (ctx, { regent, recipient, intent, objective, cause, claims }) => {
      const id = issue(ctx, regent, recipient, intent, objective, cause);
      learn(ctx, regent, { subject: oref(id), predicate: "order.status", value: "issued", observedAt: ctx.tick, band: "certain" },
        { kind: "observation", eventId: cause, source: regent }, [cause]);
      const st = best(ctx, regent, String(id), "order.status");
      const all = [...claims, ...(st ? [{ ...st, reliabilityBand: st.band }] : [])].map(({ band: _b, ...rest }: any) => rest);
      ctx.at(ctx.tick, "messenger:compose", { author: regent, recipient: ctx.content.scenario.ruler, claims: all, cause, purpose: `regency:ordered:${intent}:${objective.id}` });
    },
    "orders:completeRepair": (ctx, { orderId, location, gen }) => {
      const r = ctx.s.repairs[location];
      // a repair whose pace has changed since this end was scheduled is ended by the newer schedule
      if (!r || r.orderId !== orderId || r.gen !== gen) return;
      const rc = ctx.emit("RepairCompleted", [r.startedEventId], [loc(location), oref(orderId)], { location, restoredMilli: r.restoredMilli, orderId });
      const exp = ctx.content.scenario.agents.experience;
      const engineer = r.engineer;
      if (ctx.s.agents[engineer]) ctx.emit("ExperienceGained", [rc.id], [chr(engineer)], { agent: engineer, domain: "engineering", amount: exp.perTaskPermille, cap: exp.capPermille });
      finish(ctx, orderId, "completed", rc.id);
    },
    "orders:arrived": (ctx, { who, at, arrivedEventId }) => {
      if (ctx.s.fallen[at] && (ctx.s.troops[who] ?? 0) > 0) assault(ctx, who, at, arrivedEventId);
      for (const id of [...(ctx.s.ordersInForce[who] ?? [])]) {
        const o = ctx.s.orders[String(id)];
        if (o.status === "executing" && o.order.intent === "attack" && fortAnswering(ctx, o.order.objective.id) === at) { launchAttack(ctx, id, arrivedEventId); continue; }
        if (o.status !== "executing" || o.order.objective.id !== at) continue;
        if (o.order.intent === "advance") finish(ctx, id, "completed", arrivedEventId);
        else if (o.order.intent === "investigate") scouted(ctx, who, id, arrivedEventId);
      }
    },
    // A delegate learns from its leader's report that the subordinate order ended; only then does its own order end.
    "orders:reportArrived": (ctx, { reportId, recipient, deliveredEventId }) => {
      for (const c of ctx.s.reports[String(reportId)].claims) {
        if (c.predicate !== "order.status") continue;
        const sub = ctx.s.orders[c.subject.id]?.order;
        const parent = sub?.parentOrderId ? ctx.s.orders[String(sub.parentOrderId)] : undefined;
        if (parent && parent.order.recipient === recipient && parent.status === "executing")
          finish(ctx, parent.order.id, c.believedValue === "completed" ? "completed" : "abandoned", deliveredEventId);
      }
    },
    // the sortie ordered against a site has been fought: the order is done, and the report says what he saw
    "orders:sortieDone": (ctx, { commander, site, resolvedEventId }) => {
      for (const id of [...(ctx.s.ordersInForce[commander] ?? [])]) {
        const o = ctx.s.orders[String(id)];
        if (o.status === "executing" && o.order.intent === "attack" && o.order.objective.id === site) finish(ctx, id, "completed", resolvedEventId);
      }
    },
    "orders:detachmentArrived": (ctx, { commander, to, arrivedEventId }) => {
      for (const id of [...(ctx.s.ordersInForce[commander] ?? [])]) {
        const o = ctx.s.orders[String(id)];
        if (o.order.intent === "advance" && o.order.objective.id === to && o.status === "executing") finish(ctx, id, "completed", arrivedEventId);
      }
    },
  },
};
