// Filling the economy's known gaps, stage A (D-045): what the crown has paid each House, prices that differ by town,
// and Houses that spend what they are paid on restocking their stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import { checkRun } from "../src/invariants.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

const GP = CONTENT.scenario.goods!;
const quiet = (edit: (r: any) => void = () => {}) => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; edit(r); });
function play(seed: number, actions: [number, PlayerAction][], days = 60, content = CONTENT) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  const todo = [...actions].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 6000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    const due = todo.filter(([d]) => sim.tick >= d * DAY); todo.splice(0, due.length);
    sim.answer(due.map(([, a]) => a));
  }
  return sim;
}
const BUY: PlayerAction = { action: "purchase", target: "pinegate", to: "greybridge", good: "timber" };
const sell = (to: string): PlayerAction => ({ action: "requisition", target: "crownwood", to, good: "timber", sell: true });
const ledgerSum = (w: any, good: string, k: string) => (Object.values(w.goodsLedger[good]) as Record<string, number>[]).reduce((n, x) => n + (x[k] ?? 0), 0);

test("paid: what the crown has paid a House is kept apart from what the House still holds, and the ruler's ledger shows it", () => {
  const sim = play(2, [[5, BUY]], 30, quiet()), w = sim.unsafeWorldForDebug() as any;
  const ship = sim.log.find((e) => e.type === "GoodsShipped")!;
  assert.equal(w.housePaid.veyr, ship.payload.costMilli, "paid is exactly what the purchase cost");
  assert.equal(sim.viewOf("player").ledger!.paid.veyr, w.housePaid.veyr, "the crown knows its own payments exactly");
  assert.equal(sim.viewOf("player").ledger!.paid.varos ?? 0, 0);
});

test("towns: selling lowers that town's price for that good, a little more with each sale, and it recovers over days", () => {
  const sim = play(2, [[5, sell("saltmere")], [8, sell("saltmere")]], 12, quiet()), sold = sim.log.filter((e) => e.type === "GoodsSold");
  assert.equal(sold.length, 2);
  const per = (e: any) => e.payload.proceedsMilli / (e.payload.units * e.payload.priceMilli);
  assert.ok(per(sold[1]) < per(sold[0]), `second sale pays less per unit: ${per(sold[0])} then ${per(sold[1])}`);
  const w = sim.unsafeWorldForDebug() as any;
  assert.ok(w.townGlut.saltmere.timber > 0);
  const later = play(2, [[5, sell("saltmere")], [8, sell("saltmere")]], 60, quiet()).unsafeWorldForDebug() as any;
  assert.ok(later.townGlut.saltmere.timber < w.townGlut.saltmere.timber, "the glut wears off");
  assert.ok(play(2, [[5, sell("saltmere")], [8, sell("ravenport")]], 12, quiet()).log.filter((e) => e.type === "GoodsSold").every((e, i, a) => i === 0 || per(e) >= per(a[0]) - 0.1), "another town is not affected by the first");
});

test("towns: the ledger gives each town's price, below the realm price by its spread and its glut", () => {
  const sim = play(2, [[5, sell("saltmere")]], 9, quiet()), L = sim.viewOf("player").ledger!;
  assert.ok(L.town.saltmere.timber < L.price.timber * 0.9 + 1, "spread plus glut");
  assert.ok(L.town.ravenport.timber <= L.price.timber * 0.86 + 1 && L.town.ravenport.timber > 0);
});

test("restock: a House spends what it has been paid to refill its store, at the usual price, and conservation still holds", () => {
  const sim = play(2, [[5, BUY], [6, { ...BUY, target: "pinegate" }]], 90, quiet()), w = sim.unsafeWorldForDebug() as any;
  const ev = sim.log.filter((e) => e.type === "HouseRestocked");
  assert.ok(ev.length > 0, "the House restocked");
  for (const e of ev) { assert.equal(e.payload.house, "veyr"); assert.equal(e.payload.costMilli, (e.payload.units as number) * GP.price.timber.baseMilli); }
  assert.ok(w.houseCoin.veyr < w.housePaid.veyr, "it spent some of what it was paid");
  const start = GP.places.reduce((n, p) => n + ((p.store as Record<string, number>).timber ?? 0), 0);
  const road = (Object.values(w.goodsConvoys) as any[]).filter((c) => c.good === "timber").reduce((n, c) => n + c.units, 0);
  const have = GP.places.reduce((n, p) => n + (w.goods.timber[p.location] ?? 0), 0) + road;
  assert.equal(have, start + ledgerSum(w, "timber", "produced") - ledgerSum(w, "timber", "spilled") - ledgerSum(w, "timber", "lost") - ledgerSum(w, "timber", "seized") - ledgerSum(w, "timber", "used") - ledgerSum(w, "timber", "sold"));
  assert.deepEqual(checkRun(sim), []);
});

test("restock: with nothing bought from a House nothing is restocked and no town has a glut", () => {
  const sim = play(2, [], 90, quiet());
  assert.ok(!sim.log.some((e) => e.type === "HouseRestocked"));
  assert.ok(!sim.log.some((e) => e.type === "GoodsDay" && e.payload.glut));
});

test("books: kept every day by the steward; the ruler's ledger only moves while she is at the seat", () => {
  const sim = play(2, [[4, { action: "travel", target: "northwatch" }]], 30), w = sim.unsafeWorldForDebug() as any;
  assert.ok(w.books.tick > w.ledger.tick, "the steward's books are newer than the ruler's ledger once she is away");
  assert.ok(w.books.tick >= sim.tick - 2 * DAY);
});
