import { deriveContent, loadContent, readContentDir, type RawContent } from "../src/content.ts";
import { createSim, type SimConfig } from "../src/engine.ts";

export const CONTENT_DIR = new URL("../content/march/", import.meta.url).pathname;
export const CONTENT = loadContent(CONTENT_DIR);

/** A content variant for one test: edit a fresh copy of the raw files, then validate and index it. */
export function variant(edit: (raw: RawContent) => void) {
  const raw = readContentDir(CONTENT_DIR);
  edit(raw);
  return deriveContent(raw);
}

/** Take the frontier (Phase 14B) out of a content copy: its block, its actors, its two places, its road and its province. */
export function stripFrontier(r: RawContent) {
  delete (r.scenario.grain as { blight?: unknown } | undefined)?.blight; // the bad harvest year belongs to Phase 14, with the frontier
  delete (r.scenario as { frontier?: unknown }).frontier;
  const gone = new Set(r.locations.filter((l) => l.province === "arven").map((l) => l.id));
  r.locations = r.locations.filter((l) => !gone.has(l.id));
  r.routes = r.routes.filter((x) => !gone.has(x.from) && !gone.has(x.to));
  r.characters = r.characters.filter((c) => c.house !== "arven" && c.id !== "pell");
  r.provinces = r.provinces.filter((p) => p.id !== "arven");
}

/** The scenario as it was before Phase 10 (no environment block, and since Phase 11 no Blackwood): dry roads, the placeholder weather, no hunts. For tests that pin exact travel times or the old weather. */
export const legacyVariant = (edit: (raw: RawContent) => void = () => {}) => variant((r) => { delete (r.scenario as { environment?: unknown }).environment; delete (r.scenario as { wilds?: unknown }).wilds; stripFrontier(r); if (r.scenario.battle.tactics) delete r.scenario.battle.tactics.full; for (const c of r.characters) if (c.id === "bren") c.relationships = c.relationships.filter((x) => !(x.kind === "recommends" && x.to === "edda")); edit(r); });
export const LEGACY = legacyVariant();

export function run(cfg: Partial<SimConfig> & { seed: number }, days = 240) {
  const sim = createSim({ content: CONTENT, policy: "delegating", ...cfg });
  sim.runDays(days);
  return sim;
}

/** `run` on the pre-environment scenario (for tests that pin old trajectories and balance). */
export const legacyRun = (cfg: Partial<SimConfig> & { seed: number }, days = 240) => run({ content: LEGACY, ...cfg }, days);
