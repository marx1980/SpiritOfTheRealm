// A2: integer ticks, 1 tick = 1 game second; the scheduler jumps to the next event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler.ts";
import { TICKS_PER_DAY } from "../src/engine.ts";
import { run } from "./helpers.ts";

test("items pop in (tick, insertion) order", () => {
  const s = new Scheduler();
  s.push(50, "b", {}); s.push(10, "a", {}); s.push(50, "c", {}); s.push(10, "d", {});
  const order: string[] = [];
  while (s.size) order.push(s.pop()!.handler);
  assert.deepEqual(order, ["a", "d", "b", "c"]);
});

test("rejects non-integer or past ticks", () => {
  const s = new Scheduler();
  assert.throws(() => s.push(1.5, "x", {}));
  s.push(10, "x", {}); s.pop();
  assert.throws(() => s.push(5, "y", {}), /past/);
});

test("a day is 86,400 ticks and quiet time costs nothing", () => {
  assert.equal(TICKS_PER_DAY, 86400);
  const sim = run({ seed: 2 }, 240);
  assert.equal(sim.tick, 240 * TICKS_PER_DAY);
  // work done is proportional to scheduled items, not to 20.7 million ticks
  assert.ok(sim.stats().handlersRun < 20000, String(sim.stats().handlersRun));
});
