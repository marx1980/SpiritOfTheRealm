// Phase 10 gate G-18 (docs/ENVIRONMENT.md §3): environmental events cause second-order consequences, with no catastrophe function.
//   node tools/phase10_gate.ts probe <fromSeed> <toSeed>                          TUNE seeds only (1..9,999): print the numbers, log nothing
//   node tools/phase10_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase10_gate.ts eval <block> <out1.json> [out2.json ...]           merge shards, claim the block, record the verdict
// Arms per seed and scripted policy: OFF (`environment` ablated) and ON, 240 days from the scenario's start day.
// (a) the share of games with a chain: an environmental first-order event (RouteClosed, CropDamaged), then a supply event
//     (SupplyBlocked, a request, a refusal, a shipment, an abandoned order, a scarcity) caused by it, then a community
//     grievance (a grievance, a petition or a change of stance) caused by that. Attributable rate ON - OFF >= 10%, bootstrap
//     (over seeds, 90%) lower bound above zero.
// (b) every RouteClosed and CropDamaged has a recorded cause that reaches an EnvironmentDay or a quake (StressReleased): 100%.
// (c) no catastrophe function: no environmental event without the state it needs, replayed from the log: 0 violations.
// (d) invariants hold: 0 violations.
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { GateLog } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";

const POLICIES = ["passive", "delegating", "aggressive"] as const;
const DAYS = 240;
const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const content = loadContent(dir), cal = gateKey(content);
const E = content.scenario.environment!;
const FIRST = new Set(["RouteClosed", "CropDamaged"]);
const SUPPLY = new Set(["SupplyBlocked", "GrainAsked", "GrainRefused", "GrainShipped", "GrainDelivered", "GrainLost", "OrderAbandoned", "ScarcityChanged", "GarrisonStarved"]);
type Ev = { id: number; tick: number; type: string; causedBy: number[]; payload: Record<string, any> };

function measure(sim: Sim) {
  const log = sim.log as Ev[], byId = new Map(log.map((e) => [e.id, e]));
  const envAnc = new Map<number, boolean>(), chain = new Map<number, boolean>(), reach = new Map<number, boolean>();
  let chains = 0, first = 0, firstCaused = 0, violations = 0;
  let day: Ev | null = null;
  const bad = () => { violations++; };
  for (const e of log) {
    const ps = e.causedBy.map((id) => byId.get(id)!).filter(Boolean);
    const ea = FIRST.has(e.type) || ps.some((p) => envAnc.get(p.id));
    envAnc.set(e.id, ea);
    chain.set(e.id, (SUPPLY.has(e.type) && ea) || ps.some((p) => chain.get(p.id)));
    reach.set(e.id, e.type === "EnvironmentDay" || e.type === "StressReleased" || ps.some((p) => reach.get(p.id)));
    const grievance = (e.type === "CommunityHeard" && Array.isArray(e.payload.grievances) && e.payload.grievances.length > 0) || e.type === "PetitionMade" || e.type === "CommunityStanceChanged";
    if (grievance && ps.some((p) => chain.get(p.id))) chains++;
    if (e.type === "EnvironmentDay") day = e;
    if (FIRST.has(e.type)) { first++; if (reach.get(e.id)) firstCaused++; }
    // (c) the state each effect needs, from the day's snapshot (the daily step records before any of its effects)
    const w = day?.payload as { regions: Record<string, any>; rivers: Record<string, any>; stress: Record<string, number>; day: number } | undefined;
    const prov = (l: string) => content.byId.location.get(l)!.province;
    if (e.type === "RouteClosed" || e.type === "CropDamaged" || e.type === "Hazard") {
      if (!w || e.causedBy.length === 0) { bad(); continue; }
      if (e.type === "RouteClosed") {
        const r = content.byId.route.get(e.payload.route)!, reason = e.payload.reason as string;
        const provs = [...new Set([prov(r.from), prov(r.to)])];
        if (reason === "flood") { const lvl = r.crossing ? w.rivers[r.crossing.river].level : 0; if (!r.crossing || lvl < E.crossings[r.crossing.kind].closeAbove) bad(); }
        else if (reason === "ice") { if (!r.crossing || !w.rivers[r.crossing.river].frozen) bad(); }
        else if (reason === "snow") { if (Math.max(...provs.map((x) => w.regions[x].snow)) < E.snow.openBelowCm) bad(); }
        else if (reason === "waterlogged") { if (Math.max(...provs.map((x) => w.regions[x].wet)) < E.ground.waterloggedOpen) bad(); }
        else if (reason === "landslide") { if (!e.causedBy.some((id) => byId.get(id)?.type === "StressReleased")) bad(); }
        else bad();
      } else if (e.type === "CropDamaged") {
        const reg = w.regions[e.payload.province as string], cause = e.payload.cause as string;
        if (cause === "flood") { if (!Object.entries(E.rivers).some(([id, r]) => (r.basin[e.payload.province as string] ?? 0) > 0 && w.rivers[id].level >= E.harvest.flood.atLevel)) bad(); }
        else if (cause === "frost") { if (reg.tempC10 > E.harvest.frost.belowC10) bad(); }
        else if (cause === "drought") { if (reg.dry < E.harvest.drought.dryDays) bad(); }
        else bad();
      } else {
        const kind = e.payload.kind as string, where = e.payload.location as string;
        if (kind === "storm") { if (w.regions[prov(where)].wx !== "storm") bad(); }
        else if (kind === "fire") { if (w.regions[prov(where)].dry < E.fire.dryDays) bad(); }
        else if (kind === "earthquake") { if (!e.causedBy.some((id) => byId.get(id)?.type === "StressReleased")) bad(); }
        else bad();
      }
    }
  }
  return { chain: chains > 0 ? 1 : 0, chains, first, firstCaused, violations, invariants: checkRun(sim).length };
}

