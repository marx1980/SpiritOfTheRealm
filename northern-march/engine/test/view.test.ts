// A7 / B5 invariant: presentation and planners see ViewOf only; beliefs come only from delivered reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderCourtSummary } from "../src/presentation/court.ts";
import { run } from "./helpers.ts";

test("sim.world is not readable from outside the simulation", () => {
  const sim = run({ seed: 1 }, 30);
  assert.throws(() => (sim as unknown as { world: unknown }).world, /ViewOf/);
});

test("ViewOf(player) is frozen and holds only beliefs, delivered reports and the clock", () => {
  const sim = run({ seed: 1 }, 60);
  const v = sim.viewOf("player");
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.beliefs));
  assert.deepEqual(Object.keys(v).sort(), ["beliefs", "now", "reports", "self"]);
  assert.throws(() => { (v as { now: number }).now = 0; });
});

test("no belief from a report before its ReportDelivered event", () => {
  for (const seed of [1, 2, 3, 4]) {
    const sim = run({ seed });
    const delivered = new Map<number, number>(); // reportId -> delivery event id
    for (const e of sim.log) {
      const p = e.payload as { reportId?: number };
      if (e.type === "ReportDelivered") delivered.set(p.reportId!, e.id);
      if (e.type === "BeliefUpdated") {
        assert.ok(delivered.has(p.reportId!), `seed ${seed}: belief from undelivered report ${p.reportId}`);
        assert.ok(e.causedBy.includes(delivered.get(p.reportId!)!));
      }
    }
  }
});

test("the player's belief can differ from the truth (reports age and can be lost)", () => {
  let differs = false;
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = run({ seed }, 120);
    const truth = sim.unsafeWorldForDebug();
    for (const [key, b] of Object.entries(sim.viewOf("player").beliefs)) {
      const [loc] = key.split(":");
      if (truth.fortifications[loc] && truth.fortifications[loc].conditionMilli !== b.value) differs = true;
    }
  }
  assert.ok(differs);
});

test("presentation renders from a view", () => {
  const sim = run({ seed: 2 }, 60);
  const text = renderCourtSummary(sim.viewOf("player"));
  assert.match(text, /day 60/);
});

test("presentation modules import nothing that exposes WorldState (static check)", () => {
  const dir = new URL("../src/presentation/", import.meta.url).pathname;
  const allowed = new Set(["../view.ts", "./format.ts"]);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(allowed.has(m[1]), `${f} imports ${m[1]}`);
  }
});
