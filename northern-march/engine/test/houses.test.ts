// Wider economy, stage 3 (D-041): which House holds a resource, and where the crown can sell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

const G = CONTENT.scenario.goods!;
const num = (x: unknown) => x as number;
const quiet = (edit: (r: any) => void = () => {}) => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; edit(r); });
function ordered(seed: number, action: PlayerAction, day = 5, days = 40, content = quiet()) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= day * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const ledgerSum = (w: any, good: string, k: string) => (Object.values(w.goodsLedger[good]) as Record<string, number>[]).reduce((n, x) => n + x[k], 0);
const ironOf = (c: typeof CONTENT) => c.scenario.goods!.places.reduce((n, p) => n + (p.store.iron ?? 0), 0);

test("houses: every place that holds goods names its House, and the crown holds its own forts", () => {
  for (const p of G.places) assert.ok(G.houses.includes(p.house ?? "crown"), p.location);
  assert.equal(G.places.find((p) => p.location === "highcairn")!.house, "varos");
  assert.ok(["greybridge", "northwatch", "eastmarch"].every((f) => (G.places.find((p) => p.location === f)!.house ?? "crown") === "crown"));
});

test("houses: the crown cannot requisition from a place another House holds", () => {
  const sim = ordered(2, { action: "requisition", target: "highcairn", to: "greybridge", good: "iron" });
  assert.ok(!sim.log.some((e) => e.type === "GoodsShipped"));
  assert.ok(sim.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "houseHolds"));
});

const spent = (sim: { log: readonly { type: string; payload: Record<string, unknown> }[] }, house: string) => sim.log.filter((e) => e.type === "HouseRestocked" && e.payload.house === house).reduce((n, e) => n + Number(e.payload.costMilli), 0);

test("houses: a purchase from a House's place costs the realm price plus the markup, and the coin goes to that House exactly", () => {
  const sim = ordered(2, { action: "purchase", target: "highcairn", to: "greybridge", good: "iron" });
  const ship = sim.log.find((e) => e.type === "GoodsShipped")!;
  assert.ok(ship, "shipped"); assert.equal(ship.payload.payee, "varos");
  const price = num(ship.payload.priceMilli), units = num(ship.payload.units);
  assert.equal(price, Math.floor((num((([...sim.log].reverse().find((e) => e.type === "GoodsDay" && e.tick <= ship.tick)!.payload.prices) as Record<string, number>).iron) * (1000 + G.market.houseMarkupPermille)) / 1000));
  assert.equal(ship.payload.costMilli, units * price);
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.housePaid!.varos, units * price, "the crown's ledger records exactly what it paid Varos");
  assert.equal(w.houseCoin.varos + spent(sim, "varos"), units * price, "Varos holds what it was paid less what it spent restocking");
  assert.equal(w.houseCoin.crown ?? 0, 0);
});

test("houses: a sale at a market ships the goods, pays the spread, and the units leave the realm", () => {
  const sim = ordered(2, { action: "requisition", target: "crownwood", to: "saltmere", good: "timber", sell: true });
  const ship = sim.log.find((e) => e.type === "GoodsShipped")!, sold = sim.log.find((e) => e.type === "GoodsSold")!;
  assert.ok(ship && sold, "shipped and sold"); assert.equal(ship.payload.how, "sale"); assert.equal(ship.payload.costMilli, 0);
  const town = G.market.towns.find((t) => t.location === "saltmere")!, price = num(sold.payload.priceMilli), units = num(sold.payload.units);
  assert.equal(sold.payload.proceedsMilli, Math.floor((units * price * (1000 - town.spreadPermille)) / 1000));
  assert.equal(sold.payload.houseCutMilli, 0);
  const w = sim.unsafeWorldForDebug();
  assert.equal(ledgerSum(w, "timber", "sold"), units, "recorded as sold");
  const have = Object.values(w.goods.timber as Record<string, number>).reduce((n, x) => n + x, 0) + Object.values(w.goodsConvoys as Record<string, { good: string; units: number }>).filter((c) => c.good === "timber").reduce((n, c) => n + c.units, 0);
  const start = G.places.reduce((n, p) => n + (p.store.timber ?? 0), 0);
  assert.equal(have, start + ledgerSum(w, "timber", "produced") - ledgerSum(w, "timber", "spilled") - ledgerSum(w, "timber", "lost") - ledgerSum(w, "timber", "seized") - ledgerSum(w, "timber", "used") - ledgerSum(w, "timber", "sold"));
});

test("houses: at a market a House holds, that House takes its cut of the proceeds", () => {
  const sim = ordered(2, { action: "requisition", target: "crownwood", to: "marchend", good: "timber", sell: true });
  const sold = sim.log.find((e) => e.type === "GoodsSold")!, town = G.market.towns.find((t) => t.location === "marchend")!;
  assert.ok(sold); const proceeds = num(sold.payload.proceedsMilli);
  assert.equal(sold.payload.houseCutMilli, Math.floor((proceeds * town.cutPermille) / 1000));
  assert.equal(sim.unsafeWorldForDebug().houseCoin.varos + spent(sim, "varos"), sold.payload.houseCutMilli);
});

test("houses: selling takes units out of the realm, so the price rises afterwards", () => {
  const price = (sim: ReturnType<typeof ordered>) => num(([...sim.log].reverse().find((e) => e.type === "GoodsDay")!.payload.prices as Record<string, number>).timber);
  const sold = ordered(2, { action: "requisition", target: "crownwood", to: "saltmere", good: "timber", sell: true }, 5, 40);
  const kept = ordered(2, { action: "requisition", target: "crownwood", to: "greybridge", good: "timber" }, 5, 40);
  assert.ok(price(sold) > price(kept), `${price(sold)} vs ${price(kept)}`);
});

test("houses: a place that is not a market town gives noMarket, and a House's goods cannot be sold by the crown", () => {
  assert.ok(ordered(2, { action: "requisition", target: "crownwood", to: "greyfen", good: "timber", sell: true }, 5, 20).log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noMarket"));
  assert.ok(ordered(2, { action: "requisition", target: "highcairn", to: "saltmere", good: "iron", sell: true }, 5, 20).log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "houseHolds"));
});

test("houses: nothing ordered, nothing changes: House accounts stay at zero and nothing is sold", () => {
  const sim = createSim({ content: quiet(), seed: 2, policy: "delegating" }); sim.runDays(40);
  const w = sim.unsafeWorldForDebug();
  assert.ok(Object.values(w.houseCoin as Record<string, number>).every((x) => x === 0));
  assert.ok(!sim.log.some((e) => e.type === "GoodsSold"));
  void ironOf;
});
