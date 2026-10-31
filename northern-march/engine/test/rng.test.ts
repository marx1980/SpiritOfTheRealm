// G-02: adding draws to one stream leaves every other stream's outcomes unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/rng.ts";
import { run } from "./helpers.ts";

test("streams are seeded by (master, name) and independent", () => {
  const a = Rng.fromSeed(5, "economy"), b = Rng.fromSeed(5, "weather"), a2 = Rng.fromSeed(5, "economy");
  const xs = Array.from({ length: 50 }, () => a.u32());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => a2.u32()));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, () => b.u32()));
});

test("int() is in range, unbiased enough, integer only", () => {
  const r = Rng.fromSeed(1, "t");
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) {
    const v = r.int(0, 5);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 5);
    counts[v]++;
  }
  for (const c of counts) assert.ok(c > 9500 && c < 10500, String(counts));
});

test("state round-trips (needed for save/load)", () => {
  const r = Rng.fromSeed(9, "x");
  r.u32(); r.u32();
  const s = r.getState();
  const next = r.u32();
  assert.equal(Rng.fromState(s).u32(), next);
});

test("G-02: extra weather draws do not change economy outcomes", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const base = run({ seed });
    const perturbed = run({ seed, params: { extraDraws: { weather: 3 } } });
    const econ = (log: readonly { type: string; payload: unknown; tick: number }[]) =>
      JSON.stringify(log.filter((e) => e.type === "TreasuryCollected").map((e) => [e.tick, e.payload]));
    assert.equal(econ(perturbed.log), econ(base.log), `seed ${seed}`);
    assert.ok(perturbed.rngDraws().weather > base.rngDraws().weather);
  }
});

test("G-02: extra weather draws change weather outcomes on some seed (the switch is live)", () => {
  const storms = (log: readonly { type: string; tick: number }[]) => JSON.stringify(log.filter((e) => e.type === "Storm").map((e) => e.tick));
  const changed = [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => storms(run({ seed }).log) !== storms(run({ seed, params: { extraDraws: { weather: 3 } } }).log));
  assert.ok(changed);
});

test("messages draw from keyed substreams: one extra message does not shift another's delay", () => {
  // Same message key always gets the same draws, whatever else happened before it.
  const a = Rng.fromSeed(3, "messenger:report:864000:northwatch");
  const b = Rng.fromSeed(3, "messenger:report:864000:northwatch");
  Rng.fromSeed(3, "messenger:report:0:northwatch").u32();
  assert.equal(a.u32(), b.u32());
});
