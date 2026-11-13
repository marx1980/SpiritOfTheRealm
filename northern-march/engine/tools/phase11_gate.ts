// Phase 11 gate G-19 (docs/EXPLORATION.md §6): Stefan can emerge through recommendation and performance; the Stone may never
// reach Anna, and its provenance is always reconstructable.
//   node tools/phase11_gate.ts probe <fromSeed> <toSeed>                          TUNE seeds only (1..9,999): print the numbers, log nothing
//   node tools/phase11_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase11_gate.ts eval <block> <out1.json> [out2.json ...]           merge shards, claim the block, record the verdict
// Three scripted policies, 240 days, one arm each (the exploration system is the thing under test; paired OFF games would be empty).
// (a) Of the games where an expedition goes out, the share in which Stefan emerges is within 20-40% (Wilson 90% interval).
// (b) Every Stefan emergence has recommendation (his appointment names a recommender), performance (CharacterEmerged <- ReputationChanged <-
//     ExpeditionEnded <- ExpeditionStarted) and nothing else needed: 100% of emergences.
// (c) Of the games where the Stone was found, at least 10% end with it outside Anna's hands (kept, lost or in the wood), and in every
//     game the custody events form a chain without gaps: 100%.
// (d) Invariants: 0 violations.
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { GateLog, wilson } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import { provenance } from "../src/systems/exploration.ts";

const POLICIES = ["passive", "delegating", "aggressive"] as const;
const DAYS = 240;
const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const content = loadContent(dir), cal = gateKey(content);
type Ev = { id: number; tick: number; type: string; causedBy: number[]; payload: Record<string, any> };

function measure(sim: Sim) {
  const log = sim.log as Ev[], byId = new Map(log.map((e) => [e.id, e]));
  const ancestors = (e: Ev) => { const seen = new Set<string>(), stack = [...e.causedBy]; while (stack.length) { const x = byId.get(stack.pop()!); if (!x || seen.has(String(x.id))) continue; seen.add(String(x.id)); stack.push(...x.causedBy); } return [...seen].map((i) => byId.get(Number(i))!); };
  const expedition = log.some((e) => e.type === "ExpeditionStarted");
  const emerged = log.filter((e) => e.type === "CharacterEmerged" && e.payload.who === "stefan");
  let traced = 0;
  for (const e of emerged) {
    const anc = ancestors(e).map((x) => x.type);
    const appointed = log.some((a) => a.type === "LeaderAppointed" && a.payload.leader === "stefan" && typeof a.payload.recommendedBy === "string" && a.tick < e.tick);
    if (appointed && ["ReputationChanged", "ExpeditionEnded", "ExpeditionStarted"].every((t) => anc.includes(t))) traced++;
  }
  const found = log.some((e) => e.type === "StoneFound");
  const st = sim.unsafeWorldForDebug().bw!.stone;
  const outside = found && !(st.status === "held" && st.holder === "anna");
  // custody chain without gaps: each event's holder is whoever the previous one left it with
  let holder: string | null = null, gaps = 0;
  for (const p of provenance(log as any) as unknown as Ev[]) {
    if (p.type === "StoneFound") continue;
    if (p.type === "StoneTaken") holder = p.payload.holder as string | null;
    else if (p.type === "StoneLost") { if (p.payload.from !== holder) gaps++; holder = null; }
    else if (p.type === "StoneSent") { if (p.payload.holder !== holder) gaps++; }
    else if (p.type === "StoneDelivered") { if (p.payload.from !== holder) gaps++; holder = p.payload.to as string | null; }
    else if (p.type === "StoneKept") { if (p.payload.holder !== holder) gaps++; }
    if (p.type !== "StoneExamined" && p.causedBy.length === 0) gaps++;
  }
  return { expedition, stefanEmerged: emerged.length > 0, emergences: emerged.length, traced, found, outside, gaps, invariants: checkRun(sim).length };
}

const [mode, a1, a2, a3, a4] = process.argv.slice(2);
function run(from: number, to: number) {
  const rows = [];
  for (let seed = from; seed < to; seed++) for (const policy of POLICIES) { const s = createSim({ content, seed, policy }); s.runDays(DAYS); rows.push({ seed, policy, ...measure(s) }); }
  return rows;
}
function summarise(rows: any[]) {
  const sum = (f: (r: any) => number) => rows.reduce((n, r) => n + f(r), 0);
  const games = rows.filter((r) => r.expedition), em = games.filter((r) => r.stefanEmerged).length;
  const [lo, hi] = wilson(em, games.length, 1.645), point = games.length ? em / games.length : 0;
  const found = rows.filter((r) => r.found), out = found.filter((r) => r.outside).length;
  const [ol, oh] = wilson(out, found.length, 1.645), op = found.length ? out / found.length : 0;
  const perPolicy = Object.fromEntries(POLICIES.map((p) => { const rs = rows.filter((r) => r.policy === p), g = rs.filter((r) => r.expedition); return [p, { games: rs.length, expeditions: g.length, emerged: g.filter((r) => r.stefanEmerged).length, found: rs.filter((r) => r.found).length, outside: rs.filter((r) => r.outside).length }]; }));
  const emergences = sum((r) => r.emergences), traced = sum((r) => r.traced);
  return {
    n: new Set(rows.map((r) => r.seed)).size, perPolicy,
    a: { expeditionGames: games.length, emerged: em, share: point, interval: [lo, hi], bar: "20%-40%", verdict: lo >= 0.2 && hi <= 0.4 ? "PASS" : point >= 0.2 && point <= 0.4 ? "AMBER" : "FAIL" },
    b: { emergences, traced, bar: "= all", verdict: emergences > 0 && traced === emergences ? "PASS" : emergences === 0 ? "AMBER" : "FAIL" },
    c: { found: found.length, outside: out, share: op, interval: [ol, oh], bar: ">= 10% outside; no custody gaps", gaps: sum((r) => r.gaps), verdict: sum((r) => r.gaps) > 0 ? "FAIL" : ol >= 0.1 ? "PASS" : op >= 0.1 ? "AMBER" : "FAIL" },
    d: { violations: sum((r) => r.invariants), bar: "= 0", verdict: sum((r) => r.invariants) === 0 ? "PASS" : "FAIL" },
  };
}

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
  const s = summarise(rows), vs = [s.a, s.b, s.c, s.d].map((x) => x.verdict);
  const overall = vs.includes("FAIL") ? "FAIL" : vs.includes("AMBER") ? "AMBER" : "PASS";
  const row = { gate: "G-19", seedBlock: block, calibrationHash: cal, contentVersion: content.version, ...s, verdict: overall, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: probe|shard|eval");
