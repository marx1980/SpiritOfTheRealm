// L8: adversarial search (v4 L8, after approval). A bounded, deterministic mutation search over the same edit surface as
// L9 (improve.ts ALLOWLIST), with a quality-diversity archive over behaviour cells. It looks for two things a reviewer
// should see: exploits (behaviour that meets the objective in a way nobody should want) and cliffs (outcomes that jump
// on one small step). Development seeds only; nothing is applied. Every finding is a candidate for review and must be
// confirmed on validation seeds (and the gates re-run) before any change.
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT_DIR, labContent, readSummaries, runLab, type Patch, type Summary } from "./lab.ts";
import { PLAYTEST_SCHEMA_VERSION, type Persona, type PlaytestRunManifest } from "./contract.ts";
import { assertAllowed, assertSeeds, ALLOWLIST } from "./improve.ts";
import { readContentDir } from "../content.ts";
import { engineHash } from "../batch.ts";

export const SEARCH_PERSONAS: Persona[] = ["adviser-dependent", "community-protector", "delegating-strategist", "passive"];

/** The edit surface as a grid: each parameter takes one of its allowlisted values. */
export const gridOf = (a: { min: number; max: number; step: number }) => Array.from({ length: Math.round((a.max - a.min) / a.step) + 1 }, (_, i) => a.min + i * a.step);
export const GRID = ALLOWLIST.map(gridOf);
export const gridSize = () => GRID.reduce((a, g) => a * g.length, 1);

/** Behaviour cells: what one game looked like. 4 x 3 x 2 x 2 = 48 cells. */
export const levyBin = (n: number) => (n === 0 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : 3);
export const reliefBin = (n: number) => (n === 0 ? 0 : n <= 9 ? 1 : 2);
export const CELLS = 4 * 3 * 2 * 2;
/** Levy bin 2 means 6 to 15 levies a game; the objective met in such a game is an exploit candidate. */
export const isExploitCell = (c: string) => c.includes("O1") && Number(c.slice(1, 2)) >= 2;
export const cellOf = (s: Pick<Summary, "levies" | "reliefs" | "objectiveMet" | "topStance">) =>
  `L${levyBin(s.levies)}R${reliefBin(s.reliefs)}O${s.objectiveMet ? 1 : 0}V${Object.values(s.topStance).includes("support") ? 1 : 0}`;

/** Seeded, deterministic generator (mulberry32). */
export function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A genome is one grid index per allowlisted parameter. */
export type Genome = number[];
export const key = (g: Genome) => g.join(",");
export const valuesOf = (g: Genome) => g.map((idx, i) => GRID[i][idx]);
export const changedOf = (g: Genome, base: Genome) => g.filter((idx, i) => idx !== base[i]).length;
export function patchOf(g: Genome, base: Genome): Patch[] {
  return g.flatMap((idx, i) => (idx === base[i] ? [] : [{ path: ALLOWLIST[i].path, value: GRID[i][idx] }]));
}
/** Single-step neighbours inside the grid. */
export function neighbours(g: Genome): { genome: Genome; param: number; from: number; to: number }[] {
  const out: { genome: Genome; param: number; from: number; to: number }[] = [];
  g.forEach((idx, i) => {
    for (const d of [-1, 1]) {
      const n = idx + d;
      if (n < 0 || n >= GRID[i].length) continue;
      const genome = [...g]; genome[i] = n; out.push({ genome, param: i, from: GRID[i][idx], to: GRID[i][n] });
    }
  });
  return out;
}

export interface Evaluated { genome: Genome; values: number[]; changed: number; sums: Summary[]; dir: string }
export interface SearchOptions { id: string; firstSeed: number; seeds: number; days: number; budget: number; rngSeed: number; outDir: string }

