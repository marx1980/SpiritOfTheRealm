// The economy on the page (D-044): the steward's books reach the ruler at the seat, and every order the page offers is one the engine accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { buildView } from "../src/view.ts";
import { DAY } from "../src/systems/types.ts";
import { actionText, affordable, economyActions, economyProblems, grainCover, playerActions, priceKnown, publicRules, purchaseCostKnown, storeKnown } from "../src/presentation/affordances.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

const RULES = publicRules(CONTENT);
/** A realm whose Greybridge depot holds iron, so that men can be armed there. */
const ARMED = variant((r) => { r.scenario.goods!.places.find((p: any) => p.location === "greybridge")!.store.iron = 40; });
type Sim = ReturnType<typeof createSim>;
/** Play to a day with the ruler answering nothing, optionally giving one action first. */
function play(seed: number, days: number, action?: PlayerAction, at = 5, content = CONTENT): Sim {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 6000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (action && !done && sim.tick >= at * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const truth = (sim: Sim) => sim.unsafeWorldForDebug();

test("books: the ruler at the seat has the steward's figures for every store and every price, near the truth", () => {
  const sim = play(2, 12), v = sim.viewOf("player"), w = truth(sim), G = CONTENT.scenario.goods!;
  assert.ok(v.ledger, "a ledger");
  for (const k of G.kinds) {
    assert.ok(priceKnown(v, k)! > 0);
    assert.ok(Math.abs(priceKnown(v, k)! - w.goodsPrice[k]) <= Math.ceil(w.goodsPrice[k] * 0.34), `price ${k}`);
    for (const p of G.places) if (p.cap[k] !== undefined) {
      const b = storeKnown(v, p.location, k)!, t = w.goods[k][p.location];
      assert.ok(Number.isInteger(b) && b >= 0, `${p.location} ${k}`);
      assert.ok(Math.abs(b - t) <= Math.ceil(t * 0.85) + 1, `${p.location} ${k}: book ${b} truth ${t}`);
    }
  }
});

test("books: only the ruler gets them, and a realm with no goods has none", () => {
  const sim = play(2, 8), w = truth(sim);
  assert.ok(buildView(w, sim.content, CONTENT.scenario.ruler, sim.tick).ledger);
  assert.equal(buildView(w, sim.content, "oren", sim.tick).ledger, undefined);
  assert.equal(buildView(w, sim.content, "elara", sim.tick).ledger, undefined);
  const none = play(2, 8, undefined, 5, variant((r) => { delete r.scenario.goods; }));
  assert.equal(none.viewOf("player").ledger, undefined);
  assert.equal(none.viewOf("player").world.goods, undefined);
});

test("books: away from the seat the figures stop updating and age", () => {
  const sim = play(2, 4);
  const first = sim.viewOf("player").ledger!.tick;
  const away = play(2, 30, { action: "travel", target: "northwatch" }, 4), v = away.viewOf("player");
  assert.ok(v.ledger!.tick < away.tick - 5 * DAY, "the ledger is days old once she has left");
  assert.ok(v.ledger!.tick >= first);
});

test("books: the public rules show who holds each store and where goods sell, but never a stock", () => {
  const g = play(1, 2).viewOf("player").world.goods!;
  assert.deepEqual(g.stores.find((s) => s.id === "pinegate"), { id: "pinegate", house: "veyr", kinds: ["timber"] });
  assert.ok(g.towns.some((t) => t.id === "marchend" && t.cutPermille > 0));
  assert.equal(g.markupPermille, 150);
  assert.ok(!JSON.stringify(g).includes("store\""), "no stock figure in the rules");
});

test("actions: what the page offers follows ownership: take from the crown's stores, buy from a House's, sell only the crown's", () => {
  const v = play(2, 12, undefined, 5, ARMED).viewOf("player"), acts = economyActions(v, RULES), has = (a: PlayerAction) => acts.some((x) => JSON.stringify(x) === JSON.stringify(a));
  assert.ok(has({ action: "purchase", market: true, target: "marchend", to: "greybridge", good: "timber" }), "buy at a market for a crown store");
  assert.ok(!acts.some((a) => a.action === "purchase" && !a.market && !!a.good), "no buying straight from a store");
  assert.ok(has({ action: "requisition", target: "crownwood", to: "marchend", good: "timber", sell: true }));
  assert.ok(!acts.some((a) => a.sell && a.target === "pinegate"), "cannot sell a House's timber");
  assert.ok(!acts.some((a) => a.good && a.to === "pinegate"), "cannot send into a House's store");
  assert.ok(acts.some((a) => a.action === "requisition" && !a.sell && !!a.good && a.target === "crownwood"), "send goods between the crown's stores");
  assert.ok(acts.some((a) => a.action === "levy" && a.muster && a.target === "northwatch" && a.to === "greybridge"));
  assert.ok(acts.some((a) => !a.good && a.action === "purchase" && a.market), "grain can be bought at a market");
  assert.ok(playerActions(v, RULES).length > acts.length - 1);
});

test("actions: words and costs", () => {
  const v = play(2, 12).viewOf("player");
  assert.equal(actionText(v, { action: "requisition", target: "crownwood", to: "greybridge", good: "timber" }), "Send timber from Crownwood to Greybridge");
  assert.equal(actionText(v, { action: "purchase", target: "pinegate", to: "greybridge", good: "timber" }), "Buy timber at Pinegate for Greybridge");
  assert.equal(actionText(v, { action: "requisition", target: "crownwood", to: "saltmere", good: "timber", sell: true }), "Sell timber from Crownwood at Saltmere");
  assert.equal(actionText(v, { action: "levy", muster: true, target: "northwatch", to: "greybridge" }), "Call men from Northwatch to Greybridge");
  const own = purchaseCostKnown(v, RULES, { action: "purchase", target: "crownwood", to: "greybridge", good: "timber" })!;
  const house = purchaseCostKnown(v, RULES, { action: "purchase", target: "pinegate", to: "greybridge", good: "timber" })!;
  assert.equal(own, priceKnown(v, "timber")! * CONTENT.scenario.goods!.buy.timber.units);
  assert.equal(house, Math.floor((priceKnown(v, "timber")! * 1150) / 1000) * CONTENT.scenario.goods!.buy.timber.units, "a House sells 15% dearer");
  assert.ok(affordable(v, RULES, { action: "purchase", target: "pinegate", to: "greybridge", good: "timber" }));
});

test("actions: the page explains why an order cannot work", () => {
  const v = play(2, 12).viewOf("player");
  assert.match(economyProblems(v, { action: "requisition", target: "pinegate", to: "greybridge", good: "timber" })[0], /belongs to veyr|Veyr/i);
  assert.match(economyProblems(v, { action: "requisition", target: "crownwood", to: "greyfen", good: "timber", sell: true })[0], /market town/);
  assert.match(economyProblems(v, { action: "requisition", target: "crownwood", to: "crownwood", good: "timber" })[0], /different place/);
  assert.match(economyProblems(v, { action: "levy", muster: true, target: "ravenport", to: "greybridge" })[0], /people/);
  assert.deepEqual(economyProblems(v, { action: "requisition", target: "crownwood", to: "greybridge", good: "timber" }), []);
});

test("actions: every order the page offers is accepted by the engine (none abandoned for a reason the page should have caught)", () => {
  const v = play(2, 12, undefined, 5, ARMED).viewOf("player"), acts = economyActions(v, RULES);
  const pick = (f: (a: PlayerAction) => boolean) => acts.find(f)!;
  const sample = [pick((a) => a.action === "purchase" && !!a.market && !!a.good), pick((a) => a.action === "purchase" && !!a.market && !a.good), pick((a) => !!a.sell), pick((a) => !!a.muster)];
  for (const a of sample) {
    assert.ok(a, "a sample");
    const sim = play(2, 60, a, 12, ARMED), bad = sim.log.filter((e) => e.type === "OrderAbandoned" && ["houseHolds", "noMarket", "noDestination"].includes(String(e.payload.reason)));
    assert.deepEqual(bad.map((e) => e.payload.reason), [], actionText(v, a));
    assert.ok(sim.log.some((e) => e.type === "PlayerInput" && e.payload.action === a.action), actionText(v, a));
  }
});

test("grain: days of cover and its band from a letter's figure", () => {
  const sim = play(2, 40), v = sim.viewOf("player");
  const some = v.world.grain!.places.map((p) => ({ id: p.id, c: grainCover(v, p.id) })).filter((x) => x.c);
  for (const x of some) assert.ok(x.c!.days >= 0 && x.c!.band >= 0 && x.c!.band <= 4, x.id);
});

test("actions: men cannot be called to a fort the books show holds no iron", () => {
  const v = play(2, 12).viewOf("player");
  assert.ok(!economyActions(v, RULES).some((a) => a.muster));
  assert.match(economyProblems(v, { action: "levy", muster: true, target: "northwatch", to: "greybridge" })[0], /no iron/);
});
