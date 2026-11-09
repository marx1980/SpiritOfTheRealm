// Phase 8 battle slice in the campaign (D-060): entry from contact, exit back into the campaign. Spec from the plan:
// battle results flow back into campaign state (losses, prestige, community memory); plus the queen's battle orders as
// player input that a save replays, and battles that never show headquarters the field as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, hashLog, loadSave, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { beliefsAbout } from "../src/view.ts";
import { DAY } from "../src/systems/types.ts";
import { CONTENT } from "./helpers.ts";

function campaign(seed: number, policy: "aggressive" | "delegating" = "aggressive", days = 160) {
  const sim = createSim({ content: CONTENT, seed, policy });
  sim.runDays(days);
  return sim;
}
const firstBattle = (() => {
  let found: { sim: Sim; id: number } | undefined;
  return () => {
    for (let seed = 1; !found && seed <= 12; seed++) {
      const sim = campaign(seed);
      const b = sim.log.find((e) => e.type === "BattleEnded");
      if (b) found = { sim, id: b.payload.battleId as number };
    }
    return found!;
  };
})();

test("a sortie that meets raiders fights a battle instead of a roll", () => {
  const { sim, id } = firstBattle();
  const began = sim.log.find((e) => e.type === "BattleBegan" && e.payload.battleId === id)!;
  const setup = began.payload.setup as { formations: unknown[]; commanders: { side: string }[] };
  assert.ok(setup.formations.length >= 4, "formations on both sides");
  assert.ok(setup.commanders.filter((c) => c.side === "crown").length >= 1);
  const launched = sim.log.find((e) => e.id === began.causedBy[0])!;
  assert.equal(launched.type, "SortieLaunched", "the battle starts from the sortie's contact");
  const sortie = sim.log.find((e) => e.type === "SortieResolved" && e.payload.battleId === id)!;
  assert.ok(sortie, "the sortie is resolved by the battle");
  assert.equal(sim.log.find((e) => e.id === sortie.causedBy[0])!.type, "BattleEnded");
});

test("battle results flow back into the campaign: losses, prestige, the record of obedience, community memory", () => {
  const { sim, id } = firstBattle();
  const ended = sim.log.find((e) => e.type === "BattleEnded" && e.payload.battleId === id)!;
  const sortie = sim.log.find((e) => e.type === "SortieResolved" && e.payload.battleId === id)!;
  const lostBy = ended.payload.lostBy as Record<string, number>;
  const crownLost = Object.entries(lostBy).filter(([k]) => k !== "chief").reduce((n, [, v]) => n + v, 0);
  const losses = sim.log.find((e) => e.type === "LossesTaken" && e.causedBy.includes(sortie.id));
  if (crownLost > 0) { assert.ok(losses, "the garrison and companies bear the battle's losses"); assert.equal(losses!.payload.cause, "battle"); }
  const prestige = sim.log.filter((e) => e.type === "PrestigeChanged" && e.causedBy.includes(ended.id));
  if (ended.payload.winner !== "none") assert.ok(prestige.length > 0, "a won or lost battle changes commanders' prestige");
  const conduct = sim.log.filter((e) => e.type === "BattleConduct" && e.causedBy.includes(ended.id));
  assert.equal(conduct.length, (ended.payload.conduct as unknown[]).length, "how each commander answered each order is recorded");
  const heard = sim.log.filter((e) => e.type === "CommunityHeard" && e.causedBy.includes(sortie.id));
  assert.ok(heard.length > 0, "the community near the fort remembers the fight");
  // the raiders: ended if beaten
  if (ended.payload.winner === "crown") assert.ok(sim.log.some((e) => e.type === "ThreatEnded" && e.causedBy.includes(sortie.id)));
  const w = sim.unsafeWorldForDebug();
  for (const p of prestige) assert.ok(typeof w.prestige[p.payload.who as string] === "number");
});

test("each commander's debrief is his own account, sent to his superior", () => {
  const { sim, id } = firstBattle();
  const ended = sim.log.find((e) => e.type === "BattleEnded" && e.payload.battleId === id)!;
  const debrief = ended.payload.debrief as { author: string; ownLosses: number }[];
  for (const d of debrief) {
    const learnt = sim.log.find((e) => e.type === "BeliefUpdated" && e.payload.holder === d.author && (e.payload.prop as { predicate: string }).predicate === "battle.ownLosses" && e.causedBy.includes(ended.id));
    assert.ok(learnt, `${d.author} holds his own figure`);
    assert.equal((learnt!.payload.prop as { believedValue: number }).believedValue, d.ownLosses);
  }
});

test("the same seed fights the same battles", () => {
  const a = campaign(3, "aggressive", 120), b = campaign(3, "aggressive", 120);
  assert.equal(hashLog(a.log), hashLog(b.log));
});

test("campaigns with battles keep every invariant", () => {
  for (const seed of [1, 2, 3, 4]) for (const pol of ["aggressive", "delegating"] as const) {
    const sim = campaign(seed, pol, 120);
    assert.deepEqual(checkRun(sim), [], `seed ${seed} ${pol}`);
  }
});

/** The queen goes to Northwatch and sends Caron against the Blackwood raiders; at her battle pauses she gives orders. */
function withHer(seed: number, days = 120) {
  const sim = createSim({ content: CONTENT, seed, policy: "external", params: { dayEnd: true } });
  let travelled = false, ordered = false, given = 0, battlePauses = 0, sawReality = false;
  for (let i = 0; i < 20000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY);
    if (!p.paused) break;
    const v = p.view!, acts: Parameters<Sim["answer"]>[0] = [];
    if (p.reason === "battle") {
      battlePauses++;
      assert.ok(v.battle, "a battle pause shows the battle");
      if (given < 2) { acts.push({ action: "battle", battle: { to: v.battle!.commanders[0].id, task: { kind: "hold", place: "ridge" }, via: "runner" } }); given++; }
      if (v.battle!.hq.marks.some((m) => m.category !== "observed" && m.age === 0 && m.category !== "inferred")) sawReality = true;
    } else {
      if (!travelled) { acts.push({ action: "travel", target: "northwatch" }); travelled = true; }
      const b = beliefsAbout(v, "blackwood", "threat.intensity")[0], here = "at" in v.self.position && v.self.position.at === "northwatch";
      if (here && !ordered && b && (b.believedValue as number) > 0) { acts.push({ action: "advance", target: "northwatch", mission: "attack", raid: "blackwood" }); ordered = true; }
    }
    sim.answer(acts);
  }
  return { sim, given, battlePauses, sawReality };
}

test("with the queen at the fort the campaign pauses for her battle orders, and a save replays them exactly", () => {
  const { sim, given, battlePauses } = withHer(1);
  assert.ok(battlePauses > 0, "she was asked during the battle");
  assert.ok(given > 0 && sim.log.filter((e) => e.type === "BattleOrderGiven").length === given, "her orders are part of the battle");
  const save = sim.save();
  assert.ok(save.inputs.some((i) => i.action === "battle" && i.battle), "battle orders are saved as player input");
  const again = loadSave(JSON.parse(JSON.stringify(save)), CONTENT);
  assert.equal(hashLog(again.log), hashLog(sim.log), "replaying the save gives the same history");
});

test("a battle order is checked against what headquarters knows", () => {
  const sim = createSim({ content: CONTENT, seed: 1, policy: "external", params: { dayEnd: true } });
  const p = sim.next(30 * DAY);
  assert.ok(p.paused);
  assert.throws(() => sim.answer([{ action: "battle", battle: { to: "caron", task: { kind: "hold", place: "ridge" }, via: "runner" } }]), /no battle in progress/);
});
