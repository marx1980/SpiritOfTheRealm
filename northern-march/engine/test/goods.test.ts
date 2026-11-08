// Wider economy, stage 1 (D-039): timber, iron and horses held in stores, priced by scarcity, moved by orders like grain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import { checkRun } from "../src/invariants.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const GP = CONTENT.scenario.goods!;
const num = (x: unknown) => x as number;
const holdings = (w: any, good: string) => GP.places.reduce((n, p) => n + (w.goods?.[good]?.[p.location] ?? 0), 0);
const onRoad = (w: any, good: string) => (Object.values(w.goodsConvoys ?? {}) as { good: string; units: number }[]).filter((c) => c.good === good).reduce((n, c) => n + c.units, 0);
const ledgerSum = (w: any, good: string, k: string) => (Object.values(w.goodsLedger?.[good] ?? {}) as Record<string, number>[]).reduce((n, x) => n + (x[k] ?? 0), 0);
const start = (c: typeof CONTENT, good: string) => c.scenario.goods!.places.reduce((n, p) => n + ((p.store as Record<string, number>)[good] ?? 0), 0);
function conserved(sim: { unsafeWorldForDebug(): any; content: typeof CONTENT }, good: string) {
  const w = sim.unsafeWorldForDebug();
  return { have: holdings(w, good) + onRoad(w, good), want: start(sim.content, good) + ledgerSum(w, good, "produced") - ledgerSum(w, good, "spilled") - ledgerSum(w, good, "lost") - ledgerSum(w, good, "seized") - ledgerSum(w, good, "used") - ledgerSum(w, good, "sold") };
}
const quiet = (edit: (r: any) => void = () => {}) => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; edit(r); });
function ordered(seed: number, action: PlayerAction, day = 5, days = 40, content = CONTENT) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= day * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const BUY: PlayerAction = { action: "purchase", target: "crownwood", to: "greybridge", good: "timber" };
const MOVE: PlayerAction = { action: "requisition", target: "crownwood", to: "greybridge", good: "timber" };

test("goods: every store plus goods on the road equals start + produced - spilled - lost - seized - used, exactly, on every seed", () => {
  for (const seed of [1, 2, 3, 4]) {
    const sim = run({ seed }, 120);
    for (const good of GP.kinds) { const c = conserved(sim, good); assert.equal(c.have, c.want, `seed ${seed} ${good}`); }
    assert.deepEqual(checkRun(sim), [], `seed ${seed}`);
  }
});

test("goods: stores stay inside 0..cap and the sources produce on the days they should", () => {
  const sim = run({ seed: 1 }, 30), w = sim.unsafeWorldForDebug();
  for (const p of GP.places) for (const [g, cap] of Object.entries(p.cap as Record<string, number>)) assert.ok(w.goods[g][p.location] >= 0 && w.goods[g][p.location] <= cap, `${p.location} ${g}`);
  const days = sim.log.filter((e) => e.type === "GoodsDay").length;
  assert.ok(days >= 29, "a tally every day");
  assert.equal(w.goods.timber.crownwood, 300 + 6 * days, "timber 6 a day");
  assert.equal(w.goods.horses.thornfield, 20 + Math.floor(days / 3), "horses every third day");
});

test("goods: the price rises as the realm's stock falls, falls as it grows, and stays inside its clamp", () => {
  const price = (sim: { log: readonly any[] }, good: string) => [...sim.log].reverse().find((e) => e.type === "GoodsDay")!.payload.prices[good] as number;
  const base = run({ seed: 1 }, 3), cfg = GP.price.timber;
  const scarce = run({ seed: 1 }, 3).log; void scarce;
  const lean = createSim({ content: variant((r) => { r.scenario.goods!.places.forEach((p: any) => { delete p.store.timber; if (p.production) delete p.production.timber; }); }), seed: 1, policy: "passive" }); lean.runDays(3);
  assert.ok(price(lean, "timber") > price(base, "timber"), "no timber: dearer");
  assert.ok(price(lean, "timber") <= 3 * cfg.baseMilli && price(lean, "timber") >= Math.floor(cfg.baseMilli / 2), "clamped");
  const rich = createSim({ content: variant((r) => { r.scenario.goods!.places[0].store.timber = 2000; r.scenario.goods!.places[0].cap.timber = 3000; }), seed: 1, policy: "passive" }); rich.runDays(3);
  assert.ok(price(rich, "timber") < price(base, "timber"), "plenty: cheaper");
  assert.ok(price(rich, "timber") >= Math.floor(cfg.baseMilli / 2));
});

