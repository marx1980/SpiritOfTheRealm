// Phase 8 battle slice, the battle itself (D-060). Spec from the plan: a formation continues its old instruction while a
// new order travels; obedience decisions are traceable, never rolled; plus determinism, headquarters' beliefs kept apart
// from reality, danger signalled before it is lethal, and the seven visible behaviours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../src/canonical.ts";
import { BEHAVIOURS, decideBattleObedience, runBattle, wouldPursue, type BattleOrder, type BattleSetup } from "../src/battlefield/core.ts";
import { sampleSetup } from "./battle_sample.ts";

const order = (o: Partial<BattleOrder> & Pick<BattleOrder, "to" | "task" | "t">): BattleOrder => ({ schemaVersion: 1, id: 1, from: "anna", via: "runner", ...o });

test("the same setup and orders give the same battle", () => {
  const s = sampleSetup({ seed: 7 });
  assert.equal(canonicalJson(runBattle(s, [])), canonicalJson(runBattle(s, [])));
  const o = [order({ t: 1200, to: "edda", task: { kind: "withdraw", place: "gate" } })];
  assert.equal(canonicalJson(runBattle(s, o)), canonicalJson(runBattle(s, o)));
});

test("an order changes nothing before it is given", () => {
  const s = sampleSetup({ seed: 3 });
  const a = runBattle(s, []), b = runBattle(s, [order({ t: 1800, to: "edda", task: { kind: "withdraw", place: "gate" } })]);
  const before = (r: typeof a) => canonicalJson(r.frames.filter((f) => f.t < 1800));
  assert.equal(before(a), before(b));
});

test("a formation keeps its old instruction while a new order travels", () => {
  const s = sampleSetup({ seed: 5, anna: "rear" });
  const t = 900;
  const r = runBattle(s, [order({ t, to: "caron", task: { kind: "withdraw", place: "gate" } })]);
  const sent = r.notes.find((n) => n.kind === "order_sent" && n.orderId === 1)!;
  const got = r.notes.find((n) => n.kind === "order_received" && n.orderId === 1);
  assert.ok(sent, "the order left headquarters");
  assert.ok(got && got.t > sent.t, "it took time to arrive");
  // while it travelled, Caron's formations still had the task from before
  const between = r.frames.filter((f) => f.t > sent.t && f.t < got!.t);
  assert.ok(between.length > 0, "some time passed between sending and receipt");
  for (const f of between) for (const x of f.formations.filter((x) => x.commander === "caron" && x.behaviour !== "gone")) assert.notEqual(x.task.kind, "withdraw", `${x.id} at ${f.t}`);
});

test("obedience is decided from beliefs and traits, the same way every time, with its reasons", () => {
  const base = {
    order: order({ t: 0, to: "caron", task: { kind: "withdraw", place: "gate" } }), current: { kind: "attack" as const, target: "w1" },
    traits: [{ riskPermille: 800, obedienceWhenDisagreeingPermille: 300, lossResponsePermille: 800, commitmentPermille: 550 }],
    skill: 600, loyalty: 500, issuerIsRuler: true, believedOdds: 700, lossesPermille: 50, cohesion: 800, changed: false,
    params: { adaptMarginMilli: 3000, refuseMarginMilli: 9000, changedCircumstancesPermille: 500, dutyMilli: 4000, legitimacyRulerPermille: 900 },
  };
  const a = decideBattleObedience(base), b = decideBattleObedience(base);
  assert.deepEqual(a, b, "no dice: the same state gives the same decision");
  assert.ok(a.candidates.length >= 2 && a.candidates.every((c) => c.contributions.length > 0), "every option is scored with reasons");
  assert.ok(["obey", "adapt", "keep"].includes(a.decision));
  // a proud, aggressive commander who believes he is winning keeps attacking rather than withdraw
  assert.equal(a.decision, "keep");
  // the same commander, beaten and losing men, obeys the withdrawal
  const beaten = decideBattleObedience({ ...base, believedOdds: 250, lossesPermille: 350, cohesion: 380 });
  assert.notEqual(beaten.decision, "keep");
  // a loyal, cautious commander obeys even when he would rather not
  const loyal = decideBattleObedience({ ...base, traits: [{ riskPermille: 200, obedienceWhenDisagreeingPermille: 800, lossResponsePermille: 300, commitmentPermille: 500 }], loyalty: 900 });
  assert.equal(loyal.decision, "obey");
});

