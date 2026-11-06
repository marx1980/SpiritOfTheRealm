// L9: controlled improvement (v4 L9, V4_1 A11). A bounded search over an allowlist of economy numbers, against a
// target fixed before any run, on development seeds; the best candidate must then hold on validation seeds. The output
// is a PROPOSAL for review. Nothing is applied to content, code, tests, gates or partitions. Sealed seeds are refused.
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT_DIR, labContent, readSummaries, runLab, type Patch, type Summary } from "./lab.ts";
import { readContentDir } from "../content.ts";
import { PLAYTEST_SCHEMA_VERSION, type Persona, type PlaytestRunManifest } from "./contract.ts";
import { engineHash } from "../batch.ts";

/** Edit surface. Each entry: dotted path into the raw content, bounds and step. Nothing else may be changed. */
export const ALLOWLIST: { path: string; min: number; max: number; step: number; why: string }[] = [
  { path: "scenario.player.levyMilli", min: 30000, max: 60000, step: 5000, why: "what one levy brings in" },
  { path: "scenario.economy.dailyUpkeepMilli", min: 20000, max: 30000, step: 2500, why: "what the crown spends each day" },
  { path: "scenario.economy.captainAwayMilli", min: 1000, max: 3000, step: 500, why: "what an absent captain costs each day" },
];

/** The target, fixed before the search (v4 evaluation hierarchy item 3). Levy spam was reported in playtest round 1. */
export const TARGET = { persona: "adviser-dependent" as Persona, metric: "levies per game", maxAfter: 5, baselineNote: "about 20 levies a game in the first dev run" };
/** Guards: a candidate that breaks any of these is rejected whatever the target says (items 1, 2, 4 and 6). */
export const GUARDS = {
  objectiveDropPoints: 5,      // objective met, per persona, may fall by at most this many points (dev)
  rivalRisePoints: 5,          // the rival following, per persona, may rise by at most this many points
  maxChangedParams: 2,         // simplicity (item 7): at most this many parameters away from the baseline
  maxPerformanceRatio: 1.25,   // wall time per game against the baseline
};
const PERSONAS_SEARCH: Persona[] = ["adviser-dependent", "community-protector", "delegating-strategist", "passive"];

export interface Eval { patch: Patch[]; partition: string; games: number; levies: Record<string, number>; objectiveMet: Record<string, number>; rival: Record<string, number>; newFailures: number; invalidNonAdv: number; msPerGame: number; dir: string }

function assertAllowed(patch: Patch[]) {
  for (const p of patch) {
    const a = ALLOWLIST.find((x) => x.path === p.path);
    if (!a) throw new Error(`${p.path} is not on the edit allowlist`);
    if (typeof p.value !== "number" || p.value < a.min || p.value > a.max) throw new Error(`${p.path}=${p.value} outside ${a.min}..${a.max}`);
  }
  if (new Set(patch.map((p) => p.path)).size !== patch.length) throw new Error("a parameter appears twice");
}
function assertSeeds(first: number, count: number, partition: "dev" | "validation") {
  const [lo, hi] = partition === "dev" ? [1, 4999] : [5000, 9999];
  if (first < lo || first + count - 1 > hi) throw new Error(`${partition} seeds are ${lo}..${hi}; sealed or out-of-range seeds are refused`);
}

async function evaluate(runSetId: string, dir: string, patch: Patch[], partition: "dev" | "validation", first: number, count: number, personas: Persona[], days: number): Promise<Eval> {
  assertAllowed(patch); assertSeeds(first, count, partition);
  const m: PlaytestRunManifest = { schemaVersion: PLAYTEST_SCHEMA_VERSION, runSetId, mode: "paired", partition, commit: "l9", engineHash: engineHash(), contentVersion: labContent(CONTENT_DIR).version,
    contentHash: labContent(CONTENT_DIR).hash, scenario: "march", days, seeds: { first, count }, personas, params: { contentPatch: patch },
    budgets: { maxGames: count * personas.length, workers: 2, wallMs: 3 * 3600_000, artifactBytes: 400 << 20, llmCalls: 0 } };
  const r = await runLab(m, { outDir: dir });
  if (r.reason !== "complete") throw new Error(`${runSetId} stopped: ${r.reason} ${r.detail}`);
  const sums: Summary[] = readSummaries(dir);
  const by = (f: (s: Summary) => number) => Object.fromEntries(personas.map((p) => { const xs = sums.filter((s) => s.persona === p); return [p, xs.length ? xs.reduce((a, s) => a + f(s), 0) / xs.length : 0]; }));
  return {
    patch, partition, games: sums.length, levies: by((s) => s.levies), objectiveMet: by((s) => (s.objectiveMet ? 100 : 0)),
    rival: by((s) => (Object.values(s.topStance).includes("support") ? 100 : 0)),
    newFailures: sums.reduce((a, s) => a + s.newFailures, 0), invalidNonAdv: sums.filter((s) => s.persona !== "adversarial-probe").reduce((a, s) => a + s.invalid, 0),
    msPerGame: sums.reduce((a, s) => a + s.ms, 0) / Math.max(1, sums.length), dir,
  };
}

