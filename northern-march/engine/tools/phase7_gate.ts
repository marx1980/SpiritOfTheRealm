// Phase 7A gate on a sealed seed block: G-03/G-04 (end state "Varos acts on Greyfen's grievance", threat ON vs OFF), the share of each
// Grain Crisis outcome, and G-05 link ablations (messenger, communities; the threat link is the OFF arm itself).
//   node tools/phase7_gate.ts shard <block> <fromOffset> <toOffset> <out.json> [linkSeeds]   run seeds block+from .. block+to-1 (several shards in parallel)
//   node tools/phase7_gate.ts eval <block> <out1.json> [out2.json ...]                        merge shards, claim the block, write the verdict to results/gate_log.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { hashLog } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { OUTCOMES, readCrisis } from "../src/crisis.ts";
import { evaluateCausalGate, GateLog, policyRuleDetail } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import type { SystemId } from "../src/events.ts";

const POLICIES = ["passive", "delegating", "aggressive"] as const;
const LINKS: SystemId[] = ["messenger", "communities"];
const LINK_POLICIES = ["delegating", "aggressive"];
const LINK_SEEDS = 600;
const days = 240;
const content = loadContent(process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname);
const cal = gateKey(content);
const [mode, blockArg, a, b, c] = process.argv.slice(2);
const block = Number(blockArg);
if (!(block >= 10000 && block % 10000 === 0)) throw new Error("gate blocks start at a multiple of 10,000");
const log = new GateLog("results/gate_log.jsonl");

if (mode === "shard") {
  log.claim(block, cal); // refuses a block already used for this calibration
  const [from, to, out] = [Number(a), Number(b), c];
  const linkSeeds = Number(process.argv[7] ?? LINK_SEEDS);
  const rows: any[] = [];
  for (const policy of POLICIES) for (let off = from; off < to; off++) {
    const seed = block + off;
    const on = createSim({ content, seed, policy }), offA = createSim({ content, seed, policy, ablate: ["threat"] });
    on.runDays(days); offA.runDays(days);
    const ro = readCrisis(on.log, content), rf = readCrisis(offA.log, content);
    const row: any = { policy, seed, on: ro.endState, off: rf.endState, outcomeOn: ro.outcome, outcomeOff: rf.outcome, violations: checkRun(on).length + checkRun(offA).length, hash: hashLog(on.log), links: {} };
    if (off < linkSeeds && LINK_POLICIES.includes(policy)) for (const l of LINKS) {
      const s = createSim({ content, seed, policy, ablate: [l] }); s.runDays(days);
      row.links[l] = readCrisis(s.log, content).endState;
    }
    rows.push(row);
  }
  writeFileSync(out, JSON.stringify({ block, cal, rows }));
  console.log(`shard ${from}..${to} done: ${rows.length} rows`);
} else if (mode === "eval") {
  const files = process.argv.slice(4);
  const rows: any[] = files.flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  log.claim(block, cal);
  const per: Record<string, any> = {}, hashes: Record<string, string[]> = {}, shares: Record<string, Record<string, number>> = {}, g05: Record<string, any> = {};
  const pooled: Record<string, number> = {};
  let n = 0, violations = 0;
  for (const policy of POLICIES) {
    const rs = rows.filter((r) => r.policy === policy).sort((x, y) => x.seed - y.seed);
    n = rs.length; violations += rs.reduce((t, r) => t + r.violations, 0);
    per[policy] = evaluateCausalGate(rs.map((r) => r.on), rs.map((r) => r.off));
    hashes[policy] = rs.map((r) => r.hash);
    shares[policy] = {};
    for (const o of [...OUTCOMES, "unresolved", "no_crisis"]) { const k = rs.filter((r) => r.outcomeOn === o).length; shares[policy][o] = Math.round((k * 1000) / rs.length) / 10; pooled[o] = (pooled[o] ?? 0) + k; }
    if (LINK_POLICIES.includes(policy)) {
      const withLinks = rs.filter((r) => Object.keys(r.links).length);
      const rOn = withLinks.filter((r) => r.on).length / withLinks.length, rOff = withLinks.filter((r) => r.off).length / withLinks.length, A = rOn - rOff;
      g05[policy] = { seeds: withLinks.length, rOn, rOff, A, links: Object.fromEntries(LINKS.map((l) => { const rl = withLinks.filter((r) => r.links[l]).length / withLinks.length; return [l, { rate: rl, aWithout: rl - rOff, cut: A > 0 ? 1 - (rl - rOff) / A : null, pass: A > 0 && 1 - (rl - rOff) / A >= 0.5 }]; })), threat: { cut: 1, pass: true, note: "the OFF arm" } };
    }
  }
  const differ = (x: string, y: string) => hashes[x].filter((h, i) => h !== hashes[y][i]).length >= 0.1 * n;
  const pooledShare = Object.fromEntries(Object.entries(pooled).map(([k, v]) => [k, Math.round((v * 1000) / (n * POLICIES.length)) / 10]));
  const outcomeGate = OUTCOMES.map((o) => ({ outcome: o, pooledPct: pooledShare[o], pass: pooledShare[o] >= 5 }));
  const g05pass = Object.values(g05).every((p: any) => Object.values(p.links).every((l: any) => l.pass));
  const row = { gate: "phase7A", seedBlock: block, n, calibrationHash: cal, contentVersion: content.version, perPolicy: per, G03: policyRuleDetail(per, "G03", differ), G04: policyRuleDetail(per, "G04", differ),
    outcomeShares: shares, outcomePooled: pooledShare, outcomeGate, outcomeVerdict: outcomeGate.every((x) => x.pass) ? "PASS" : "FAIL", G05: { perPolicy: g05, verdict: g05pass ? "PASS" : "FAIL" }, invariantViolations: violations, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: shard|eval");
