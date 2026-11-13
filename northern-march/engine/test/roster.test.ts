// Unit roster (D-067): a fort's men are foot, archers or horse. Men are raised as one kind from the fort's goods (iron for
// foot, timber for bows, iron and a horse for a rider), the battle draws its garrison formations from the roster, and the
// fort loses men of the kinds that fell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { initialState, loseMen } from "../src/world.ts";
import { buildSetup, personOf } from "../src/battlefield/setup.ts";
import { CONTENT, variant } from "./helpers.ts";

const M = CONTENT.scenario.manpower!;
const num = (x: unknown) => x as number;
const armed = () => variant((r) => {
  r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0;
  const f = r.scenario.goods!.places.find((p: any) => p.location === "northwatch")!; f.store.iron = 60; f.store.horses = 10; f.store.timber = 25;
});
function ordered(seed: number, action: PlayerAction, days = 30) {
  const sim = createSim({ content: armed(), seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= 5 * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const muster = (arm?: "foot" | "archers" | "horse"): PlayerAction => ({ action: "levy", muster: true, target: "northwatch", to: "northwatch", ...(arm ? { arm } : {}) });

test("roster: each fort starts with its usual share of bowmen and no riders", () => {
  const s = initialState(CONTENT), share = CONTENT.scenario.battle.forces!.garrison.find((g) => g.kind === "archers")!.sharePermille;
  for (const [id, f] of Object.entries(s.fortifications)) {
    assert.equal(f.archers, Math.floor((f.garrison * share) / 1000), id);
    assert.equal(f.horse, 0, id);
    assert.equal(f.estArchers, f.archers, id);
  }
});

test("roster: men raised as horse take iron and a horse each, and stand as horse", () => {
  const sim = ordered(2, muster("horse"));
  const c = sim.log.find((e) => e.type === "MusterCalled")!;
  assert.ok(c, "called");
  const men = num(c.payload.men);
  assert.ok(men > 0 && men <= 10, `no more riders than horses: ${men}`);
  assert.equal(c.payload.arm, "horse");
  const w = sim.unsafeWorldForDebug(), f = w.fortifications.northwatch;
  assert.equal(w.goodsLedger.horses.northwatch.used, men * M.arms!.horse.horses);
  assert.equal(w.goodsLedger.iron.northwatch.used, men * M.arms!.horse.iron);
  assert.ok(sim.log.some((e) => e.type === "MusterArrived"));
  assert.equal(f.horse, men);
  assert.equal(f.garrison, f.establishment + men);
});

test("roster: men raised as archers take timber for bows, not iron", () => {
  const sim = ordered(2, muster("archers"));
  const c = sim.log.find((e) => e.type === "MusterCalled")!, men = num(c.payload.men);
  const w = sim.unsafeWorldForDebug(), f = w.fortifications.northwatch;
  assert.ok(men > 0 && men <= 25, `${men}`);
  assert.equal(w.goodsLedger.timber.northwatch.used, men * M.arms!.archers.timber);
  assert.equal(w.goodsLedger.iron.northwatch.used, 0);
  assert.equal(f.archers, f.estArchers + men);
  assert.equal(f.horse, 0);
});

test("roster: with no horses at the fort a call for riders is abandoned, with the reason", () => {
  const c = variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; const f = r.scenario.goods!.places.find((p: any) => p.location === "northwatch")!; f.store.iron = 60; f.store.horses = 0; });
  const sim = createSim({ content: c, seed: 2, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < 20 * DAY; i++) { const p = sim.next(20 * DAY); if (!p.paused) break; if (!done && sim.tick >= 5 * DAY) { sim.answer([muster("horse")]); done = true; continue; } sim.answer([]); }
  assert.ok(sim.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "noHorses"));
  assert.ok(!sim.log.some((e) => e.type === "MusterCalled"));
});

test("roster: at the end of service the called men go home as their own kind", () => {
  const sim = ordered(2, muster("horse"), 5 + M.serviceDays + 10);
  const f = sim.unsafeWorldForDebug().fortifications.northwatch;
  assert.ok(sim.log.some((e) => e.type === "MusterEnded"));
  assert.equal(f.garrison, f.establishment);
  assert.equal(f.horse, 0, "the riders left");
  assert.equal(f.archers, f.estArchers, "the bowmen stayed");
});

test("roster: men lost go in their share unless the kinds are known; never more bowmen and riders than men", () => {
  const f = { conditionMilli: 0, lastChangeEvent: 0, garrison: 100, establishment: 100, archers: 30, horse: 20, estArchers: 30 };
  loseMen(f, 50);
  assert.deepEqual([f.garrison, f.archers, f.horse], [50, 15, 10]);
  loseMen(f, 10, { archers: 10 });
  assert.deepEqual([f.garrison, f.archers, f.horse], [40, 5, 10]);
  loseMen(f, 38, { archers: 0, horse: 0 });
  assert.ok(f.archers + f.horse <= f.garrison, `${f.archers}+${f.horse} <= ${f.garrison}`);
  loseMen(f, 999);
  assert.deepEqual([f.garrison, f.archers, f.horse], [0, 0, 0]);
});

const inputs = (garrison: { men: number; archers?: number; horse?: number }) => {
  const sc = CONTENT.scenario, b = sc.battle;
  return { battleId: 1, seed: 7, site: "s", place: "Northwatch", endT: 3600, weather: "clear" as const, field: b.field!, params: b.tactics!, forces: b.forces!, obedience: sc.agents.obedience,
    garrison: { ...garrison, castellan: personOf(CONTENT, "bren") }, companies: [], raiderMen: 200, ruler: { ...personOf(CONTENT, sc.ruler), present: false } };
};

test("roster: the battle's garrison formations follow the fort's roster", () => {
  const s = buildSetup(inputs({ men: 120, archers: 30, horse: 20 }));
  const crown = s.formations.filter((f) => f.side === "crown");
  const by = (k: string) => crown.filter((f) => f.kind === k).reduce((n, f) => n + f.men, 0);
  assert.deepEqual([by("foot"), by("archers"), by("horse")], [70, 30, 20]);
  const none = buildSetup(inputs({ men: 120, archers: 0, horse: 0 }));
  assert.ok(!none.formations.some((f) => f.side === "crown" && f.kind === "horse"), "no riders, no horse formation");
});

test("roster: without a roster the garrison splits by content shares as before", () => {
  const s = buildSetup(inputs({ men: 120 }));
  const crown = s.formations.filter((f) => f.side === "crown");
  assert.deepEqual(crown.map((f) => [f.kind, f.men]), [["foot", 84], ["archers", 36]]);
});

test("roster: a battle fields the fort's riders and the fort loses the kinds that fell", () => {
  const c = variant((r) => { for (const l of r.locations) if (l.fortification) l.fortification.horse = 20; });
  let checked = 0;
  for (let seed = 1; seed <= 12 && checked < 2; seed++) {
    const sim = createSim({ content: c, seed, policy: "aggressive" });
    sim.runDays(160);
    for (const b of sim.log.filter((e) => e.type === "BattleBegan")) {
      const setup = b.payload.setup as { formations: { id: string; side: string; kind: string; men: number; commander: string }[] };
      const sortie = sim.log.find((e) => e.type === "SortieResolved" && e.payload.battleId === b.payload.battleId);
      const ended = sim.log.find((e) => e.type === "BattleEnded" && e.payload.battleId === b.payload.battleId);
      if (!sortie || !ended) continue;
      const loss = sim.log.find((e) => e.type === "LossesTaken" && e.causedBy.includes(sortie.id));
      const horse = setup.formations.filter((f) => f.side === "crown" && f.kind === "horse" && !/'s /.test((f as any).label ?? ""));
      if (!loss?.payload.garrisonKinds || !horse.length) continue;
      const k = loss.payload.garrisonKinds as { archers: number; horse: number };
      assert.ok(k.horse + k.archers <= num(loss.payload.garrisonLost) + 0, "kinds lost are among the men lost");
      checked++;
    }
  }
  assert.ok(checked >= 1, "at least one battle with the fort's riders on the field");
});
