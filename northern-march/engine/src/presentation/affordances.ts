// What a decision can be, from the ruler's view only (playtest v4.1 A1). The debug page and the playtest bridge both
// use this module, so a human and a player agent are offered the same things at the same moment.
// Inputs: the View and PublicRules (prices and lists anyone in the realm knows). Never Content or WorldState.
import { beliefsAbout, type PlayerAction, type Recommendation, type View } from "../view.ts";
import { captainSentTo, fallenAt, nearestPeople, planOf, planWords, timberSource } from "./phrasing.ts";
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
  /** What a purchase of grain costs: sacks an order buys and the price of a sack. */
  grainBuy?: { sacks: number; priceMilliPerSack: number };
}

export function publicRules(c: {
  scenario: { ruler: string; player: { levyMilli: number; repairRestoreToMilli: number; repairCostMilliPerMilli: number; repairRushCostPermille: number }; presence: { travelTo: string[] }; grain?: { purchase: { sacks: number; priceMilliPerSack: number } } };
  communities: { params: { reliefMilli: number }; communities: { id: string }[] };
}): PublicRules {
  const p = c.scenario.player;
  return {
    ruler: c.scenario.ruler, levyMilli: p.levyMilli, reliefMilli: c.communities.params.reliefMilli, repairRestoreToMilli: p.repairRestoreToMilli,
    repairCostMilliPerMilli: p.repairCostMilliPerMilli, repairRushCostPermille: p.repairRushCostPermille,
    travelTo: [...c.scenario.presence.travelTo], peoplePlaces: c.communities.communities.map((x) => x.id).sort(),
    ...(c.scenario.grain ? { grainBuy: { sacks: c.scenario.grain.purchase.sacks, priceMilliPerSack: c.scenario.grain.purchase.priceMilliPerSack } } : {}),
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
  if (a.action === "purchase") return purchaseCostKnown(v, rules, a);
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
  if (a.kind === "advise_relief") return { action: "relief", target: a.target, followed: r.author };
  if (a.kind === "advise_timber") { const src = timberSource(v, a.target!); return src ? { action: "requisition", target: src, to: a.target, good: "timber", followed: r.author } : null; }
  if (a.kind === "advise_muster") { const from = nearestPeople(v, a.target!); return from ? { action: "levy", muster: true, target: from, to: a.target, followed: r.author } : null; }
  return null;
}

/** Each adviser's latest advice that is not yet settled. */
export function openAdvice(v: View): Recommendation[] {
  return latestAdviceOf(v).filter((r) => !adviceSettled(v, r.id));
}

/** The words for an action, as the page shows them. */
export function actionText(v: View, a: PlayerAction): string {
  return a.action === "order" ? `Order ${name(v, a.order!.recipient)}: ${a.order!.intent} ${name(v, a.order!.objective.id)}`
    : a.action === "levy" && a.muster ? `Call men from ${name(v, a.target!)} to ${name(v, a.to!)}`
    : (a.action === "requisition" || a.action === "purchase") && a.to ? `${a.sell ? "Sell" : a.action === "purchase" ? "Buy" : "Move"} ${a.good ?? "grain"} ${a.sell ? `from ${name(v, a.target!)} at ${name(v, a.to)}` : a.action === "purchase" ? `at ${name(v, a.target!)} for ${name(v, a.to)}` : `from ${name(v, a.target!)} to ${name(v, a.to)}`}${a.consult ? ", asking the people first" : ""}`
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
  out.push(...economyActions(v, rules));
  return out.filter((a) => affordable(v, rules, a));
}


// ---- the wider economy on the page: what the steward's books say, and the orders they allow (D-044) ----------------------
export const GOOD_LABEL: Record<string, string> = { timber: "Timber", iron: "Iron", horses: "Horses" };

/** The stock of a good in a store as the steward's books last gave it, or undefined when the ruler has no figure. */
export const storeKnown = (v: View, place: string, good: string): number | undefined => v.ledger?.stock[good]?.[place];
/** The going price of a good (coin units per unit) as the books give it. */
export const priceKnown = (v: View, good: string): number | undefined => v.ledger?.price[good];
/** The grain in a place, as the newest letter or look gave it. */
export const grainKnown = (v: View, place: string): { sacks: number; observedAt: number; band: string } | undefined => {
  const b = beliefsAbout(v, place, "grain.stock")[0];
  return b ? { sacks: b.believedValue as number, observedAt: b.observedAt, band: b.effectiveBand } : undefined;
};
/** Days of cover a grain figure gives a place, and its band number (0 plenty .. 4 famine), from the stewards' public need and bands. */
export function grainCover(v: View, place: string): { days: number; band: number } | undefined {
  const g = grainKnown(v, place), need = v.world.grain?.places.find((p) => p.id === place)?.need;
  if (!g || !need || !v.world.grain) return undefined;
  const days = Math.floor(g.sacks / need), at = v.world.grain.bandDays;
  return { days, band: days >= at[0] ? 0 : days >= at[1] ? 1 : days >= at[2] ? 2 : days >= at[3] ? 3 : 4 };
}
export const houseOf = (v: View, place: string): string => v.world.goods?.stores.find((x) => x.id === place)?.house ?? "crown";
/** A purchase of goods: units an order buys times the going price, dearer by the House's markup when a House holds the store. Grain: sacks times the price. */
export function purchaseCostKnown(v: View, rules: PublicRules, a: PlayerAction): number | undefined {
  if (!a.good) return rules.grainBuy ? rules.grainBuy.sacks * rules.grainBuy.priceMilliPerSack : undefined;
  const g = v.world.goods, price = priceKnown(v, a.good);
  if (!g || price === undefined || a.sell) return undefined;
  const per = houseOf(v, a.target ?? "") !== "crown" ? Math.floor((price * (1000 + g.markupPermille)) / 1000) : price;
  return per * (g.unitsPerOrder[a.good] ?? 0);
}

/** Why an economy order cannot work, as far as the ruler knows. Empty: nothing known against it. */
export function economyProblems(v: View, a: PlayerAction): string[] {
  const g = v.world.goods, out: string[] = [], nm = (id: string) => name(v, id);
  if (a.action === "levy" && a.muster) {
    if (!g?.muster) return ["no muster in this realm"];
    if (!g.muster.communities.includes(a.target ?? "")) out.push("choose a people to call men from");
    if (!v.world.places.find((p) => p.id === a.to)?.fortified) out.push("choose a fort for the men to go to");
    else { const iron = storeKnown(v, a.to!, "iron"); if (iron !== undefined && iron < g.muster.ironPerMan) out.push(`${nm(a.to!)} has no iron to arm men`); }
    return out;
  }
  if (a.action !== "requisition" && a.action !== "purchase") return out;
  if (!a.good) { // grain
    const places = v.world.grain?.places.map((p) => p.id) ?? [];
    if (!places.includes(a.target ?? "") || !places.includes(a.to ?? "")) out.push("choose two places that keep grain");
    else if (a.target === a.to) out.push("choose a different place to send it to");
    return out;
  }
  if (!g || !g.kinds.includes(a.good)) return ["unknown good"];
  const src = g.stores.find((x) => x.id === a.target);
  if (!src || !src.kinds.includes(a.good)) return [`${nm(a.target ?? "")} holds no ${a.good}`];
  if (a.target === a.to) return ["choose a different place to send it to"];
  if (a.sell) {
    if (src.house !== "crown") out.push(`${nm(a.target!)} belongs to ${nm(src.house)}: you cannot sell what is not yours`);
    if (!g.towns.some((t) => t.id === a.to)) out.push("choose a market town to sell at");
    return out;
  }
  const dest = g.stores.find((x) => x.id === a.to);
  if (!dest || !dest.kinds.includes(a.good)) out.push(`${nm(a.to ?? "")} cannot store ${a.good}`);
  else if (dest.house !== "crown") out.push(`${nm(a.to!)} belongs to ${nm(dest.house)}: send it to a store of yours`);
  if (a.action === "requisition" && src.house !== "crown") out.push(`${nm(a.target!)} belongs to ${nm(src.house)}: you can buy there, not take`);
  const have = storeKnown(v, a.target!, a.good);
  if (have !== undefined && have <= 0) out.push(`${nm(a.target!)} has none`);
  return out;
}

/** Every economy order the books and letters allow now: moving and buying goods and grain, selling goods, and calling men. Deterministic order. */
export function economyActions(v: View, rules: PublicRules): PlayerAction[] {
  const out: PlayerAction[] = [], g = v.world.goods;
  const ok = (a: PlayerAction) => economyProblems(v, a).length === 0;
  if (g && v.ledger) {
    for (const good of g.kinds) {
      const holders = g.stores.filter((x) => x.kinds.includes(good) && (storeKnown(v, x.id, good) ?? 0) > 0).map((x) => x.id).sort();
      const crownStores = g.stores.filter((x) => x.kinds.includes(good) && x.house === "crown").map((x) => x.id).sort();
      for (const from of holders) {
        for (const to of crownStores) if (to !== from) {
          const a: PlayerAction = { action: houseOf(v, from) === "crown" ? "requisition" : "purchase", target: from, to, good };
          if (ok(a)) out.push(a);
        }
        if (houseOf(v, from) === "crown") for (const t of g.towns.map((x) => x.id).sort()) { const a: PlayerAction = { action: "requisition", target: from, to: t, good, sell: true }; if (ok(a)) out.push(a); }
      }
    }
  }
  if (v.world.grain) {
    const have = v.world.grain.places.map((p) => p.id).filter((id) => grainKnown(v, id)).sort();
    for (const from of have) for (const to of v.world.grain.places.map((p) => p.id).sort()) if (to !== from) for (const kind of ["requisition", "purchase"] as const) {
      const a: PlayerAction = { action: kind, target: from, to }; if (ok(a)) out.push(a);
    }
  }
  if (g?.muster) for (const c of g.muster.communities) for (const f of v.world.places.filter((p) => p.fortified).map((p) => p.id).sort()) {
    const a: PlayerAction = { action: "levy", muster: true, target: c, to: f }; if (ok(a)) out.push(a);
  }
  return out.filter((a) => affordable(v, rules, a));
}

/** The public rules as far as a view carries them (what a scripted policy may know): the costs of orders it can price from the view alone. */
export function publicRulesOf(v: View): PublicRules {
  return { ruler: v.self.id, levyMilli: 0, reliefMilli: 0, repairRestoreToMilli: 0, repairCostMilliPerMilli: 0, repairRushCostPermille: 0, travelTo: [], peoplePlaces: [] };
}
