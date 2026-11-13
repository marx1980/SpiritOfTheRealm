// D-068: when a sortie means a battle, a commander judges his chances from the battle, not from the old roll. Checked on
// TUNE seeds against battles fought out with the same setup the campaign builds; no ambush here, so the check compares
// the estimate without its ambush term.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortieP } from "../src/agents/terms.ts";
import { buildSetup, personOf } from "../src/battlefield/setup.ts";
import { runBattle } from "../src/battlefield/core.ts";
import { battleLoss } from "../src/battle.ts";
import { CONTENT } from "./helpers.ts";

const sc = CONTENT.scenario, b = sc.battle;
const noAmbush = { ...b, sortie: { ...b.sortie, ambushPermilleAtFull: 0 } };
const old = { ...b, sortie: { ...b.sortie, estimate: undefined } };
const sit = (battle: typeof b) => ({ p: { battle } }) as any;
const intensityOf = (raiders: number) => Math.floor((raiders * 1000) / b.sortie.raiderMenAtFull);

function fought(men: number, raiders: number, seed: number) {
  const s = buildSetup({ battleId: seed, seed: seed * 104729 + men * 31 + raiders, site: "s", place: "Fort", endT: 6 * 3600, weather: "clear", field: b.field!, params: b.tactics!, forces: b.forces!, obedience: sc.agents.obedience,
    garrison: { men, archers: Math.floor((men * 300) / 1000), horse: 0, castellan: personOf(CONTENT, "bren") }, companies: [], raiderMen: raiders, ruler: { ...personOf(CONTENT, sc.ruler), present: false } });
  return runBattle(s, s.plan).result;
}

test("sortie estimate: closer to the battle's results than the old roll's estimate", () => {
  const skill = CONTENT.byId.character.get("bren")!.capabilities.military ?? 0;
  let errNew = 0, errOld = 0, cells = 0;
  for (const men of [80, 140, 220]) for (const raiders of [100, 200, 320]) {
    let won = 0;
    const n = 6;
    for (let seed = 1; seed <= n; seed++) if (fought(men, raiders, seed).winner === "crown") won++;
    const truth = (1000 * won) / n, I = intensityOf(raiders);
    errNew += Math.abs(sortieP(sit(noAmbush), men, skill, I) - truth);
    errOld += Math.abs(sortieP(sit(old), men, skill, I) - truth);
    cells++;
  }
  assert.ok(errNew < errOld, `mean error ${Math.round(errNew / cells)} against the old ${Math.round(errOld / cells)} (per mille)`);
});

test("sortie estimate: the larger side is expected to win, and the chance of a second band lowers the odds", () => {
  const I = intensityOf(200);
  assert.ok(sortieP(sit(noAmbush), 400, 500, I) > 900);
  assert.ok(sortieP(sit(noAmbush), 100, 500, I) < 100);
  assert.ok(sortieP(sit(b), 250, 500, I) < sortieP(sit(noAmbush), 250, 500, I));
  assert.equal(sortieP(sit(b), 100, 500, 0), 1000, "nobody there");
});

test("sortie estimate: expected losses use the battles' rates when battles are fought, the old rates when they are not", () => {
  const noField = { ...b, field: undefined };
  assert.ok(battleLoss(b, 200, 200, true) > battleLoss(noField as any, 200, 200, true));
  assert.equal(battleLoss(b, 200, 200, true), Math.floor((200 * b.sortie.estimate!.lossOnWinPermille * 500) / (500 * 1000)));
});
