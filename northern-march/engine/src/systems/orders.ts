// StructuredOrder lifecycle (B2, DESIGN_PIPELINE §6). Every step is its own event. Until Phase 3 brings agents,
// interpretation and obedience are a stub (literal reading, always obey), marked as such in the payload.
import { validateOrder, type IntentKind, type StructuredOrder } from "../schemas.ts";
import type { SubjectRef } from "../events.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, chr, loc } from "./types.ts";
import { best, learn, observe } from "./knowledge.ts";

const oref = (id: number) => ({ kind: "order" as const, id: String(id) });

export function issue(ctx: Ctx, issuer: string, recipient: string, intent: IntentKind, objective: SubjectRef, cause: number, supersedesPrevious = false) {
  const id = ctx.s.nextOrderId;
  const supersedes = supersedesPrevious
    ? (ctx.s.issued[issuer] ?? []).filter((r) => r.recipient === recipient && r.target === objective.id).map((r) => r.orderId)
    : [];
  const order: StructuredOrder = {
    schemaVersion: 1, id, issuer, recipient, issuedAt: ctx.tick, kind: "strategic", intent, objective,
    constraints: [], contingencies: [], discretion: "bounded",
    reportingPolicy: { onReceipt: false, onCompletion: true, onFailure: true },
    ...(supersedes.length ? { supersedes } : {}),
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

function process(ctx: Ctx, orderId: number, receivedId: number) {
  const o = ctx.s.orders[String(orderId)].order;
  const subj = [chr(o.recipient), oref(orderId)];
  for (const old of o.supersedes ?? [])
    if ((ctx.s.ordersInForce[o.recipient] ?? []).includes(old))
      ctx.emit("OrderSuperseded", [receivedId], [chr(o.recipient), oref(old)], { orderId: old, by: orderId, recipient: o.recipient });
  const int = ctx.emit("OrderInterpreted", [receivedId], subj, { orderId, intent: o.intent, objective: o.objective, stub: "literal reading until Phase 3" });
  const ob = ctx.emit("ObedienceDecided", [int.id], subj, { orderId, decision: "obey", stub: "always obey until Phase 3" });
  const pl = ctx.emit("LocalPlanFormed", [ob.id], subj, { orderId, steps: [o.intent] });
  const ex = ctx.emit("ExecutionStarted", [pl.id], subj, { orderId });
  const sc = ctx.content.scenario;
  if (o.intent === "repair") {
    const where = o.objective.id;
    const cond = ctx.s.fortifications[where]?.conditionMilli;
    if (cond === undefined) return finish(ctx, orderId, "abandoned", ex.id, "noFortification");
    if (ctx.s.repairs[where]) return finish(ctx, orderId, "abandoned", ex.id, "inProgress");
    const restoredMilli = sc.player.repairRestoreToMilli - cond;
    if (restoredMilli <= 0) return finish(ctx, orderId, "abandoned", ex.id, "notNeeded");
    const costMilli = restoredMilli * sc.player.repairCostMilliPerMilli;
    if (ctx.s.treasuryMilli[sc.ruler] < costMilli) return finish(ctx, orderId, "abandoned", ex.id, "funds");
    const st = ctx.emit("RepairStarted", [ex.id], [loc(where), oref(orderId)], { location: where, payer: sc.ruler, costMilli, startedAt: ctx.tick, orderId });
    ctx.at(ctx.tick + sc.player.repairDays * DAY, "orders:completeRepair", { orderId, location: where, restoredMilli, startedEventId: st.id });
  } else if (o.intent === "levy") {
    const lv = ctx.emit("LevyRaised", [ex.id], [chr(sc.ruler), oref(orderId)], { payer: sc.ruler, amountMilli: sc.player.levyMilli, orderId });
    finish(ctx, orderId, "completed", lv.id);
  }
  // other intents (hold, screen, ...) stay in force until superseded
}

function finish(ctx: Ctx, orderId: number, outcome: "completed" | "abandoned", cause: number, reason?: string) {
  const o = ctx.s.orders[String(orderId)].order;
  const ev = ctx.emit(outcome === "completed" ? "OrderCompleted" : "OrderAbandoned", [cause], [chr(o.recipient), oref(orderId)],
    { orderId, recipient: o.recipient, ...(reason ? { reason } : {}) });
  const wants = outcome === "completed" ? o.reportingPolicy.onCompletion : o.reportingPolicy.onFailure;
  if (!wants || o.recipient === o.issuer) return;
  learn(ctx, o.recipient, { subject: oref(orderId), predicate: "order.status", value: outcome, observedAt: ctx.tick, band: "certain" },
    { kind: "observation", eventId: ev.id, source: o.recipient }, [ev.id]);
  const p = ctx.s.positions[o.recipient];
  if (o.intent === "repair" && "at" in p && p.at === o.objective.id) observe(ctx, o.recipient, loc(o.objective.id), "fortification.condition", ev.id);
  const claims = [best(ctx, o.recipient, String(orderId), "order.status"), o.intent === "repair" ? best(ctx, o.recipient, o.objective.id, "fortification.condition") : null]
    .filter((x): x is NonNullable<typeof x> => !!x).map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as "certain" }));
  ctx.at(ctx.tick, "messenger:compose", { author: o.recipient, recipient: o.issuer, claims, cause: ev.id });
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
      issue(ctx, s.from, s.to, s.intent as IntentKind, s.objective, ev.id, !!s.supersedesPrevious);
    },
    "orders:received": (ctx, { orderId, receivedEventId }) => process(ctx, orderId, receivedEventId),
    "orders:completeRepair": (ctx, { orderId, location, restoredMilli, startedEventId }) => {
      const rc = ctx.emit("RepairCompleted", [startedEventId], [loc(location), oref(orderId)], { location, restoredMilli, orderId });
      finish(ctx, orderId, "completed", rc.id);
    },
  },
};
