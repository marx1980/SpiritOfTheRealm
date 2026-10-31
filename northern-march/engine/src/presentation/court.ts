// Presentation reads a View only (A7). Static test: imports limited to ../view.ts and ./format.ts.
import type { View } from "../view.ts";
import { dayOf, pct } from "./format.ts";

export function renderCourtSummary(v: View): string {
  const lines = [`Court, day ${dayOf(v.now)}`];
  const beliefs = Object.values(v.beliefs).sort((a, b) => (a.subject.id + a.predicate < b.subject.id + b.predicate ? -1 : 1) || a.id - b.id);
  for (const b of beliefs) {
    const value = b.predicate === "fortification.condition" ? pct(b.believedValue as number) : String(b.believedValue);
    const src = b.evidenceRefs[b.evidenceRefs.length - 1]?.source ?? "?";
    lines.push(`${b.subject.id} ${b.predicate}: ${value} [${b.effectiveBand}] (seen day ${dayOf(b.observedAt)}, from ${src})`);
  }
  lines.push(`reports received: ${v.reports.length}; orders given: ${v.self.orders.length}`);
  return lines.join("\n");
}