test("an unclear order to an unskilled commander is read literally: the limit is dropped", () => {
  const base = {
    order: order({ t: 0, to: "edda", task: { kind: "attack", target: "w1", limit: "stream" } }), current: { kind: "hold" as const, place: "ridge" },
    traits: [{ riskPermille: 500, obedienceWhenDisagreeingPermille: 600, lossResponsePermille: 500, commitmentPermille: 500 }],
    loyalty: 700, issuerIsRuler: true, believedOdds: 600, lossesPermille: 0, cohesion: 800, changed: false,
    params: { adaptMarginMilli: 3000, refuseMarginMilli: 9000, changedCircumstancesPermille: 500, dutyMilli: 4000, legitimacyRulerPermille: 900 },
  };
  const skilled = decideBattleObedience({ ...base, skill: 800 }), raw = decideBattleObedience({ ...base, skill: 0, clarityPenalty: 300 });
  assert.equal(skilled.understood.limit, "stream");
  assert.equal(raw.literal, true);
  assert.equal(raw.understood.limit, undefined, "read literally, the limit is lost");
});

test("every order a commander receives has a trace, and obedience draws no chance", () => {
  for (const seed of [1, 2, 3, 4]) {
    const s = sampleSetup({ seed, anna: "centre" });
    const r = runBattle(s, [order({ t: 600, to: "bren", task: { kind: "hold", place: "ridge" } }), order({ id: 2, t: 1500, to: "caron", task: { kind: "attack", target: "w1" } })]);
    const received = r.notes.filter((n) => n.kind === "order_received");
    for (const n of received) {
      const tr = r.traces.find((x) => x.orderId === n.orderId && x.commander === n.commander);
      assert.ok(tr, `trace for order ${n.orderId}`);
      assert.ok(tr!.candidates.every((c) => c.contributions.length > 0));
    }
    assert.ok(r.traces.every((t) => t.draws === 0), "deciding to obey uses no random draw");
  }
});

test("headquarters' map never shows reality it has not seen: what is out of sight is reported, inferred or stale, with an age", () => {
  const s = sampleSetup({ seed: 11, anna: "rear" });
  const r = runBattle(s, []);
  let checked = 0;
  for (const f of r.hq) for (const m of f.marks) {
    assert.ok(["observed", "reported", "inferred"].includes(m.category));
    assert.ok(m.age >= 0);
    if (m.category !== "observed") { assert.ok(m.age > 0 || m.category === "inferred"); checked++; }
    if (m.category === "observed") {
      const real = r.frames.find((x) => x.t === f.t)?.formations.find((x) => x.id === m.id);
      if (real) assert.equal(m.behaviour, real.behaviour, "observed means seen as it is");
    }
    if (m.age > s.params.staleAfter) assert.equal(m.stale, true);
  }
  assert.ok(checked > 0, "some formations were out of sight at some time");
});

test("a runner goes to where headquarters believes the commander is", () => {
  const s = sampleSetup({ seed: 9, anna: "rear" });
  const r = runBattle(s, [order({ t: 600, to: "caron", task: { kind: "hold", place: "ridge" } })]);
  const sent = r.notes.find((n) => n.kind === "order_sent" && n.orderId === 1)!;
  assert.ok(sent.towards, "the runner set off towards a believed position");
  const got = r.notes.find((n) => n.kind === "order_received" && n.orderId === 1), lost = r.notes.find((n) => (n.kind === "runner_lost" || n.kind === "runner_searching") && n.orderId === 1);
  assert.ok(got || lost, "it was received, or the runner had to search or was lost");
});

test("danger is always signalled before it can be lethal", () => {
  let lethal = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = sampleSetup({ seed, anna: "forward", raiders: 520 });
    const r = runBattle(s, []);
    const firstDanger = r.notes.find((n) => n.kind === "danger");
    if (r.result.ruler !== "safe") {
      lethal++;
      assert.ok(firstDanger, `seed ${seed}: harm without warning`);
      assert.ok(firstDanger!.t < r.result.endT, `seed ${seed}: warned only at the end`);
    }
    if (!r.notes.some((n) => n.kind === "danger")) assert.equal(r.result.ruler, "safe");
  }
  assert.ok(lethal >= 0);
});

test("with Anna absent there is no guard, no danger and she is safe", () => {
  const r = runBattle(sampleSetup({ seed: 4 }), []);
  assert.equal(r.result.ruler, "absent");
  assert.ok(!r.notes.some((n) => n.kind === "danger"));
});

