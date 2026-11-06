// What a decision can be, from the ruler's view only (playtest v4.1 A1). The debug page and the playtest bridge both
// use this module, so a human and a player agent are offered the same things at the same moment.
// Inputs: the View and PublicRules (prices and lists anyone in the realm knows). Never Content or WorldState.
import { beliefsAbout, type PlayerAction, type Recommendation, type View } from "../view.ts";
import { captainSentTo, fallenAt, planOf, planWords } from "./phrasing.ts";
import { adviceSettled, latestAdviceOf } from "./court.ts";

/** Public rules of the realm: what things cost and where the ruler may go. Built from content by the caller. */
export interface PublicRules {
  ruler: string;
  levyMilli: number;
  reliefMilli: number;
  repairRestoreToMilli: number;
  repairCostMilliPerMilli: number;
  repairRushCostPermille: number;
  travelTo: readonly string[];
  /** Places whose people can be sent relief. */
  peoplePlaces: readonly string[];
}

export function publicRules(c: {
  scenario: { ruler: string; player: { levyMilli: number; repairRestoreToMilli: number; repairCostMilliPerMilli: number; repairRushCostPermille: number }; presence: { travelTo: string[] } };
  communities: { params: { reliefMilli: number }; communities: { id: string }[] };
}): PublicRules {
  const p = c.scenario.player;
  return {
    ruler: c.scenario.ruler, levyMilli: p.levyMilli, reliefMilli: c.communities.params.reliefMilli, repairRestoreToMilli: p.repairRestoreToMilli,
    repairCostMilliPerMilli: p.repairCostMilliPerMilli, repairRushCostPermille: p.repairRushCostPermille,
    travelTo: [...c.scenario.presence.travelTo], peoplePlaces: c.communities.communities.map((x) => x.id).sort(),
  };
}

const name = (v: View, id: string) => v.world.names[id] ?? id;

/** What the ruler believes the treasury holds (the newest belief), or undefined. */
export function coinsKnown(v: View, rules: PublicRules): number | undefined {
  const b = beliefsAbout(v, rules.ruler, "treasury.balance").sort((x, y) => y.observedAt - x.observedAt)[0];
  return b ? (b.believedValue as number) : undefined;
}

/** What a repair would cost, from what the ruler believes about the walls. Labour costs no coin. */
export function repairCostKnown(v: View, rules: PublicRules, place: string, mode = "standard"): number | undefined {
  const b = beliefsAbout(v, place, "fortification.condition").sort((x, y) => y.observedAt - x.observedAt)[0];
  if (!b || mode === "labour") return b ? 0 : undefined;
  return Math.floor((Math.max(0, rules.repairRestoreToMilli - (b.believedValue as number)) * rules.repairCostMilliPerMilli * (mode === "rush" ? rules.repairRushCostPermille : 1000)) / 1000);
}

/** The known cost of an action, or undefined when the ruler does not know it (or it costs nothing). */
export function costKnown(v: View, rules: PublicRules, a: PlayerAction): number | undefined {
  if (a.action === "relief") return rules.reliefMilli;
  if (a.action === "repair") return repairCostKnown(v, rules, a.target!, a.repairMode);
  return undefined;
}

/** Whether the ruler can pay for an action, as far as she knows. Actions with no known cost are always possible. */
export function affordable(v: View, rules: PublicRules, a: PlayerAction): boolean {
  const c = costKnown(v, rules, a), k = coinsKnown(v, rules);
  return c === undefined || k === undefined || c <= k;
}

/** The fortified place nearest a site (static map knowledge). */
export function fortNear(v: View, site: string): string | undefined {
  const s = v.world.places.find((p) => p.id === site);
  if (!s) return undefined;
  const d = (p: { pos: [number, number] }) => (p.pos[0] - s.pos[0]) ** 2 + (p.pos[1] - s.pos[1]) ** 2;
  return v.world.places.filter((p) => p.fortified).sort((a, b) => d(a) - d(b))[0]?.id;
}

/** The raiders' site a captain would scout or attack from this fort: the strongest believed raid that fort answers. */
export function raidNear(v: View, fort: string): string | undefined {
  const raids = v.world.places.filter((p) => fortNear(v, p.id) === fort)
    .map((p) => ({ id: p.id, b: beliefsAbout(v, p.id, "threat.intensity")[0] })).filter((x) => x.b && (x.b.believedValue as number) > 0);
  return raids.sort((a, b) => (b.b!.believedValue as number) - (a.b!.believedValue as number))[0]?.id;
}

