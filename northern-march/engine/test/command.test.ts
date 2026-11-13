// Phase 12, the full battlefield (docs/COMMAND.md). Spec from the plan: full command hierarchy, line of sight and
// occlusion, observed/reported/inferred/stale markers, signals, panic propagation and rout, local adaptation and
// deliberate disobedience, commander incapacitation and local succession, sector delegation, recorded disobedience
// outcomes. Written before the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../src/canonical.ts";
import { deadGroundBlocks, decideReview, judgeDisobedience, lightPermille, planSector, runBattle, type BattleOrder, type BattleRecord, type BattleSetup } from "../src/battlefield/core.ts";
import { validateBattleDraft } from "../src/view.ts";
import { armySetup, labContent } from "./battle_army.ts";
import { sampleSetup } from "./battle_sample.ts";

const order = (o: Partial<BattleOrder> & Pick<BattleOrder, "to" | "task" | "t">): BattleOrder => ({ schemaVersion: 1, id: 501, from: "anna", via: "runner", ...o });
const runs = new Map<string, BattleRecord>();
const army = (seed: number, plan: "hold" | "delegate" | "attack" = "delegate", extra: (s: BattleSetup) => void = () => {}) => {
  const key = `${seed}:${plan}:${extra.toString()}`;
  if (!runs.has(key)) { const s = armySetup({ seed, plan }); extra(s); runs.set(key, runBattle(s, [])); }
  return runs.get(key)!;
};
const full = () => labContent().scenario.battle.tactics!.full!;

test("content: six signals, four standard and two agreed before the fight; the full battlefield is switched on", () => {
  const b = labContent().scenario.battle;
  assert.equal(b.forces!.signals.length, 6);
  assert.equal(b.forces!.signals.filter((s) => s.standard).length, 4);
  assert.ok(b.tactics!.full, "tactics.full present");
});

test("without tactics.full nothing of Phase 12 happens", () => {
  for (const seed of [1, 2, 3]) {
    const s = sampleSetup({ seed, anna: "centre", raiders: 520 });
    s.params = structuredClone(s.params); // the content's own object is shared
    delete s.params.full;
    const r = runBattle(s, []);
    for (const k of ["review", "commander_fell", "succession", "fall_known", "signal_seen", "rally", "sector_plan"]) assert.ok(!r.notes.some((n) => n.kind === k), `${k} without full`);
    assert.ok(!r.result.fallen?.length && !r.result.disobedience?.length);
  }
});

test("the lab army: three wings, about 15 formations a side, a deputy for each wing commander", () => {
  const s = armySetup({ seed: 1 });
  const crown = s.formations.filter((f) => f.side === "crown"), raiders = s.formations.filter((f) => f.side === "raiders");
  assert.ok(crown.length >= 13 && crown.length <= 16, `crown ${crown.length}`);
  assert.ok(raiders.length >= 12 && raiders.length <= 16, `raiders ${raiders.length}`);
  for (const lead of ["caron", "elara", "varos"]) {
    const c = s.commanders.find((x) => x.id === lead)!;
    assert.equal(c.superior, undefined, "a wing commander answers to headquarters");
    assert.ok(c.deputy, `${lead} has a deputy`);
  }
  assert.equal(s.commanders.find((x) => x.id === "rurik")!.superior, "varos");
});

test("the same setup and orders give the same full battle", () => {
  const s = armySetup({ seed: 4, plan: "delegate" });
  assert.equal(canonicalJson(runBattle(s, [])), canonicalJson(runBattle(s, [])));
});

test("hierarchy: reports go up the chain; headquarters hears from a subordinate only through his superior", () => {
  for (const seed of [1, 2, 3]) {
    const s = armySetup({ seed });
    const r = army(seed);
    const sup = new Map(s.commanders.map((c) => [c.id, c.superior]));
    const sent = r.notes.filter((n) => n.kind === "report_sent");
    assert.ok(sent.some((n) => n.from === "rurik" && n.to === "varos"), "Rurik reports to Varos");
    // a report reaching headquarters comes from a commander with no superior, or whose superior had fallen
    const fell = new Map((r.result.fallen ?? []).map((f) => [f.commander, f.t]));
    for (const n of r.notes.filter((n) => n.kind === "report_received" && n.to === s.hq)) {
      const up = sup.get(n.from!);
      assert.ok(!up || up === s.hq || (fell.has(up) && fell.get(up)! <= n.t), `seed ${seed}: ${n.from} reported straight to headquarters at ${n.t}`);
    }
  }
});

