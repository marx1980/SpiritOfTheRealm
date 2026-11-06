// Phase 7A, stage 1: the grain economy. Exact conservation, shortage caused by the raids, scarcity bands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../src/events.ts";
import { bandOf } from "../src/world.ts";
import { checkRun } from "../src/invariants.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const G = CONTENT.scenario.grain!;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

test("grain: every place's store equals start + produced - consumed - spilled, exactly, on every seed", () => {
  for (const seed of SEEDS) {
    const sim = run({ seed });
    for (const p of G.places) {
      const l = (sim.unsafeWorldForDebug() as any).grainLedger[p.location];
      assert.equal(sim.unsafeWorldForDebug().grain[p.location], p.store + l.produced - l.consumed - l.spilled, `${p.location} seed ${seed}`);
      assert.ok(sim.unsafeWorldForDebug().grain[p.location] >= 0 && sim.unsafeWorldForDebug().grain[p.location] <= p.cap, `${p.location} within 0..cap`);
    }
    assert.deepEqual(checkRun(sim), [], `seed ${seed}`);
  }
});

test("grain: the log alone gives the same stores as the world (projection)", () => {
  const sim = run({ seed: 3 });
  const store = Object.fromEntries(G.places.map((p) => [p.location, p.store]));
  for (const e of sim.log) if (e.type === "GrainDay") for (const [l, pr, c, sp] of e.payload.changes as number[][] as unknown as [string, number, number, number][]) store[l] += pr - c - sp;
  assert.deepEqual(store, sim.unsafeWorldForDebug().grain);
});

test("grain: with the Blackwood threat ablated nothing cuts the harvest and no place runs short", () => {
  for (const seed of SEEDS) {
    const off = run({ seed, ablate: ["threat"] });
    assert.ok(!off.log.some((e) => e.type === "HarvestDamaged"), `seed ${seed}`);
    assert.ok(G.places.every((p) => off.unsafeWorldForDebug().grainLedger[p.location].unmet === 0), `seed ${seed} unmet need`);
  }
});

test("grain: raids cause HarvestDamaged and, on some seed, a shortage at Northwatch that the OFF arm does not have", () => {
  let short = 0;
  for (const seed of SEEDS) {
    const on = run({ seed });
    const hit = on.log.filter((e) => e.type === "HarvestDamaged");
    for (const h of hit) assert.equal(on.log[h.causedBy[0] - 1].type, "RaidDamage");
    if (on.unsafeWorldForDebug().grainLedger.northwatch.unmet > 0 || on.log.some((e) => e.type === "ScarcityChanged" && e.payload.place === "northwatch" && (e.payload.to === "short" || e.payload.to === "famine"))) short += 1;
  }
  assert.ok(short > 0, "no seed of 8 shows a Northwatch shortage");
});

test("grain: scarcity bands follow days of cover; a change is an event caused by the daily tally", () => {
  assert.equal(bandOf(1200, 40, G.bandDays), "plenty");
  assert.equal(bandOf(560, 40, G.bandDays), "adequate");
  assert.equal(bandOf(280, 40, G.bandDays), "tight");
  assert.equal(bandOf(120, 40, G.bandDays), "short");
  assert.equal(bandOf(39, 40, G.bandDays), "famine");
  const sim = run({ seed: 2 });
  for (const e of sim.log.filter((x) => x.type === "ScarcityChanged")) assert.equal(sim.log[e.causedBy[0] - 1].type, "GrainDay");
});

test("grain: grain events belong to the grain system and the content rejects a place that does not exist", () => {
  for (const t of ["GrainDay", "HarvestDamaged", "ScarcityChanged"]) assert.equal(EVENT_TYPES[t].system, "grain");
  assert.throws(() => variant((r) => { r.scenario.grain!.places[0].location = "nowhere"; }));
  assert.throws(() => variant((r) => { r.scenario.grain!.places[0].store = r.scenario.grain!.places[0].cap + 1; }));
});

test("grain: a surplus above the cap is spilled, not created", () => {
  const sim = run({ seed: 1 });
  assert.ok(sim.unsafeWorldForDebug().grainLedger.greyfen.spilled > 0);
});
