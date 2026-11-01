// A6: scripted player policies. A policy sees only ViewOf(player) and may draw from the "player" stream.
import type { Rng } from "./rng.ts";
import { beliefsAbout, type OrderDraft, type View } from "./view.ts";
import { captainSentTo } from "./presentation/phrasing.ts";


export type PolicyId = "passive" | "delegating" | "aggressive" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser" | "external" | "replay" | `follow:${string}`;
/** `mission` (for sending a captain): defend the fort (default), or scout / attack the raiders at `raid`. */
export interface PlayerAction { action: "repair" | "levy" | "advance" | "travel" | "order"; target?: string; order?: OrderDraft; decision?: number; followed?: string; mission?: "defend" | "scout" | "attack"; raid?: string }
export type PolicyFn = (v: View, rng: () => Rng) => PlayerAction[];

const DAY = 86400;
const recently = (v: View, action: string, target: string | null, days: number) =>
  v.self.orders.some((o) => o.action === action && (target === null || o.target === target) && v.now - o.tick < days * DAY);
/** For each fortification the player has any belief about, the value of the belief she would act on (best first). */
const believedForts = (v: View) =>
  [...new Set(Object.values(v.beliefs).filter((b) => b.predicate === "fortification.condition").map((b) => b.subject.id))].sort()
    .map((loc) => ({ loc, value: beliefsAbout(v, loc, "fortification.condition")[0].believedValue as number }));

/** Fortifications the player believes are under threat: the seat of whoever reported raiders near them. */
const believedThreats = (v: View, minIntensity: number) => {
  const forts = new Set<string>();
  for (const r of v.reports) for (const c of r.claims) {
    if (c.predicate !== "threat.intensity") continue;
    const cur = beliefsAbout(v, c.subject.id, "threat.intensity")[0];
    if (!cur || (cur.believedValue as number) < minIntensity) continue;
    const seat = beliefsAbout(v, r.author, "character.seat")[0]?.believedValue as string | undefined;
    if (seat) forts.add(seat);
  }
  return [...forts].sort();
};
const advanceTo = (minIntensity: number, cooldownDays: number): PolicyFn => (v) =>
  believedThreats(v, minIntensity).filter((f) => !recently(v, "advance", f, cooldownDays)).slice(0, 1).map((f) => ({ action: "advance" as const, target: f }));

const repairBelow = (threshold: number, cooldownDays: number): PolicyFn => (v) =>
  believedForts(v).filter((f) => f.value < threshold && !recently(v, "repair", f.loc, cooldownDays)).map((f) => ({ action: "repair" as const, target: f.loc }));

/** Do what one adviser recommends: each piece of advice heard from them in person and still fresh (one standing
 *  piece per target), unless already acted on recently. */
export function followAdviser(adviser: string): PolicyFn {
  return (v) => {
    const out: PlayerAction[] = [];
    for (const rec of v.advice.filter((r) => r.author === adviser)) {
      const a = JSON.parse(rec.plan.id) as { kind: string; target?: string };
      const map: Record<string, PlayerAction["action"]> = { advise_repair: "repair", advise_send_captain: "advance", advise_levy: "levy" };
      let action = map[a.kind], target = a.target;
let mission: PlayerAction["mission"], raid: string | undefined;
      if (a.kind === "advise_sortie") { // send the captain to the fort nearest the raiders; once he is there, attack
        action = "advance"; target = fortOfSite(v, a.target!);
        if (target && captainSentTo(v, target)) { mission = "attack"; raid = a.target; }
      }
      if (!action || recently(v, action, action === "levy" ? null : target ?? null, 10)) continue;
      if (out.some((x) => x.action === action && x.target === target)) continue;
      out.push({ action, ...(target ? { target } : {}), ...(mission ? { mission, raid } : {}), followed: adviser });
    }
    return out;
  };
}
/** The fortified place nearest a site on the map (static knowledge). */
function fortOfSite(v: View, site: string): string | undefined {
  const s = v.world.places.find((p) => p.id === site);
  if (!s) return undefined;
  const d = (p: { pos: [number, number] }) => (p.pos[0] - s.pos[0]) ** 2 + (p.pos[1] - s.pos[1]) ** 2;
  return [...v.world.places].filter((p) => p.fortified).sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1))[0]?.id;
}

/** Which adviser "best" and "worst" mean is measured (G-12) and recorded in content; until then they are unavailable. */
export function policyFn(id: PolicyId, aliases: Record<string, string> = {}): PolicyFn | null {
  if (id.startsWith("follow:")) return followAdviser(id.slice("follow:".length));
  if ((id === "follow-best-adviser" || id === "follow-worst-adviser") && aliases[id]) return followAdviser(aliases[id]);
  return POLICIES[id as keyof typeof POLICIES]?.fn ?? null;
}

export const POLICIES: Record<"passive" | "delegating" | "aggressive" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser", { fn: PolicyFn | null; note: string }> = {
  passive: { fn: () => [], note: "never acts" },
  delegating: { fn: (v, rng) => [...repairBelow(60000, 20)(v, rng), ...advanceTo(400, 20)(v, rng)], note: "repairs below 60%; sends the captain against raiders reported at 400 or more" },
  aggressive: {
    fn: (v, rng) => [...repairBelow(80000, 10)(v, rng), ...advanceTo(1, 10)(v, rng), ...(recently(v, "levy", null, 30) ? [] : [{ action: "levy" as const }])],
    note: "repairs below 80%, sends the captain against any reported raiders, levies every 30 days",
  },
  "random-valid": {
    fn: (v, rng) => {
      // valid = not repeating an order given in the last 10 days (advice now opens decision points too; without this a
      // random ruler answers every piece of advice with a fresh order, which wakes the advisers again)
      const opts: PlayerAction[][] = [[], ...(recently(v, "levy", null, 10) ? [] : [[{ action: "levy" as const }]]),
        ...believedForts(v).filter((f) => !recently(v, "repair", f.loc, 10)).map((f) => [{ action: "repair" as const, target: f.loc }]),
        ...believedThreats(v, 1).filter((f) => !recently(v, "advance", f, 10)).map((f) => [{ action: "advance" as const, target: f }])];
      return opts[rng().int(0, opts.length - 1)];
    },
    note: "uniform over valid actions (no repeat of the same order within 10 days)",
  },
  "follow-best-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
  "follow-worst-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
};
