// Phase 2 / P0.03 / B5: observations with quality, evidence, reliability bands, lazy staleness,
// contradictions kept, caps with logged eviction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveBand, integrate, evictionPlan, BANDS, type BeliefProposition } from "../src/beliefs.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { beliefsAbout } from "../src/view.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const HL = 20 * DAY;
const prop = (id: number, value: number, observedAt: number, band: BeliefProposition["reliabilityBand"], source: string, kind = "report"): BeliefProposition => ({
  id, subject: { kind: "location", id: "northwatch" }, predicate: "fortification.condition", believedValue: value,
  evidenceRefs: [{ kind: kind as never, eventId: id, source }], observedOrLearnedAt: observedAt, observedAt, learnedAt: observedAt, reliabilityBand: band,
});

test("lazy staleness: the band drops one step per half-life, computed on read", () => {
  const p = prop(1, 50000, 0, "certain", "bren");
  assert.equal(effectiveBand(p, 0, HL), "certain");
  assert.equal(effectiveBand(p, HL - 1, HL), "certain");
  assert.equal(effectiveBand(p, HL, HL), "probable");
  assert.equal(effectiveBand(p, 3 * HL, HL), "doubtful");
  assert.equal(effectiveBand(p, 4 * HL, HL), "stale");
  assert.equal(effectiveBand(p, 1e9, 0), "certain"); // half-life 0: never decays
});

test("staleness changes the view without any per-tick event", () => {
  // Messenger ablated: nobody tells Anna anything new about Bren, so her day-0 belief can only age.
  const day1 = run({ seed: 2, policy: "passive", ablate: ["messenger"] }, 1);
  const day7 = run({ seed: 2, policy: "passive", ablate: ["messenger"] }, 7);
  const b1 = beliefsAbout(day1.viewOf("anna"), "bren", "character.location")[0];
  const b7 = beliefsAbout(day7.viewOf("anna"), "bren", "character.location")[0];
  assert.equal(b1.id, b7.id);
  assert.ok(BANDS.indexOf(b7.effectiveBand) < BANDS.indexOf(b1.effectiveBand), `${b1.effectiveBand} -> ${b7.effectiveBand}`);
  const stored1 = day1.unsafeWorldForDebug().beliefs.anna[String(b1.id)], stored7 = day7.unsafeWorldForDebug().beliefs.anna[String(b7.id)];
  assert.deepEqual(stored1, stored7, "the stored proposition is unchanged; only the read differs");
  // Anna now observes the treasury every day (exact, as ruler), so only location beliefs must stay silent per tick.
  assert.ok(!day7.log.some((e) => e.type.startsWith("Belief") && e.payload.holder === "anna" && e.tick > 0 && JSON.stringify(e.payload).includes("character.location")));
});

test("contradictions from different sources are kept; same-source updates and first-hand observation resolve", () => {
  const store: Record<string, BeliefProposition> = { "1": prop(1, 60000, 0, "probable", "bren") };
  const r1 = integrate(store, prop(0, 45000, DAY, "probable", "varos"), { now: DAY, halfLife: HL, nextId: 2 });
  assert.deepEqual(r1.dropIds, []);
  assert.equal(r1.upsert.id, 2);
  store["2"] = r1.upsert;
  const r2 = integrate(store, prop(0, 58000, 2 * DAY, "probable", "bren"), { now: 2 * DAY, halfLife: HL, nextId: 3 });
  assert.deepEqual(r2.dropIds, [1]); // Bren's newer account replaces his older one, Varos's stays
  const r3 = integrate(store, prop(0, 52000, 3 * DAY, "certain", "self", "observation"), { now: 3 * DAY, halfLife: HL, nextId: 4 });
  assert.deepEqual(r3.dropIds.sort(), [1, 2]);
  const r4 = integrate(store, prop(0, 60000, 3 * DAY, "uncertain", "self", "observation"), { now: 3 * DAY, halfLife: HL, nextId: 5 });
  assert.equal(r4.upsert.id, 1); // same value merges into the existing proposition
  assert.equal(r4.upsert.evidenceRefs.length, 2);
});

test("two characters hold conflicting beliefs about one fact", () => {
  let found = false;
  for (let seed = 1; seed <= 20 && !found; seed++) {
    const sim = run({ seed, policy: "passive" }, 60);
    const bren = beliefsAbout(sim.viewOf("bren"), "northwatch", "fortification.condition")[0];
    const anna = beliefsAbout(sim.viewOf("anna"), "northwatch", "fortification.condition")[0];
    if (bren && anna && bren.believedValue !== anna.believedValue) found = true;
  }
  assert.ok(found);
});

test("observation quality is capped by the observer's capability (Bren: engineering 800)", () => {
  const sim = run({ seed: 1, policy: "passive" }, 30);
  const obs = sim.log.filter((e) => e.type === "Observed");
  assert.ok(obs.length > 0);
  for (const e of obs) assert.ok(["certain", "probable", "uncertain", "doubtful"].includes(e.payload.band as string));
  const bren = obs.filter((e) => e.payload.observer === "bren" && e.payload.predicate === "fortification.condition");
  assert.ok(bren.every((e) => (e.payload.qualityPermille as number) <= 800));
});

test("belief caps evict the least relevant propositions, and every eviction is logged", () => {
  const c = variant((r) => { r.scenario.knowledge.beliefCaps.A = 6; });
  const sim = run({ seed: 3, content: c, policy: "passive" }, 120);
  const ev = sim.log.filter((e) => e.type === "BeliefEvicted");
  assert.ok(ev.length > 0);
  const w = sim.unsafeWorldForDebug(), caps = c.scenario.knowledge.beliefCaps as Record<string, number>;
  for (const [holder, store] of Object.entries(w.beliefs)) assert.ok(Object.keys(store).length <= caps[w.tiers[holder]], holder);
});

test("eviction plan removes the lowest (band x recency x relevance) first, ties by id", () => {
  const store = { "1": prop(1, 1, 0, "doubtful", "a"), "2": prop(2, 2, 10 * DAY, "certain", "a"), "3": prop(3, 3, 0, "doubtful", "a") };
  const plan = evictionPlan(store, 2, { now: 10 * DAY, halfLifeOf: () => HL, relevanceOf: () => 1000 });
  assert.deepEqual(plan.map((x) => x.id), [1]);
});

test("the ruler knows where every principal character is; the background she does not know", () => {
  const sim = run({ seed: 1, policy: "passive", ablate: ["messenger"] }, 0);
  const v = sim.viewOf("anna");
  for (const c of CONTENT.characters) {
    if (c.id === "anna") continue;
    assert.equal(beliefsAbout(v, c.id, "character.location").length > 0, c.tier === "A", c.id);
  }
});
