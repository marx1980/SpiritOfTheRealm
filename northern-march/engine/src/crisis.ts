// Phase 7A: the Grain Crisis read from the event log (nothing here changes the world). Four outcomes, one end state.
import type { Content } from "./content.ts";
import type { SimEvent } from "./events.ts";

export const OUTCOMES = ["cooperative_support", "material_success_political_damage", "political_caution_military_danger", "misinformation_failure"] as const;
export type Outcome = (typeof OUTCOMES)[number] | "unresolved" | "no_crisis";
export interface CrisisReading {
  outcome: Outcome; crisis: boolean; endState: boolean;
  firstShortTick: number | null; famine: boolean; starvedMen: number; helped: boolean; damage: boolean; needlessOrder: boolean; believedFine: boolean; ordered: boolean;
}

/** `place` is where the crisis lies (the place that needs grain), `grievance` the community whose people were asked, `actor` the one who may act on it. */
export function readCrisis(log: readonly SimEvent[], c: Content, o: { place?: string; grievance?: string; actor?: string; ruler?: string } = {}): CrisisReading {
  const place = o.place ?? "northwatch", comm = o.grievance ?? "greyfen", actor = o.actor ?? "varos", ruler = o.ruler ?? c.scenario.ruler;
  const g = c.scenario.grain;
  const store: Record<string, number> = Object.fromEntries((g?.places ?? []).map((p) => [p.location, p.store]));
  const need = Object.fromEntries((g?.places ?? []).map((p) => [p.location, p.need]));
  const bands = g?.bandDays ?? [30, 14, 7, 3];
  let firstShortTick: number | null = null, famineTick: number | null = null, starvedMen = 0, helped = false, damage = false, endState = false, needlessOrder = false, ordered = false;
  let believed: number | null = null, believedAtFamine: number | null = null;
  const byId = new Map<number, SimEvent>(log.map((e) => [e.id, e]));
  /** Does anything this event came from (its causes, their causes, ...) include a grain requisition shipment? */
  const fromRequisition = (e: SimEvent) => {
    const seen = new Set<number>(), stack = [...e.causedBy];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const x = byId.get(id);
      if (!x) continue;
      if (x.type === "GrainShipped" && x.payload.how === "requisition") return true;
      stack.push(...x.causedBy);
    }
    return false;
  };
  for (const e of log) {
    const p = e.payload as Record<string, any>;
    switch (e.type) {
      case "GrainDay": for (const [l, pr, co, sp] of p.changes as [string, number, number, number][]) store[l] += pr - co - sp; break;
      case "GrainShipped": store[p.from] -= p.sacks; break;
      case "GrainDelivered": store[p.to] += p.sacks - p.spilled; if (p.to === place) helped = true; break;
      case "ScarcityChanged":
        if (p.place === place && (p.to === "short" || p.to === "famine") && firstShortTick === null) firstShortTick = e.tick;
        if (p.place === place && p.to === "famine" && famineTick === null) { famineTick = e.tick; believedAtFamine = believed; }
        break;
      case "GarrisonStarved": for (const [l, n] of p.changes as [string, number][]) if (l === place) starvedMen += n; break;
      case "PlayerInput":
        if (p.action === "requisition" || p.action === "purchase") {
          ordered = true;
          if (p.to === place && Math.floor(store[place] / Math.max(1, need[place])) >= bands[1]) needlessOrder = true; // asked for grain while the place had a fortnight or more in hand (more than "tight")
        }
        break;
      case "BeliefUpdated": {
        const b = p.prop as { subject: { id: string }; predicate: string; believedValue: number };
        if (p.holder === ruler && b.predicate === "grain.stock" && b.subject.id === place) believed = Math.floor(b.believedValue / Math.max(1, need[place]));
        break;
      }
      case "CommunityStanceChanged":
        if (p.community === comm) {
          if (["withhold", "refuse", "support"].includes(p.to)) damage = true;
          if (p.to === "support" && p.supports === actor && fromRequisition(e)) endState = true; // the grievance he acts on must trace back to a requisition
        }
        break;
      case "CommunityHeard":
        if (p.community === comm && ((p.grievances ?? []) as { kind: string }[]).some((x) => x.kind === "broken_promise")) damage = true;
        break;
    }
  }
  const famine = famineTick !== null, crisis = firstShortTick !== null || ordered;
  const believedFine = famine && believedAtFamine !== null && believedAtFamine >= bands[2];
  const garrison = c.byId.location.get(place)?.fortification?.garrison ?? 0;
  const danger = famine || starvedMen >= Math.max(1, Math.floor(garrison / 5));
  let outcome: Outcome;
  if (!crisis) outcome = "no_crisis";
  else if (needlessOrder || believedFine) outcome = "misinformation_failure";
  else if (helped && !damage && !famine) outcome = "cooperative_support";
  else if (helped && damage) outcome = "material_success_political_damage";
  else if (!helped && danger) outcome = "political_caution_military_danger";
  else outcome = "unresolved";
  return { outcome, crisis, endState, firstShortTick, famine, starvedMen, helped, damage, needlessOrder, believedFine, ordered };
}
