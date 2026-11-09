// A battle at Northwatch from the scenario's own content, for tests and the lab: Bren's garrison with Edda's archers,
// Caron's company, the raiders of the Blackwood, and Anna with her guard if asked for. Reads content from disk (Node only).
import { loadContent, type Content } from "../content.ts";
import type { BattleSetup } from "./core.ts";
import { buildSetup, personOf } from "./setup.ts";

let cached: Content | undefined;
const content = () => (cached ??= loadContent(new URL("../../content/march/", import.meta.url).pathname));

export const person = personOf;

export function sampleSetup(o: { seed: number; anna?: "rear" | "centre" | "forward"; raiders?: number; weather?: "clear" | "rain"; noCaron?: boolean; content?: Content }): BattleSetup {
  const c = o.content ?? content(), b = c.scenario.battle;
  return buildSetup({
    battleId: 1, seed: o.seed, site: "blackwood", place: "Northwatch", endT: 4 * 3600, weather: o.weather ?? "clear",
    field: b.field!, params: b.tactics!, forces: b.forces!, obedience: c.scenario.agents.obedience,
    garrison: { men: c.byId.location.get("northwatch")!.fortification!.garrison, castellan: person(c, "bren"), sergeant: person(c, "edda") },
    companies: o.noCaron ? [] : [{ captain: person(c, "caron"), men: c.byId.character.get("caron")!.troops! }],
    raiderMen: o.raiders ?? 360,
    ruler: { ...person(c, "anna"), present: !!o.anna, ...(o.anna ? { post: o.anna } : {}) },
  });
}
