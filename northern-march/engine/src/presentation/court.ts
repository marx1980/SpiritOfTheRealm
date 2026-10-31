// Presentation reads a View only (A7). Static test: imports limited to ../view.ts and ./format.ts.
import type { View } from "../view.ts";
import { dayOf, pct } from "./format.ts";

export function renderCourtSummary(v: View): string {
  const lines = [`Court, day ${dayOf(v.now)}`];
  for (const [key, b] of Object.entries(v.beliefs).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [where, what] = key.split(":");
    lines.push(`${where} ${what}: ${pct(b.value)} (seen day ${dayOf(b.observedAt)}, heard day ${dayOf(b.learnedAt)})`);
  }
  lines.push(`reports received: ${v.reports.length}; orders given: ${v.self.orders.length}`);
  return lines.join("\n");
}
