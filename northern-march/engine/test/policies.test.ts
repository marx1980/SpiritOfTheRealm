// A6 / C0.5: scripted player policies are deterministic, act only through recorded inputs, and differ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashLog } from "../src/engine.ts";
import { POLICIES } from "../src/policies.ts";
import { run } from "./helpers.ts";

const ACTIVE = ["passive", "delegating", "aggressive", "random-valid"] as const;

test("every policy is deterministic", () => {
  for (const policy of ACTIVE) assert.equal(hashLog(run({ seed: 5, policy }).log), hashLog(run({ seed: 5, policy }).log));
});

test("policies are behaviourally distinct on at least 10% of seeds (C3)", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  // each (policy, seed) simulation runs once; pairs are compared from the stored hashes
  const hashes = Object.fromEntries(ACTIVE.map((p) => [p, seeds.map((seed) => hashLog(run({ seed, policy: p }).log))]));
  for (let i = 0; i < ACTIVE.length; i++) for (let j = i + 1; j < ACTIVE.length; j++) {
    const differ = seeds.filter((_, k) => hashes[ACTIVE[i]][k] !== hashes[ACTIVE[j]][k]).length;
    assert.ok(differ >= 4, `${ACTIVE[i]} vs ${ACTIVE[j]}: ${differ}/40`);
  }
});

test("player actions appear only as PlayerInput events with no cause other than what the player saw", () => {
  const sim = run({ seed: 2, policy: "aggressive" });
  const inputs = sim.log.filter((e) => e.type === "PlayerInput");
  assert.ok(inputs.length > 0);
  for (const e of inputs) {
    const seen = sim.log.find((x) => x.id === e.causedBy[0]);
    assert.ok(!seen || ["ReportDelivered", "RecommendationMade", "DangerSignalled", "Arrived"].includes(seen.type), "player acted on something not shown to her");
  }
});

test("adviser-following policies are declared but unavailable before Phase 5", () => {
  assert.ok(POLICIES["follow-best-adviser"]);
  assert.throws(() => run({ seed: 1, policy: "follow-best-adviser" }), /Phase 5/);
});
