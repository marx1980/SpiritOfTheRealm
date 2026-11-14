// Phase 14A (docs/CONTENT.md): the six endings and the five pressures, read from the event log. Nothing here changes the world.
// Names of places, people and communities come from the content (scenario.endings, scenario.objective), never from this file.
import type { Content } from "./content.ts";
import { EVENT_TYPES, type SimEvent } from "./events.ts";

const DAY = 86400;

export const ENDING_TYPES = ["military_victory", "negotiated_settlement", "coalition_fracture", "death", "capture_deposition", "territorial_authority_failure"] as const;
export type EndingType = (typeof ENDING_TYPES)[number];
/** Which endings the world can produce at all (victory and settlement from 14B stage 2). */
const REACHABLE: Record<EndingType, boolean> = { military_victory: true, negotiated_settlement: true, coalition_fracture: true, death: true, capture_deposition: true, territorial_authority_failure: true };

export const PRESSURES = ["rebellion", "food_security", "wilds", "frontier", "environment"] as const;
export type Pressure = (typeof PRESSURES)[number];
/** A pressure is read from the system of the nearest event on an input's chain of causes that belongs to one. (`frontier` has no system until 14B.) */
export const SYSTEM_PRESSURE: Readonly<Record<string, Pressure>> = Object.freeze({
  frontier: "frontier",
  communities: "rebellion",
  grain: "food_security", goods: "food_security", economy: "food_security", manpower: "food_security",
  threat: "wilds", exploration: "wilds",
  weather: "environment", environment: "environment",
});

/** Events that are an agent's decision (a character's, or a community's change of stance). */
export const DECISION_TYPES: readonly string[] = ["PlayerInput", "OrderIssued", "ObedienceDecided", "LocalPlanFormed", "SubordinateOrdersIssued", "ExpeditionStarted", "CommunityStanceChanged", "DecisionMade"];

export interface EndingReading {
  type: EndingType | "unresolved";
  tick: number | null;
  /** The event that completed the ending's condition. */
  trigger: number | null;
  /** `decision` if any event in the trigger's ancestry is an agent's decision, else `exogenous`. */
  firstCause: "decision" | "exogenous" | null;
  ancestryDomains: string[];
  reachable: Record<EndingType, boolean>;
}

interface Candidate { type: EndingType; tick: number; trigger: number }

