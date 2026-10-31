// Phase 2 / B2: StructuredOrder frozen; every lifecycle step is a separate event; supersession on receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOrder, validateRecommendation, validateReport, validateProposition, ORDER_LIFECYCLE } from "../src/schemas.ts";
import { checkOrderLifecycles } from "../src/invariants.ts";
import { orderHistory } from "../src/inspect.ts";
import { EVENT_TYPES } from "../src/events.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { run, variant } from "./helpers.ts";

test("every lifecycle event type is registered", () => {
  for (const t of [...ORDER_LIFECYCLE.main, ...ORDER_LIFECYCLE.failures]) assert.ok(EVENT_TYPES[t], t);
  assert.ok(EVENT_TYPES.RecommendationMade);
});

test("order lifecycles are valid paths on every seed and policy", () => {
  for (const policy of ["delegating", "aggressive", "random-valid"] as const)
    for (let seed = 1; seed <= 12; seed++) assert.deepEqual(checkOrderLifecycles(run({ seed, policy }).log), [], `${policy} ${seed}`);
});

test("every issued order validates against the frozen schema", () => {
  const sim = run({ seed: 2, policy: "aggressive" });
  const issued = sim.log.filter((e) => e.type === "OrderIssued");
  assert.ok(issued.length > 0);
  for (const e of issued) assert.deepEqual(validateOrder(e.payload.order), []);
});

test("the validators reject malformed contracts", () => {
  const sim = run({ seed: 2, policy: "aggressive" });
  const good = sim.log.find((e) => e.type === "OrderIssued")!.payload.order as Record<string, unknown>;
  assert.ok(validateOrder({ ...good, discretion: "whatever" }).length > 0);
  assert.ok(validateOrder({ ...good, issuedAt: 1.5 }).length > 0);
  const { reportingPolicy, ...noPolicy } = good; void reportingPolicy;
  assert.ok(validateOrder(noPolicy).length > 0);
  assert.ok(validateProposition({ id: 1 }).length > 0);
  assert.ok(validateReport({ id: 1, author: "x" }).length > 0);
  const rec = {
    id: 1, author: "elara", question: "what_would_you_do", plan: { kind: "plan", id: "hold-northwatch" },
    reasons: [{ kind: "belief", ref: { kind: "belief", id: "7" }, weight: 400, textKey: "reason.wall_low" }],
    uncertainties: [], alternatives: [], contingencies: [], basedOnBeliefs: [{ kind: "belief", id: "7" }], computedAt: 0,
  };
  assert.deepEqual(validateRecommendation(rec), []);
  assert.ok(validateRecommendation({ ...rec, question: "tell_me_a_joke" }).length > 0);
  assert.ok(validateRecommendation({ ...rec, reasons: [{ kind: "vibes", ref: {}, weight: 1, textKey: "x" }] }).length > 0);
});

test("the inspector shows a full lifecycle, including the failure branch", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 1, kind: "order", from: "anna", to: "bren", intent: "hold", objective: { kind: "location", id: "northwatch" } }];
    r.scenario.messenger.lossPermillePerDay = 1000; r.scenario.interception = [];
  });
  const lost = run({ seed: 1, content: c, policy: "passive" }, 10);
  const oid = lost.log.find((e) => e.type === "OrderIssued")!.payload.order as { id: number };
  assert.deepEqual(orderHistory(lost.log, oid.id).map((e) => e.type), ["OrderIssued", "OrderDispatched", "OrderLost"]);

  const ok = run({ seed: 2, policy: "aggressive" });
  const levy = ok.log.find((e) => e.type === "OrderIssued" && (e.payload.order as { intent: string }).intent === "levy")!;
  assert.deepEqual(orderHistory(ok.log, (levy.payload.order as { id: number }).id).map((e) => e.type),
    ["OrderIssued", "OrderReceived", "OrderInterpreted", "ObedienceDecided", "LocalPlanFormed", "ExecutionStarted", "OrderCompleted"]);
});

test("a new order supersedes the old one only when it is received", () => {
  const c = variant((r) => {
    r.scenario.scripts = [
      { day: 1, kind: "order", from: "anna", to: "bren", intent: "hold", objective: { kind: "location", id: "northwatch" } },
      { day: 5, kind: "order", from: "anna", to: "bren", intent: "hold", objective: { kind: "location", id: "northwatch" }, supersedesPrevious: true },
    ];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 5);
  const first = (sim.log.find((e) => e.type === "OrderIssued")!.payload.order as { id: number }).id;
  sim.runUntil(5 * DAY + 3600);
  assert.ok(sim.viewOf("bren").self.ordersInForce.some((o) => o.id === first), "old order still in force while the new one travels");
  sim.runDays(5);
  const sup = sim.log.find((e) => e.type === "OrderSuperseded")!;
  const rec2 = sim.log.filter((e) => e.type === "OrderReceived")[1];
  assert.equal(sup.payload.orderId, first);
  assert.equal(sup.tick, rec2.tick);
  assert.ok(!sim.viewOf("bren").self.ordersInForce.some((o) => o.id === first));
});

test("the recipient reports back as the order's reporting policy says", () => {
  const sim = run({ seed: 2, policy: "aggressive" });
  const done = sim.log.filter((e) => e.type === "OrderCompleted" && e.payload.recipient === "bren");
  for (const d of done) assert.ok(sim.log.some((e) => e.type === "ReportComposed" && e.causedBy.includes(d.id)));
});
