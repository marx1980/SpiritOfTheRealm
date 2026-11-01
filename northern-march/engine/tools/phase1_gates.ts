// Phase 1 gate run: G-02 on 100 seeds (every system perturbed in turn), and the 1,000-seeds-per-arm batch
// with every invariant checked on every seed. G-01 cross-engine is run from the shell (node vs bun).
import { writeFileSync, mkdirSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim, type Sim } from "../src/engine.ts";
import { runBatch, type metricsRow } from "../src/batch.ts";
import { checkRun, checkPairing } from "../src/invariants.ts";
import { canonicalJson } from "../src/canonical.ts";
import { EVENT_TYPES, type SystemId } from "../src/events.ts";

const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
const out: Record<string, unknown> = {};

// G-02 (redefined in Phase 4, DECISIONS D-014): extra draws in one system's stream must not change any other system's
// draws. Once systems interact, the world they act on legitimately differs AFTER the perturbed system's outcomes change;
// so the test is: the first event that differs between the two runs belongs to the perturbed system.
// Also reported (not gated): how often other systems' drawn events stayed identical overall (causal spill-over).
const ROOT_DRAWN: Record<string, string> = { economy: "TreasuryCollected", weather: "Storm", threat: "ThreatBegan" };
const sig = (s: Sim, type: string) => canonicalJson(s.log.filter((e) => e.type === type).map((e) => [e.tick, e.payload]));
const g02: Record<string, { seeds: number; firstDivergenceOwn: number; perturbedChanged: number; otherDrawnEventsIdentical: number; firstForeign: string[] }> = {};
for (const perturbed of Object.keys(ROOT_DRAWN) as SystemId[]) {
  let own = 0, changed = 0, identical = 0;
  const foreign: string[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    const a = createSim({ content, seed, policy: "delegating" }); a.runDays(240);
    const b = createSim({ content, seed, policy: "delegating", params: { extraDraws: { [perturbed]: 3 } } }); b.runDays(240);
    let i = 0;
    while (i < a.log.length && i < b.log.length && canonicalJson(a.log[i]) === canonicalJson(b.log[i])) i++;
    // at the first differing position, either run may hold the perturbed system's event (one run has it, the other not)
    const sides = [a.log[i], b.log[i]].filter((x) => !!x);
    if (!sides.length || sides.some((x) => EVENT_TYPES[x.type].system === perturbed)) own++;
    else foreign.push(`seed ${seed}: ${sides.map((x) => x.type).join(" / ")}`);
    if (sig(a, ROOT_DRAWN[perturbed]) !== sig(b, ROOT_DRAWN[perturbed])) changed++;
    if (Object.entries(ROOT_DRAWN).every(([sys, t]) => sys === perturbed || sig(a, t) === sig(b, t))) identical++;
  }
  g02[perturbed] = { seeds: 100, firstDivergenceOwn: own, perturbedChanged: changed, otherDrawnEventsIdentical: identical, firstForeign: foreign.slice(0, 5) };
}
out.G02 = { perSystem: g02, verdict: Object.values(g02).every((x) => x.firstDivergenceOwn === 100) ? "PASS" : "FAIL" };
console.log("G-02", JSON.stringify(out.G02));

// 1,000 seeds per arm, invariants on every seed; ON and OFF run seed by seed so no logs are kept
const t0 = performance.now();
const violations: string[] = [];
const seeds = Array.from({ length: 1000 }, (_, i) => i + 1);
const on: ReturnType<typeof metricsRow>[] = [], off: ReturnType<typeof metricsRow>[] = [];
for (const seed of seeds) {
  const specOn = { content, seeds: [seed], days: 240, policy: "delegating" as const };
  const specOff = { ...specOn, ablate: ["threat" as SystemId] };
  let logOn: Sim["log"] = [];
  on.push(...runBatch(specOn, (row, sim) => { for (const v of checkRun(sim)) violations.push(`on seed ${seed}: ${v}`); logOn = sim.log; }));
  off.push(...runBatch(specOff, (row, sim) => {
    for (const v of checkRun(sim)) violations.push(`off seed ${seed}: ${v}`);
    for (const v of checkPairing(logOn, sim.log, "threat")) violations.push(`pairing seed ${seed}: ${v}`);
  }));
}
const secs = (performance.now() - t0) / 1000;
const rate = (rows: typeof on, f: (r: (typeof on)[number]) => boolean) => rows.filter(f).length / rows.length;
out.batch = {
  seedsPerArm: 1000, days: 240, wallClockSeconds: Math.round(secs * 10) / 10,
  invariantViolations: violations.length, firstViolations: violations.slice(0, 10),
  breachedOn: rate(on, (r) => r.endStateFlags.fortificationBreached), breachedOff: rate(off, (r) => r.endStateFlags.fortificationBreached),
  meanEvents: Math.round(on.reduce((a, r) => a + Object.values(r.eventsByType).reduce((x, y) => x + y, 0), 0) / on.length),
  meanDecisions: on.reduce((a, r) => a + r.decisionsTotal, 0) / on.length,
  staleOrWrongShare: on.reduce((a, r) => a + r.decisionsUsingStaleOrWrongBelief, 0) / Math.max(1, on.reduce((a, r) => a + r.decisionsTotal, 0)),
  meanWallClockPerSimYearMs: Math.round(on.reduce((a, r) => a + r.wallClockPerSimYear, 0) / on.length),
};
console.log("batch", JSON.stringify(out.batch));
mkdirSync("results", { recursive: true });
writeFileSync("results/phase1_gates.json", JSON.stringify(out, null, 2));