test("sector delegation: the planner follows the commander's skill and temperament", () => {
  const subs = [{ id: "a", kinds: ["foot" as const] }, { id: "b", kinds: ["archers" as const] }, { id: "h", kinds: ["horse" as const] }];
  const task = { kind: "hold" as const, place: "ridge" };
  const p = full().sector!;
  const cautious = [{ riskPermille: 250, obedienceWhenDisagreeingPermille: 600, lossResponsePermille: 500, commitmentPermille: 500 }];
  const bold = [{ riskPermille: 850, obedienceWhenDisagreeingPermille: 400, lossResponsePermille: 300, commitmentPermille: 600 }];
  const capable = planSector({ skill: 800, traits: cautious, task, subs, params: p });
  assert.deepEqual(capable, planSector({ skill: 800, traits: cautious, task, subs, params: p }), "pure");
  assert.equal(capable.find((x) => x.to === "a")!.task.place, "ridge");
  const reserve = capable.find((x) => x.to === "h")!.task;
  assert.ok(reserve.when, "a capable commander keeps the horse back as a reserve with a contingency");
  const brave = planSector({ skill: 800, traits: bold, task, subs, params: p });
  assert.equal(brave.find((x) => x.to === "h")!.task.kind, "attack", "a bold one sends the horse in");
  const poor = planSector({ skill: 300, traits: cautious, task, subs, params: p });
  for (const x of poor) { assert.equal(x.task.kind, "hold"); assert.equal(x.task.when, undefined, "an unskilled one gives everyone the same order, no contingency"); }
});

test("sector delegation in battle: a wing commander's orders travel and his men decide on them", () => {
  const r = army(2, "delegate");
  const planned = r.notes.filter((n) => n.kind === "sector_plan");
  assert.ok(planned.some((n) => n.commander === "elara"), "Elara planned for the centre");
  const fromWing = r.traces.filter((t) => t.issuer === "elara");
  assert.ok(fromWing.length >= 1, "her subordinates decided on her orders");
  assert.ok(fromWing.every((t) => t.draws === 0));
});

test("dead ground: the ford cannot be seen from the gate over the ridge, but can from the ridge", () => {
  const f = labContent().scenario.battle.field!, g = full().deadGround!;
  const gate = f.places.find((p) => p.id === "gate")!, ford = f.places.find((p) => p.id === "ford")!, ridge = f.places.find((p) => p.id === "ridge")!, camp = f.places.find((p) => p.id === "camp")!;
  assert.equal(deadGroundBlocks(f, g, gate.x, gate.y, ford.x, ford.y), true);
  assert.equal(deadGroundBlocks(f, g, ridge.x, ridge.y, ford.x, ford.y), false);
  assert.equal(deadGroundBlocks(f, g, gate.x, gate.y, camp.x, camp.y), false, "far beyond the crest is not dead ground");
  assert.equal(deadGroundBlocks(f, g, gate.x, gate.y, ridge.x, ridge.y), false, "the crest itself is seen");
});

test("failing light: sight falls over the last stretch before nightfall, not before", () => {
  const d = full().dusk!;
  assert.equal(lightPermille(0, 10000, d, true), 1000);
  assert.equal(lightPermille(10000 - d.lastSeconds - 1, 10000, d, true), 1000);
  assert.ok(lightPermille(10000 - Math.floor(d.lastSeconds / 2), 10000, d, true) < 1000);
  assert.equal(lightPermille(10000, 10000, d, true), d.sightPermille);
  assert.equal(lightPermille(9999, 10000, d, false), 1000, "a battle stopped by the cap is not at dusk");
});

test("headquarters infers where an enemy it lost sight of has gone, from its own sightings only", () => {
  let inferred = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = armySetup({ seed, plan: "hold" });
    const r = army(seed, "hold");
    const own = new Map<string, number>();
    for (const h of r.hq) for (const m of h.marks) {
      if (m.side !== "raiders") continue;
      if (m.category === "inferred") {
        inferred++;
        assert.equal(m.source, s.hq, "inferred from headquarters' own sighting, not a report");
        assert.ok(own.has(m.id) && own.get(m.id)! < h.t, `seed ${seed}: ${m.id} inferred at ${h.t} without having been seen`);
        assert.ok(m.age <= full().inferEnemy!.maxSeconds && m.age >= full().inferEnemy!.after);
      } else if (m.source === s.hq && !own.has(m.id)) own.set(m.id, h.t - m.age);
    }
  }
  assert.ok(inferred > 0, "some enemy was inferred");
});

