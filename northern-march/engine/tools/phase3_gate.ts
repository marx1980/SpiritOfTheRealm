// Phase 3 gate: G-10 (bad outcomes with failureOrigin attributed) and G-11 (wrong beliefs matter), per scripted policy.
//   node tools/phase3_gate.ts tune 1..300            (TUNE seeds: exploration, logged to results/phase3_tune.jsonl)
//   node tools/phase3_gate.ts gate 20000 1000        (sealed GATE block: one verdict per calibration)
import { appendFileSync, mkdirSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { analyzeRun } from "../src/chronicle.ts";
import { bandVerdict, clusteredRateRatio, GateLog, policyRuleDetail, wilson, type Verdict } from "../src/gates.ts";
import { calibrationHash } from "../src/batch.ts";
import { hashLog } from "../src/engine.ts";
import type { PolicyId } from "../src/policies.ts";

const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
const [mode, a, b] = process.argv.slice(2);
const POLICIES: PolicyId[] = ["passive", "delegating", "aggressive"];
let seeds: number[];
if (mode === "tune") { const [x, y] = a.split("..").map(Number); seeds = Array.from({ length: y - x + 1 }, (_, i) => x + i); if (y >= 10000) throw new Error("TUNE seeds are below 10,000"); }
else { const start = Number(a), n = Number(b ?? 1000); seeds = Array.from({ length: n }, (_, i) => start + i); }
const cal = calibrationHash(content);
const log = new GateLog("results/gate_log.jsonl");
if (mode === "gate") log.claim(seeds[0], cal);

const per: Record<string, Record<string, unknown>> = {};
const hashes: Record<string, string[]> = {};
const t0 = performance.now();
for (const policy of POLICIES) {
  let outcomes = 0, attributed = 0, evaluated = 0, wrong = 0;
  const bySeed: { badWrong: number; wrong: number; badRight: number; right: number }[] = [];
  const bySeedRaw: typeof bySeed = [];
  const origins: Record<string, number> = { belief: 0, choice: 0, communication: 0, execution: 0 };
  hashes[policy] = [];
  for (const seed of seeds) {
    const sim = createSim({ content, seed, policy });
    sim.runDays(240);
    hashes[policy].push(hashLog(sim.log));
    const { summary: s } = analyzeRun(sim);
    outcomes += s.outcomes; attributed += s.attributed; evaluated += s.evaluated; wrong += s.wrongOrStale;
    for (const k of Object.keys(origins)) origins[k] += (s.byOrigin as Record<string, number>)[k];
    bySeed.push({ badWrong: s.badWhenWrong, wrong: s.wrongOrStale, badRight: s.badWhenRight, right: s.evaluated - s.wrongOrStale });
    bySeedRaw.push({ badWrong: s.badRawWhenWrong, wrong: s.wrongOrStale, badRight: s.badRawWhenRight, right: s.evaluated - s.wrongOrStale });
  }
  const g10p = outcomes ? attributed / outcomes : 0, g10ci = wilson(attributed, outcomes);
  const G10: Verdict = outcomes < 300 ? "FAIL" : g10p >= 0.95 && g10ci[0] >= 0.90 ? "PASS" : g10p >= 0.95 ? "AMBER" : "FAIL";
  const aP = evaluated ? wrong / evaluated : 0, aCi = wilson(wrong, evaluated);
  const G11a = bandVerdict(aP, aCi, 0.05, 0.35);
  const rr = clusteredRateRatio(bySeed);
  const G11b: Verdict = rr.ratio >= 1.5 && rr.ci[0] > 1 ? "PASS" : rr.ratio >= 1.5 ? "AMBER" : "FAIL";
  const worst = [G11a, G11b].includes("FAIL") ? "FAIL" : [G11a, G11b].includes("AMBER") ? "AMBER" : "PASS";
  const raw = clusteredRateRatio(bySeedRaw);
  per[policy] = { outcomes, attributed, g10: g10p, g10ci, G10, evaluated, wrongOrStale: wrong, g11a: aP, g11aCi: aCi, G11a, ratio: rr.ratio, ratioCi: rr.ci, G11b, G11: worst, origins,
    rawRatio: raw.ratio, rawRatioCi: raw.ci };
  console.log(policy, JSON.stringify(per[policy]));
}
const differ = (x: string, y: string) => hashes[x].filter((h, i) => h !== hashes[y][i]).length >= 0.1 * seeds.length;
const row = { phase: 3, mode, seedBlock: mode === "gate" ? seeds[0] : "TUNE", seeds: `${seeds[0]}..${seeds.at(-1)}`, calibrationHash: cal, contentVersion: content.version,
  perPolicy: per, G10: policyRuleDetail(per, "G10", differ), G11: policyRuleDetail(per, "G11", differ), seconds: Math.round((performance.now() - t0) / 1000), t: new Date().toISOString() };
console.log("G-10", JSON.stringify(row.G10), "G-11", JSON.stringify(row.G11), `${row.seconds}s`);
mkdirSync("results", { recursive: true });
if (mode === "gate") log.record(row); else appendFileSync("results/phase3_tune.jsonl", JSON.stringify(row) + "\n");
