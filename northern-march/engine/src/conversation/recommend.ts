// Questions to advisers, answered from the Recommendation she holds (ARCHITECTURE §20.12): "what would you do", "why", "how
// sure are you", "what worries you", "what else could we do", "what if it fails". The words come from the Recommendation's
// own plan, reasons, uncertainties and alternatives, in the adviser's name; nothing is worked out here. A Recommendation
// goes stale when she learns something material, after it was given, about what it concerns; then he must think again.
import { beliefsAbout, type Recommendation, type View } from "../view.ts";
import { certainty, nameOf, nearestFort, planOf, planWords, reasonWords, wallWords, raiderWords } from "../presentation/phrasing.ts";
import type { QuestionKind, SpeechAct } from "./layer.ts";
import { act } from "./speak.ts";
import { lowerFirst, orList, andList } from "./text.ts";

/** The places a piece of advice concerns: its plan's and its alternatives', and the fort that answers a site. */
function concerns(v: View, r: Recommendation): Set<string> {
  const out = new Set<string>();
  for (const p of [r.plan, ...r.alternatives]) {
    const a = planOf(v, p.id);
    if (a.target) { out.add(a.target); const f = nearestFort(v, a.target); if (f) out.add(f); }
  }
  return out;
}
const materially = (now: unknown, was: unknown): boolean => typeof now === "number" && typeof was === "number" ? Math.abs(now - was) > Math.max(0.1 * Math.abs(was), 1) : now !== was;

export function recommendationStale(v: View, r: Recommendation): boolean {
  const where = concerns(v, r);
  if (!where.size) return false; // waiting and its like concern no place in particular
  const byKey = new Map<string, typeof v.beliefs[string][]>();
  for (const b of Object.values(v.beliefs)) if (where.has(b.subject.id)) { const k = `${b.subject.id}|${b.predicate}`; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(b); }
  for (const bs of byKey.values()) {
    const sorted = [...bs].sort((a, b) => a.observedAt - b.observedAt || a.id - b.id);
    const prior = [...sorted].reverse().find((b) => b.observedAt <= r.computedAt), later = [...sorted].reverse().find((b) => b.observedAt > r.computedAt);
    if (prior && later && materially(later.believedValue, prior.believedValue)) return true;
  }
  return false;
}

/** What a belief is about, in words, as the adviser holds it (the Recommendation names it by id; her own view has the same fact if she heard it). */
function beliefWords(v: View, id: string): string | undefined {
  const b = v.beliefs[id];
  if (!b) return undefined;
  const s = nameOf(v, b.subject.id);
  switch (b.predicate) {
    case "fortification.condition": return `the walls at ${s} (${wallWords(Number(b.believedValue))})`;
    case "threat.intensity": return `the raiders at ${s} (${raiderWords(Number(b.believedValue))})`;
    case "fortification.garrison": return `the men at ${s}`;
    case "grain.stock": return `the grain at ${s}`;
    default: return undefined;
  }
}

const weak = (r: Recommendation, v: View): string[] => r.uncertainties.map((u) => beliefWords(v, u.belief.id)).filter((x): x is string => !!x);
const plan = (v: View, id: string) => lowerFirst(planWords(v, id));
const reasonsFor = (r: Recommendation) => r.reasons.filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight || (a.textKey < b.textKey ? -1 : 1));
const reasonsAgainst = (r: Recommendation) => r.reasons.filter((x) => x.weight < 0).sort((a, b) => a.weight - b.weight || (a.textKey < b.textKey ? -1 : 1));
const uniq = (xs: string[]) => [...new Set(xs)];

/** The adviser's answer to one question about his own Recommendation, as a speech act. */
export function answerFor(v: View, r: Recommendation, q: QuestionKind): SpeechAct {
  const who = r.author, names = [nameOf(v, who)];
  const doIt = plan(v, r.plan.id), sel = [...r.plan.id.matchAll(/"target":"([a-z_]+)"/g)].map((m) => nameOf(v, m[1]));
  switch (q) {
    case "what_would_you_do": return act("answer", who, `I would ${doIt}.`, sel);
    case "why": {
      const f = uniq(reasonsFor(r).slice(0, 3).map((x) => reasonWords(x.textKey))), a = uniq(reasonsAgainst(r).slice(0, 2).map((x) => reasonWords(x.textKey)));
      const text = !f.length && !a.length ? `I have no more to say than that I would ${doIt}.` : `I would ${doIt}${f.length ? `, for ${andList(f)}` : ""}${a.length ? `; against it weigh ${andList(a)}` : ""}.`;
      return act("answer", who, text, sel);
    }
    case "how_sure": {
      const w = weak(r, v);
      if (!r.uncertainties.length) return act("answer", who, "I am sure of what I have been told.", names);
      return act("answer", who, w.length ? `I am less sure of ${andList(w.slice(0, 3))}; the word I have may be out of date.` : `I am not sure of everything I have been told; some of it may be out of date.`, names);
    }
    case "what_worries_you": {
      const against = uniq(reasonsAgainst(r).slice(0, 2).map((x) => reasonWords(x.textKey))), w = weak(r, v);
      if (!against.length && !r.uncertainties.length) return act("answer", who, "Nothing worries me more than the usual risks.", names);
      return act("answer", who, `What worries me: ${[...against, ...w.slice(0, 2).map((x) => `what I know of ${x}`), ...(!w.length && r.uncertainties.length ? ["word that may be out of date"] : [])].join("; ")}.`, names);
    }
    case "alternatives": {
      const alts = r.alternatives.map((a) => plan(v, a.id));
      return act("answer", who, alts.length ? `Otherwise: ${orList(alts)}.` : "I see no other way.", r.alternatives.flatMap((a) => [...a.id.matchAll(/"target":"([a-z_]+)"/g)].map((m) => nameOf(v, m[1]))));
    }
    case "what_if": {
      if (r.contingencies.length) return act("answer", who, `If it fails, I would think again.`, names);
      const next = r.alternatives[0];
      return act("answer", who, next ? `If that fails, I would ${plan(v, next.id)}.` : "I have no other course worked out if that fails.", next ? [...next.id.matchAll(/"target":"([a-z_]+)"/g)].map((m) => nameOf(v, m[1])) : []);
    }
  }
}
export { certainty };
export { beliefsAbout };
