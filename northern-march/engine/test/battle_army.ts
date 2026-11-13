// The lab army (Phase 12, docs/COMMAND.md §9): three wings and about 15 formations a side on the Northwatch field, from the
// scenario's own characters, against a large raider host. For tests and the G-20 gate. Reads content from disk (Node only).
import { loadContent, type Content } from "../src/content.ts";
import type { BattleOrder, BattleSetup, Task } from "../src/battlefield/core.ts";
import { buildArmySetup, personOf, type ArmyInputs } from "../src/battlefield/setup.ts";

let cached: Content | undefined;
export const labContent = () => (cached ??= loadContent(new URL("../content/march/", import.meta.url).pathname));

/** Where each wing stands and what it holds. */
export const WINGS = { left: "fold", centre: "ridge", right: "woodedge" } as const;
export type ArmyPlan = "hold" | "delegate" | "attack";
/** The raider host by seed: an even fight, a hard one, a hopeless one. */
export const HOSTS = [1600, 2200, 2800];

export function armyInputs(o: { seed: number; plan?: ArmyPlan; raiders?: number; anna?: "rear" | "centre" | "forward"; content?: Content; noFull?: boolean }): ArmyInputs {
  const c = o.content ?? labContent(), b = c.scenario.battle, p = (id: string) => personOf(c, id);
  const params = structuredClone(b.tactics!);
  if (o.noFull) delete params.full;
  return {
    battleId: 1, seed: o.seed, site: "blackwood", place: "Northwatch", endT: 4 * 3600, weather: "clear",
    field: b.field!, params, forces: b.forces!, obedience: c.scenario.agents.obedience,
    wings: [
      { at: "left", lead: p("caron"), own: [{ kind: "horse", men: 120 }, { kind: "foot", men: 100 }], subs: [{ person: p("tobin"), kind: "foot", men: 150 }, { person: p("neve"), kind: "horse", men: 80 }] },
      { at: "centre", lead: p("elara"), own: [{ kind: "foot", men: 200 }, { kind: "horse", men: 80 }], subs: [{ person: p("bren"), kind: "foot", men: 180 }, { person: p("edda"), kind: "archers", men: 120 }, { person: p("stefan"), kind: "archers", men: 80 }] },
      { at: "right", lead: p("varos"), own: [{ kind: "foot", men: 150 }, { kind: "horse", men: 80 }], subs: [{ person: p("rurik"), kind: "foot", men: 160 }, { person: p("corwin"), kind: "archers", men: 80 }, { person: p("ilka"), kind: "foot", men: 100 }] },
    ],
    raiderMen: o.raiders ?? HOSTS[o.seed % HOSTS.length],
    ruler: { ...p("anna"), present: true, post: o.anna ?? "rear" },
    plan: armyPlan(o.plan ?? "delegate"),
  };
}

/** Headquarters' plan before the fight, three ways: everyone told directly to hold; the wings delegated; everyone told to attack. */
export function armyPlan(kind: ArmyPlan): BattleOrder[] {
  const wing = { left: { lead: "caron", subs: ["tobin", "neve"] }, centre: { lead: "elara", subs: ["bren", "edda", "stefan"] }, right: { lead: "varos", subs: ["rurik", "corwin", "ilka"] } };
  const out: BattleOrder[] = [];
  const add = (to: string, task: Task) => out.push({ schemaVersion: 1, id: out.length + 1, t: 0, from: "anna", to, task, via: "voice" });
  for (const [at, w] of Object.entries(wing) as [keyof typeof WINGS, (typeof wing)["left"]][]) {
    const place = WINGS[at];
    if (kind === "delegate") add(w.lead, { kind: "hold", place, command: [...w.subs] });
    else for (const id of [w.lead, ...w.subs]) add(id, kind === "hold" ? { kind: "hold", place } : { kind: "attack", place: "ford", limit: "stream" });
  }
  return out;
}

export const armySetup = (o: Parameters<typeof armyInputs>[0]): BattleSetup => buildArmySetup(armyInputs(o));
