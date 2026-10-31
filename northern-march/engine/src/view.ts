// A7: ViewOf(agent | player). The only window UI, planners and policies get onto the world: the viewer's own
// beliefs (with staleness applied on read), reports delivered to them, their own orders and position, and the clock.
import { BANDS, effectiveBand, type BeliefProposition, type EffectiveBand } from "./beliefs.ts";
import type { Content } from "./content.ts";
import type { StructuredOrder } from "./schemas.ts";
import type { IssuedRecord, Position, WorldState } from "./world.ts";

export type BeliefView = BeliefProposition & { effectiveBand: EffectiveBand; ageTicks: number };
export interface DeliveredReport {
  reportId: number; author: string; subject: { kind: string; id: string }; claims: BeliefProposition[];
  composedAt: number; deliveredAt: number; route: string[]; authorBias?: string[];
}
export interface View {
  readonly now: number;
  readonly self: { readonly id: string; readonly position: Position; readonly ordersInForce: readonly StructuredOrder[]; readonly orders: readonly IssuedRecord[] };
  readonly beliefs: Readonly<Record<string, Readonly<BeliefView>>>;
  readonly reports: readonly DeliveredReport[];
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

export function buildView(s: Readonly<WorldState>, c: Content, who: string, now: number): View {
  const beliefs: Record<string, BeliefView> = {};
  for (const [id, p] of Object.entries(s.beliefs[who] ?? {})) {
    const band = effectiveBand(p, now, c.byId.predicate.get(p.predicate)?.halfLifeTicks ?? 0);
    if (band !== "stale") beliefs[id] = { ...structuredClone(p), effectiveBand: band, ageTicks: now - p.observedAt };
  }
  const reports: DeliveredReport[] = Object.values(s.reports)
    .filter((r) => r.recipient === who && r.status === "delivered")
    .map((r) => ({ reportId: r.id, author: r.author, subject: r.subject, claims: structuredClone(r.claims), composedAt: r.composedAt, deliveredAt: r.deliveredAt!,
      route: [...r.route], ...(r.authorBias ? { authorBias: [...r.authorBias] } : {}) }))
    .sort((a, b) => a.reportId - b.reportId);
  return deepFreeze({
    now,
    self: { id: who, position: structuredClone(s.positions[who]), ordersInForce: (s.ordersInForce[who] ?? []).map((id) => structuredClone(s.orders[String(id)].order)),
      orders: structuredClone(s.issued[who] ?? []) },
    beliefs,
    reports,
  });
}

/** What the viewer believes about one subject and predicate, best first (band, then freshness, then id). */
export function beliefsAbout(v: View, subjectId: string, predicate: string): BeliefView[] {
  return Object.values(v.beliefs).filter((b) => b.subject.id === subjectId && b.predicate === predicate)
    .sort((a, b) => BANDS.indexOf(b.effectiveBand) - BANDS.indexOf(a.effectiveBand) || b.observedAt - a.observedAt || a.id - b.id);
}
