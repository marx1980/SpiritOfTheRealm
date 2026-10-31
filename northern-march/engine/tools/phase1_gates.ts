// Phase 1 gate run: G-02 on 100 seeds (every system perturbed in turn), and the 1,000-seeds-per-arm batch
// with every invariant checked on every seed. G-01 cross-engine is run from the shell (node vs bun).
import { writeFileSync, mkdirSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim, type Sim } from "../src/engine.ts";
import { runBatch } from "../src/batch.ts";
import { checkRun, checkPairing } from "../src/invariants.ts";
import { canonicalJson } from "../src/canonical.ts";
import type { SystemId } from "../src/events.ts";

const content = loadContent(new URL("../content/testbed/", import.meta.url).pathname);
const out: Record<string, unknown> = {};

// G-02
const ROOT_DRAWN: Record<string, string> = { economy: "TreasuryCollected", weather: "Storm", threat: "ThreatBegan" };
const sig = (s: Sim, type: string) => canonicalJson(s.log.filter((e) => e.type === type).map((e) => [e.tick, e.payload]));
const g02: Record<string, { seeds: number; otherStreamsUnchanged: number; perturbedChanged: number }> = {};
for (const perturbed of Object.keys(ROOT_DRAWN) as SystemId[]) {
  let unchanged = 0, changed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const a = createSim({ content, seed, policy: "delegating" }); a.runDays(240);
    const b = createSim({ content, seed, policy: "delegating", params: { extraDraws: { [perturbed]: 3 } } }); b.runDays(240);
    if (Object.entries(ROOT_DRAWN).every(([sys, t]) => sys === perturbed || sig(a, t) === sig(b, t))) unchanged++;
    if (sig(a, ROOT_DRAWN[perturbed]) !== sig(b, ROOT_DRAWN[perturbed])) changed++;
  }
  g02[perturbed] = { seeds: 100, otherStreamsUnchanged: unchanged, perturbedChanged: changed };
}
out.G02 = { perSystem: g02, verdict: Object.values(g02).every((x) => x.otherStreamsUnchanged === 100) ? "PASS" : "FAIL" };
console.log("G-02", JSON.stringify(out.G02));

// 1,000 seeds per arm, invariants on every seed
const t0 = performance.now();
const violations: string[] = [];
const seeds = Array.from({ length: 1000 }, (_, i) => i + 1);
const logsOn = new Map<number, Sim["log"]>();
const on = runBatch({ content, seeds, days: 240, policy: "delegating" }, (row, sim) => {
  for (const v of checkRun(sim)) violations.push(`on seed ${row.seed}: ${v}`);
  logsOn.set(row.seed, sim.log);
});
const off = runBatch({ content, seeds, days: 240, policy: "delegating", ablate: ["threat"] }, (row, sim) => {
  for (const v of checkRun(sim)) violations.push(`off seed ${row.seed}: ${v}`);
  for (const v of checkPairing(logsOn.get(row.seed)!, sim.log, "threat")) violations.push(`pairing seed ${row.seed}: ${v}`);
});
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
