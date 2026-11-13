// Phase 2 / P0.04: physical transmission; lost, delayed, intercepted, redirected and undeliverable messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BeliefProposition } from "../src/beliefs.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { beliefsAbout } from "../src/view.ts";
import { run, variant, LEGACY } from "./helpers.ts";

const allIntercepted = variant((r) => { r.scenario.interception = [{ location: "greybridge", by: "varos", permille: 1000 }]; });

test("an intercepted report updates the interceptor's beliefs, not the intended recipient's", () => {
  const sim = run({ seed: 4, content: allIntercepted, policy: "delegating" }, 90);
  const intercepted = new Set(sim.log.filter((e) => e.type === "ReportIntercepted").map((e) => e.payload.reportId as number));
  assert.ok(intercepted.size > 0);
  const anna = sim.unsafeWorldForDebug().beliefs.anna;
  for (const p of Object.values(anna)) for (const ev of p.evidenceRefs) assert.ok(!(ev.kind === "report" && intercepted.has(ev.reportId!)));
  const varos = Object.values(sim.unsafeWorldForDebug().beliefs.varos);
  assert.ok(varos.some((p) => p.evidenceRefs.some((ev) => ev.kind === "intercepted")));
  assert.ok(varos.some((p) => p.predicate === "report.route"), "Varos also learns who wrote to whom");
});

test("interceptors learn only once their own agents bring the papers back", () => {
  const sim = run({ seed: 4, content: allIntercepted, policy: "passive" }, 60);
  const cap = sim.log.find((e) => e.type === "ReportIntercepted")!;
  const got = sim.log.find((e) => e.type === "InterceptedReportReceived" && e.payload.reportId === cap.payload.reportId)!;
  assert.ok(got.tick > cap.tick);
  assert.ok(got.causedBy.includes(cap.id));
});

test("no action on an undelivered report: with every Northwatch report intercepted, the ruler never orders its repair", () => {
  const sim = run({ seed: 4, content: allIntercepted, policy: "aggressive" }, 240);
  const orders = sim.log.filter((e) => e.type === "OrderIssued").map((e) => e.payload.order as { intent: string; objective: { id: string } });
  assert.ok(orders.some((o) => o.intent === "repair"), "other fortifications' reports still arrive and get acted on");
  assert.ok(!orders.some((o) => o.intent === "repair" && o.objective.id === "northwatch"));
});

test("messages can be lost, and the loss is logged at the leg where it happened", () => {
  const c = variant((r) => { r.scenario.messenger.lossPermillePerDay = 900; });
  const sim = run({ seed: 5, content: c, policy: "passive" }, 60);
  const lost = sim.log.filter((e) => e.type === "ReportLost");
  assert.ok(lost.length > 0);
  for (const e of lost) assert.ok(typeof e.payload.at === "string");
});

test("delivery takes the physical travel time", () => {
  const sim = run({ seed: 6, policy: "passive", content: LEGACY }, 60);
  const d = sim.log.find((e) => e.type === "ReportDispatched" && e.payload.sender === "bren")!;
  const got = sim.log.find((e) => e.type === "ReportDelivered" && e.payload.reportId === d.payload.reportId)!;
  assert.ok(got, "this seed's first report arrives");
  assert.ok(got.tick - d.tick >= Math.floor(124200 * 0.9) && got.tick - d.tick <= Math.ceil(124200 * 1.3));
  assert.equal(got.tick, (d.payload.arrivals as number[]).at(-1));
});

test("a messenger is redirected when locals saw the recipient leave, and the order arrives", () => {
  const c = variant((r) => {
    r.scenario.scripts = [
      { day: 1, kind: "travel", who: "bren", to: "grey_hill", mode: "rider" },
      { day: 2, kind: "order", from: "anna", to: "bren", intent: "hold", objective: { kind: "location", id: "northwatch" } },
    ];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  assert.ok(sim.log.some((e) => e.type === "MessengerRedirected"));
  const rec = sim.log.find((e) => e.type === "OrderReceived")!;
  assert.equal(rec.payload.recipient, "bren");
  assert.equal(rec.payload.at, "grey_hill");
});

test("an order is undeliverable when the recipient left without word of where", () => {
  const c = variant((r) => {
    r.scenario.scripts = [
      { day: 1, kind: "travel", who: "bren", to: "highcairn", mode: "rider", secret: true },
      { day: 2, kind: "order", from: "anna", to: "bren", intent: "hold", objective: { kind: "location", id: "northwatch" } },
    ];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const u = sim.log.find((e) => e.type === "OrderUndeliverable")!;
  assert.ok(u);
  assert.equal(u.payload.reason, "recipient not found");
  assert.ok(!sim.log.some((e) => e.type === "OrderReceived"));
});

test("a report reaching the ruler names its author, source age and route", () => {
  const sim = run({ seed: 7, policy: "passive" }, 40);
  const v = sim.viewOf("player");
  assert.ok(v.reports.length > 0);
  for (const r of v.reports) { assert.ok(r.author); assert.ok(r.composedAt <= r.deliveredAt); assert.ok(r.route.length >= 1); }
  const b = beliefsAbout(v, "northwatch", "fortification.condition")[0] as BeliefProposition & { ageTicks: number };
  assert.ok(b.ageTicks >= 0 && b.ageTicks < 40 * DAY);
});