test("observed marks are reality; the network shows a commander fallen only after headquarters saw it or heard of it", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = army(seed, "attack");
    for (const h of r.hq) {
      const real = r.frames.find((x) => x.t === h.t);
      for (const m of h.marks.filter((m) => m.category === "observed")) { const f = real?.formations.find((x) => x.id === m.id); if (f) assert.equal(m.behaviour, f.behaviour); }
      for (const row of h.network.filter((n) => n.state === "fallen")) {
        const known = r.notes.find((n) => n.kind === "fall_known" && n.commander === row.commander);
        assert.ok(known && known.t <= h.t, `seed ${seed}: ${row.commander} shown fallen at ${h.t} before headquarters knew`);
      }
    }
  }
});

test("signals: a custom signal agreed before the fight may be ordered; the enemy reads the standard ones, not the custom", () => {
  const b = labContent().scenario.battle;
  const custom = b.forces!.signals.find((s) => !s.standard)!;
  const v = { battle: { t: 0, ended: undefined, commanders: [{ id: "caron" }], field: b.field, hq: { marks: [] }, signals: b.forces!.signals }, self: { id: "anna" } } as never;
  assert.deepEqual(validateBattleDraft(v, { to: "caron", task: custom.task, via: "signal", signal: custom.id }), []);
  let understood = 0, notUnderstood = 0;
  for (let seed = 1; seed <= 10; seed++) for (const sig of ["withdraw", custom.id]) {
    const s = sampleSetup({ seed, anna: "forward", raiders: 360 });
    const task = b.forces!.signals.find((x) => x.id === sig)!.task;
    const r = runBattle(s, [order({ t: 900, to: "caron", task, via: "signal", signal: sig })]);
    for (const n of r.notes.filter((n) => n.kind === "signal_seen")) { if (n.text === "understood") understood++; else notUnderstood++; }
  }
  assert.ok(understood > 0, "the enemy understood a standard signal at least once");
  assert.ok(notUnderstood > 0, "and saw a custom one without understanding it");
});

test("local adaptation and deliberate disobedience: decided by scores, never rolled", () => {
  const base = {
    order: { kind: "hold" as const, place: "ridge" }, current: { kind: "hold" as const, place: "ridge" }, alternatives: [{ kind: "attack" as const }, { kind: "withdraw" as const, place: "gate" }],
    traits: [{ riskPermille: 850, obedienceWhenDisagreeingPermille: 250, lossResponsePermille: 300, commitmentPermille: 500 }],
    skill: 700, loyalty: 300, issuerIsRuler: true, believedOdds: 850, lossesPermille: 20, cohesion: 850,
    params: labContent().scenario.agents.obedience,
  };
  const a = decideReview(base), b = decideReview(base);
  assert.deepEqual(a, b, "no dice");
  assert.equal(a.decision, "defy", "a proud, bold commander who believes the enemy is beaten attacks against an order to hold");
  assert.equal(a.chosen.kind, "attack");
  assert.ok(a.candidates.every((c) => c.contributions.length > 0));
  const loyal = decideReview({ ...base, traits: [{ riskPermille: 300, obedienceWhenDisagreeingPermille: 800, lossResponsePermille: 500, commitmentPermille: 500 }], loyalty: 900 });
  assert.equal(loyal.decision, "obey", "a loyal, cautious one stays with his order");
  // once he has gone his own way, his commitment to it keeps him there at the same beliefs
  const after = decideReview({ ...base, current: a.chosen });
  assert.equal(after.decision, "defy");
});

test("in battle, every review that changes what a commander does is a trace with its reasons and no draw", () => {
  let defied = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const plan of ["hold", "attack"] as const) {
    const r = army(seed, plan);
    const reviews = r.traces.filter((t) => t.trigger === "review");
    for (const t of reviews) { assert.equal(t.draws, 0); assert.ok(t.candidates.every((c) => c.contributions.length > 0)); assert.ok(["adapt", "defy", "obey"].includes(t.decision)); }
    defied += reviews.filter((t) => t.decision === "defy").length;
    for (const n of r.notes.filter((n) => n.kind === "review")) assert.ok(reviews.some((t) => t.commander === n.commander && t.t === n.t), "a review note has its trace");
  }
  assert.ok(defied > 0, "some commander went against his order somewhere");
});

