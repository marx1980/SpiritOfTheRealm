// Phase 14 gates G-07, G-08, G-09 (docs/CONTENT.md): what Anna's attention goes to, how the campaign ends, and whether an ending is
// a random branch. 14A runs this on TUNE seeds only (probe); the sealed round is 14C. G-15 (ablation sanity) is not in this tool yet.
//   node tools/phase14_gate.ts probe <fromSeed> <toSeed>                          TUNE seeds only (1..9,999): print the numbers, log nothing
//   node tools/phase14_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase14_gate.ts eval <block> <out1.json> [out2.json ...]           merge shards, claim the block, record the verdict
// Three scripted policies, 240 days (scenario.endings.horizonDays). Readings come from the log (src/endings.ts).
// G-07: for each of the five pressures, the share of games in which it is the dominant crisis is within 5-45%.
// G-08: at least 4 of the six endings each have a share within 5-60% of all games, and none is above 60% (unresolved is reported, not counted).
// G-09: of the games that end, (a) at most 20% end from an exogenous first cause with no agent decision in the ancestry; (b) at least 60%
//       have an ancestry across three or more domains.
// Bars are the plan's (C2). Verdict per bar: PASS if the Wilson 90% interval is inside, AMBER if only the point is, else FAIL. The pooled
// verdict over the three policies decides; each policy is reported too.
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { GateLog, wilson } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import { ENDING_TYPES, PRESSURES, readAttention, readEnding } from "../src/endings.ts";

const POLICIES = ["passive", "delegating", "aggressive"] as const;
const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const content = loadContent(dir), cal = gateKey(content);
const DAYS = content.scenario.endings.horizonDays;
type Row = { seed: number; policy: string; ending: string; firstCause: string | null; domains: number; dominant: string | null; runnerUp: string | null; counted: number; shares: Record<string, number>; ms: number };
type V = "PASS" | "AMBER" | "FAIL";

function run(from: number, to: number): Row[] {
  const rows: Row[] = [];
  for (let seed = from; seed < to; seed++) for (const policy of POLICIES) {
    const t0 = performance.now(), s = createSim({ content, seed, policy });
    s.runDays(DAYS);
    const e = readEnding(s.log, content, s.tick), a = readAttention(s.log, content);
    rows.push({ seed, policy, ending: e.type, firstCause: e.firstCause, domains: e.ancestryDomains.length, dominant: a.dominant, runnerUp: a.runnerUp, counted: a.counted, shares: a.shares, ms: Math.round(performance.now() - t0) });
  }
  return rows;
}

const inBand = (k: number, n: number, lo: number, hi: number): { share: number; interval: [number, number]; verdict: V } => {
  const share = n ? k / n : 0, [l, h] = wilson(k, n, 1.645);
  return { share, interval: [l, h], verdict: n && lo <= l && h <= hi ? "PASS" : lo <= share && share <= hi ? "AMBER" : "FAIL" };
};
const worst = (vs: V[]): V => (vs.includes("FAIL") ? "FAIL" : vs.includes("AMBER") ? "AMBER" : "PASS");

function measure(rows: Row[]) {
  const n = rows.length;
  const g07 = Object.fromEntries([...PRESSURES].map((p) => [p, inBand(rows.filter((r) => r.dominant === p).length, n, 0.05, 0.45)]));
  const types = Object.fromEntries(ENDING_TYPES.map((t) => [t, inBand(rows.filter((r) => r.ending === t).length, n, 0.05, 0.6)]));
  const inside = ENDING_TYPES.filter((t) => types[t].verdict !== "FAIL").length, over = ENDING_TYPES.filter((t) => types[t].share > 0.6);
  const ended = rows.filter((r) => r.ending !== "unresolved"), exo = ended.filter((r) => r.firstCause === "exogenous").length, wide = ended.filter((r) => r.domains >= 3).length;
  const a = ended.length ? (() => { const [l, h] = wilson(exo, ended.length, 1.645), p = exo / ended.length; return { share: p, interval: [l, h], verdict: (h <= 0.2 ? "PASS" : p <= 0.2 ? "AMBER" : "FAIL") as V }; })() : { share: 0, interval: [0, 1], verdict: "FAIL" as V };
  const b = ended.length ? (() => { const [l, h] = wilson(wide, ended.length, 1.645), p = wide / ended.length; return { share: p, interval: [l, h], verdict: (l >= 0.6 ? "PASS" : p >= 0.6 ? "AMBER" : "FAIL") as V }; })() : { share: 0, interval: [0, 1], verdict: "FAIL" as V };
  return {
    games: n, wallMsPerGame: n ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / n) : 0,
    G07: { dominantShare: g07, none: rows.filter((r) => r.dominant === null).length / (n || 1), verdict: worst(Object.values(g07).map((x) => x.verdict)) },
    G08: { endingShare: types, unresolved: rows.filter((r) => r.ending === "unresolved").length / (n || 1), typesInBand: inside, over60: over, verdict: (inside >= 4 && !over.length ? worst(ENDING_TYPES.filter((t) => types[t].verdict !== "FAIL").map((t) => types[t].verdict)) : "FAIL") as V },
    G09: { ended: ended.length, a_exogenousOnly: a, b_threeDomains: b, verdict: worst([a.verdict, b.verdict]) },
  };
}
function summarise(rows: Row[]) {
  return { n: new Set(rows.map((r) => r.seed)).size, pooled: measure(rows), perPolicy: Object.fromEntries(POLICIES.map((p) => [p, measure(rows.filter((r) => r.policy === p))])) };
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
  const rows: Row[] = process.argv.slice(4).flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  const log = new GateLog("results/gate_log.jsonl");
  log.claim(block, cal);
  const s = summarise(rows), p = s.pooled;
  const overall = worst([p.G07.verdict, p.G08.verdict, p.G09.verdict]);
  const row = { gate: "G-07/08/09", seedBlock: block, calibrationHash: cal, contentVersion: content.version, ...s, verdict: overall, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: probe|shard|eval");
