// C3: invariant checks, run on every seed. Each returns human-readable violations (empty = pass).
import { canonicalJson } from "./canonical.ts";
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type SimEvent, type SystemId } from "./events.ts";

interface RunLike { log: readonly SimEvent[]; projectFromLog?: () => unknown; unsafeWorldForDebug?: () => unknown }

export function checkLog(log: readonly SimEvent[]): string[] {
  const v: string[] = [];
  const pos = new Map<number, number>();
  const delivered = new Map<number, number>();
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
    const p = e.payload as { reportId?: number };
    if (e.type === "ReportDelivered") delivered.set(p.reportId!, e.id);
    if (e.type === "BeliefUpdated" && (!delivered.has(p.reportId!) || !e.causedBy.includes(delivered.get(p.reportId!)!)))
      v.push(`event ${e.id}: belief from report ${p.reportId} before its ReportDelivered`);
    if (e.type === "PlayerInput") {
      const src = log[pos.get(e.causedBy[0]) ?? -1];
      if (!src || src.type !== "ReportDelivered") v.push(`event ${e.id}: player input not caused by something delivered to the player`);
    }
  }
  return v;
}

export function checkRun(sim: RunLike): string[] {
  const v = checkLog(sim.log);
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
