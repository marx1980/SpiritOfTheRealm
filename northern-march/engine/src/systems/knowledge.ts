// Knowledge (B5, DESIGN_PIPELINE §4): observation with quality, integration into sparse belief stores,
// contradictions kept, first-hand / same-source resolution, caps with logged eviction, scenario seeding.
import { bandFromQuality, effectiveBand, evictionPlan, integrate, type Band, type BeliefProposition, type Evidence } from "../beliefs.ts";
import type { SubjectRef } from "../events.ts";
import type { Ctx, System } from "./types.ts";
import { chr, sorted } from "./types.ts";

export interface Claim { subject: SubjectRef; predicate: string; value: unknown; observedAt: number; band: Band }

/** Integrate one claim into a holder's store and emit BeliefUpdated (+ BeliefResolved, BeliefEvicted). */
export function learn(ctx: Ctx, holder: string, claim: Claim, evidence: Evidence, causedBy: number[]) {
  const store = ctx.s.beliefs[holder] ?? {};
  const incoming: BeliefProposition = { id: 0, subject: claim.subject, predicate: claim.predicate, believedValue: claim.value, evidenceRefs: [evidence],
    observedOrLearnedAt: claim.observedAt, observedAt: claim.observedAt, learnedAt: ctx.tick, reliabilityBand: claim.band };
  const prev = best(ctx, holder, claim.subject.id, claim.predicate);
  const { upsert, dropIds, reason } = integrate(store, incoming, { now: ctx.tick, halfLife: ctx.halfLife(claim.predicate), nextId: ctx.s.nextPropId });
  const material = isMaterial(ctx, claim.predicate, prev?.believedValue, claim.value);
  const upd = ctx.emit("BeliefUpdated", causedBy, [chr(holder), claim.subject], { holder, prop: upsert, material });
  if (dropIds.length) ctx.emit("BeliefResolved", [upd.id], [chr(holder), claim.subject], { holder, kept: upsert.id, dropped: dropIds, reason });
  const ch = ctx.content.byId.character.get(holder)!;
  const cap = ctx.content.scenario.knowledge.beliefCaps[ch.tier];
  const plan = evictionPlan(ctx.s.beliefs[holder], cap, {
    now: ctx.tick, halfLifeOf: (p) => ctx.halfLife(p.predicate), relevanceOf: (p) => relevance(ctx, holder, p.subject),
  });
  if (plan.length) ctx.emit("BeliefEvicted", [upd.id], [chr(holder)], { holder, propIds: plan.map((x) => x.id), scores: plan.map((x) => x.score) });
  return upd;
}

/** A change matters if there was no belief, a different non-numeric value, or a numeric value in another band of
 *  width `materialDelta` (so slow drift wakes an agent when it crosses a band edge, not every day). */