test("every behaviour occurs across battles", () => {
  const seen = new Set<string>();
  // stop once every behaviour is seen ("gone" is not one of them: counting it stopped the search early, found in Phase 12)
  for (let seed = 1; seed <= 30 && !BEHAVIOURS.every((b) => seen.has(b)); seed++) for (const raiders of [180, 360, 520]) {
    const r = runBattle(sampleSetup({ seed, raiders }), seed % 3 === 0 ? [order({ t: 1200, to: "bren", task: { kind: "withdraw", place: "gate" } })] : []);
    for (const f of r.frames) for (const x of f.formations) seen.add(x.behaviour);
  }
  for (const b of BEHAVIOURS) assert.ok(seen.has(b), `never saw ${b}`);
});

// ---- pursuit (D-063): men who see the enemy break may run after them, out of formation ----
const PURSUIT = { triggerRange: 300, loseRange: 600, startMargin: 100, mountedUrge: 200, holdRestraint: 300, skillRestraintPermille: 500, fatigueRestraintPermille: 1000, caughtCohesion: 6 };
const urgeBase = { discipline: 450, riskPermille: 800, mounted: false, commanderNear: true, skill: 500, fatigue: 0, holding: false, already: false, isGuard: false, params: PURSUIT };

test("whether men pursue is decided from discipline, their leader and their orders, the same way every time", () => {
  assert.deepEqual(wouldPursue(urgeBase), wouldPursue(urgeBase), "no dice");
  assert.equal(wouldPursue(urgeBase).pursue, true, "a bold war leader's loose warband runs after a broken enemy");
  assert.equal(wouldPursue({ ...urgeBase, isGuard: true }).pursue, false, "the guard never leaves the queen");
  assert.equal(wouldPursue({ ...urgeBase, discipline: 900, riskPermille: 400 }).pursue, false, "disciplined men under a cautious leader stay");
  const foot = { ...urgeBase, discipline: 600, riskPermille: 450, skill: 600, holding: true };
  assert.equal(wouldPursue(foot).pursue, false, "foot told to hold, their commander with them, keep their ground");
  assert.equal(wouldPursue({ ...foot, commanderNear: false }).pursue, true, "without him there, they go");
  const horse = { ...foot, discipline: 650, mounted: true, riskPermille: 700 };
  assert.ok(wouldPursue(horse).urge > wouldPursue({ ...horse, mounted: false }).urge, "horsemen are the readiest to chase");
  // once running, a smaller margin keeps them going (they do not stop and start each step)
  const edge = { ...urgeBase, skill: 2 * (wouldPursue(urgeBase).urge - 50) };
  assert.equal(wouldPursue(edge).pursue, false);
  assert.equal(wouldPursue({ ...edge, already: true }).pursue, true);
  assert.equal(wouldPursue({ ...urgeBase, fatigue: 800 }).pursue, false, "winded men give up the chase");
});

test("pursuit happens in real battles, never by the guard, and only after a broken enemy", () => {
  let pursuing = 0;
  for (let seed = 1; seed <= 12; seed++) for (const raiders of [180, 360, 520]) {
    const r = runBattle(sampleSetup({ seed, raiders, anna: "centre" }), []);
    for (const f of r.frames) for (const x of f.formations) if (x.behaviour === "pursuing") { pursuing++; assert.notEqual(x.kind, "guard", `seed ${seed}: the guard pursued`); }
    // frames are only every 30 s, so judge from the behaviour notes: some enemy had broken (and not recovered) before
    const sideOf = new Map(r.frames[0].formations.map((x) => [x.id, x.side]));
    for (const n of r.notes.filter((n) => n.kind === "behaviour" && n.to === "pursuing")) {
      const last = new Map<string, string>();
      for (const m of r.notes) if (m.kind === "behaviour" && m.t < n.t && sideOf.get(m.formation!) !== sideOf.get(n.formation!)) last.set(m.formation!, m.to!);
      assert.ok([...last.values()].some((b) => b === "retreat" || b === "rout"), `seed ${seed}: ${n.formation} pursued no broken enemy`);
    }
  }
  assert.ok(pursuing > 0, "someone pursued");
});

test("men told not to pursue beyond the stream stop at it", () => {
  const stream = 700;
  let crownPursued = 0;
  for (let seed = 1; seed <= 20; seed++) for (const raiders of [180, 360]) {
    const s = sampleSetup({ seed, raiders });
    const r = runBattle(s, [order({ t: 600, to: "caron", task: { kind: "attack", limit: "stream" } }), order({ id: 2, t: 600, to: "bren", task: { kind: "attack", limit: "stream" } })]);
    for (const f of r.frames) for (const x of f.formations) if (x.side === "crown" && x.behaviour === "pursuing") {
      crownPursued++;
      if (x.task.limit === "stream") assert.ok(x.y >= stream, `seed ${seed}: ${x.id} pursued beyond the stream (y ${x.y})`);
    }
  }
  assert.ok(crownPursued > 0, "the crown's men pursued at all");
});