async function evaluate(o: SearchOptions, k: number, genome: Genome, base: Genome, partition: "dev" | "validation" = "dev"): Promise<Evaluated> {
  const patch = patchOf(genome, base);
  assertAllowed(patch); assertSeeds(o.firstSeed, o.seeds, partition);
  const dir = `${o.outDir}/g${k}`;
  const lab = labContent(CONTENT_DIR);
  const m: PlaytestRunManifest = { schemaVersion: PLAYTEST_SCHEMA_VERSION, runSetId: `${o.id}-g${k}`, mode: "paired", partition, commit: "l8", engineHash: engineHash(),
    contentVersion: lab.version, contentHash: lab.hash, scenario: "march", days: o.days, seeds: { first: o.firstSeed, count: o.seeds }, personas: SEARCH_PERSONAS,
    params: { contentPatch: patch }, budgets: { maxGames: o.seeds * SEARCH_PERSONAS.length, workers: 2, wallMs: 3 * 3600_000, artifactBytes: 400 << 20, llmCalls: 0 } };
  const r = await runLab(m, { outDir: dir });
  if (r.reason !== "complete") throw new Error(`${o.id}-g${k} stopped: ${r.reason} ${r.detail}`);
  return { genome, values: valuesOf(genome), changed: changedOf(genome, base), sums: readSummaries(dir), dir };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function search(o: SearchOptions) {
  mkdirSync(o.outDir, { recursive: true });
  const raw = readContentDir(CONTENT_DIR) as unknown as Record<string, unknown>;
  const base: Genome = ALLOWLIST.map((a, i) => {
    const v = a.path.split(".").reduce<any>((x, k) => x[k], raw);
    const idx = GRID[i].indexOf(v);
    if (idx < 0) throw new Error(`${a.path}=${v} is not on its grid`);
    return idx;
  });
  const seen = new Map<string, Evaluated>();
  let k = 0;
  const run = async (g: Genome) => { const e = await evaluate(o, ++k, g, base); seen.set(key(g), e); return e; };

  // 1. the baseline and every single-step neighbour of it (these give the first cliff checks)
  await run(base);
  for (const n of neighbours(base)) if (seen.size < o.budget && !seen.has(key(n.genome))) await run(n.genome);

  // 2. bounded mutation: pick an evaluated genome at random, move one parameter one step, evaluate, until the budget
  const rnd = rngOf(o.rngSeed);
  let tries = 0;
  while (seen.size < o.budget && tries < o.budget * 20) {
    tries++;
    const pool = [...seen.values()];
    const parent = pool[Math.floor(rnd() * pool.length)].genome;
    const nb = neighbours(parent);
    const child = nb[Math.floor(rnd() * nb.length)].genome;
    if (seen.has(key(child))) continue;
    await run(child);
  }

  // 3. quality-diversity archive: per cell, the simplest genome that reached it, with up to three example games
  const archive = new Map<string, { games: number; examples: { genome: number[]; values: number[]; changed: number; persona: Persona; seed: number; levies: number; reliefs: number; objectiveMet: boolean }[] }>();
  for (const e of seen.values()) for (const s of e.sums) {
    const c = cellOf(s);
    const a = archive.get(c) ?? { games: 0, examples: [] };
    a.games++;
    a.examples.push({ genome: e.genome, values: e.values, changed: e.changed, persona: s.persona, seed: s.seed, levies: s.levies, reliefs: s.reliefs, objectiveMet: s.objectiveMet });
    a.examples.sort((x, y) => x.changed - y.changed || x.seed - y.seed).splice(3);
    archive.set(c, a);
  }

  // 4. exploits: the objective met with heavy levying (6 or more a game), which a reviewer should check against intent
  const exploits = [...archive.entries()].filter(([c]) => isExploitCell(c))
    .map(([cell, a]) => ({ cell, games: a.games, examples: a.examples.slice(0, 3) }));

  // 5. cliffs: two genomes one step apart on one parameter, same seeds, same persona; objective met changes by 50 points or more
  const cliffs: { param: string; from: number; to: number; persona: Persona; objectiveFrom: number; objectiveTo: number; seeds: number; diff: number }[] = [];
  const all = [...seen.values()];
  for (const a of all) for (const b of all) {
    if (a === b || a.genome.length !== b.genome.length) continue;
    const moved = a.genome.map((x, i) => Math.abs(x - b.genome[i]));
    const i = moved.indexOf(1);
    if (i < 0 || moved.some((d, j) => j !== i && d !== 0) || a.genome[i] > b.genome[i]) continue;
    for (const p of SEARCH_PERSONAS) {
      const xa = a.sums.filter((s) => s.persona === p), xb = b.sums.filter((s) => s.persona === p);
      const oa = mean(xa.map((s) => (s.objectiveMet ? 1 : 0))), ob = mean(xb.map((s) => (s.objectiveMet ? 1 : 0)));
      if (Math.abs(oa - ob) >= 0.5) cliffs.push({ param: ALLOWLIST[i].path, from: GRID[i][a.genome[i]], to: GRID[i][b.genome[i]], persona: p, objectiveFrom: Math.round(100 * oa), objectiveTo: Math.round(100 * ob), seeds: xa.length, diff: Math.round(100 * (ob - oa)) });
    }
  }
  cliffs.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  const verdict = exploits.length || cliffs.length
    ? `FINDINGS FOR REVIEW: ${exploits.length} exploit cell(s), ${cliffs.length} cliff(s). Nothing applied. Confirm on validation seeds before any change.`
    : "NO FINDINGS: no exploit cell and no cliff in the searched grid";
  const out = { schemaVersion: PLAYTEST_SCHEMA_VERSION, id: o.id, mode: "search", partition: "dev", firstSeed: o.firstSeed, seeds: o.seeds, days: o.days, personas: SEARCH_PERSONAS,
    budget: o.budget, genomesEvaluated: seen.size, gridSize: gridSize(), cellsFilled: archive.size, cells: CELLS, base: valuesOf(base), allowlist: ALLOWLIST,
    archive: Object.fromEntries([...archive.entries()].sort()), exploits, cliffs: cliffs.slice(0, 50), cliffCount: cliffs.length, verdict, applied: false, engineHash: engineHash() };
  writeFileSync(`${o.outDir}/search.json`, JSON.stringify(out, null, 1));
  return out;
}

/** Confirmation sweep on validation seeds: one parameter walks its whole grid, the others stay at the baseline. Output is evidence for review; nothing is applied. */
export async function sweep(o: SearchOptions & { param: string }) {
  mkdirSync(o.outDir, { recursive: true });
  const raw = readContentDir(CONTENT_DIR) as unknown as Record<string, unknown>;
  const base: Genome = ALLOWLIST.map((a, i) => GRID[i].indexOf(a.path.split(".").reduce<any>((x, k) => x[k], raw)));
  const pi = ALLOWLIST.findIndex((a) => a.path === o.param);
  if (pi < 0) throw new Error(`${o.param} is not on the edit allowlist`);
  const rows: { value: number; persona: Persona; games: number; objectiveMet: number; levies: number; heavyLevyObjective: number }[] = [];
  let k = 0;
  for (let idx = 0; idx < GRID[pi].length; idx++) {
    const g = [...base]; g[pi] = idx;
    const e = await evaluate(o, ++k, g, base, "validation");
    for (const p of SEARCH_PERSONAS) {
      const xs = e.sums.filter((x) => x.persona === p);
      rows.push({ value: GRID[pi][idx], persona: p, games: xs.length, objectiveMet: Math.round(1000 * mean(xs.map((x) => (x.objectiveMet ? 1 : 0)))) / 10,
        levies: Math.round(10 * mean(xs.map((x) => x.levies))) / 10, heavyLevyObjective: Math.round(1000 * mean(xs.map((x) => (x.objectiveMet && x.levies >= 6 ? 1 : 0)))) / 10 });
    }
  }
  const out = { schemaVersion: PLAYTEST_SCHEMA_VERSION, id: o.id, mode: "sweep", partition: "validation", param: o.param, baseValue: GRID[pi][base[pi]], firstSeed: o.firstSeed, seeds: o.seeds, days: o.days, personas: SEARCH_PERSONAS, rows, applied: false, engineHash: engineHash() };
  writeFileSync(`${o.outDir}/sweep.json`, JSON.stringify(out, null, 1));
  return out;
}
