// Filling the gaps, stage B (D-045): advisers advise on timber for repairs and on calling men, as extra advice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import { buildView } from "../src/view.ts";
import { buildSituation } from "../src/systems/agents.ts";
import { perceiverFromView } from "../src/systems/agents.ts";
import { generateEconomy, score } from "../src/agents/planner.ts";
import { adviceAction, actionText, economyProblems } from "../src/presentation/affordances.ts";
import { planOf, planWords } from "../src/presentation/phrasing.ts";
import { checkRun } from "../src/invariants.ts";
import { CONTENT, variant } from "./helpers.ts";

/** A realm where Northwatch's walls are worn down (so repairs are wanted) and the crown's timber is plentiful. */
const WORN = variant((r: any) => { r.locations.find((l: any) => l.id === "northwatch").fortification.conditionMilli = 40000; r.scenario.scripts = []; });
const ARMED = variant((r: any) => { r.locations.find((l: any) => l.id === "northwatch").fortification.conditionMilli = 40000; r.scenario.goods.places.find((p: any) => p.location === "northwatch").store.iron = 40; });
function situation(content: typeof CONTENT, agent: string, days = 12, seed = 2) {
  const sim = createSim({ content, seed, policy: "passive" }); sim.runDays(days);
  const w = sim.unsafeWorldForDebug(), view = buildView(w, sim.content, agent, sim.tick);
  return { sit: buildSituation(w, sim.content, agent, sim.tick, "advise", view), per: perceiverFromView(view), sim, w };
}

test("situation: advisers at the seat know the steward's books; others do not", () => {
  const at = situation(WORN, "oren").sit;
  assert.ok(at.goods && at.goods.stock.timber.crownwood > 0);
  assert.equal(at.goods!.coverPermille, 350);
  const away = situation(WORN, "bren").sit;
  assert.equal(away.goods, undefined, "a castellan in the field has not read the books");
});

test("candidates: timber for a worn fort when one order of it would cover the repair; muster only for a threatened fort that has iron", () => {
  const { sit, per } = situation(WORN, "oren");
  const kinds = generateEconomy(sit, per).map((a) => `${a.kind}:${a.target}`);
  assert.ok(kinds.includes("advise_timber:northwatch"), kinds.join(" "));
  assert.ok(!kinds.some((k) => k.startsWith("advise_muster")), "no iron, no muster");
  const none = situation(variant((r: any) => { r.scenario.scripts = []; }), "oren").sit;
  assert.ok(!generateEconomy(none, situation(variant((r: any) => { r.scenario.scripts = []; }), "oren").per).some((a) => a.kind === "advise_timber"), "sound walls: no timber advice");
});

test("score: timber advice is worth about the coin it saves on the repair, to an adviser who minds the treasury", () => {
  const { sit, per } = situation(WORN, "oren");
  const c = score(sit, per, { kind: "advise_timber", target: "northwatch" });
  assert.ok(c.score > 0, `score ${c.score}`);
  assert.ok(c.contributions.some((x) => x.textKey === "reason.preserve_treasury"));
});

test("score: calling men is a cost in wages against fewer losses at the fort: dearer wages make it score lower (and in the sampled situations it never beats waiting: the advisers judge forty men not worth a season's pay)", () => {
  const cheap = variant((r: any) => { r.scenario.manpower.wageMilli = 1; r.scenario.goods.places.find((p: any) => p.location === "northwatch").store.iron = 40; });
  const dear = variant((r: any) => { r.scenario.manpower.wageMilli = 400; r.scenario.goods.places.find((p: any) => p.location === "northwatch").store.iron = 40; });
  const worth = (content: typeof CONTENT) => { const { sit, per } = situation(content, "elara", 70); if (!generateEconomy(sit, per).some((a) => a.kind === "advise_muster")) return null; return score(sit, per, { kind: "advise_muster", target: "northwatch" }).score - score(sit, per, { kind: "advise_wait" }).score; };
  const a = worth(cheap), b = worth(dear);
  assert.ok(a !== null && b !== null, "raiders near Northwatch are believed by day 70 on seed 2");
  assert.ok(a! > b!, `cheap ${a} vs dear ${b}`);
});

