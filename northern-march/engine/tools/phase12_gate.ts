// Phase 12 gate G-20 (docs/COMMAND.md §10): the full battlefield. Lab army battles (test/battle_army.ts: three wings,
// about 15 formations a side, the raider host by seed) under three scripted headquarters plans, plus campaign runs.
//   node tools/phase12_gate.ts probe <fromSeed> <toSeed>                          TUNE seeds only (1..9,999): print the numbers, log nothing
//   node tools/phase12_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase12_gate.ts eval <block> <out1.json> [out2.json ...]           merge shards, claim the block, record the verdict
// (a) Disobedience is reasoned: every departure from an order is the option the margins pick from its recorded scores, with
//     no random draw: 0 violations.
// (b) Disobedience matters both ways: every departure is judged (100%); among departures that made a difference, the shares
//     saved and ruined both have a Wilson 90% lower bound of at least 15% (AMBER if only the points are).
// (c) Panic spreads by sight: paired arms (contagion off / on, same seeds); the share of breaks that come within 120 s of a
//     friend breaking 400-1000 m away; lift on/off >= 1.3 with the 90% bootstrap (over seeds) lower bound above 1.0.
// (d) Succession and what headquarters knows: no fall with a living heir left without a successor while the battle went
//     on (30 minutes); headquarters never shows a commander fallen before it saw it or heard it: 0 violations.
// (e) Information integrity and invariants: observed marks are reality; campaign runs (every 4th seed, three scripted
//     rulers, 160 days) keep every invariant: 0 violations.
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { GateLog, wilson } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import { runBattle, type BattleRecord, type BattleSetup } from "../src/battlefield/core.ts";
import { decideObedience } from "../src/agents/obedience.ts";
import { armySetup, type ArmyPlan } from "../test/battle_army.ts";

const PLANS: ArmyPlan[] = ["hold", "delegate", "attack"];
const POLICIES = ["passive", "delegating", "aggressive"] as const;
const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const content = loadContent(dir), cal = gateKey(content);

function chained(r: BattleRecord) {
  const side = new Map(r.frames[0].formations.map((f) => [f.id, f.side]));
  const br = r.notes.filter((x) => x.kind === "behaviour" && (x.to === "rout" || x.to === "retreat")).map((x) => ({ t: x.t, f: x.formation! }));
  const pos = (id: string, t: number) => [...r.frames].reverse().find((x) => x.t <= t)!.formations.find((y) => y.id === id)!;
  let n = 0;
  for (const b of br) { const me = pos(b.f, b.t); if (br.some((a) => a.f !== b.f && side.get(a.f) === side.get(b.f) && a.t < b.t && a.t >= b.t - 120 && (() => { const o = pos(a.f, b.t), d = Math.hypot(o.x - me.x, o.y - me.y); return d > 400 && d <= 1000; })())) n++; }
  return { chained: n, breaks: br.length };
}

