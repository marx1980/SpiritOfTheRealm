// Phase 7A: the Grain Crisis on a seed block. TUNE seeds (1-9,999) for tuning; blocks at multiples of 10,000 only through phase7_gate.ts.
// Reports the share of each outcome and the end state ("Varos acts on Greyfen's grievance") with the Blackwood threat on and off, per policy.
// Usage: node tools/phase7_crisis.ts <firstSeed> <count> <policy[,policy...]> [days]
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { OUTCOMES, readCrisis } from "../src/crisis.ts";
import { evaluateCausalGate } from "../src/gates.ts";

export function arms(first: number, count: number, policies: string[], days = 240) {
  const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
  const out: Record<string, any> = { block: [first, first + count - 1], content: content.version, contentHash: content.hash };
  for (const policy of policies) {
    const on: boolean[] = [], off: boolean[] = [], share: Record<string, number> = {}, shareOff: Record<string, number> = {};
    let violations = 0, hashSame = 0;
    for (let seed = first; seed < first + count; seed++) {
      const a = createSim({ content, seed, policy: policy as never }); a.runDays(days);
      const b = createSim({ content, seed, policy: policy as never, ablate: ["threat"] }); b.runDays(days);
      violations += checkRun(a).length + checkRun(b).length;
      const ra = readCrisis(a.log, content), rb = readCrisis(b.log, content);
      on.push(ra.endState); off.push(rb.endState);
      share[ra.outcome] = (share[ra.outcome] ?? 0) + 1; shareOff[rb.outcome] = (shareOff[rb.outcome] ?? 0) + 1;
      if (a.log.length === b.log.length) hashSame++;
    }
    const pct = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v * 1000) / count) / 10]));
    out[policy] = { seeds: count, invariantViolations: violations, outcomesOn: pct(share), outcomesOff: pct(shareOff), endState: evaluateCausalGate(on, off), identicalArms: hashSame };
  }
  return out;
}
if (process.argv[1]?.endsWith("phase7_crisis.ts")) {
  const [first, count, pols, days] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 100), (process.argv[4] ?? "passive,delegating,aggressive").split(","), Number(process.argv[5] ?? 240)];
  if (first >= 10000) throw new Error("blocks from 10,000 are gate blocks: use tools/phase7_gate.ts");
  console.log(JSON.stringify(arms(first, count, pols, days), null, 1));
}
void OUTCOMES;
