// Phase 6 (6A) gate: G-13 on a sealed seed block, under the given policies, plus the community dashboard
// (reported, not gated): how far each community climbs the ladder, petitions, misconduct, relief, divergence.
// Usage: node tools/phase6_gate.ts <firstSeed> <count> <policy[,policy...]>
import { loadContent, STANCES } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";

const [first, count, pols] = [Number(process.argv[2] ?? 60000), Number(process.argv[3] ?? 1000), (process.argv[4] ?? "passive,delegating,aggressive").split(",")];
if (first < 10000) throw new Error("gate runs refuse seeds below 10,000 (C3)");
const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
const rung = (s: string) => STANCES.indexOf(s as (typeof STANCES)[number]);
const ids = content.communities.communities.map((c) => c.id).sort();

const out: Record<string, unknown> = { block: [first, first + count - 1], content: content.version, contentHash: content.hash };
for (const policy of pols) {
  let unsupported = 0, revolts = 0, violations = 0, divergent = 0, levySeeds = 0;
  const reached: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, STANCES.map(() => 0)]));
  const counts = { petitions: 0, misconduct: 0, relief: 0, stanceChanges: 0, letters: 0 };
  const first5: string[] = [];
  for (let seed = first; seed < first + count; seed++) {
    const sim = createSim({ content, seed, policy: policy as never });
    sim.runDays(240);
    const v = checkRun(sim);
    violations += v.length; if (v.length && first5.length < 5) first5.push(`seed ${seed}: ${v[0]}`);
    const top: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const e of sim.log) {
      if (e.type === "CommunityStanceChanged") {
        counts.stanceChanges++;
        const c = e.payload.community as string, to = rung(e.payload.to as string), from = rung(e.payload.from as string);
        top[c] = Math.max(top[c], to);
        const g = e.payload.gates as Record<string, boolean>;
        if (to >= 3 && to > from && !(g.G && g.N && g.L && g.T && (e.payload.inputs as { leader: string | null }).leader)) unsupported++;
      }
      if (/Revolt/.test(e.type)) revolts++;
      if (e.type === "PetitionMade") counts.petitions++;
      if (e.type === "TroopMisconduct") counts.misconduct++;
      if (e.type === "ReliefDelivered") counts.relief++;
      if (e.type === "ReportComposed" && /^(petition|community):/.test(String((e.payload.report as { purpose?: string }).purpose ?? ""))) counts.letters++;
    }
    for (const id of ids) reached[id][top[id]]++;
    // I02 at scale: of the communities that paid the same levies, did they end at different heights on the ladder?
    const levied = sim.log.some((e) => e.type === "LevyRaised");
    if (levied) { levySeeds++; const payers = ids.filter((id) => (content.communities.communities.find((c) => c.id === id)!.levySharePermille > 0)); if (new Set(payers.map((id) => top[id])).size > 1) divergent++; }
  }
  out[policy] = {
    seeds: count, G13: { revolts, unsupportedEscalations: unsupported, verdict: revolts === 0 && unsupported === 0 ? "PASS" : "FAIL" }, invariantViolations: violations, firstViolations: first5,
    highestRungShare: Object.fromEntries(ids.map((id) => [id, Object.fromEntries(STANCES.map((s, i) => [s, Math.round((reached[id][i] * 1000) / count) / 10]))])),
    perRun: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Math.round((n * 100) / count) / 100])),
    levySeeds, payersDiverge: levySeeds ? Math.round((divergent * 1000) / levySeeds) / 10 : null,
  };
  console.log(policy, JSON.stringify(out[policy]));
}
console.log(JSON.stringify(out, null, 1));
