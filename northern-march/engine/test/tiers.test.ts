// Phase 4 / ARCHITECTURE §20.9: simulation tiers, promotion and demotion, budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { withExtraBackground } from "../src/content.ts";
import type { DecisionTrace } from "../src/schemas.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const background = CONTENT.characters.filter((c) => c.tier === "C");
const touches = (sim: ReturnType<typeof run>, who: string) => sim.log.filter((e) =>
  (e.type === "BeliefUpdated" && e.payload.holder === who) || (e.type === "AgentWoke" && e.payload.agent === who) ||
  (e.type === "DecisionMade" && (e.payload.trace as DecisionTrace).agent === who) || (e.type === "Observed" && e.payload.observer === who));

const expedition = (edit?: (r: Parameters<Parameters<typeof variant>[0]>[0]) => void) => variant((r) => {
  r.scenario.scripts = [{ day: 2, kind: "order", from: "anna", to: "caron", intent: "investigate", objective: { kind: "location", id: "blackwood" }, discretion: "delegated" }];
  r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  edit?.(r);
});

test("20-30 background characters, each with identity, household, occupation, place, traits and few relationships", () => {
  assert.ok(background.length >= 20 && background.length <= 30, String(background.length));
  for (const c of background) {
    assert.ok(c.name && c.household && c.occupation && c.location && c.traits.length >= 1, c.id);
    assert.ok(c.relationships.length <= 2, `${c.id}: minimal relationships`);
  }
});

test("background characters cost nothing while nothing concerns them", () => {
  const sim = run({ seed: 1, policy: "passive", ablate: ["threat"] }, 120);
  for (const c of background) assert.equal(touches(sim, c.id).length, 0, c.id);
});

test("Stefan promotes from background to expedition commander without pre-running full AI", () => {
  const sim = run({ seed: 1, content: expedition(), policy: "passive" }, 30);
  const appointed = sim.log.find((e) => e.type === "LeaderAppointed")!;
  assert.ok(appointed, "a leader was appointed");
  assert.equal(appointed.payload.leader, "stefan");
  assert.equal(appointed.payload.by, "caron");
  assert.equal(appointed.payload.recommendedBy, "bren", "known through someone Caron trusts");
  const promo = sim.log.find((e) => e.type === "CharacterPromoted" && e.payload.who === "stefan")!;
  assert.equal(promo.payload.from, "C"); assert.equal(promo.payload.to, "A");
  assert.ok(promo.causedBy.includes(appointed.id));
  assert.ok(touches(sim, "stefan").every((e) => e.id > promo.id), "no planning, beliefs or observation before promotion");
  // he then leads: receives the order, decides, goes, scouts, reports
  const sub = sim.log.find((e) => e.type === "OrderIssued" && (e.payload.order as { recipient: string }).recipient === "stefan")!;
  assert.equal((sub.payload.order as { issuer: string }).issuer, "caron");
  assert.ok(sim.log.some((e) => e.type === "ObedienceDecided" && e.payload.orderId === (sub.payload.order as { id: number }).id));
  assert.ok(sim.log.some((e) => e.type === "Observed" && e.payload.observer === "stefan" && (e.payload.subject as { id: string }).id === "blackwood"));
  assert.ok(sim.log.some((e) => e.type === "ReportComposed" && (e.payload.report as { author: string; recipient: string }).author === "stefan"));
  // Caron's order was delegated (a subordinate order) and completes when the expedition does
  const parent = (sim.log.find((e) => e.type === "OrderIssued" && (e.payload.order as { recipient: string }).recipient === "caron")!.payload.order as { id: number }).id;
  assert.ok(sim.log.some((e) => e.type === "SubordinateOrdersIssued" && e.payload.orderId === parent));
  const done = sim.log.find((e) => e.type === "OrderCompleted" && e.payload.orderId === parent)!;
  const heard = sim.log.find((e) => e.id === done.causedBy[0])!;
  assert.equal(heard.type, "ReportDelivered", "Caron's order ends when Stefan's report reaches him");
  assert.equal(heard.payload.recipient, "caron");
});