/** `until` is how far the log is known to run (default: its last event); the horizon is `scenario.endings.horizonDays`. */
export function readEnding(log: readonly SimEvent[], c: Content, until?: number): EndingReading {
  const en = c.scenario.endings, horizon = en.horizonDays * DAY;
  const known = Math.min(horizon, until ?? (log.length ? log[log.length - 1].tick : 0));
  const events = log.filter((e) => e.tick <= horizon);
  const cands: Candidate[] = [];
  // death and capture: the campaign's own endings
  const ended = events.find((e) => e.type === "CampaignEnded");
  if (ended) cands.push({ type: ended.payload.ending === "killed" ? "death" : "capture_deposition", tick: ended.tick, trigger: ended.id });
  // territorial failure: enough objective forts held by raiders at once
  const forts = new Set(c.scenario.objective.forts), lost = new Set<string>();
  for (const e of events) {
    const f = e.payload.fort as string | undefined;
    if (!f || !forts.has(f)) continue;
    if (e.type === "FortFell") { lost.add(f); if (lost.size >= en.lostForts) { cands.push({ type: "territorial_authority_failure", tick: e.tick, trigger: e.id }); break; } }
    else if (e.type === "FortRetaken") lost.delete(f);
  }
  // coalition fracture: enough communities in stance `support` of one actor, unbroken for the hold
  const holds = new Map<string, string>(); // community -> actor
  let pending: { start: number; trigger: number } | null = null;
  const hold = en.fractureDays * DAY;
  const group = () => { const by = new Map<string, number>(); for (const a of holds.values()) by.set(a, (by.get(a) ?? 0) + 1); return [...by.values()].some((k) => k >= en.fractureCommunities); };
  for (const e of events) {
    if (e.type !== "CommunityStanceChanged") continue;
    if (pending && e.tick >= pending.start + hold) break;
    const comm = e.payload.community as string, actor = e.payload.supports as string | undefined;
    if (e.payload.to === "support" && actor) holds.set(comm, actor); else holds.delete(comm);
    if (group()) pending ??= { start: e.tick, trigger: e.id }; else pending = null;
  }
  // negotiated settlement: a treaty signed, and no host marched for the hold after it
  const signed = events.find((e) => e.type === "TreatySigned"), settle = en.settlementDays * DAY;
  if (signed && signed.tick + settle <= known && !events.some((e) => e.type === "FrontierStrike" && e.tick >= signed.tick && e.tick <= signed.tick + settle)) cands.push({ type: "negotiated_settlement", tick: signed.tick + settle, trigger: signed.id });
  // military victory: enough of the host's marches at the gate ended by the March's arms (a host that goes home does not count)
  const gate = c.scenario.frontier?.site;
  if (gate) {
    let won = 0;
    for (const e of events) if (e.type === "ThreatEnded" && e.payload.site === gate && ["sortie", "battle", "assault"].includes(e.payload.endedBy as string) && ++won >= en.victoryHosts) { cands.push({ type: "military_victory", tick: e.tick, trigger: e.id }); break; }
  }
  if (pending && pending.start + hold <= known) cands.push({ type: "coalition_fracture", tick: pending.start + hold, trigger: pending.trigger });
  if (!cands.length) return { type: "unresolved", tick: null, trigger: null, firstCause: null, ancestryDomains: [], reachable: { ...REACHABLE } };
  cands.sort((a, b) => a.tick - b.tick || ENDING_TYPES.indexOf(a.type) - ENDING_TYPES.indexOf(b.type));
  const first = cands[0];
  const { ancestors } = ancestry(log, first.trigger);
  return {
    type: first.type, tick: first.tick, trigger: first.trigger,
    firstCause: ancestors.some((e) => DECISION_TYPES.includes(e.type)) ? "decision" : "exogenous",
    ancestryDomains: [...new Set(ancestors.map((e) => e.domain))].sort(),
    reachable: { ...REACHABLE },
  };
}

/** The event and everything its causes reach, with the roots among them. */
function ancestry(log: readonly SimEvent[], id: number, byId = new Map(log.map((e) => [e.id, e] as const))) {
  const seen = new Set<number>(), stack = [id], ancestors: SimEvent[] = [], roots: SimEvent[] = [];
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x)) continue;
    seen.add(x);
    const e = byId.get(x);
    if (!e) continue;
    ancestors.push(e);
    if (!e.causedBy.length) roots.push(e);
    stack.push(...e.causedBy);
  }
  return { ancestors, roots };
}

/** Breadth-first through `causedBy`: the pressures of the closest events (not the input itself) whose system belongs to one. */
function nearestPressures(id: number, byId: Map<number, SimEvent>, frontierSite?: string): Set<Pressure> {
  let level = [id];
  const seen = new Set<number>([id]);
  while (level.length) {
    const next: number[] = [], found = new Set<Pressure>();
    for (const x of level) for (const cid of byId.get(x)?.causedBy ?? []) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      const x = byId.get(cid), p = frontierSite && x?.payload.site === frontierSite ? "frontier" : SYSTEM_PRESSURE[EVENT_TYPES[x?.type ?? ""]?.system];
      if (p) found.add(p); else next.push(cid);
    }
    if (found.size) return found;
    level = next;
  }
  return new Set();
}

/** What the decision's own action answers, or null when the action says nothing about a pressure (then the chain of causes decides):
 *  repair answers what last damaged the fort; grain moved or bought answers food; relief answers rebellion; advance (or a scout or attack) answers the
 *  raiders at that fort or site (the gate's are the frontier's); a treaty answer is the frontier's. Everything else (levy, order, policy, ask, travel, battle) is null. */