/** Accept a candidate against the baseline: the target improves and every guard holds. */
export function judge(base: Eval, cand: Eval): { ok: boolean; reasons: string[]; target: { before: number; after: number } } {
  const reasons: string[] = [];
  const before = base.levies[TARGET.persona], after = cand.levies[TARGET.persona];
  if (!(after < before)) reasons.push(`target: ${TARGET.metric} ${after} is not below ${before}`);
  if (after > TARGET.maxAfter && before - after < (before - TARGET.maxAfter) / 2) reasons.push(`target: only ${(before - after).toFixed(1)} fewer, under half the way to ${TARGET.maxAfter}`);
  for (const p of Object.keys(base.objectiveMet)) {
    if (base.objectiveMet[p] - cand.objectiveMet[p] > GUARDS.objectiveDropPoints * 1) reasons.push(`guard: objective met for ${p} fell ${(base.objectiveMet[p] - cand.objectiveMet[p]).toFixed(1)} points`);
    if (cand.rival[p] - base.rival[p] > GUARDS.rivalRisePoints) reasons.push(`guard: the rival following for ${p} rose ${(cand.rival[p] - base.rival[p]).toFixed(1)} points`);
  }
  if (cand.newFailures > base.newFailures) reasons.push(`guard: ${cand.newFailures - base.newFailures} new invariant failure(s)`);
  if (cand.invalidNonAdv > 0) reasons.push(`guard: ${cand.invalidNonAdv} rejected decisions from non-adversarial personas`);
  if (cand.msPerGame > base.msPerGame * GUARDS.maxPerformanceRatio) reasons.push(`guard: performance ${Math.round(cand.msPerGame)} ms vs ${Math.round(base.msPerGame)} ms`);
  if (cand.patch.length > GUARDS.maxChangedParams) reasons.push(`simplicity: ${cand.patch.length} parameters changed`);
  return { ok: reasons.length === 0, reasons, target: { before, after } };
}

/** Paired bootstrap of the target on validation: the per-seed difference in levies, resampled over seeds. */
export function persists(base: Summary[], cand: Summary[], persona: Persona, B = 2000): { diff: number; lo: number; hi: number } {
  const bs = base.filter((s) => s.persona === persona), cs = cand.filter((s) => s.persona === persona);
  const d = bs.map((b, i) => cs[i].levies - b.levies), n = d.length;
  let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const means: number[] = [];
  for (let k = 0; k < B; k++) { let t = 0; for (let i = 0; i < n; i++) t += d[Math.floor(rnd() * n)]; means.push(t / n); }
  means.sort((x, y) => x - y);
  return { diff: d.reduce((a, b) => a + b, 0) / n, lo: means[Math.floor(0.025 * B)], hi: means[Math.floor(0.975 * B)] };
}

export interface ImproveOptions { id: string; devSeeds: number; valSeeds: number; days: number; maxCandidates: number; outDir: string }
export async function improve(o: ImproveOptions) {
  mkdirSync(o.outDir, { recursive: true });
  const log: Record<string, unknown>[] = [];
  const base = await evaluate(`${o.id}-base`, `${o.outDir}/base-dev`, [], "dev", 1, o.devSeeds, PERSONAS_SEARCH, o.days);
  log.push({ step: "baseline", dev: base });
  let best: Eval = base, tried = 0;
  // greedy coordinate search: each allowlisted number moves one step up or down from the current best; keep what passes
  for (const a of ALLOWLIST) {
    const cur = (best.patch.find((p) => p.path === a.path)?.value ?? a.path.split(".").reduce((o2: any, k) => o2[k], readContentDir(CONTENT_DIR) as unknown as any)) as number;
    for (const v of [cur - a.step, cur + a.step]) {
      if (tried >= o.maxCandidates || v < a.min || v > a.max) continue;
      const patch = [...best.patch.filter((p) => p.path !== a.path), { path: a.path, value: v }];
      if (patch.length > GUARDS.maxChangedParams) continue;
      tried++;
      const c = await evaluate(`${o.id}-c${tried}`, `${o.outDir}/c${tried}-dev`, patch, "dev", 1, o.devSeeds, PERSONAS_SEARCH, o.days);
      const j = judge(base, c);
      log.push({ step: `candidate ${tried}`, patch, dev: c, judged: j });
      if (j.ok && c.levies[TARGET.persona] < best.levies[TARGET.persona]) best = c;
    }
  }
  let validation: null | Record<string, unknown> = null;
  let verdict = "NO CANDIDATE: no change passed the target and the guards on dev seeds";
  if (best.patch.length) {
    const vBase = await evaluate(`${o.id}-base-val`, `${o.outDir}/base-val`, [], "validation", 5000, o.valSeeds, PERSONAS_SEARCH, o.days);
    const vCand = await evaluate(`${o.id}-cand-val`, `${o.outDir}/cand-val`, best.patch, "validation", 5000, o.valSeeds, PERSONAS_SEARCH, o.days);
    const vj = judge(vBase, vCand);
    const pers = persists(readSummaries(`${o.outDir}/base-val`), readSummaries(`${o.outDir}/cand-val`), TARGET.persona);
    const holds = vj.ok && pers.hi < 0;
    validation = { base: vBase, cand: vCand, judged: vj, levyChange: pers };
    verdict = holds ? "PROPOSED: passes dev and validation. Needs review before any change; gates (G-12, G-13) must be re-run on a fresh sealed block before adoption."
      : "NOT CONFIRMED: the dev gain did not hold on validation seeds";
  }
  const out = { schemaVersion: PLAYTEST_SCHEMA_VERSION, id: o.id, target: TARGET, guards: GUARDS, allowlist: ALLOWLIST, devSeeds: o.devSeeds, valSeeds: o.valSeeds, days: o.days,
    candidates: tried, verdict, proposal: best.patch.length ? best.patch : null, applied: false, log, validation, engineHash: engineHash() };
  writeFileSync(`${o.outDir}/proposal.json`, JSON.stringify(out, null, 1));
  return out;
}
