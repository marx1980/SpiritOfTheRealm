// Phase 9 gate G-17 (docs/POLICY.md §4): standing policy and precedent, paired arms on a sealed seed block.
//   node tools/phase9_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase9_gate.ts eval <block> <out1.json> [out2.json ...]          merge shards, claim the block, record the verdict
// Arms per seed and scripted policy: OFF (no standing policy) and ON ("hold the walls" in force from the start).
// (a) sorties launched with no order in force, ON / OFF, pooled: at most 0.6 (bootstrap 90% interval over seeds)
// (b) of the ON arm's sortie weighings with no order in force, the share that weigh the policy: at least 95%
// (c) of the OFF arm's sortie weighings by someone who knows an earlier sortie against the same raiders, the share
//     that cite a precedent: at least 50%
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent, readContentDir, deriveContent } from "../src/content.ts";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { GateLog } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";

const POLICIES = ["passive", "delegating", "aggressive"] as const;
const DAYS = 160;
const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const off = loadContent(dir);
const on = (() => { const raw: any = readContentDir(dir); raw.scenario.policy.initial = { military: "hold_walls" }; return deriveContent(raw); })();
const cal = gateKey(off);
const [mode, blockArg] = process.argv.slice(2);
const block = Number(blockArg);
if (!(block >= 10000 && block % 10000 === 0)) throw new Error("gate blocks start at a multiple of 10,000");

type Trace = { agent: string; ordersInForce?: unknown[]; candidates: { action: { kind: string; target?: string }; contributions: { kind: string; ref: { kind: string; id: string } }[] }[] };
function measure(sim: Sim) {
  const traces = sim.log.filter((e) => e.type === "DecisionMade").map((e) => ({ e, t: e.payload.trace as Trace })).filter((x) => x.t?.candidates);
  const free = sim.log.filter((e) => e.type === "SortieLaunched" && !(sim.log.find((d) => d.id === e.payload.decisionEventId)?.payload.trace as Trace | undefined)?.ordersInForce?.length).length;
  let applied = 0, cited = 0, known = 0, citedPrec = 0;
  const recs = sim.log.filter((e) => e.type === "PrecedentRecorded" && e.payload.kind === "sortie");
  for (const { e, t } of traces) {
    if (t.ordersInForce?.length) continue;
    for (const c of t.candidates.filter((c) => c.action.kind === "sortie")) {
      applied++;
      if (c.contributions.some((r) => r.ref.kind === "policy" && r.ref.id.startsWith("military:"))) cited++;
      const post = off.byId.character.get(t.agent)?.location;
      if (recs.some((r) => r.tick < e.tick && r.payload.site === c.action.target && (r.payload.knownBy as string[]).some((k) => k === t.agent || k === `fort:${post}`))) {
        known++;
        if (c.contributions.some((r) => r.kind === "precedent")) citedPrec++;
      }
    }
  }
  return { free, applied, cited, known, citedPrec, violations: checkRun(sim).length };
}

if (mode === "shard") {
  const [from, to, out] = [Number(process.argv[4]), Number(process.argv[5]), process.argv[6]];
  const rows = [];
  for (let seed = block + from; seed < block + to; seed++) for (const policy of POLICIES) {
    const a = createSim({ content: on, seed, policy }); a.runDays(DAYS);
    const b = createSim({ content: off, seed, policy }); b.runDays(DAYS);
    rows.push({ seed, policy, on: measure(a), off: measure(b) });
  }
  writeFileSync(out, JSON.stringify({ block, cal, rows }));
  console.log(`shard ${from}..${to} done: ${rows.length} rows`);
} else if (mode === "eval") {
  const rows: any[] = process.argv.slice(4).flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  const log = new GateLog("results/gate_log.jsonl");
  log.claim(block, cal);
  // a deterministic bootstrap over seeds for the ratio of free sorties
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((x, y) => x - y);
  const bySeed = new Map(seeds.map((s) => [s, rows.filter((r) => r.seed === s)]));
  const ratio = (ss: number[]) => { let a = 0, b = 0; for (const s of ss) for (const r of bySeed.get(s)!) { a += r.on.free; b += r.off.free; } return b ? a / b : 0; };
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const boots = Array.from({ length: 1000 }, () => ratio(seeds.map(() => seeds[Math.floor(rnd() * seeds.length)]))).sort((p, q) => p - q);
  const point = ratio(seeds), lo = boots[49], hi = boots[949];
  const wilson = (k: number, n: number) => { if (!n) return [0, 0]; const z = 1.645, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - w) / d, (c + w) / d]; };
  const sum = (f: (r: any) => number, rs = rows) => rs.reduce((n, r) => n + f(r), 0);
  const verdictMax = (p: number, l: number, h: number, bar: number) => (h <= bar ? "PASS" : p <= bar ? "AMBER" : "FAIL");
  const verdictMin = (p: number, l: number, h: number, bar: number) => (l >= bar ? "PASS" : p >= bar ? "AMBER" : "FAIL");
  const appl = sum((r) => r.on.applied), cit = sum((r) => r.on.cited), kn = sum((r) => r.off.known), cp = sum((r) => r.off.citedPrec);
  const [bl, bh] = wilson(cit, appl), [cl, ch] = wilson(cp, kn);
  const perPolicy = Object.fromEntries(POLICIES.map((p) => { const rs = rows.filter((r) => r.policy === p); return [p, { offFree: sum((r) => r.off.free, rs), onFree: sum((r) => r.on.free, rs), cited: sum((r) => r.on.cited, rs), applied: sum((r) => r.on.applied, rs), precKnown: sum((r) => r.off.known, rs), precCited: sum((r) => r.off.citedPrec, rs) }]; }));
  const row = {
    gate: "G-17", seedBlock: block, n: seeds.length, calibrationHash: cal, contentVersion: off.version, perPolicy,
    a: { ratio: point, interval: [lo, hi], bar: "<= 0.6", verdict: verdictMax(point, lo, hi, 0.6) },
    b: { share: appl ? cit / appl : 0, interval: [bl, bh], bar: ">= 0.95", verdict: verdictMin(appl ? cit / appl : 0, bl, bh, 0.95) },
    c: { share: kn ? cp / kn : 0, interval: [cl, ch], bar: ">= 0.5", verdict: verdictMin(kn ? cp / kn : 0, cl, ch, 0.5) },
    invariantViolations: sum((r) => r.on.violations + r.off.violations), t: new Date().toISOString(),
  };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: shard|eval");