const [mode, a1, a2, a3, a4] = process.argv.slice(2);

function run(from: number, to: number) {
  const rows = [];
  for (let seed = from; seed < to; seed++) for (const policy of POLICIES) {
    const on = createSim({ content, seed, policy }); on.runDays(DAYS);
    const off = createSim({ content, seed, policy, ablate: ["environment"] }); off.runDays(DAYS);
    rows.push({ seed, policy, on: measure(on), off: measure(off) });
  }
  return rows;
}

// a deterministic bootstrap over seeds (games within a seed share their seed, so seeds are the resampling unit)
function summarise(rows: any[]) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((x, y) => x - y);
  const bySeed = new Map(seeds.map((s) => [s, rows.filter((r) => r.seed === s)]));
  const rate = (ss: number[], arm: "on" | "off") => { let k = 0, n = 0; for (const s of ss) for (const r of bySeed.get(s)!) { k += r[arm].chain; n++; } return n ? k / n : 0; };
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const diffs = Array.from({ length: 1000 }, () => { const ss = seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]); return rate(ss, "on") - rate(ss, "off"); }).sort((p, q) => p - q);
  const rOn = rate(seeds, "on"), rOff = rate(seeds, "off"), A = rOn - rOff, lo = diffs[49], hi = diffs[949];
  const sum = (f: (r: any) => number) => rows.reduce((n, r) => n + f(r), 0);
  const perPolicy = Object.fromEntries(POLICIES.map((p) => { const rs = rows.filter((r) => r.policy === p); return [p, { n: rs.length, on: rs.reduce((n, r) => n + r.on.chain, 0) / (rs.length || 1), off: rs.reduce((n, r) => n + r.off.chain, 0) / (rs.length || 1) }]; }));
  const first = sum((r) => r.on.first), caused = sum((r) => r.on.firstCaused);
  return {
    n: seeds.length, perPolicy,
    a: { rOn, rOff, A, interval: [lo, hi], bar: ">= 0.10, lower bound > 0", verdict: A >= 0.1 && lo > 0 ? "PASS" : A >= 0.1 ? "AMBER" : "FAIL" },
    b: { firstOrder: first, withCause: caused, share: first ? caused / first : 1, bar: "= 1", verdict: caused === first ? "PASS" : "FAIL" },
    c: { violations: sum((r) => r.on.violations + r.off.violations), bar: "= 0", verdict: sum((r) => r.on.violations + r.off.violations) === 0 ? "PASS" : "FAIL" },
    d: { violations: sum((r) => r.on.invariants + r.off.invariants), bar: "= 0", verdict: sum((r) => r.on.invariants + r.off.invariants) === 0 ? "PASS" : "FAIL" },
  };
}

if (mode === "probe") {
  const [from, to] = [Number(a1), Number(a2)];
  if (!(from >= 1 && to <= 10000)) throw new Error("probe runs on TUNE seeds (1..9,999) only");
  console.log(JSON.stringify(summarise(run(from, to)), null, 1));
} else if (mode === "shard") {
  const block = Number(a1);
  if (!(block >= 10000 && block % 10000 === 0)) throw new Error("gate blocks start at a multiple of 10,000");
  const [from, to, out] = [Number(a2), Number(a3), a4];
  writeFileSync(out, JSON.stringify({ block, cal, rows: run(block + from, block + to) }));
  console.log(`shard ${from}..${to} done`);
} else if (mode === "eval") {
  const block = Number(a1);
  const rows: any[] = process.argv.slice(4).flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  const log = new GateLog("results/gate_log.jsonl");
  log.claim(block, cal);
  const s = summarise(rows);
  const overall = [s.a, s.b, s.c, s.d].some((x) => x.verdict === "FAIL") ? "FAIL" : [s.a, s.b, s.c, s.d].some((x) => x.verdict === "AMBER") ? "AMBER" : "PASS";
  const row = { gate: "G-18", seedBlock: block, calibrationHash: cal, contentVersion: content.version, ...s, verdict: overall, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: probe|shard|eval");