function answered(e: SimEvent, lastDamage: Map<string, Pressure>, active: Map<string, { target: string; since: number }>, gate?: string): Set<Pressure> | null {
  const p = e.payload, one = (x: Pressure | undefined) => (x ? new Set<Pressure>([x]) : null);
  switch (p.action) {
    case "repair": return one(lastDamage.get(p.target as string));
    case "requisition": case "purchase": return !p.good || p.good === "grain" ? one("food_security") : null;
    case "relief": return one("rebellion");
    case "treaty": return one("frontier");
    case "advance": {
      if (typeof p.raid === "string") return one(gate && p.raid === gate ? "frontier" : "wilds");
      let site: string | undefined, since = -1;
      for (const [s, t] of active) if (t.target === p.target && t.since > since) { site = s; since = t.since; }
      return site === undefined ? null : one(gate && site === gate ? "frontier" : "wilds");
    }
    default: return null;
  }
}

export interface Attention {
  /** Share of the ruler's counted inputs that came from each pressure (0 to 1; they sum to 1, or all 0 if nothing was counted). */
  shares: Record<Pressure, number>;
  dominant: Pressure | null;
  runnerUp: Pressure | null;
  /** The first day with an input inside each pressure's busiest 30 days (null if it never drew an input). */
  peakDay: Record<Pressure, number | null>;
  /** Inputs that came from a pressure, and inputs that came from none (routine). */
  counted: number;
  routine: number;
}

export function readAttention(log: readonly SimEvent[], c: Content): Attention {
  const horizon = c.scenario.endings.horizonDays * DAY, days = c.scenario.endings.horizonDays;
  const byId = new Map(log.map((e) => [e.id, e] as const));
  const sum = Object.fromEntries(PRESSURES.map((p) => [p, 0])) as Record<Pressure, number>;
  const perDay = Object.fromEntries(PRESSURES.map((p) => [p, new Array<number>(days + 1).fill(0)])) as Record<Pressure, number[]>;
  let counted = 0, routine = 0;
  const gate = c.scenario.frontier?.site;
  // What the log says so far (read in order, so a decision sees only what came before it): what last damaged each place, and the raiders now abroad.
  const lastDamage = new Map<string, Pressure>(), active = new Map<string, { target: string; since: number }>();
  for (const e of log) {
    const p = e.payload;
    switch (e.type) {
      case "FortificationsWeathered": for (const ch of (p.changes as [string, number][] | undefined) ?? []) lastDamage.set(ch[0], "environment"); break;
      case "Storm": case "Hazard": if (typeof p.location === "string") lastDamage.set(p.location, "environment"); break;
      case "RaidDamage": if (typeof p.location === "string") lastDamage.set(p.location, gate && p.site === gate ? "frontier" : "wilds"); break;
      case "ThreatBegan": active.set(p.site as string, { target: p.target as string, since: e.tick }); break;
      case "ThreatEnded": active.delete(p.site as string); break;
    }
    if (e.type !== "PlayerInput" || e.tick > horizon) continue;
    const ps = answered(e, lastDamage, active, gate) ?? nearestPressures(e.id, byId, gate);
    if (!ps.size) { routine++; continue; }
    counted++;
    for (const p of ps) { sum[p] += 1 / ps.size; perDay[p][Math.min(days, Math.floor(e.tick / DAY))] += 1 / ps.size; }
  }
  const shares = Object.fromEntries(PRESSURES.map((p) => [p, counted ? sum[p] / counted : 0])) as Record<Pressure, number>;
  const ranked = PRESSURES.filter((p) => shares[p] > 0).sort((a, b) => shares[b] - shares[a] || PRESSURES.indexOf(a) - PRESSURES.indexOf(b));
  const peakDay = Object.fromEntries(PRESSURES.map((p) => {
    if (!sum[p]) return [p, null];
    let best = -1, end = 0, w = 0;
    for (let d = 0; d <= days; d++) { w += perDay[p][d]; if (d >= 30) w -= perDay[p][d - 30]; if (w > best + 1e-9) { best = w; end = d; } }
    let at = Math.max(0, end - 29);
    while (at < end && perDay[p][at] === 0) at++; // the first day with an input inside those 30 days
    return [p, at];
  })) as Record<Pressure, number | null>;
  return { shares, dominant: ranked[0] ?? null, runnerUp: ranked[1] ?? null, peakDay, counted, routine };
}
