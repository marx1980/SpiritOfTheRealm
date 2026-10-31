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

export function run(cfg: Partial<SimConfig> & { seed: number }, days = 240) {
  const sim = createSim({ content: CONTENT, policy: "delegating", ...cfg });
  sim.runDays(days);
  return sim;
}
