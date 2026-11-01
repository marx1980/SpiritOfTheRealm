// Phase 4 gate G-14: (1) wakes within tier budgets; (2) doubling the background cast raises Tier A wakes by < 20%;
// (3) wall-clock per simulated year <= 60 s. 100 seeds from a sealed GATE block, three scripted policies.
//   node tools/phase4_gate.ts 30000
import { loadContent, withExtraBackground } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { GateLog } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import type { PolicyId } from "../src/policies.ts";

const DAY = 86400, DAYS = 240;
const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
const doubled = withExtraBackground(content, 2);
const block = Number(process.argv[2]);
const seeds = Array.from({ length: 100 }, (_, i) => block + i);
const log = new GateLog("results/gate_log.jsonl");
const cal = gateKey(content);
log.claim(block, cal);

function measure(c: typeof content, policy: PolicyId) {
  let tierA = 0, worstMs = 0, over = 0;
  const maxPerTier: Record<string, number> = { A: 0, B: 0, C: 0 }, total: Record<string, number> = { A: 0, B: 0, C: 0 };
  const agentDays: Record<string, number> = { A: 0, B: 0, C: 0 };
  for (const seed of seeds) {
    const t0 = performance.now();
    const sim = createSim({ content: c, seed, policy });
    sim.runDays(DAYS);
    worstMs = Math.max(worstMs, ((performance.now() - t0) * 365) / DAYS);
    const per = new Map<string, number>();
    for (const e of sim.log) if (e.type === "AgentWoke") {
      const tier = e.payload.tier as string, k = `${e.payload.agent}|${tier}|${Math.floor(e.tick / DAY)}`;
      per.set(k, (per.get(k) ?? 0) + 1);
      total[tier]++;
      if (tier === "A") tierA++;
    }
    for (const [k, n] of per) {
      const tier = k.split("|")[1];
      maxPerTier[tier] = Math.max(maxPerTier[tier], n);
      if (n > c.scenario.agents.wakeBudgetPerDay[tier as "A"]) over++;
    }
    const w = sim.unsafeWorldForDebug();
    for (const id of Object.keys(w.tiers)) if (id !== c.scenario.ruler) agentDays[w.tiers[id]] += DAYS; // end-of-run tier, approximate
  }
  return { tierA, worstMsPerSimYear: Math.round(worstMs), maxWakesPerAgentDay: maxPerTier, budgetViolations: over,
    meanWakesPerAgentDay: Object.fromEntries(Object.entries(total).map(([k, v]) => [k, agentDays[k] ? Math.round((1000 * v) / agentDays[k]) / 1000 : 0])) };
}

const per: Record<string, unknown> = {};
let pass = true;
for (const policy of ["passive", "delegating", "aggressive"] as PolicyId[]) {
  const a = measure(content, policy), b = measure(doubled, policy);
  const rise = a.tierA ? (b.tierA - a.tierA) / a.tierA : 0;
  const ok = { budgets: a.budgetViolations === 0 && b.budgetViolations === 0, scaling: rise < 0.2, wallClock: Math.max(a.worstMsPerSimYear, b.worstMsPerSimYear) <= 60000 };
  pass &&= ok.budgets && ok.scaling && ok.wallClock;
  per[policy] = { normal: a, doubledBackground: b, tierARise: Math.round(rise * 1000) / 1000, checks: ok };
  console.log(policy, JSON.stringify(per[policy]));
}
const row = { gate: "G-14", phase: 4, seedBlock: block, seeds: `${seeds[0]}..${seeds.at(-1)}`, calibrationHash: cal, contentVersion: content.version, perPolicy: per,
  verdict: pass ? "PASS" : "FAIL", t: new Date().toISOString() };
log.record(row);
console.log("G-14", row.verdict);
