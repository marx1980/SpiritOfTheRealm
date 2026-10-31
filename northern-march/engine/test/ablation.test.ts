// A6 / C0.3 / C3: ablated systems emit nothing and draw nothing; paired arms match until the ablated system first acts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../src/events.ts";
import { checkPairing } from "../src/invariants.ts";
import { run } from "./helpers.ts";

const SYSTEMS = ["economy", "weather", "threat", "messenger"] as const;

test("a disabled system emits no events and consumes no RNG", () => {
  for (const sys of SYSTEMS) {
    const sim = run({ seed: 7, ablate: [sys] });
    assert.ok(!sim.log.some((e) => EVENT_TYPES[e.type].system === sys), `${sys} emitted`);
    assert.ok(!sim.streamsCreated().some((s) => s === sys || s.startsWith(sys + ":")), `${sys} drew`);
  }
});

test("ON and OFF arms are identical until the ablated system first emits", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const on = run({ seed }), off = run({ seed, ablate: ["threat"] });
    assert.deepEqual(checkPairing(on.log, off.log, "threat"), [], `seed ${seed}`);
  }
});

test("the threat matters on some seed (the switch is live)", () => {
  const h = (s: ReturnType<typeof run>) => s.log.length;
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8].some((seed) => h(run({ seed })) !== h(run({ seed, ablate: ["threat"] }))));
});

test("unknown system names are rejected", () => {
  assert.throws(() => run({ seed: 1, ablate: ["magic" as never] }), /unknown system/);
});
