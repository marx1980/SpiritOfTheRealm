// A7: ViewOf(agent | player). The only window that UI, planners and policies get onto the world.
// It holds the viewer's own beliefs, reports delivered to them, their own orders, and the clock.
import type { Belief, OrderRecord, WorldState } from "./world.ts";

export interface DeliveredReport { reportId: number; author: string; subject: string; predicate: string; value: number; observedAt: number; deliveredAt: number }
export interface View {
  readonly now: number;
  readonly self: { readonly id: string; readonly orders: readonly OrderRecord[] };
  readonly beliefs: Readonly<Record<string, Readonly<Belief>>>;
  readonly reports: readonly DeliveredReport[];
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export function buildView(s: Readonly<WorldState>, who: string, now: number): View {
  const reports: DeliveredReport[] = Object.entries(s.reports)
    .filter(([, r]) => r.recipient === who && r.deliveredAt !== null)
    .map(([id, r]) => ({ reportId: Number(id), author: r.author, subject: r.subject, predicate: r.predicate, value: r.value, observedAt: r.observedAt, deliveredAt: r.deliveredAt! }))
    .sort((a, b) => a.reportId - b.reportId);
  return deepFreeze({
    now,
    self: { id: who, orders: structuredClone(s.orders[who] ?? []) },
    beliefs: structuredClone(s.beliefs[who] ?? {}),
    reports,
  });
}
