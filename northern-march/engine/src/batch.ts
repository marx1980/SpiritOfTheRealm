// A6 / C1: headless batch runner and per-run metrics row. Fields not measurable before their phase are null.
import { hashOf } from "./canonical.ts";
import type { Content } from "./content.ts";
import { createSim, hashLog, type Sim, type SimParams } from "./engine.ts";
import type { SystemId } from "./events.ts";
import type { PolicyId } from "./policies.ts";

export const METRIC_FIELDS = [
  "seed", "dominantCrisis", "crisisCount", "timeToFirstCrisis", "timeToEnding", "endingType", "endingFirstCause", "endingAncestryDomains",
  "decisionsTotal", "decisionsUsingStaleOrWrongBelief", "badOutcomesByFailureOrigin", "badOutcomeByBeliefQuality",
  "causalChainMaxLength", "crossSystemChains", "endStateFlags", "ordersLost", "ordersIntercepted", "ordersRefused", "ordersAdapted",
  "disobedienceEvents", "agentWakesPerSimDay", "wallClockPerSimYear", "communityRevolts", "communityRevoltsWithoutNamedLeader",
  "armId", "policyId", "calibrationHash", "seedBlock", "logHash", "eventsByType",
] as const;

export interface BatchSpec { content: Content; seeds: number[]; days: number; policy: PolicyId; ablate?: SystemId[]; params?: SimParams }

export const calibrationHash = (content: Content, params: SimParams = {}) => hashOf({ content: content.hash, params }).slice(0, 12);
export const seedBlockOf = (seed: number) => (seed < 10000 ? "TUNE" : Math.floor(seed / 10000) * 10000);

export function metricsRow(sim: Sim, spec: BatchSpec, wallMs: number) {
  const log = sim.log;
  const depth = new Map<number, number>(), domains = new Map<number, Set<string>>();
  for (const e of log) {
    depth.set(e.id, 1 + Math.max(0, ...e.causedBy.map((c) => depth.get(c)!)));
    const d = new Set<string>([e.domain]);
    for (const c of e.causedBy) for (const x of domains.get(c)!) d.add(x);
    domains.set(e.id, d);
  }
  const count = (t: string) => log.filter((e) => e.type === t).length;
  const eventsByType: Record<string, number> = {};
  for (const e of log) eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1;
  const crisis = log.filter((e) => e.type === "Storm" || e.type === "ThreatBegan");
  const breached = minConditionBelow(sim, spec.content.scenario.endStates.fortificationBreachedBelowMilli);
  const obs = sim.decisionsObserved;
  return {
    seed: sim.seed,
    dominantCrisis: null,
    crisisCount: { Storm: count("Storm"), ThreatBegan: count("ThreatBegan") },
    timeToFirstCrisis: crisis.length ? crisis[0].tick : null,
    timeToEnding: null, endingType: null, endingFirstCause: null, endingAncestryDomains: null,
    decisionsTotal: count("PlayerInput"),
    decisionsUsingStaleOrWrongBelief: obs.filter((o) => o.staleBelief || o.wrongBelief).length,
    badOutcomesByFailureOrigin: null, badOutcomeByBeliefQuality: null,
    causalChainMaxLength: Math.max(0, ...depth.values()),
    crossSystemChains: [...domains.values()].filter((d) => d.size >= 3).length,
    endStateFlags: { fortificationBreached: breached },
    ordersLost: count("OrderLost") + count("ReportLost"),
    ordersIntercepted: null,
    ordersRefused: count("RepairRefused"),
    ordersAdapted: null, disobedienceEvents: null, agentWakesPerSimDay: null,
    wallClockPerSimYear: Math.round((wallMs * 365) / spec.days),
    communityRevolts: null, communityRevoltsWithoutNamedLeader: null,
    armId: spec.ablate?.length ? `off:${[...spec.ablate].sort().join("+")}` : "on",
    policyId: spec.policy,
    calibrationHash: calibrationHash(spec.content, spec.params),
    seedBlock: seedBlockOf(sim.seed),
    logHash: hashLog(log),
    eventsByType,
  };
}

/** Did any fortification fall below the threshold at any point? Rebuilt from the log (metrics observer, not UI). */
function minConditionBelow(sim: Sim, threshold: number): boolean {
  const cond: Record<string, number> = {};
  for (const l of sim.content.locations) if (l.fortification) cond[l.id] = l.fortification.conditionMilli;
  let low = Object.values(cond).some((c) => c < threshold);
  const clamp = (v: number) => Math.max(0, Math.min(100000, v));
  for (const e of sim.log) {
    const p = e.payload as Record<string, any>;
    if (e.type === "FortificationsWeathered") for (const [l, d] of p.changes) cond[l] = clamp(cond[l] - d);
    else if ((e.type === "Storm" || e.type === "RaidDamage") && cond[p.location] !== undefined) cond[p.location] = clamp(cond[p.location] - p.damageMilli);
    else if (e.type === "RepairCompleted") cond[p.location] = clamp(cond[p.location] + p.restoredMilli);
    else continue;
    if (Object.values(cond).some((c) => c < threshold)) low = true;
  }
  return low;
}

export function runBatch(spec: BatchSpec, onRow?: (row: ReturnType<typeof metricsRow>, sim: Sim) => void) {
  const rows: ReturnType<typeof metricsRow>[] = [];
  for (const seed of spec.seeds) {
    const t0 = performance.now();
    const sim = createSim({ content: spec.content, seed, policy: spec.policy, ablate: spec.ablate, params: spec.params });
    sim.runDays(spec.days);
    const row = metricsRow(sim, spec, performance.now() - t0);
    rows.push(row);
    onRow?.(row, sim);
  }
  return rows;
}