function isMaterial(ctx: Ctx, predicate: string, before: unknown, after: unknown) {
  if (before === undefined) return true;
  const d = ctx.content.byId.predicate.get(predicate)!.materialDelta;
  if (typeof before === "number" && typeof after === "number") return Math.floor(before / d) !== Math.floor(after / d);
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Effective skill: content capability plus experience gained in play. */
export function skill(ctx: Ctx, who: string, domain: string) {
  return Math.min(1000, (ctx.content.byId.character.get(who)?.capabilities[domain] ?? 0) + (ctx.s.agents[who]?.experience[domain] ?? 0));
}

/** Interpretation (ARCHITECTURE §20.7): low skill in the domain treats a reading as more reliable than it is. */
export function interpretBand(ctx: Ctx, who: string, predicate: string, band: Band): Band {
  const domain = CAPABILITY_FOR[predicate];
  if (!domain || skill(ctx, who, domain) >= 500 || band === "certain") return band;
  return (["doubtful", "uncertain", "probable", "certain"] as const)[["doubtful", "uncertain", "probable", "certain"].indexOf(band) + 1];
}

/** 1000: about the holder, where they are, their superior or someone they have a relationship with; 600: same province; else 300. */
function relevance(ctx: Ctx, holder: string, subj: SubjectRef): number {
  const ch = ctx.content.byId.character.get(holder)!;
  const pos = ctx.s.positions[holder];
  const here = "at" in pos ? pos.at : pos.transit.dest;
  if (subj.id === holder || subj.id === here || subj.id === ch.reportsTo || ch.relationships.some((r) => r.to === subj.id)) return 1000;
  const prov = ctx.content.byId.location.get(here)!.province;
  const subjLoc = subj.kind === "location" ? subj.id : subj.kind === "character" ? ctx.content.byId.character.get(subj.id)?.location : undefined;
  return subjLoc && ctx.content.byId.location.get(subjLoc)?.province === prov ? 600 : 300;
}

export const CAPABILITY_FOR: Record<string, string> = { "fortification.condition": "engineering", "character.location": "intelligence", "threat.intensity": "intelligence", "treasury.balance": "administration" };

/** A character looks at something where they are. Quality = capability minus conditions; error shrinks with quality. */
export function observe(ctx: Ctx, observer: string, subject: SubjectRef, predicate: string, cause: number) {
  const k = ctx.content.scenario.knowledge;
  let value: unknown, quality: number;
  if (predicate === "fortification.condition") {
    const truth = ctx.s.fortifications[subject.id].conditionMilli;
    const storm = ctx.s.lastStorm[subject.id];
    quality = Math.max(0, skill(ctx, observer, CAPABILITY_FOR[predicate]) - (storm !== undefined && ctx.tick - storm < 86400 ? k.stormPenaltyPermille : 0));
    const maxErr = (1000 - quality) * k.maxErrorMilliPerMissingPermille;
    const r = ctx.keyed(`knowledge:observe:${observer}:${ctx.tick}:${subject.id}:${predicate}`);
    value = Math.max(0, Math.min(100000, truth + r.int(-maxErr, maxErr)));
  } else if (predicate === "threat.intensity") {
    // estimating raiders' strength from what they did: errors shrink with intelligence skill
    const truth = ctx.s.threats[subject.id]?.intensityPermille ?? 0;
    quality = skill(ctx, observer, "intelligence");
    const maxErr = Math.floor((1000 - quality) / 2);
    const r = ctx.keyed(`knowledge:observe:${observer}:${ctx.tick}:${subject.id}:${predicate}`);
    value = truth === 0 ? 0 : Math.max(50, Math.min(1000, truth + r.int(-maxErr, maxErr)));
  } else if (predicate === "treasury.balance") {
    const truth = ctx.s.treasuryMilli[subject.id] ?? 0;
    quality = skill(ctx, observer, "administration");
    const maxErr = (1000 - quality) * 20;
    const r = ctx.keyed(`knowledge:observe:${observer}:${ctx.tick}:${subject.id}:${predicate}`);
    value = truth + r.int(-maxErr, maxErr);
  } else if (predicate === "character.location") {
    const pos = ctx.s.positions[subject.id];
    if (!("at" in pos)) return null;
    value = pos.at; quality = 1000; // seeing someone in the same place is certain
  } else throw new Error(`cannot observe ${predicate}`);
  const band = interpretBand(ctx, observer, predicate, bandFromQuality(quality, k.bands));
  const obs = ctx.emit("Observed", [cause], [chr(observer), subject], { observer, subject, predicate, value, qualityPermille: quality, band });
  const here = ctx.s.positions[observer];
  const local = subject.kind === "location" && "at" in here && here.at === subject.id;
  return learn(ctx, observer, { subject, predicate, value, observedAt: ctx.tick, band }, { kind: "observation", eventId: obs.id, source: observer, ...(local ? { local: true } : {}) }, [obs.id]);
}

/** Best current belief (highest effective band, then freshest, then lowest id). */
export function best(ctx: Ctx, holder: string, subjectId: string, predicate: string): (BeliefProposition & { band: string }) | null {
  const hl = ctx.halfLife(predicate);
  const xs = Object.values(ctx.s.beliefs[holder] ?? {}).filter((p) => p.subject.id === subjectId && p.predicate === predicate)
    .map((p) => ({ ...p, band: effectiveBand(p, ctx.tick, hl) })).filter((p) => p.band !== "stale");
  const rank = ["doubtful", "uncertain", "probable", "certain"];
  xs.sort((a, b) => rank.indexOf(b.band) - rank.indexOf(a.band) || b.observedAt - a.observedAt || a.id - b.id);
  return xs[0] ?? null;
}

export const knowledge: System = {
  id: "knowledge",
  // Scenario knowledge: everyone knows the seat (stable) and the last known whereabouts (ages from tick 0) of their
  // superior, their subordinates and the people they deal with; the ruler knows them for every named character.
  start: (ctx) => {
    const c = ctx.content;
    for (const ch of sorted(c.characters, (x) => x.id)) {
      const known = new Set<string>(ch.relationships.map((r) => r.to));
      if (ch.reportsTo) known.add(ch.reportsTo);
      if (ch.id === c.scenario.ruler) for (const o of c.characters) known.add(o.id);
      for (const o of c.characters) if (o.reportsTo === ch.id) known.add(o.id);
      known.delete(ch.id);
      for (const id of [...known].sort()) {
        const home = c.byId.character.get(id)!.location;
        const ev = { kind: "scenario" as const, eventId: 1, source: "scenario" };
        learn(ctx, ch.id, { subject: chr(id), predicate: "character.seat", value: home, observedAt: 0, band: "certain" }, ev, [1]);
        learn(ctx, ch.id, { subject: chr(id), predicate: "character.location", value: home, observedAt: 0, band: "probable" }, ev, [1]);
      }
    }
  },
  handlers: {},
};