/** A piece of advice as the action it means, or null (waiting, staying). */
export function adviceAction(v: View, r: Recommendation): PlayerAction | null {
  const a = planOf(v, r.plan.id);
  if (a.kind === "advise_repair") return { action: "repair", target: a.target, followed: r.author };
  if (a.kind === "advise_repair_rush" || a.kind === "advise_repair_labour") return { action: "repair", target: a.target, repairMode: a.kind === "advise_repair_rush" ? "rush" : "labour", followed: r.author };
  if (a.kind === "advise_recall" || a.kind === "advise_send_captain" || a.kind === "advise_retake") return { action: "advance", target: a.target, followed: r.author };
  if (a.kind === "advise_sortie") { const f = fortNear(v, a.target!); return !f ? null : captainSentTo(v, f) ? { action: "advance", target: f, mission: "attack", raid: a.target, followed: r.author } : { action: "advance", target: f, followed: r.author }; }
  if (a.kind === "advise_levy") return { action: "levy", followed: r.author };
  return null;
}

/** Each adviser's latest advice that is not yet settled. */
export function openAdvice(v: View): Recommendation[] {
  return latestAdviceOf(v).filter((r) => !adviceSettled(v, r.id));
}

/** The words for an action, as the page shows them. */
export function actionText(v: View, a: PlayerAction): string {
  return a.action === "order" ? `Order ${name(v, a.order!.recipient)}: ${a.order!.intent} ${name(v, a.order!.objective.id)}`
    : a.action === "levy" ? "Raise a levy" : a.action === "relief" ? `Send relief to ${name(v, a.target!)}` : a.action === "travel" ? `Travel to ${name(v, a.target!)}`
    : a.action === "repair" ? `Repair ${name(v, a.target!)}${a.repairMode === "rush" ? " quickly, paying extra, with the captain's men" : a.repairMode === "labour" ? " with the captain's men only (no cost, slower)" : ""}`
    : a.mission === "attack" && a.raid ? `Attack the raiders at ${name(v, a.raid)}` : a.mission === "scout" && a.raid ? `Scout the raiders at ${name(v, a.raid)}` : (fallenAt(v, a.target!) ? `Retake ${name(v, a.target!)}` : `Send the captain to ${name(v, a.target!)}`);
}

/** Advice as parallel choices: the same action from several advisers is one choice; waiting and staying are shown, not ordered. */
export interface AdviceChoice { action: PlayerAction; text: string; by: string[]; byIds: string[]; adviceIds: number[]; wait?: boolean }
export function adviceChoices(v: View): AdviceChoice[] {
  const out = new Map<string, AdviceChoice>();
  const add = (key: string, mk: () => AdviceChoice, r: Recommendation) => {
    if (!out.has(key)) out.set(key, mk());
    const c = out.get(key)!; c.by.push(name(v, r.author)); c.byIds.push(r.author); c.adviceIds.push(r.id);
  };
  for (const r of openAdvice(v)) {
    const kind = planOf(v, r.plan.id).kind;
    if (kind === "advise_wait") { add("wait", () => ({ action: { action: "wait" } as unknown as PlayerAction, text: "Wait for more news", by: [], byIds: [], adviceIds: [], wait: true }), r); continue; }
    if (kind === "advise_stay") { const k = `stay:${planOf(v, r.plan.id).target}`; add(k, () => ({ action: { action: "wait" } as unknown as PlayerAction, text: planWords(v, r.plan.id), by: [], byIds: [], adviceIds: [], wait: true }), r); continue; }
    const act = adviceAction(v, r);
    if (!act) continue;
    const { followed: _f, ...same } = act;
    add(JSON.stringify(same), () => ({ action: act, text: actionText(v, act), by: [], byIds: [], adviceIds: [] }), r);
  }
  return [...out.values()];
}

/** Every action the ruler could take now that the rules allow and she can pay for (as far as she knows), advice or not.
 *  Order of the list is deterministic. Free-form orders to other people are not listed (the composer's "o:" orders). */
export function playerActions(v: View, rules: PublicRules): PlayerAction[] {
  const out: PlayerAction[] = [];
  const forts = v.world.places.filter((p) => p.fortified).map((p) => p.id).sort();
  for (const f of forts) {
    if (beliefsAbout(v, f, "fortification.condition").length && !fallenAt(v, f))
      for (const mode of ["standard", "rush", "labour"] as const) out.push({ action: "repair", target: f, ...(mode !== "standard" ? { repairMode: mode } : {}) });
    out.push({ action: "advance", target: f });
    const raid = fallenAt(v, f) ? undefined : raidNear(v, f);
    if (raid) out.push({ action: "advance", target: f, mission: "attack", raid }, { action: "advance", target: f, mission: "scout", raid });
  }
  out.push({ action: "levy" });
  for (const p of rules.peoplePlaces) out.push({ action: "relief", target: p });
  const here = "at" in v.self.position ? v.self.position.at : null;
  for (const t of rules.travelTo) if (t !== here) out.push({ action: "travel", target: t });
  return out.filter((a) => affordable(v, rules, a));
}
