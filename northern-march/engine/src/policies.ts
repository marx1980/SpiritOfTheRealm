// A6: scripted player policies. A policy sees only ViewOf(player) and may draw from the "player" stream.
import type { Rng } from "./rng.ts";
import { beliefsAbout, type View } from "./view.ts";

export type PolicyId = "passive" | "delegating" | "aggressive" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser" | "replay";
export interface PlayerAction { action: "repair" | "levy"; target?: string; decision?: number }
export type PolicyFn = (v: View, rng: () => Rng) => PlayerAction[];

const DAY = 86400;
const recently = (v: View, action: string, target: string | null, days: number) =>
  v.self.orders.some((o) => o.action === action && (target === null || o.target === target) && v.now - o.tick < days * DAY);
/** For each fortification the player has any belief about, the value of the belief she would act on (best first). */
const believedForts = (v: View) =>
  [...new Set(Object.values(v.beliefs).filter((b) => b.predicate === "fortification.condition").map((b) => b.subject.id))].sort()
    .map((loc) => ({ loc, value: beliefsAbout(v, loc, "fortification.condition")[0].believedValue as number }));

const repairBelow = (threshold: number, cooldownDays: number): PolicyFn => (v) =>
  believedForts(v).filter((f) => f.value < threshold && !recently(v, "repair", f.loc, cooldownDays)).map((f) => ({ action: "repair" as const, target: f.loc }));

export const POLICIES: Record<Exclude<PolicyId, "replay">, { fn: PolicyFn | null; note: string }> = {
  passive: { fn: () => [], note: "never acts" },
  delegating: { fn: repairBelow(60000, 20), note: "approves a repair when a fortification is reported below 60%" },
  aggressive: {
    fn: (v, rng) => [...repairBelow(80000, 10)(v, rng), ...(recently(v, "levy", null, 30) ? [] : [{ action: "levy" as const }])],
    note: "repairs below 80%, levies every 30 days",
  },
  "random-valid": {
    fn: (v, rng) => {
      const opts: PlayerAction[][] = [[], [{ action: "levy" }], ...believedForts(v).map((f) => [{ action: "repair" as const, target: f.loc }])];
      return opts[rng().int(0, opts.length - 1)];
    },
    note: "uniform over valid actions",
  },
  "follow-best-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
  "follow-worst-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
};
