// A6: scripted player policies. A policy sees only ViewOf(player) and may draw from the "player" stream.
import type { Rng } from "./rng.ts";
import { beliefsAbout, type OrderDraft, type View } from "./view.ts";
import { captainSentTo, planOf } from "./presentation/phrasing.ts";
import { adviceAction, economyProblems, affordable as affordableR, publicRulesOf } from "./presentation/affordances.ts";


export type PolicyId = "passive" | "delegating" | "aggressive" | "cautious" | "provisioner" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser" | "external" | "replay" | `follow:${string}`;
/** `mission` (for sending a captain): defend the fort (default), or scout / attack the raiders at `raid`. */
export interface BattleOrderDraft { to: string; task: import("./battlefield/core.ts").Task; via: "runner" | "signal" | "voice"; signal?: string }
export interface PlayerAction { action: "repair" | "levy" | "advance" | "travel" | "order" | "relief" | "requisition" | "purchase" | "battle"; battle?: BattleOrderDraft; target?: string; to?: string; consult?: boolean; good?: string; units?: number; market?: boolean; sell?: boolean; muster?: boolean; order?: OrderDraft; decision?: number; followed?: string; mission?: "defend" | "scout" | "attack"; raid?: string; repairMode?: "standard" | "rush" | "labour" }
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

/** What the ruler believes a store holds, in sacks, and how many days it would feed its place (null when she has no belief). */
const believedStore = (v: View, place: string) => {
  const b = beliefsAbout(v, place, "grain.stock")[0], need = v.world.grain?.places.find((p) => p.id === place)?.need;
  return b && need ? { sacks: b.believedValue as number, cover: Math.floor((b.believedValue as number) / need), need } : null;
};
/** When she believes a place has under TRIGGER_COVER days of grain, ask the richest other store for some; at most once in 30 days. */
const TRIGGER_COVER = 8;
const grainRelief = (consult: boolean, gapDays = 30): PolicyFn => (v) => {
  const places = v.world.grain?.places ?? [];
  const forts = new Set(v.world.places.filter((p) => p.fortified).map((p) => p.id)); // she worries about the garrisons' bread
  const short = places.filter((p) => forts.has(p.id)).map((p) => ({ id: p.id, k: believedStore(v, p.id) })).filter((x) => x.k && x.k.cover < TRIGGER_COVER).sort((a, b) => a.k!.cover - b.k!.cover || (a.id < b.id ? -1 : 1))[0];
  if (!short || recently(v, "requisition", null, gapDays)) return [];
  const from = places.filter((p) => p.id !== short.id).map((p) => ({ id: p.id, k: believedStore(v, p.id) })).filter((x) => x.k && x.k.sacks >= 12 * x.k.need)
    .sort((a, b) => b.k!.sacks - a.k!.sacks || (a.id < b.id ? -1 : 1))[0];
  return from ? [{ action: "requisition" as const, target: from.id, to: short.id, consult }] : [];
};
const repairBelow = (threshold: number, cooldownDays: number): PolicyFn => (v) =>
  believedForts(v).filter((f) => f.value < threshold && !recently(v, "repair", f.loc, cooldownDays)).map((f) => ({ action: "repair" as const, target: f.loc }));

/** Do what one adviser recommends: each piece of advice heard from them in person and still fresh (one standing
 *  piece per target), unless already acted on recently. */
