// Wider economy, stage 2 (D-040): levy and manpower. Men from a community's hands, armed from the fort's iron, some mounted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

const M = CONTENT.scenario.manpower!;
const num = (x: unknown) => x as number;
const MUSTER: PlayerAction = { action: "levy", muster: true, target: "northwatch", to: "northwatch" };
/** A quiet realm in which Northwatch holds iron and horses; edit adds more changes. */
const armed = (edit: (r: any) => void = () => {}) => variant((r) => {
  r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0;
  const f = r.scenario.goods!.places.find((p: any) => p.location === "northwatch")!; f.store.iron = 60; f.store.horses = 10;
  edit(r);
});
function ordered(seed: number, action: PlayerAction, day = 5, days = 30, content = armed()) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= day * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const base = (id: string) => CONTENT.communities.communities.find((c) => c.id === id)!.hands!;

test("manpower: a muster moves hands, iron and horses exactly and adds the men to the garrison above establishment", () => {
  const sim = ordered(2, MUSTER, 5, 30);
  const called = sim.log.find((e) => e.type === "MusterCalled")!, arrived = sim.log.find((e) => e.type === "MusterArrived")!;
  assert.ok(called && arrived && arrived.tick >= called.tick, "called, then arrives");
  const men = num(called.payload.men), mounted = num(called.payload.mounted);
  assert.ok(men > 0 && men <= M.musterMen, `men ${men}`);
  assert.equal(mounted, Math.min(Math.floor((men * M.mountedPermille) / 1000), 10), "a quarter ride, if the horses are there");
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.hands.northwatch + w.musterAway.northwatch, base("northwatch"), "hands + away = base");
  assert.equal(w.goodsLedger.iron.northwatch.used, men * M.ironPerMan);
  assert.equal(w.goodsLedger.horses.northwatch.used, mounted);
  const f = w.fortifications.northwatch;
  assert.equal(f.garrison, f.establishment + men + mounted, "mounted men count twice");
});

test("manpower: no iron at the fort and no spare hands each abandon the order", () => {
  const noIron = ordered(2, MUSTER, 5, 20, armed((r) => { r.scenario.goods.places.find((p: any) => p.location === "northwatch").store.iron = 0; }));
  assert.ok(noIron.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noIron"));
  assert.ok(!noIron.log.some((e) => e.type === "MusterCalled"));
  const noHands = ordered(2, MUSTER, 5, 20, armed((r) => { r.communities.communities.find((c: any) => c.id === "northwatch").hands = 0; }));
  assert.ok(noHands.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noHands"));
});

test("manpower: wages are paid every day of service, and the surplus is discharged and the hands return at the end", () => {
  const sim = ordered(2, MUSTER, 5, 5 + M.serviceDays + 10);
  const called = sim.log.find((e) => e.type === "MusterCalled")!, men = num(called.payload.men), mounted = num(called.payload.mounted);
  const paid = sim.log.filter((e) => e.type === "UpkeepPaid" && num(e.payload.musterMen) > 0);
  assert.ok(paid.length >= M.serviceDays - 3 && paid.length <= M.serviceDays + 1, `${paid.length} days of wages`);
  const sc = CONTENT.scenario;
  assert.ok(paid.every((e) => num(e.payload.musterMen) === men && num(e.payload.amountMilli) === sc.economy.dailyUpkeepMilli + num(e.payload.awayCaptains) * sc.economy.captainAwayMilli + men * M.wageMilli), "each day pays the men their wage on top of upkeep");
  void mounted;
  const end = sim.log.find((e) => e.type === "MusterEnded")!;
  assert.ok(end && end.tick >= called.tick + M.serviceDays * DAY, "ends after the service");
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.musterAway.northwatch, 0); assert.equal(w.hands.northwatch, base("northwatch"));
  assert.equal(w.fortifications.northwatch.garrison, w.fortifications.northwatch.establishment, "back to establishment");
  assert.equal(Object.keys(w.musters).length, 0);
});

test("manpower: while men are away the community's harvest falls, and it recovers when they return", () => {
  const produced = (sim: ReturnType<typeof ordered>, from: number, to: number) => sim.log.filter((e) => e.type === "GrainDay" && e.tick >= from * DAY && e.tick < to * DAY)
    .reduce((n, e) => n + (e.payload.changes as [string, number][]).filter((c) => c[0] === "northwatch").reduce((m, c) => m + c[1], 0), 0);
  const withMuster = ordered(2, MUSTER, 5, 70), without = ordered(2, { action: "repair", target: "northwatch" }, 5, 70);
  assert.ok(produced(withMuster, 10, 60) < produced(without, 10, 60), "less grain while the men are away");
  const end = withMuster.log.find((e) => e.type === "MusterEnded");
  if (end) assert.equal(produced(withMuster, Math.ceil(end.tick / DAY) + 1, 70), produced(without, Math.ceil(end.tick / DAY) + 1, 70), "back to normal");
});

test("manpower: men from another community walk to the fort, so they arrive later", () => {
  const sim = ordered(2, { action: "levy", muster: true, target: "greyfen", to: "northwatch" }, 5, 30);
  const called = sim.log.find((e) => e.type === "MusterCalled")!, arrived = sim.log.find((e) => e.type === "MusterArrived")!;
  assert.ok(called && arrived && arrived.tick > called.tick, "walking takes time");
  const w = sim.unsafeWorldForDebug(); assert.equal(w.hands.greyfen + w.musterAway.greyfen, base("greyfen"));
});

test("manpower: a muster is a levy to the people it is taken from, and a people that cooperates less gives fewer men", () => {
  const sim = ordered(2, MUSTER, 5, 15);
  const kinds = (sim.unsafeWorldForDebug().communities.northwatch.grievances as { kind: string }[]).map((g) => g.kind);
  assert.ok(kinds.includes("levy"), kinds.join());
  const full = num(sim.log.find((e) => e.type === "MusterCalled")!.payload.men);
  const half = ordered(2, MUSTER, 5, 15, armed((r) => { for (const k of Object.keys(r.communities.params.effects.recruits)) r.communities.params.effects.recruits[k] = 500; }));
  assert.equal(num(half.log.find((e) => e.type === "MusterCalled")!.payload.men), Math.floor(full / 2));
});

test("manpower: with nothing mustered the realm plays exactly as before (hands full, no wages, no muster events)", () => {
  const sim = createSim({ content: armed(), seed: 2, policy: "delegating" }); sim.runDays(40);
  const w = sim.unsafeWorldForDebug();
  for (const c of CONTENT.communities.communities) assert.equal(w.hands[c.id], c.hands);
  assert.ok(!sim.log.some((e) => e.type.startsWith("Muster")));
  assert.ok(sim.log.filter((e) => e.type === "UpkeepPaid").every((e) => !e.payload.musterMen));
});
