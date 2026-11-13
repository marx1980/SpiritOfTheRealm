// The marketplace (D-051): buy at a market for a place of the crown's, the buyer pays at once, the seller is paid when the
// caravan arrives, journeys take as long as the road, caravans can be late or lost, and grain has a price that moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
// Phase 10: these tests pin the pre-environment scenario (dry roads, the placeholder weather); the environment has its own tests
import { LEGACY as CONTENT, legacyVariant as variant } from "./helpers.ts";

const quiet = (edit: (r: any) => void = () => {}) => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; edit(r); });
function ordered(action: PlayerAction, days = 40, content = quiet()) {
  const sim = createSim({ content, seed: 2, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= 5 * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const find = (sim: ReturnType<typeof ordered>, type: string) => sim.log.find((e) => e.type === type);
const buyIron = (market: string, edit?: (r: any) => void) => ordered({ action: "purchase", market: true, target: market, to: "greybridge", good: "iron", units: 10 }, 40, quiet(edit));

test("a market purchase: the buyer pays the market's price at once, the seller only when the caravan arrives", () => {
  const sim = buyIron("saltmere");
  const ship = find(sim, "GoodsShipped")!, got = find(sim, "GoodsDelivered")!;
  assert.ok(ship && got, "shipped and delivered");
  assert.equal(ship.payload.how, "market"); assert.equal(ship.payload.units, 10);
  const town = CONTENT.scenario.goods!.market.towns.find((t) => t.location === "saltmere")!;
  const realm = [...sim.log].reverse().find((e) => e.type === "GoodsDay" && e.tick <= ship.tick)!.payload.prices as Record<string, number>;
  assert.equal(ship.payload.priceMilli, Math.floor((realm.iron * (1000 + town.spreadPermille)) / 1000));
  assert.equal(ship.payload.costMilli, 10 * (ship.payload.priceMilli as number));
  // the supplier (Varos, at Highcairn) is not paid at the start: the coin appears with the delivery
  const owed = ship.payload.owedMilli as number; assert.ok(owed > 0 && owed < (ship.payload.costMilli as number), "the market keeps a margin");
  assert.equal(ship.payload.owedTo, "varos");
  const paidBefore = sim.log.filter((e) => e.type === "GoodsShipped" || e.type === "GoodsDelivered").map((e) => e.type);
  assert.deepEqual(paidBefore, ["GoodsShipped", "GoodsDelivered"]);
  assert.equal(got.payload.owedMilli, owed);
  assert.ok(got.tick > ship.tick);
});

test("a nearer market delivers sooner", () => {
  const t = (m: string) => { const sim = buyIron(m, (r) => { r.scenario.goods.convoy.delayPermillePerDay = 0; }); const s = find(sim, "GoodsShipped")!; return (s.payload.arrivesAt as number) - (s.payload.departedAt as number); };
  const times = ["ravenport", "saltmere", "greybridge", "marchend"].map(t);
  assert.ok(new Set(times).size > 1, `journeys differ: ${times.join(", ")}`);
});

test("weather can hold a caravan up", () => {
  const trip = (late: number) => { const sim = buyIron("saltmere", (r) => { r.scenario.goods.convoy.delayPermillePerDay = late; r.scenario.goods.convoy.delayDays = [2, 2]; }); const s = find(sim, "GoodsShipped")!; return { span: (s.payload.arrivesAt as number) - (s.payload.departedAt as number), late: s.payload.delayTicks }; };
  const on = trip(1000), off = trip(0);
  assert.equal(on.span - off.span, 2 * DAY); assert.equal(on.late, 2 * DAY); assert.equal(off.late, undefined);
});

test("a caravan that is lost costs the buyer what was paid and pays the seller nothing", () => {
  const sim = buyIron("saltmere", (r) => { r.scenario.goods.convoy.lossPermillePerDay = 1000; r.scenario.goods.convoy.delayPermillePerDay = 0; });
  const ship = find(sim, "GoodsShipped")!, lost = find(sim, "GoodsLost");
  assert.ok(lost, "lost"); assert.ok(!find(sim, "GoodsDelivered"));
  assert.equal(sim.unsafeWorldForDebug().houseCoin.varos - (sim.log.filter((e) => e.type === "HouseRestocked" && e.payload.house === "varos").reduce((n, e) => n - Number(e.payload.costMilli), 0)), 0, "the seller was never paid");
  assert.ok((ship.payload.costMilli as number) > 0);
});

test("a sale is paid when the caravan reaches the market, and may be late or lost without penalty", () => {
  const sim = ordered({ action: "requisition", target: "crownwood", to: "saltmere", good: "timber", units: 20, sell: true });
  const ship = find(sim, "GoodsShipped")!, sold = find(sim, "GoodsSold")!;
  assert.equal(ship.payload.costMilli, 0); assert.ok(sold.tick > ship.tick);
  const lostSim = ordered({ action: "requisition", target: "crownwood", to: "saltmere", good: "timber", units: 20, sell: true }, 40, quiet((r) => { r.scenario.goods.convoy.lossPermillePerDay = 1000; }));
  assert.ok(find(lostSim, "GoodsLost") && !find(lostSim, "GoodsSold"));
});

test("a market must be a market, and the destination one of the crown's stores", () => {
  assert.ok(ordered({ action: "purchase", market: true, target: "pinegate", to: "greybridge", good: "iron" }, 20).log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noMarket"));
  assert.ok(ordered({ action: "purchase", market: true, target: "saltmere", to: "highcairn", good: "iron" }, 20).log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noDestination"));
});

test("grain bought at a market is paid at the market's price at once, and the price moves with the realm's stock", () => {
  const sim = ordered({ action: "purchase", market: true, target: "saltmere", to: "coldmere", units: 30 }, 40);
  const ship = sim.log.find((e) => e.type === "GrainShipped")!;
  assert.ok(ship && ship.payload.sacks === 30);
  assert.equal(ship.payload.costMilli, 30 * (ship.payload.priceMilli as number));
  const prices = (c: ReturnType<typeof quiet>) => { const s = createSim({ content: c, seed: 2, policy: "passive" }); s.runDays(30); return s.unsafeWorldForDebug().grainPrice as Record<string, number>; };
  const normal = prices(quiet()), short = prices(quiet((r) => { for (const p of r.scenario.grain.places) { p.store = Math.floor(p.store / 8); } }));
  assert.ok(Object.keys(normal).length === CONTENT.scenario.goods!.market.towns.length);
  for (const k of Object.keys(normal)) assert.ok(short[k] > normal[k], `${k}: ${short[k]} vs ${normal[k]}`);
  const all = Object.values(short).concat(Object.values(normal)); const g = CONTENT.scenario.grain!.market!;
  assert.ok(all.every((x) => x >= g.minMilli && x <= g.maxMilli));
});

test("the page offers market purchases and sales, grain taking, and no moving goods between stores", async () => {
  const { economyActions, publicRulesOf, adviceAction } = await import("../src/presentation/affordances.ts");
  const sim = createSim({ content: CONTENT, seed: 3, policy: "passive" }); sim.runDays(12);
  const v = sim.viewOf("player"); const acts = economyActions(v, publicRulesOf(v));
  assert.ok(acts.some((a) => a.action === "purchase" && a.market && a.good === "timber"));
  assert.ok(acts.some((a) => a.action === "purchase" && a.market && !a.good), "grain at a market");
  assert.ok(acts.some((a) => a.action === "requisition" && !a.good && !a.sell), "grain taken from a people");
  const houses = new Set((v.world.goods?.stores ?? []).filter((x) => x.house !== "crown").map((x) => x.id));
  assert.ok(!acts.some((a) => a.good && (a.action === "requisition" && !a.sell && (houses.has(a.target!) || houses.has(a.to!)) || a.action === "purchase" && !a.market)), "no goods moved to or from a House's store, and no buying straight from a store");
  assert.ok(acts.some((a) => a.action === "requisition" && !a.sell && !!a.good), "send between the crown's stores");
  void adviceAction;
});
