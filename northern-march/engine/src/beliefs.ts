// B5: belief propositions, reliability bands, lazy staleness, contradiction handling and eviction.
// Pure functions: the knowledge system turns their results into events.
import type { SubjectRef } from "./events.ts";

export type Band = "certain" | "probable" | "uncertain" | "doubtful";
export type EffectiveBand = Band | "stale";
/** Index = reliability; higher is better. */
export const BANDS: readonly EffectiveBand[] = ["stale", "doubtful", "uncertain", "probable", "certain"];

export interface Evidence { kind: "observation" | "report" | "intercepted" | "scenario"; eventId: number; source: string; reportId?: number }
export interface BeliefProposition<T = unknown> {
  id: number;
  subject: SubjectRef;
  predicate: string;
  believedValue: T;
  evidenceRefs: Evidence[];
  observedOrLearnedAt: number; // B5 field: the age of the fact itself (= observedAt)
  observedAt: number;          // when someone saw it
  learnedAt: number;           // when this holder learned it
  reliabilityBand: Band;
}

export function effectiveBand(p: Pick<BeliefProposition, "reliabilityBand" | "observedAt">, now: number, halfLife: number): EffectiveBand {
  const base = BANDS.indexOf(p.reliabilityBand);
  if (halfLife <= 0) return p.reliabilityBand;
  const steps = Math.floor(Math.max(0, now - p.observedAt) / halfLife);
  return BANDS[Math.max(0, base - steps)];
}

export function downgrade(b: Band, steps = 1): Band {
  return BANDS[Math.max(1, BANDS.indexOf(b) - steps)] as Band;
}

export function bandFromQuality(q: number, t: { certain: number; probable: number; uncertain: number }): Band {
  return q >= t.certain ? "certain" : q >= t.probable ? "probable" : q >= t.uncertain ? "uncertain" : "doubtful";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sourceOf = (p: BeliefProposition) => p.evidenceRefs[p.evidenceRefs.length - 1]?.source;
const MAX_EVIDENCE = 5;

/**
 * Integrate new evidence into one holder's store.
 * - Same subject, predicate and value: merge into that proposition (evidence appended, freshest time, better band).
 * - Different value: a new proposition; the old one is KEPT (contradictions coexist), unless
 *   (a) the new evidence is first-hand observation at probable or better: it resolves every other value, or
 *   (b) it comes from the same source with a newer observation: that source has updated its own account.
 */
export function integrate(store: Record<string, BeliefProposition>, incoming: BeliefProposition, o: { now: number; halfLife: number; nextId: number }) {
  const group = Object.values(store).filter((p) => p.subject.kind === incoming.subject.kind && p.subject.id === incoming.subject.id && p.predicate === incoming.predicate)
    .sort((a, b) => a.id - b.id);
  const match = group.find((p) => same(p.believedValue, incoming.believedValue));
  let upsert: BeliefProposition;
  if (match) {
    const cur = effectiveBand(match, o.now, o.halfLife);
    const curBand: Band = cur === "stale" ? "doubtful" : cur;
    const band = BANDS.indexOf(incoming.reliabilityBand) > BANDS.indexOf(curBand) ? incoming.reliabilityBand : curBand;
    const observedAt = Math.max(match.observedAt, incoming.observedAt);
    upsert = { ...match, evidenceRefs: [...match.evidenceRefs, ...incoming.evidenceRefs].slice(-MAX_EVIDENCE), observedAt, observedOrLearnedAt: observedAt,
      learnedAt: o.now, reliabilityBand: band };
  } else {
    upsert = { ...incoming, id: o.nextId, learnedAt: o.now, observedOrLearnedAt: incoming.observedAt };
  }
  const firsthand = incoming.evidenceRefs.some((e) => e.kind === "observation") && BANDS.indexOf(incoming.reliabilityBand) >= BANDS.indexOf("probable");
  const src = sourceOf(incoming);
  const dropIds = group.filter((p) => p.id !== upsert.id && !same(p.believedValue, incoming.believedValue))
    .filter((p) => firsthand || (sourceOf(p) === src && p.observedAt <= incoming.observedAt))
    .map((p) => p.id);
  const reason = !dropIds.length ? null : firsthand ? "first-hand observation" : "same source updated its account";
  return { upsert, dropIds, reason };
}

const BAND_WEIGHT: Record<EffectiveBand, number> = { certain: 1000, probable: 750, uncertain: 500, doubtful: 250, stale: 0 };

/** Score = band x recency x relevance (each 0..1000). Lowest go first, ties by id; enough to get back to the cap. */
export function evictionPlan(store: Record<string, BeliefProposition>, cap: number,
  o: { now: number; halfLifeOf: (p: BeliefProposition) => number; relevanceOf: (p: BeliefProposition) => number }) {
  const all = Object.values(store);
  if (all.length <= cap) return [];
  const scored = all.map((p) => {
    const hl = o.halfLifeOf(p), age = Math.max(0, o.now - p.observedAt);
    const recency = hl <= 0 ? 1000 : Math.floor((1000 * hl) / (hl + age));
    const score = Math.floor((BAND_WEIGHT[effectiveBand(p, o.now, hl)] * recency * o.relevanceOf(p)) / 1_000_000);
    return { id: p.id, score };
  }).sort((a, b) => a.score - b.score || a.id - b.id);
  return scored.slice(0, all.length - cap);
}
