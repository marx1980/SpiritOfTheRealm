// Debug inspectors (developer tooling, not presentation): event ancestry, timelines, per-type counts.
import type { SimEvent } from "./events.ts";
import { ORDER_LIFECYCLE } from "./schemas.ts";
import { orderIdOf } from "./invariants.ts";

const DAY = 86400;
const fmt = (e: SimEvent) => `#${e.id} d${Math.floor(e.tick / DAY)}+${e.tick % DAY}s ${e.type} ${JSON.stringify(e.payload)}`;

export function ancestry(log: readonly SimEvent[], id: number, maxDepth = 20): string {
  const byId = new Map(log.map((e) => [e.id, e]));
  const lines: string[] = [];
  const seen = new Set<number>();
  const walk = (eid: number, d: number) => {
    const e = byId.get(eid);
    if (!e) { lines.push(`${"  ".repeat(d)}#${eid} (missing)`); return; }
    lines.push(`${"  ".repeat(d)}${fmt(e)}${seen.has(eid) ? " (see above)" : ""}`);
    if (seen.has(eid) || d >= maxDepth) return;
    seen.add(eid);
    for (const c of e.causedBy) walk(c, d + 1);
  };
  walk(id, 0);
  return lines.join("\n");
}

export function timeline(log: readonly SimEvent[], types?: string[]): string {
  return log.filter((e) => !types || types.includes(e.type)).map(fmt).join("\n");
}

const LIFECYCLE = new Set<string>([...ORDER_LIFECYCLE.main, ...ORDER_LIFECYCLE.failures]);

/** Every lifecycle event of one order, in order (P0.04 done-when: the lifecycle is fully visible). */
export function orderHistory(log: readonly SimEvent[], orderId: number): SimEvent[] {
  return log.filter((e) => LIFECYCLE.has(e.type) && orderIdOf(e) === orderId);
}