test("no recommendation from someone the delegate trusts, no Stefan", () => {
  const c = expedition((r) => { r.characters.find((x) => x.id === "caron")!.relationships.find((x) => x.to === "bren")!.value = 300; });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const appointed = sim.log.find((e) => e.type === "LeaderAppointed");
  assert.notEqual(appointed?.payload.leader, "stefan");
  assert.equal(touches(sim, "stefan").length, 0);
});

test("demoted people keep history and relationships; plans are dropped", () => {
  const sim = run({ seed: 1, content: expedition(), policy: "passive" }, 120);
  const demotions = sim.log.filter((e) => e.type === "CharacterDemoted" && e.payload.who === "stefan");
  assert.equal(demotions.length, 2, "Stefan steps back once the expedition is over and nothing stirs him, A to B to C");
  assert.ok(demotions[1].tick - demotions[0].tick >= sim.content.scenario.agents.demoteAfterDays * DAY, "each step needs its own quiet period");
  const w = sim.unsafeWorldForDebug();
  const st = w.agents.stefan;
  assert.ok(st, "his record survives demotion");
  assert.equal(st.operational, null, "plans dropped");
  assert.ok(w.history.stefan.some((h) => h.event === "promoted") && w.history.stefan.some((h) => h.event === "demoted"));
  assert.ok(Object.keys(st.experience).length > 0 || w.history.stefan.some((h) => h.role === "expedition leader"));
  assert.deepEqual(sim.content.byId.character.get("stefan")!.relationships, CONTENT.byId.character.get("stefan")!.relationships);
  assert.ok(Object.keys(w.beliefs.stefan ?? {}).length > 0, "memories kept");
});

test("a background character caught up in raids becomes locally relevant (Tier B)", () => {
  const c = variant((r) => { r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 800, durationDays: 40 }]; });
  const sim = run({ seed: 2, content: c, policy: "passive" }, 30);
  const p = sim.log.find((e) => e.type === "CharacterPromoted" && e.payload.who === "edda")!;
  assert.ok(p, "the Northwatch sergeant");
  assert.equal(p.payload.from, "C"); assert.equal(p.payload.to, "B");
  for (const e of sim.log.filter((x) => x.type === "DecisionMade" && (x.payload.trace as DecisionTrace).agent === "edda"))
    assert.ok((e.payload.trace as DecisionTrace & { compressed?: boolean }).compressed, "Tier B traces are compressed");
});

test("wakes stay within tier budgets (A 20, B 3, C 0 per agent per day)", () => {
  const c = variant((r) => { r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 900, durationDays: 60 }]; });
  for (const seed of [1, 2, 3]) {
    const sim = run({ seed, content: c, policy: "aggressive" }, 120);
    const per = new Map<string, number>();
    for (const w of sim.log.filter((e) => e.type === "AgentWoke")) {
      const k = `${w.payload.agent}:${w.payload.tier}:${Math.floor(w.tick / DAY)}`;
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    for (const [k, n] of per) {
      const tier = k.split(":")[1] as "A" | "B" | "C";
      assert.ok(n <= sim.content.scenario.agents.wakeBudgetPerDay[tier], `${k}: ${n}`);
    }
  }
});

test("doubling the background cast barely changes Tier A work", () => {
  const doubled = withExtraBackground(CONTENT, 2);
  assert.equal(doubled.characters.filter((c) => c.tier === "C").length, 2 * background.length);
  let a1 = 0, a2 = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const count = (sim: ReturnType<typeof run>) => sim.log.filter((e) => e.type === "AgentWoke" && e.payload.tier === "A").length;
    a1 += count(run({ seed, policy: "delegating" }, 240));
    a2 += count(run({ seed, content: doubled, policy: "delegating" }, 240));
  }
  assert.ok(Math.abs(a2 - a1) * 1000 < 200 * a1, `${a1} -> ${a2}`);
});
