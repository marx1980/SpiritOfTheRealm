import { loadContent } from "../src/content.ts";
import { createSim, type SimConfig } from "../src/engine.ts";

export const CONTENT = loadContent(new URL("../content/testbed/", import.meta.url).pathname);

export function run(cfg: Partial<SimConfig> & { seed: number }, days = 240) {
  const sim = createSim({ content: CONTENT, policy: "delegating", ...cfg });
  sim.runDays(days);
  return sim;
}