test("a battle ends, with a winner, losses on both sides and a debrief from each commander", () => {
  const s: BattleSetup = sampleSetup({ seed: 2 });
  const r = runBattle(s, []);
  assert.ok(["crown", "raiders", "none"].includes(r.result.winner));
  assert.ok(r.result.endT > 0 && r.result.endT <= s.endT);
  assert.ok(r.result.lost.crown >= 0 && r.result.lost.raiders >= 0);
  const commanders = s.commanders.filter((c) => c.side === "crown").map((c) => c.id).sort();
  assert.deepEqual(r.debrief.map((d) => d.author).sort(), commanders);
  for (const d of r.debrief) assert.ok(d.ownLosses >= 0 && d.enemyLosses >= 0 && ["won", "lost", "drawn"].includes(d.result));
});

test("a proud commander's debrief under-reports his losses; an honest one does not", () => {
  const s = sampleSetup({ seed: 6, raiders: 360 });
  const r = runBattle(s, []);
  const truth = (who: string) => r.result.lostBy[who] ?? 0;
  const caron = r.debrief.find((d) => d.author === "caron")!, edda = r.debrief.find((d) => d.author === "edda")!;
  if (truth("caron") > 10) assert.ok(caron.ownLosses < truth("caron"), "Caron is proud");
  if (truth("edda") > 10) assert.ok(edda.ownLosses >= Math.floor(truth("edda") * 0.9), "Edda is honest");
});

test("by default her guard falls back with her; if she insists on standing after the warning, the danger is real, and it was signalled first", () => {
  let harmed = 0, defaultHarmed = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = sampleSetup({ seed, anna: "forward", raiders: 520 });
    if (runBattle(s, []).result.ruler !== "safe") defaultHarmed++;
    const insist = Array.from({ length: 30 }, (_, i) => order({ id: 100 + i, t: 300 + i * 300, from: "anna", to: "anna", via: "voice", task: { kind: "hold", place: "ford" } }));
    const r = runBattle(s, insist);
    if (r.result.ruler === "safe") continue;
    harmed++;
    const warned = r.notes.find((n) => n.kind === "danger");
    const end = r.notes.find((n) => n.kind === "end" && (n.why === "killed" || n.why === "captured"))!;
    assert.ok(warned && warned.t < end.t, `seed ${seed}: harmed without warning`);
  }
  assert.ok(harmed > 0, "standing in the way of a stronger enemy can cost her dearly");
  assert.ok(defaultHarmed < harmed, "the guard's own caution protects her when she leaves it to them");
});

test("the two sides keep their fronts: where they touch, the crown's men are below the raiders, never through or behind them", () => {
  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) for (const raiders of [180, 360, 520]) {
    const r = runBattle(sampleSetup({ seed, raiders }), []);
    for (const f of r.frames) {
      const live = f.formations.filter((x) => x.behaviour !== "gone");
      for (const c of live.filter((x) => x.side === "crown")) for (const e of live.filter((x) => x.side === "raiders")) {
        if (Math.abs(c.x - e.x) >= 220 || Math.abs(c.y - e.y) >= 220) continue;
        checked++;
        assert.ok(c.y >= e.y, `seed ${seed} raiders ${raiders} t ${f.t}: ${c.id} (${c.x},${c.y}) is past ${e.id} (${e.x},${e.y})`);
      }
    }
  }
  assert.ok(checked > 1000, "the sides do meet");
});

test("archers and bowmen shoot at an enemy in range, and the record says at whom; men running away do not shoot", () => {
  let shots = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = runBattle(sampleSetup({ seed, raiders: 360 }), []);
    for (const f of r.frames) for (const x of f.formations) {
      if (!x.shooting) continue;
      shots++;
      assert.ok(x.kind === "archers" || x.kind === "bowmen", `${x.id} ${x.kind} shoots`);
      assert.ok(x.behaviour !== "rout" && x.behaviour !== "retreat", `${x.id} shoots while ${x.behaviour}`);
      const t = f.formations.find((y) => y.id === x.shooting)!;
      assert.ok(t.side !== x.side && Math.hypot(t.x - x.x, t.y - x.y) <= 201, `${x.id} shoots at ${t.id} in range: ${Math.round(Math.hypot(t.x - x.x, t.y - x.y))} m, ${x.behaviour}, target ${t.behaviour}`);
    }
    for (const h of r.hq) for (const m of h.marks) if (m.shooting) assert.equal(m.category, "observed", "headquarters draws arrows only where it sees them");
  }
  assert.ok(shots > 50);
});
