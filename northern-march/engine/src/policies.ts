// A6: scripted player policies. A policy sees only ViewOf(player) and may draw from the "player" stream.
import type { Rng } from "./rng.ts";
import { beliefsAbout, type View } from "./view.ts";

export type PolicyId = "passive" | "delegating" | "aggressive" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser" | "replay";
export interface PlayerAction { action: "repair" | "levy" | "advance"; target?: string; decision?: number }
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

export const POLICIES: Record<Exclude<PolicyId, "replay">, { fn: PolicyFn | null; note: string }> = {
  passive: { fn: () => [], note: "never acts" },
  delegating: { fn: (v, rng) => [...repairBelow(60000, 20)(v, rng), ...advanceTo(400, 20)(v, rng)], note: "repairs below 60%; sends the captain against raiders reported at 400 or more" },
  aggressive: {
    fn: (v, rng) => [...repairBelow(80000, 10)(v, rng), ...advanceTo(1, 10)(v, rng), ...(recently(v, "levy", null, 30) ? [] : [{ action: "levy" as const }])],
    note: "repairs below 80%, sends the captain against any reported raiders, levies every 30 days",
  },
  "random-valid": {
    fn: (v, rng) => {
      const opts: PlayerAction[][] = [[], [{ action: "levy" }], ...believedForts(v).map((f) => [{ action: "repair" as const, target: f.loc }]),
        ...believedThreats(v, 1).map((f) => [{ action: "advance" as const, target: f }])];
      return opts[rng().int(0, opts.length - 1)];
    },
    note: "uniform over valid actions",
  },
  "follow-best-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
  "follow-worst-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
};