export function followAdviser(adviser: string): PolicyFn {
  return (v) => {
    const out: PlayerAction[] = [];
    for (const rec of v.advice.filter((r) => r.author === adviser)) {
      const a = planOf(v, rec.plan.id);
      const map: Record<string, PlayerAction["action"]> = { advise_repair: "repair", advise_repair_rush: "repair", advise_repair_labour: "repair", advise_send_captain: "advance", advise_retake: "advance", advise_recall: "advance", advise_levy: "levy", advise_relief: "relief" };
      let action = map[a.kind], target = a.target;
let mission: PlayerAction["mission"], raid: string | undefined;
      if (a.kind === "advise_sortie") { // send the captain to the fort nearest the raiders; once he is there, attack
        action = "advance"; target = fortOfSite(v, a.target!);
        if (target && captainSentTo(v, target)) { mission = "attack"; raid = a.target; }
      }
      if (!action || recently(v, action, action === "levy" ? null : target ?? null, 10)) continue;
      if (out.some((x) => x.action === action && x.target === target)) continue;
      out.push({ action, ...(target ? { target } : {}), ...(mission ? { mission, raid } : {}), ...(a.kind === "advise_repair_rush" ? { repairMode: "rush" as const } : a.kind === "advise_repair_labour" ? { repairMode: "labour" as const } : {}), followed: adviser });
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

/** The wider economy as a scripted player (D-045): follow advice on timber and men; sell a nearly full timber store at the dearest town. */
function provision(v: View): PlayerAction[] {
  const out: PlayerAction[] = [], rules = publicRulesOf(v);
  for (const rec of v.advice) {
    const k = planOf(v, rec.plan.id).kind;
    if (k !== "advise_timber" && k !== "advise_muster") continue;
    const a = adviceAction(v, rec);
    if (!a || recently(v, a.action === "levy" ? "levy" : "requisition", a.target ?? null, 20) || out.some((x) => x.action === a.action && x.target === a.target && x.to === a.to)) continue;
    if (economyProblems(v, a).length === 0 && affordableR(v, rules, a)) out.push(a);
  }
  const g = v.world.goods, L = v.ledger;
  if (g && L) {
    const store = [...g.stores].sort((a, b) => (a.id < b.id ? -1 : 1)).find((x) => x.house === "crown" && x.kinds.includes("timber") && (L.stock.timber?.[x.id] ?? 0) >= 450 && !recently(v, "requisition", x.id, 20));
    const town = [...g.towns].sort((a, b) => (L.town[b.id]?.timber ?? 0) - (L.town[a.id]?.timber ?? 0) || (a.id < b.id ? -1 : 1))[0];
    if (store && town) out.push({ action: "requisition", target: store.id, to: town.id, good: "timber", sell: true });
  }
  return out;
}

/** Which adviser "best" and "worst" mean is measured (G-12) and recorded in content; until then they are unavailable. */
export function policyFn(id: PolicyId, aliases: Record<string, string> = {}): PolicyFn | null {
  if (id.startsWith("follow:")) return followAdviser(id.slice("follow:".length));
  if ((id === "follow-best-adviser" || id === "follow-worst-adviser") && aliases[id]) return followAdviser(aliases[id]);
  return POLICIES[id as keyof typeof POLICIES]?.fn ?? null;
}

export const POLICIES: Record<"passive" | "delegating" | "aggressive" | "cautious" | "provisioner" | "random-valid" | "follow-best-adviser" | "follow-worst-adviser", { fn: PolicyFn | null; note: string }> = {
  passive: { fn: () => [], note: "never acts" },
  delegating: { fn: (v, rng) => [...repairBelow(60000, 20)(v, rng), ...advanceTo(400, 20)(v, rng), ...grainRelief(true)(v, rng)], note: "repairs below 60%; sends the captain against raiders reported at 400 or more; asks the people whose grain it is first when a store looks low" },
  aggressive: {
    fn: (v, rng) => [...repairBelow(80000, 10)(v, rng), ...advanceTo(1, 10)(v, rng), ...(recently(v, "levy", null, 60) ? [] : [{ action: "levy" as const }]), ...grainRelief(false, 60)(v, rng)],
    note: "repairs below 80%, sends the captain against any reported raiders, levies every 60 days, takes grain without asking when a store looks low, at most once in 60 days",
  },
  provisioner: { fn: (v, rng) => [...POLICIES.delegating.fn!(v, rng), ...provision(v)], note: "as delegating, and also: does what advisers say about timber and men (once in 20 days for each), and sells timber from a store that is nearly full at the town that pays most (D-045; an evidence policy, not a gate policy)" },
  cautious: { fn: (v, rng) => [...repairBelow(60000, 20)(v, rng), ...advanceTo(400, 20)(v, rng)], note: "as delegating, but never asks anyone for grain (holds back from a people already angry)" },
  "random-valid": {
    fn: (v, rng) => {
      // valid = not repeating an order given in the last 10 days (advice now opens decision points too; without this a
      // random ruler answers every piece of advice with a fresh order, which wakes the advisers again)
      const opts: PlayerAction[][] = [[], ...(recently(v, "levy", null, 10) ? [] : [[{ action: "levy" as const }]]),
        ...believedForts(v).filter((f) => !recently(v, "repair", f.loc, 10)).map((f) => [{ action: "repair" as const, target: f.loc }]),
        ...believedThreats(v, 1).filter((f) => !recently(v, "advance", f, 10)).map((f) => [{ action: "advance" as const, target: f }]),
        ...(recently(v, "requisition", null, 10) ? [] : (v.world.grain?.places ?? []).filter((p) => beliefsAbout(v, p.id, "grain.stock").length).flatMap((from) => (v.world.grain!.places).filter((to) => to.id !== from.id).flatMap((to) => [true, false].map((consult) => [{ action: "requisition" as const, target: from.id, to: to.id, consult }]))))];
      return opts[rng().int(0, opts.length - 1)];
    },
    note: "uniform over valid actions (no repeat of the same order within 10 days)",
  },
  "follow-best-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
  "follow-worst-adviser": { fn: null, note: "needs advisers and recommendations: available from Phase 5" },
};
