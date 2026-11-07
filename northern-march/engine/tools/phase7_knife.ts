// G-06 knife-edge test (plan C0.6) for Phase 7A on TUNE seeds: each declared parameter at -25% and +25%; the headline metric is the end-state rate
// (threat ON) under delegating and aggressive. A parameter is knife-edge if either run drives that rate to 0 or above twice the band's upper edge (80%).
//   node tools/phase7_knife.ts <firstSeed> <count> [policies]
import { readContentDir, deriveContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { readCrisis } from "../src/crisis.ts";

const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const [first, count, pols] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 150), (process.argv[4] ?? "delegating,aggressive").split(",")];
if (first >= 10000) throw new Error("G-06 runs on TUNE seeds");
const scale = (v: number, pct: number) => Math.max(1, Math.round((v * (100 + pct)) / 100));
const PARAMS: { id: string; get: (r: any) => number; set: (r: any, v: number) => void }[] = [
  { id: "harvestHitPermille", get: (r) => r.scenario.grain.harvestHitPermille, set: (r, v) => (r.scenario.grain.harvestHitPermille = Math.min(1000, v)) },
  { id: "harvestHitDays", get: (r) => r.scenario.grain.harvestHitDays, set: (r, v) => (r.scenario.grain.harvestHitDays = v) },
  { id: "requisition.grievance", get: (r) => r.scenario.grain.requisition.grievance, set: (r, v) => (r.scenario.grain.requisition.grievance = v) },
  { id: "requisition.consultedPermille", get: (r) => r.scenario.grain.requisition.consultedPermille, set: (r, v) => (r.scenario.grain.requisition.consultedPermille = Math.min(1000, v)) },
  { id: "refuse.chancePerG", get: (r) => r.scenario.grain.requisition.refuse.chancePerG, set: (r, v) => (r.scenario.grain.requisition.refuse.chancePerG = v) },
  { id: "official.consultCover", get: (r) => r.scenario.grain.official.consultCover, set: (r, v) => (r.scenario.grain.official.consultCover = v) },
  { id: "greyfen.supportAt", get: (r) => r.communities.communities.find((c: any) => c.id === "greyfen").supportAt, set: (r, v) => (r.communities.communities.find((c: any) => c.id === "greyfen").supportAt = v) },
  { id: "narrative.trustPerDay", get: (r) => r.communities.params.narrative.trustPerDay, set: (r, v) => (r.communities.params.narrative.trustPerDay = v) },
];
const rate = (content: ReturnType<typeof deriveContent>, policy: string) => {
  let k = 0;
  for (let seed = first; seed < first + count; seed++) { const s = createSim({ content, seed, policy: policy as never }); s.runDays(240); if (readCrisis(s.log, content).endState) k++; }
  return Math.round((k * 1000) / count) / 10;
};
const out: Record<string, any> = { seeds: [first, first + count - 1], policies: pols };
const baseContent = deriveContent(readContentDir(dir));
out.baseline = Object.fromEntries(pols.map((p) => [p, rate(baseContent, p)]));
let knife = 0;
out.params = {};
for (const P of PARAMS) {
  const row: Record<string, any> = {};
  let edge = false;
  for (const pct of [-25, 25]) {
    const raw: any = readContentDir(dir); const v0 = P.get(raw); P.set(raw, scale(v0, pct));
    const c = deriveContent(raw);
    row[`${pct > 0 ? "+" : ""}${pct}%`] = Object.fromEntries(pols.map((p) => { const r = rate(c, p); if (r === 0 || r > 80) edge = true; return [p, r]; }));
  }
  row.base = P.get(readContentDir(dir)); row.knifeEdge = edge; if (edge) knife++;
  out.params[P.id] = row;
  console.error(P.id, JSON.stringify(row));
}
out.knifeEdgeCount = knife; out.G06 = knife <= 2 ? "PASS" : "FAIL";
console.log(JSON.stringify(out, null, 1));
