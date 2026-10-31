// C3: invariant checks, run on every seed. Each returns human-readable violations (empty = pass).
import { canonicalJson } from "./canonical.ts";
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type SimEvent, type SystemId } from "./events.ts";
import { ORDER_LIFECYCLE, ORDER_TRANSITIONS } from "./schemas.ts";

interface RunLike { log: readonly SimEvent[]; projectFromLog?: () => unknown; unsafeWorldForDebug?: () => unknown }

export function checkLog(log: readonly SimEvent[]): string[] {
  const v: string[] = [];
  const pos = new Map<number, number>();
  log.forEach((e, i) => pos.set(e.id, i));
  for (let i = 0; i < log.length; i++) {
    const e = log[i], def = EVENT_TYPES[e.type];
    if (!def) { v.push(`event ${e.id}: unregistered type ${e.type}`); continue; }
    if (e.schemaVersion !== EVENT_SCHEMA_VERSION) v.push(`event ${e.id}: schemaVersion ${e.schemaVersion}`);
    if (e.domain !== def.domain) v.push(`event ${e.id}: domain ${e.domain} != ${def.domain}`);
    if (i > 0 && e.id <= log[i - 1].id) v.push(`event ${e.id}: id does not increase`);
    if (i > 0 && e.tick < log[i - 1].tick) v.push(`event ${e.id}: tick goes backwards`);
    for (const c of e.causedBy) {
      const p = pos.get(c);
      if (p === undefined) v.push(`event ${e.id}: cause ${c} does not exist`);
      else if (p >= i) v.push(`event ${e.id}: cause ${c} is not earlier`);
    }
    if (!e.causedBy.length && !def.root) v.push(`event ${e.id} (${e.type}): empty causedBy on a non-root type`);
    try { canonicalJson(e); } catch (err) { v.push(`event ${e.id}: ${(err as Error).message}`); }
    if (e.type === "BeliefUpdated") {
      const holder = e.payload.holder as string;
      for (const ev of (e.payload.prop as { evidenceRefs: { kind: string; eventId: number; source: string; reportId?: number }[] }).evidenceRefs) {
        if (!e.causedBy.includes(ev.eventId)) continue; // evidence merged from earlier events
        const src = log[pos.get(ev.eventId) ?? -1];
        if (ev.kind === "report" && !(src?.type === "ReportDelivered" && src.payload.reportId === ev.reportId && src.payload.recipient === holder))
          v.push(`event ${e.id}: belief from report ${ev.reportId} without its ReportDelivered to ${holder}`);
        if (ev.kind === "intercepted" && !(src && ["InterceptedReportReceived", "InterceptedOrderReceived"].includes(src.type) && src.payload.by === holder))
          v.push(`event ${e.id}: intercepted belief for ${holder} without the papers reaching them`);
        if (ev.kind === "observation" && ev.source !== holder) v.push(`event ${e.id}: ${holder} holds someone else's observation as first-hand`);
      }
    }
    if (e.type === "PlayerInput") {
      const src = log[pos.get(e.causedBy[0]) ?? -1];
      if (!src || src.type !== "ReportDelivered") v.push(`event ${e.id}: player input not caused by something delivered to the player`);
    }
  }
  return v;
}

const LIFECYCLE = new Set<string>([...ORDER_LIFECYCLE.main, ...ORDER_LIFECYCLE.failures]);
export const orderIdOf = (e: SimEvent) => (e.type === "OrderIssued" ? (e.payload.order as { id: number }).id : (e.payload.orderId as number));

/** B2: every order's events form a valid path through the lifecycle; nothing follows a terminal step. */
export function checkOrderLifecycles(log: readonly SimEvent[]): string[] {
  const v: string[] = [];
  const state = new Map<number, string>();
  for (const e of log) {
    if (!LIFECYCLE.has(e.type)) continue;
    const id = orderIdOf(e), cur = state.get(id) ?? "start";
    const allowed = cur === "ObedienceDecided:refuse" ? [] : ORDER_TRANSITIONS[cur.split(":")[0]] ?? [];
    if (!allowed.includes(e.type)) v.push(`order ${id}: ${e.type} after ${cur}`);
    state.set(id, e.type === "ObedienceDecided" && e.payload.decision === "refuse" ? "ObedienceDecided:refuse" : e.type);
  }
  return v;
}

export function checkRun(sim: RunLike): string[] {
  const v = [...checkLog(sim.log), ...checkOrderLifecycles(sim.log)];
  if (sim.projectFromLog && sim.unsafeWorldForDebug && canonicalJson(sim.projectFromLog()) !== canonicalJson(sim.unsafeWorldForDebug()))
    v.push("WorldState differs from the projection of the log");
  return v;
}

/** Valid pairing: OFF arm has no events of the ablated system, and both logs match until the system first emits. */
export function checkPairing(on: readonly SimEvent[], off: readonly SimEvent[], system: SystemId): string[] {
  const v: string[] = [];
  if (off.some((e) => EVENT_TYPES[e.type]?.system === system)) v.push(`OFF arm contains ${system} events`);
  let k = on.findIndex((e) => EVENT_TYPES[e.type]?.system === system);
  if (k < 0) k = on.length;
  if (k > off.length) v.push(`OFF arm shorter (${off.length}) than the shared prefix (${k})`);
  for (let i = 0; i < Math.min(k, off.length); i++)
    if (canonicalJson(on[i]) !== canonicalJson(off[i])) { v.push(`arms diverge at event ${on[i].id} before ${system} first emits`); break; }
  if (k === on.length && canonicalJson(on) !== canonicalJson(off)) v.push(`${system} never emitted but the arms differ`);
  return v;
}
