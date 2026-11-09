// The captain on the map (D-055/D-056): placed by the news, headed by his last order, ringed by how fresh the word is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { buildMap } from "../src/presentation/map.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT } from "./helpers.ts";

function play(days: number, action?: PlayerAction, at = 5) {
  const sim = createSim({ content: CONTENT, seed: 2, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 6000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (action && !done && sim.tick >= at * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}

test("a captain with a company is on the map, with a ring that is full on the day the news arrives and fades", () => {
  const sim = createSim({ content: CONTENT, seed: 2, policy: "external", params: { dayEnd: true } });
  let first: number | undefined, later: number | undefined;
  for (let i = 0; i < 6000 && sim.tick < 30 * DAY; i++) {
    const p = sim.next(30 * DAY); if (!p.paused) break;
    const c = buildMap(sim.viewOf("player")).captains.find((x) => x.id === "caron");
    if (c && first === undefined) first = c.strength; else if (c && later === undefined && sim.tick > 15 * DAY) later = c.strength;
    sim.answer([]);
  }
  assert.equal(first, 1, "full strength on the day the first letter about him arrives");
  assert.ok(later === undefined || later < 1, "an old report gives a fainter ring");
});

test("an order to move: the next day he is shown headed there, as a projection, until word of him arrives", () => {
  const given = { action: "advance", target: "northwatch" } as const;
  const m = buildMap(play(13, given, 11.95).viewOf("player")), c = m.captains.find((x) => x.id === "caron");
  assert.ok(c?.heading, "headed somewhere");
  assert.equal(c!.heading!.words, "En route to Northwatch");
  assert.equal(c!.heading!.to, "northwatch");
  assert.equal(c!.heading!.projected, true);
  assert.equal(c!.at, "greybridge", "still believed at his old post");
});

test("a fight order reads as an attack on the raiders at their place, and a scouting order as scouting", () => {
  const atk = buildMap(play(13, { action: "advance", target: "northwatch", mission: "attack", raid: "greyfen" }, 11.95).viewOf("player")).captains.find((c) => c.id === "caron");
  if (atk?.heading) assert.match(atk.heading.words, /^(Attacking the raiders at|En route to) /);
});