test("commanders fall only in contact; a deputy or superior takes over; the men keep their last instruction until then", () => {
  let falls = 0, successions = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = armySetup({ seed, plan: "attack" });
    const r = army(seed, "attack");
    for (const f of r.result.fallen ?? []) {
      falls++;
      assert.ok(f.why === "melee" || f.why === "missile", "only fighting or arrows harm a commander");
      assert.ok(f.fate === "wounded" || f.fate === "killed");
      const c = s.commanders.find((x) => x.id === f.commander)!;
      const heir = c.deputy ?? c.superior;
      const succ = r.notes.find((n) => n.kind === "succession" && n.from === f.commander);
      if (succ) {
        successions++;
        assert.ok(succ.t >= f.t, "succession follows the fall");
        assert.ok(succ.to === c.deputy || succ.to === c.superior, "by the pre-set order of command");
        // between the fall and the succession his men kept the task they had
        const before = r.frames.filter((x) => x.t <= f.t).pop();
        for (const fr of r.frames.filter((x) => x.t > f.t && x.t < succ.t)) for (const x of fr.formations.filter((y) => c.formations.includes(y.id) && y.behaviour !== "gone")) {
          const was = before?.formations.find((y) => y.id === x.id);
          if (was && was.behaviour !== "gone") assert.equal(x.task.kind, was.task.kind, `seed ${seed}: ${x.id} changed task while leaderless`);
        }
      } else if (heir) assert.ok(r.result.endT - f.t < 1800 || !s.commanders.some((x) => x.id === heir), `seed ${seed}: no succession for ${f.commander}`);
    }
  }
  assert.ok(falls > 0, "commanders do fall in hard fighting");
  assert.ok(successions > 0);
});

test("recorded disobedience outcomes: each departure is judged against the same battle with that decision obeyed", () => {
  let judged = 0;
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3, 4]) for (const plan of ["hold", "attack"] as const) {
    const s = armySetup({ seed, plan });
    const r = army(seed, plan);
    for (const d of r.result.disobedience ?? []) {
      judged++;
      kinds.add(d.outcome);
      assert.ok(["saved", "ruined", "no_difference"].includes(d.outcome));
      // the counterfactual is exact: replaying with that decision forced gives the recorded alternative
      const cf = runBattle(s, [], { force: [{ commander: d.commander, t: d.t, trigger: d.trigger }], judge: false });
      assert.equal(cf.result.winner, d.winnerIf);
      assert.equal(cf.result.lost.crown, d.crownLostIf);
    }
    // judging does not change the battle itself
    const again = judgeDisobedience(s, [], runBattle(s, [], { judge: false }));
    assert.equal(canonicalJson(again.frames), canonicalJson(r.frames));
  }
  assert.ok(judged > 0, "there was something to judge");
  assert.ok(kinds.size >= 2, "more than one kind of outcome");
});

test("panic spreads by sight: with it, more breaks follow a friend breaking out of earshot but in view", () => {
  // the share of breaks (retreat or rout) that come within 120 s of a break of a friend 400-1000 m away
  const chained = (r: BattleRecord) => {
    const side = new Map(r.frames[0].formations.map((f) => [f.id, f.side]));
    const br = r.notes.filter((x) => x.kind === "behaviour" && (x.to === "rout" || x.to === "retreat")).map((x) => ({ t: x.t, f: x.formation! }));
    const pos = (id: string, t: number) => [...r.frames].reverse().find((x) => x.t <= t)!.formations.find((y) => y.id === id)!;
    let n = 0;
    for (const b of br) { const me = pos(b.f, b.t); if (br.some((a) => a.f !== b.f && side.get(a.f) === side.get(b.f) && a.t < b.t && a.t >= b.t - 120 && (() => { const o = pos(a.f, b.t), d = Math.hypot(o.x - me.x, o.y - me.y); return d > 400 && d <= 1000; })())) n++; }
    return [n, br.length];
  };
  const on = [0, 0], off = [0, 0];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const a = chained(army(seed, "attack")), b = chained(army(seed, "attack", (s) => { delete s.params.full!.contagion; }));
    on[0] += a[0]; on[1] += a[1]; off[0] += b[0]; off[1] += b[1];
  }
  assert.ok(on[0] * off[1] > off[0] * on[1], `chained breaks with contagion ${on[0]}/${on[1]}, without ${off[0]}/${off[1]}`);
});

