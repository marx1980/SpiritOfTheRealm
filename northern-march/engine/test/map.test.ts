// Phase 2 / P0.02: three provinces, roads, crossings, travel times; characters and messengers move along routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MapGraph } from "../src/map.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { CONTENT, run, variant, legacyVariant } from "./helpers.ts";

const map = new MapGraph(CONTENT);

test("20-25 locations across three provinces, with bridge, ford and ferry over the river", () => {
  assert.ok(CONTENT.locations.length >= 20 && CONTENT.locations.length <= 25);
  assert.equal(new Set(CONTENT.locations.map((l) => l.province)).size, 3);
  const kinds = new Set(CONTENT.routes.filter((r) => r.crossing).map((r) => r.crossing!.kind));
  assert.deepEqual([...kinds].sort(), ["bridge", "ferry", "ford"]);
});

test("travel time = km / speed for the terrain and mode, plus the crossing delay", () => {
  assert.equal(map.legTicks("ravenport-kingsroad", "rider"), 40 * DAY / 80);
  assert.equal(map.legTicks("veyford-redbarrow", "rider"), 12 * DAY / 60 + 2 * 3600);
  assert.equal(map.legTicks("veyford-redbarrow", "army"), 12 * DAY / 15 + 2 * 3600);
  assert.equal(map.legTicks("saltmere-marchend", "foot"), Math.ceil(40 * DAY / 30) + 6 * 3600);
});

test("shortest path is deterministic and correct", () => {
  const p = map.path("ravenport", "northwatch", "rider", () => true)!;
  assert.deepEqual(p.locations, ["ravenport", "kingsroad", "greybridge", "pinegate", "northwatch"]);
  assert.equal(p.ticks, 43200 + 32400 + 16200 + 32400);
});

test("a closed route forces a detour", () => {
  const p = map.path("ravenport", "northwatch", "rider", (r) => r !== "greybridge-pinegate")!;
  assert.ok(!p.locations.includes("pinegate") || p.locations.indexOf("pinegate") > p.locations.indexOf("greybridge") + 1);
  assert.ok(p.ticks > 124200);
  assert.equal(map.path("ravenport", "northwatch", "rider", () => false), null);
});

test("a character rides along the route and arrives exactly on time", () => {
  const c = legacyVariant((r) => { r.scenario.scripts = [{ day: 3, kind: "travel", who: "bren", to: "ravenport", mode: "rider" }]; });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const dep = sim.log.find((e) => e.type === "Departed" && e.payload.who === "bren")!;
  const arr = sim.log.find((e) => e.type === "Arrived" && e.payload.who === "bren")!;
  assert.equal(dep.tick, 3 * DAY);
  assert.deepEqual(dep.payload.path, ["northwatch", "pinegate", "greybridge", "kingsroad", "ravenport"]);
  assert.equal(arr.tick - dep.tick, 124200);
  assert.deepEqual(sim.unsafeWorldForDebug().positions.bren, { at: "ravenport" });
});

test("an army moves at army speed", () => {
  const c = legacyVariant((r) => { r.scenario.scripts = [{ day: 1, kind: "travel", who: "caron", to: "northwatch", mode: "army" }]; });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const dep = sim.log.find((e) => e.type === "Departed" && e.payload.who === "caron")!;
  const arr = sim.log.find((e) => e.type === "Arrived" && e.payload.who === "caron")!;
  assert.equal(arr.tick - dep.tick, 15 * DAY / 20 + 30 * DAY / 20);
});

test("while travelling, a character is between places, not at either", () => {
  const c = variant((r) => { r.scenario.scripts = [{ day: 3, kind: "travel", who: "bren", to: "ravenport", mode: "rider" }]; });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 3);
  sim.runUntil(3 * DAY + 3600);
  const pos = sim.unsafeWorldForDebug().positions.bren as { transit?: { dest: string } };
  assert.equal(pos.transit?.dest, "ravenport");
});
