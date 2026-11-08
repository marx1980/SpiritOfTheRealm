// Quantity on economy orders (D-048): an optional `units` amount, capped by the usual order size; absent, nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

const quiet = () => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; });
function ordered(action: PlayerAction, days = 40) {
  const sim = createSim({ content: quiet(), seed: 2, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= 5 * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const shipped = (sim: ReturnType<typeof ordered>) => sim.log.find((e) => e.type === "GoodsShipped" || e.type === "GrainShipped")!;

test("a goods order for fewer units moves and pays for exactly that many", () => {
  const full = shipped(ordered({ action: "purchase", target: "pinegate", to: "greybridge", good: "timber" }));
  const part = shipped(ordered({ action: "purchase", target: "pinegate", to: "greybridge", good: "timber", units: 20 }));
  assert.equal(full.payload.units, CONTENT.scenario.goods!.buy.timber.units);
  assert.equal(part.payload.units, 20);
  assert.equal(part.payload.costMilli, 20 * (part.payload.priceMilli as number));
});

test("more than the usual order size is capped at the usual size", () => {
  assert.equal(shipped(ordered({ action: "purchase", target: "pinegate", to: "greybridge", good: "timber", units: 500 })).payload.units, CONTENT.scenario.goods!.buy.timber.units);
});

test("a grain order for fewer sacks moves exactly that many", () => {
  const sim = ordered({ action: "purchase", target: "greyfen", to: "coldmere", units: 30 });
  assert.equal(shipped(sim).payload.sacks, 30);
});

test("the amount is kept in the saved inputs", () => {
  const sim = ordered({ action: "purchase", target: "pinegate", to: "greybridge", good: "timber", units: 20 });
  const inp = (sim as any).save().inputs.find((i: any) => i.action === "purchase");
  assert.equal(inp.units, 20); assert.equal(inp.good, "timber");
});

test("letters give days of food and merge where the writer is with how many men", async () => {
  const { letterSentences } = await import("../src/presentation/phrasing.ts");
  const sim = createSim({ content: CONTENT, seed: 3, policy: "passive" }); sim.runDays(12);
  const v = sim.viewOf("player");
  const text = (a: string) => v.reports.filter((r) => r.author === a).sort((x, y) => x.composedAt - y.composedAt).map((r) => letterSentences(v, r).join(" "));
  assert.match(text("bren").find((t) => /^I am at/.test(t))!, /^I am at Northwatch with \d+ men\. The walls are .* and we have food for \d+ days?\. Coldmere has food for \d+ days?\./);
  assert.match(text("caron")[0], /^I am at Greybridge with 200 men\./);
  assert.ok(!text("caron")[0].includes("food"), "Greybridge keeps no grain");
  for (const t of [...text("bren"), ...text("varos")]) assert.ok(!/grain stock/.test(t), t);
});