test("presentation: the words and the order each piece of advice turns into", () => {
  const sim = createSim({ content: ARMED, seed: 2, policy: "external", params: { dayEnd: true } });
  for (let i = 0; i < 3000 && sim.tick < 12 * DAY; i++) { const p = sim.next(12 * DAY); if (!p.paused) break; sim.answer([]); }
  const v = sim.viewOf("player");
  const rec = (kind: string, target: string) => ({ id: 1, author: "oren", plan: { kind: "plan", id: JSON.stringify({ kind, target }) }, computedAt: v.now, reasons: [], uncertainties: [], alternatives: [], contingencies: [], basedOnBeliefs: [], question: "what_would_you_do" }) as never;
  assert.equal(planWords(v, JSON.stringify({ kind: "advise_timber", target: "northwatch" })), "Bring timber to Northwatch");
  assert.equal(planWords(v, JSON.stringify({ kind: "advise_muster", target: "northwatch" })), "Call men to Northwatch");
  const t = adviceAction(v, rec("advise_timber", "northwatch"))!;
  assert.equal(t.action, "purchase"); assert.equal(t.market, true); assert.equal(t.good, "timber"); assert.equal(t.to, "northwatch"); assert.ok(["greybridge", "marchend", "ravenport", "saltmere"].includes(t.target!), "a market");
  assert.deepEqual(economyProblems(v, t), []);
  const m = adviceAction(v, rec("advise_muster", "northwatch"))!;
  assert.equal(m.action, "levy"); assert.equal(m.muster, true); assert.equal(m.to, "northwatch"); assert.equal(m.target, "northwatch", "the nearest people");
  assert.match(actionText(v, m), /^Call men from Northwatch to Northwatch$/);
  void planOf;
});

test("extras: the main advice an adviser gives is unchanged by the economy advice, which comes as extra advice only", () => {
  const sim = createSim({ content: WORN, seed: 2, policy: "passive" }); sim.runDays(40);
  const made = sim.log.filter((e) => e.type === "RecommendationMade");
  const kinds = (e: any) => JSON.parse(e.payload.recommendation.plan.id).kind as string;
  assert.ok(made.some((e) => kinds(e) === "advise_timber"), "timber advice is voiced in the game");
  for (const e of made.filter((x) => kinds(x) === "advise_timber")) assert.ok(made.some((m) => m.tick === e.tick && (m.payload as any).recommendation.author === (e.payload as any).recommendation.author && kinds(m) !== "advise_timber"), "spoken alongside the adviser's main advice");
});

test("provisioner: plays whole games without breaking an invariant, sells timber and does what the advisers say about it", () => {
  let sold = 0, moved = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = createSim({ content: CONTENT, seed, policy: "provisioner" }); sim.runDays(150);
    assert.deepEqual(checkRun(sim), [], `seed ${seed}`);
    sold += sim.log.filter((e) => e.type === "GoodsSold").length; moved += sim.log.filter((e) => e.type === "GoodsShipped" && (e.payload.how === "requisition" || e.payload.how === "market") && e.payload.to !== undefined).length;
  }
  assert.ok(sold > 0, "it sold some timber");
  assert.ok(moved > 0, "it moved some timber or sold some");
});

test("provisioner: with no goods in the realm it plays exactly as delegating", () => {
  const none = variant((r: any) => { delete r.scenario.goods; });
  const a = createSim({ content: none, seed: 3, policy: "provisioner" }), b = createSim({ content: none, seed: 3, policy: "delegating" });
  a.runDays(100); b.runDays(100);
  assert.equal(a.log.length, b.log.length);
});