test("goods: a purchase pays today's price in coin, ships as a convoy and delivers on arrival", () => {
  const sim = ordered(2, BUY, 5, 40, quiet());
  const ship = sim.log.find((e) => e.type === "GoodsShipped")!;
  assert.ok(ship, "shipped"); assert.equal(ship.payload.good, "timber"); assert.equal(ship.payload.how, "purchase");
  const day = [...sim.log].filter((e) => e.type === "GoodsDay" && e.tick <= ship.tick).pop()!;
  assert.equal(ship.payload.costMilli, num(ship.payload.units) * (day.payload.prices as Record<string, number>).timber, "units × price on the day");
  const done = sim.log.find((e) => e.type === "GoodsDelivered" || e.type === "GoodsLost")!;
  assert.ok(done && done.tick > ship.tick && done.causedBy[0] === ship.id, "arrival is later and caused by the departure");
  const c = conserved(sim, "timber"); assert.equal(c.have, c.want);
  if (done.type === "GoodsDelivered") assert.ok(sim.unsafeWorldForDebug().goods.timber.greybridge >= num(ship.payload.units) - num(done.payload.spilled));
});

test("goods: a requisition moves stock between the crown's places and costs no coin", () => {
  const sim = ordered(2, MOVE, 5, 40, quiet());
  const ship = sim.log.find((e) => e.type === "GoodsShipped")!;
  assert.ok(ship); assert.equal(ship.payload.how, "requisition"); assert.equal(ship.payload.costMilli, 0);
});

test("goods: a source at or below its reserve ships nothing and the order is abandoned for lack of surplus", () => {
  const sim = ordered(2, BUY, 5, 20, quiet((r) => { r.scenario.goods!.places[0].store.timber = 10; r.scenario.goods!.places[0].production.timber = 0; }));
  assert.ok(!sim.log.some((e) => e.type === "GoodsShipped"));
  assert.ok(sim.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noSurplus"), "abandoned: noSurplus");
});

test("goods: a convoy can be lost on the road and the loss is in the ledger", () => {
  const sim = ordered(2, MOVE, 5, 40, quiet((r) => { r.scenario.goods.convoy.lossPermillePerDay = 1000; }));
  const lost = sim.log.find((e) => e.type === "GoodsLost")!;
  assert.ok(lost, "lost"); const w = sim.unsafeWorldForDebug();
  assert.equal(w.goodsLedger.timber.crownwood.lost + w.goodsLedger.timber.crownwood.seized, lost.payload.units);
  const c = conserved(sim, "timber"); assert.equal(c.have, c.want);
});

test("goods: timber at a fort covers part of a repair's coin cost, and the timber is used up", () => {
    const hurt = (r: any) => { r.locations.find((l: any) => l.id === "northwatch").fortification.conditionMilli = 40000; };
  const withTimber = quiet((r) => { hurt(r); const f = r.scenario.goods.places.find((p: any) => p.location === "northwatch"); f.store.timber = 120; });
  const cost = (c: typeof CONTENT) => {
    const sim = ordered(3, { action: "repair", target: "northwatch" }, 40, 60, c);
    const st = sim.log.find((e) => e.type === "RepairStarted" && e.payload.location === "northwatch");
    return st ? { coin: st.payload.costMilli as number, timber: (st.payload.timberUsed ?? 0) as number, sim } : null;
  };
  const dry = cost(quiet(hurt)), wet = cost(withTimber);
  assert.ok(dry && wet, "both repairs started");
  assert.equal(dry!.timber, 0);
  assert.ok(wet!.timber > 0 && wet!.coin < dry!.coin, `coin ${wet!.coin} vs ${dry!.coin}`);
  assert.equal(wet!.coin, Math.floor((dry!.coin * (1000 - GP.repair.coverPermille)) / 1000), `dry ${dry!.coin} wet ${wet!.coin} timber ${wet!.timber}`);
  const c = conserved(wet!.sim, "timber"); assert.equal(c.have, c.want);
});

test("goods: a scenario with no goods block plays as before (no goods events)", () => {
  const sim = createSim({ content: variant((r) => { delete r.scenario.goods; }), seed: 1, policy: "delegating" }); sim.runDays(30);
  assert.ok(!sim.log.some((e) => e.type.startsWith("Goods")));
});