test("campaign: a commander who falls in battle is recorded; the dead decide nothing more; a dead captain's men go back to the fort", async () => {
  const { createSim } = await import("../src/engine.ts");
  const { checkRun } = await import("../src/invariants.ts");
  const { variant } = await import("./helpers.ts");
  // commanders made easy to hit, so that a fall comes soon on a TUNE seed
  const c = variant((r) => { const h = r.scenario.battle.tactics!.full!.hazard!; h.meleePerMyriad = 400; h.missilePerMyriad = 100; h.killedPermille = 700; });
  let killed = 0;
  for (let seed = 1; seed <= 6 && killed === 0; seed++) {
    const sim = createSim({ content: c, seed, policy: "aggressive" });
    sim.runDays(120);
    assert.deepEqual(checkRun(sim), [], `seed ${seed}: invariants`);
    for (const e of sim.log.filter((e) => e.type === "CommanderFell")) {
      const who = e.payload.who as string;
      const ended = sim.log.find((x) => x.id === e.causedBy[0])!;
      assert.equal(ended.type, "BattleEnded", "the fall comes from a battle");
      const w = sim.unsafeWorldForDebug();
      const last = sim.log.filter((x) => x.type === "CommanderFell" && x.payload.who === who).pop()!;
      assert.equal(w.commandersFallen[who].fate, last.payload.fate, "the world holds his latest fate");
      assert.ok(!sim.log.some((x) => x.id > e.id && x.type === "BattleBegan" && e.payload.fate === "killed" && (x.payload.setup as { commanders: { id: string }[] }).commanders.some((k) => k.id === who)), "the dead fight no more battles");
      if (e.payload.fate !== "killed") continue;
      killed++;
      assert.ok(!sim.log.some((x) => x.id > e.id && x.type === "DecisionMade" && (x.subjects as { id: string }[])[0]?.id === who), `${who} decided something after death`);
      assert.equal(w.troops[who] ?? 0, 0, "a dead captain leads no men");
    }
  }
  assert.ok(killed > 0, "a commander was killed somewhere");
});

test("when the whole line of command falls before word reaches the heir, the battle records that no one was left to take over", () => {
  // the shape found by G-20 on its sealed block (D-078): a commander falls, his heir falls before the succession is due, and
  // no one else in either line is alive. Built here with a much higher hazard so the shape turns up on TUNE seeds.
  let chains = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const s = armySetup({ seed, plan: "attack" });
    s.params.full!.hazard!.meleePerMyriad *= 40; s.params.full!.hazard!.missilePerMyriad *= 40;
    const r = runBattle(s, []), fallen = r.result.fallen ?? [];
    const fellBy = (id: string | undefined, t: number) => !!id && fallen.some((g) => g.commander === id && g.t <= t);
    for (const f of fallen) {
      const c = s.commanders.find((x) => x.id === f.commander)!;
      const heirs = [c.deputy, c.superior].filter((x): x is string => !!x && !fellBy(x, f.t));
      if (!heirs.length || r.result.endT - f.t < 1800) continue;
      const succ = r.notes.find((n) => n.kind === "succession" && n.from === f.commander);
      const failed = r.notes.find((n) => n.kind === "succession_failed" && n.from === f.commander);
      assert.ok(succ || failed, `seed ${seed}: ${f.commander} fell at ${f.t} with ${heirs.join(", ")} alive and nothing was recorded`);
      assert.ok(!(succ && failed), "either a successor or none, not both");
      if (failed) {
        chains++;
        // only when everyone in the line had fallen by then
        for (const h of [c.deputy, c.superior].filter((x): x is string => !!x)) {
          assert.ok(fellBy(h, failed.t), `seed ${seed}: ${h} was alive when no successor was recorded`);
          const hc = s.commanders.find((x) => x.id === h);
          for (const n of [hc?.deputy, hc?.superior].filter((x): x is string => !!x && x !== f.commander)) assert.ok(fellBy(n, failed.t), `seed ${seed}: ${n}, next in line, was alive`);
        }
      }
    }
  }
  assert.ok(chains > 0, "the shape turns up with a high hazard");
});