function measure(s: BattleSetup, r: BattleRecord) {
  // (a) every departure is what the margins pick from the recorded scores, and drew nothing
  let departures = 0, reasonedBad = 0;
  for (const t of r.traces) {
    const review = t.trigger === "review";
    const departs = review ? t.decision !== "obey" : t.decision === "keep";
    if (!departs) continue;
    departures++;
    const sc = (k: string) => t.candidates.filter((c) => c.kind === k).map((c) => c.score);
    const obey = sc("obey")[0], serving = Math.max(-1e12, ...sc("adapt")), other = Math.max(-1e12, ...sc(review ? "defy" : "keep"));
    const d = decideObedience({ obey, bestServing: serving, bestOther: other, ...t.margins });
    const expect = d.decision === "refuse" ? (review ? "defy" : "keep") : d.decision;
    if (t.draws !== 0 || expect !== t.decision) reasonedBad++;
  }
  // (b) judged
  const judged = r.result.disobedience ?? [];
  const out = { saved: judged.filter((d) => d.outcome === "saved").length, ruined: judged.filter((d) => d.outcome === "ruined").length, none: judged.filter((d) => d.outcome === "no_difference").length };
  // (d) succession and headquarters' knowledge
  let succBad = 0, knowBad = 0;
  for (const f of r.result.fallen ?? []) {
    const c = s.commanders.find((x) => x.id === f.commander)!;
    const heirs = [c.deputy, c.superior].filter((x): x is string => !!x && !(r.result.fallen ?? []).some((g) => g.commander === x && g.t <= f.t));
    const succ = r.notes.some((n) => n.kind === "succession" && n.from === f.commander);
    if (heirs.length && !succ && r.result.endT - f.t >= 1800) succBad++;
    const known = r.notes.find((n) => n.kind === "fall_known" && n.commander === f.commander);
    if (known && known.t < f.t) knowBad++;
  }
  for (const h of r.hq) for (const row of h.network.filter((n) => n.state === "fallen")) { const k = r.notes.find((n) => n.kind === "fall_known" && n.commander === row.commander); if (!k || k.t > h.t) knowBad++; }
  // (e) observed marks are reality
  let infoBad = 0;
  for (const h of r.hq) { const real = r.frames.find((x) => x.t === h.t); for (const m of h.marks.filter((m) => m.category === "observed")) { const f = real?.formations.find((x) => x.id === m.id); if (f && (f.behaviour !== m.behaviour || (f.behaviour !== "gone" && (f.x !== m.x || f.y !== m.y)))) infoBad++; // the guard's last place is kept once it is gone } }
  return { departures, reasonedBad, judged: judged.length, ...out, falls: (r.result.fallen ?? []).length, succBad, knowBad, infoBad, winner: r.result.winner, ...chained(r) };
}

function run(from: number, to: number) {
  const rows = [];
  for (let seed = from; seed < to; seed++) {
    for (const plan of PLANS) {
      const s = armySetup({ seed, plan, content });
      const on = measure(s, runBattle(s, []));
      const off = armySetup({ seed, plan, content });
      delete off.params.full!.contagion;
      const c = chained(runBattle(off, [], { judge: false }));
      rows.push({ seed, plan, on, off: c });
    }
    if (seed % 4 === 0) for (const policy of POLICIES) { const sim = createSim({ content, seed, policy }); sim.runDays(160); rows.push({ seed, policy, invariants: checkRun(sim).length }); }
  }
  return rows;
}

function summarise(rows: any[]) {
  const battles = rows.filter((r) => r.plan), camps = rows.filter((r) => r.policy);
  const sum = (xs: any[], f: (r: any) => number) => xs.reduce((n, r) => n + f(r), 0);
  const departures = sum(battles, (r) => r.on.departures), judged = sum(battles, (r) => r.on.judged);
  const saved = sum(battles, (r) => r.on.saved), ruined = sum(battles, (r) => r.on.ruined), diff = saved + ruined;
  const [sl] = wilson(saved, diff, 1.645), [rl] = wilson(ruined, diff, 1.645);
  const seeds = [...new Set(battles.map((r) => r.seed))].sort((a, b) => a - b);
  const bySeed = new Map(seeds.map((s) => [s, battles.filter((r) => r.seed === s)]));
  const lift = (ss: number[]) => { let a = 0, b = 0, c = 0, d = 0; for (const s of ss) for (const r of bySeed.get(s)!) { a += r.on.chained; b += r.on.breaks; c += r.off.chained; d += r.off.breaks; } return b && c ? (a / b) / (c / d) : 0; };
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const boots = Array.from({ length: 1000 }, () => lift(seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]))).sort((p, q) => p - q);
  const L = lift(seeds), lo = boots[49], hi = boots[949];
  const perPlan = Object.fromEntries(PLANS.map((p) => { const rs = battles.filter((r) => r.plan === p); return [p, { battles: rs.length, crownWon: rs.filter((r) => r.on.winner === "crown").length, departures: sum(rs, (r) => r.on.departures), saved: sum(rs, (r) => r.on.saved), ruined: sum(rs, (r) => r.on.ruined), falls: sum(rs, (r) => r.on.falls) }]; }));
  const reasonedBad = sum(battles, (r) => r.on.reasonedBad), succBad = sum(battles, (r) => r.on.succBad), knowBad = sum(battles, (r) => r.on.knowBad);
  const infoBad = sum(battles, (r) => r.on.infoBad), inv = sum(camps, (r) => r.invariants);
  return {
    n: seeds.length, perPlan, campaigns: camps.length,
    a: { departures, violations: reasonedBad, bar: "= 0", verdict: departures > 0 && reasonedBad === 0 ? "PASS" : "FAIL" },
    b: { departures, judged, saved, ruined, noDifference: sum(battles, (r) => r.on.none), savedShare: diff ? saved / diff : 0, ruinedShare: diff ? ruined / diff : 0, lowerBounds: [sl, rl], bar: "all judged; saved and ruined each >= 15% (Wilson 90% lower bound)",
      verdict: judged !== departures ? "FAIL" : sl >= 0.15 && rl >= 0.15 ? "PASS" : diff && saved / diff >= 0.15 && ruined / diff >= 0.15 ? "AMBER" : "FAIL" },
    c: { on: [sum(battles, (r) => r.on.chained), sum(battles, (r) => r.on.breaks)], off: [sum(battles, (r) => r.off.chained), sum(battles, (r) => r.off.breaks)], lift: L, interval: [lo, hi], bar: "lift >= 1.3, lower bound > 1.0", verdict: L >= 1.3 && lo > 1 ? "PASS" : L >= 1.3 ? "AMBER" : "FAIL" },
    d: { falls: sum(battles, (r) => r.on.falls), successionViolations: succBad, knowledgeViolations: knowBad, bar: "= 0", verdict: succBad + knowBad === 0 ? "PASS" : "FAIL" },
    e: { observedViolations: infoBad, invariantViolations: inv, bar: "= 0", verdict: infoBad + inv === 0 ? "PASS" : "FAIL" },
  };
}

const [mode, a1, a2, a3, a4] = process.argv.slice(2);
if (mode === "probe") {
  const [from, to] = [Number(a1), Number(a2)];
  if (!(from >= 1 && to <= 10000)) throw new Error("probe runs on TUNE seeds (1..9,999) only");
  console.log(JSON.stringify(summarise(run(from, to)), null, 1));
} else if (mode === "shard") {
  const block = Number(a1);
  if (!(block >= 10000 && block % 10000 === 0)) throw new Error("gate blocks start at a multiple of 10,000");
  writeFileSync(a4, JSON.stringify({ block, cal, rows: run(block + Number(a2), block + Number(a3)) }));
  console.log(`shard ${a2}..${a3} done`);
} else if (mode === "eval") {
  const block = Number(a1);
  const rows: any[] = process.argv.slice(4).flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  const log = new GateLog("results/gate_log.jsonl");
  log.claim(block, cal);
  const s = summarise(rows), vs = [s.a, s.b, s.c, s.d, s.e].map((x) => x.verdict);
  const overall = vs.includes("FAIL") ? "FAIL" : vs.includes("AMBER") ? "AMBER" : "PASS";
  const row = { gate: "G-20", seedBlock: block, calibrationHash: cal, contentVersion: content.version, ...s, verdict: overall, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: probe|shard|eval");
