// Phase 14B stage 4 (D-087): a bad harvest year, so that food can be the crisis of a game; the merchant's grain, which a hostile court withholds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const DAY = 86400;
const B = CONTENT.scenario.grain!.blight!;
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);
const sure = variant((r) => { r.scenario.grain!.blight = { ...r.scenario.grain!.blight!, chancePermille: 1000 }; });
const never = variant((r) => { r.scenario.grain!.blight = { ...r.scenario.grain!.blight!, chancePermille: 0 }; });
const places = CONTENT.scenario.grain!.places.map((p) => p.location).sort();

test("the blight is content: a day, a chance, a cut and its length; it is a root event of the grain system", () => {
  assert.ok(B && B.chancePermille > 0 && B.chancePermille < 1000 && B.cutPermille > 0 && B.days >= 1);
  assert.equal(EVENT_TYPES.HarvestBlighted.system, "grain");
  assert.equal(EVENT_TYPES.HarvestBlighted.root, true);
});

test("a blight year: one event on the day, and every grain place's harvest cut by the same amount for the same days", () => {
  const log = run({ seed: 2, content: sure }, B.checkDay + 5).log, bl = ofType(log, "HarvestBlighted");
  assert.equal(bl.length, 1);
  assert.equal(bl[0].causedBy.length, 0, "a root");
  assert.ok(bl[0].tick >= B.checkDay * DAY && bl[0].tick < (B.checkDay + 1) * DAY);
  const hits = ofType(log, "HarvestDamaged").filter((e) => e.causedBy.includes(bl[0].id));
  assert.deepEqual(hits.map((e) => e.payload.place as string).sort(), places);
  for (const h of hits) { assert.equal(h.payload.permille, B.cutPermille); assert.equal(h.payload.until, bl[0].tick + B.days * DAY); }
});

test("with no chance there is no blight; the same seed gives the same year", () => {
  assert.equal(ofType(run({ seed: 2, content: never }, B.checkDay + 5).log, "HarvestBlighted").length, 0);
  assert.deepEqual(ofType(run({ seed: 5, content: sure }, B.checkDay + 5).log, "HarvestBlighted").map((e) => e.tick), ofType(run({ seed: 5, content: sure }, B.checkDay + 5).log, "HarvestBlighted").map((e) => e.tick));
});

test("by default some years are blighted and some are not", () => {
  const n = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) => ofType(run({ seed }, B.checkDay + 2).log, "HarvestBlighted").length);
  assert.ok(n.some((x) => x === 1) && n.some((x) => x === 0), n.join(""));
});

test("a blighted year leaves the stores lower, and the merchant's grain eases it", () => {
  const stock = (c: typeof CONTENT) => Object.values(run({ seed: 2, policy: "passive", content: c }, B.checkDay + B.days).unsafeWorldForDebug().grain as Record<string, number>).reduce((a, b) => a + b, 0);
  const unmet = (c: typeof CONTENT) => Object.values(run({ seed: 2, policy: "passive", content: c }, B.checkDay + B.days).unsafeWorldForDebug().grainLedger as Record<string, { unmet: number }>).reduce((a, x) => a + x.unmet, 0);
  const calm = stock(never), bad = stock(sure);
  assert.ok(bad < calm - 100, `${bad} vs ${calm}`);
  const embargo = variant((r) => { r.scenario.grain!.blight = { ...r.scenario.grain!.blight!, chancePermille: 1000 }; const f = r.scenario.frontier!; f.court = { ...f.court, startStance: "press", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 2000 } }; });
  const open = variant((r) => { r.scenario.grain!.blight = { ...r.scenario.grain!.blight!, chancePermille: 1000 }; const f = r.scenario.frontier!; f.court = { ...f.court, startStance: "trade", thresholds: { tradeFrom: 0, pressFrom: 2000, strikeFrom: 2000 } }; });
  assert.ok(unmet(open) < unmet(embargo), "the grain that comes in while the court trades is what the embargo withholds: fewer go hungry");
});
