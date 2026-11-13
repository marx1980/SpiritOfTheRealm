// The templated parser: her words → an Understanding, by the lexicon and the names she knows. Deterministic, no model.
import type { View } from "../view.ts";
import { emptyUnderstanding, type Mention, type QuestionKind, type Understanding, type UnderstandCtx } from "./layer.ts";
import { findNames, findPhrases, nameIndex, onlyPhrases, tokenise, type Hit, type NameEntry, type NameHit, type Tok } from "./text.ts";

/** Words that carry no meaning of their own here (articles, pronouns, the commonest nouns of an order). */
const STOP = new Set(["the", "a", "an", "and", "or", "of", "my", "our", "your", "his", "her", "their", "that", "this", "it", "its", "up", "out", "on", "off", "with", "by", "is", "are", "be", "me", "us", "we", "i", "you", "he", "she", "they", "them", "do", "does", "so", "as", "all",
  "walls", "wall", "fort", "forts", "fortress", "castle", "keep", "town", "village", "place", "men", "company", "captain", "people", "store", "stores", "market", "goods", "there", "here", "too", "also", "again", "own", "if", "when", "should", "would", "will", "can", "could", "what", "how", "why", "say", "said", "advises", "advice", "advised"]);

const PREP_ROLE = (ctx: UnderstandCtx, toks: Tok[], hit: { start: number }): Mention["role"] => {
  let k = hit.start - 1;
  if (k >= 0 && (toks[k].w === "the" || toks[k].w === "a")) k--;
  if (k < 0) return null;
  const P = ctx.lexicon.prepositions, one = toks[k].w, two = k > 0 ? `${toks[k - 1].w} ${toks[k].w}` : "";
  if (P.from.includes(one) || P.from.includes(two)) return "from";
  if (P.at.includes(one)) return "at";
  if (P.to.includes(one)) return "to";
  return null;
};

function mentionsOf(toks: Tok[], idx: NameEntry[], ctx: UnderstandCtx, covered: Set<number>): { ms: Mention[]; hits: NameHit[] } {
  const hits = findNames(toks, idx, ctx.lexicon.fuzzy, covered);
  return { hits, ms: hits.map((h) => ({ id: h.id, kind: h.kind, name: h.name, exact: h.exact, surface: toks.slice(h.start, h.end).map((t) => t.raw).join(" "), role: PREP_ROLE(ctx, toks, h) })) };
}

const cover = (set: Set<number>, hs: { start: number; end: number }[]) => { for (const h of hs) for (let k = h.start; k < h.end; k++) set.add(k); };

/** Words left over once everything understood is taken out, if they could be a name. */
function leftovers(toks: Tok[], covered: Set<number>, ctx: UnderstandCtx): string[] {
  const fill = new Set(ctx.lexicon.fillers.flatMap((f) => tokenise(f).map((t) => t.w)));
  const prep = new Set([...ctx.lexicon.prepositions.from, ...ctx.lexicon.prepositions.at, ...ctx.lexicon.prepositions.to].flatMap((f) => tokenise(f).map((t) => t.w)));
  return toks.filter((t, k) => !covered.has(k) && t.w.length >= 3 && !STOP.has(t.w) && !fill.has(t.w) && !prep.has(t.w) && !/^\d+$/.test(t.w)).map((t) => t.raw);
}

const LEAD_CORRECT = (toks: Tok[], ctx: UnderstandCtx): number => {
  const hits = findPhrases(toks, { c: ctx.lexicon.correct });
  let n = 0;
  for (const h of hits) { if (h.start === n) n = h.end; else break; }
  // a comma-less "no I mean": keep eating correction words that follow
  return n;
};

export function understandCourt(text: string, ctx: UnderstandCtx): Understanding {
  const L = ctx.lexicon, toks = tokenise(text);
  if (!toks.length) return emptyUnderstanding(text);
  if (onlyPhrases(toks, L.cancel, L.fillers)) return emptyUnderstanding(text, "cancel");
  if (onlyPhrases(toks, L.affirm, L.fillers)) return emptyUnderstanding(text, "affirm");
  const idx = nameIndex(ctx.view);
  // questions: the phrase, and the adviser (if one is named)
  const qh = findPhrases(toks, L.questions)[0];
  const lead = LEAD_CORRECT(toks, ctx);
  const covered = new Set<number>();
  const verbHits = findPhrases(toks, L.verbs), modeHits = findPhrases(toks, L.modes), goodHits = findPhrases(toks, L.goods), armHits = findPhrases(toks, L.arms);
  const fillHits = findPhrases(toks, { f: L.fillers });
  const qPhrase = qh && !(verbHits.some((v) => v.start < qh.start && v.key !== "follow")) ? qh : undefined;
  cover(covered, verbHits); cover(covered, modeHits); cover(covered, goodHits); cover(covered, armHits); cover(covered, fillHits);
  if (qPhrase) cover(covered, [qPhrase]);
  const { ms, hits } = mentionsOf(toks, idx, ctx, covered);
  cover(covered, hits);
  const u = emptyUnderstanding(text, "command");
  u.mentions = ms;
  u.modes = [...new Set(modeHits.map((h) => h.key))];
  u.goods = [...new Set(goodHits.map((h) => h.key))];
  u.arms = [...new Set(armHits.map((h) => h.key))];
  if (qPhrase) {
    const who = ms.find((m) => m.kind === "person");
    u.act = "question";
    u.question = { kind: qPhrase.key as QuestionKind, ...(who ? { addressee: who.id } : {}) };
    return u;
  }
  // verbs: "goods" and "arms" words double as nouns, so a verb is needed to make a command
  const verb = verbHits[0];
  if (verb) u.verb = verb.key;
  // "follow": the adviser named is the one followed
  u.unknown = leftovers(toks, covered, ctx);
  if (lead > 0) {
    // "no, I mean Northwatch": a correction; with its own verb it is a new command
    u.act = u.verb ? "command" : "correct";
    if (!u.verb && !u.mentions.length && !u.modes.length && !u.goods.length && !u.arms.length && !u.unknown.length) return emptyUnderstanding(text, "correct");
    return u;
  }
  if (!u.verb) {
    if (!u.mentions.length && !u.modes.length && !u.goods.length && !u.arms.length && !u.unknown.length) return emptyUnderstanding(text);
    u.act = "answer";
    return u;
  }
  // a place-taking verb with nothing it could be about and several strange words: say so; with one strange word, it is a name
  return u;
}

export function understandBattle(text: string, ctx: UnderstandCtx): Understanding {
  const L = ctx.lexicon, B = L.battle, toks = tokenise(text), b = ctx.view.battle;
  if (!toks.length) return emptyUnderstanding(text);
  if (onlyPhrases(toks, L.cancel, L.fillers)) return emptyUnderstanding(text, "cancel");
  if (onlyPhrases(toks, L.affirm, L.fillers)) return emptyUnderstanding(text, "affirm");
  const qh = findPhrases(toks, L.questions)[0];
  if (qh) { const u = emptyUnderstanding(text, "question"); u.question = { kind: qh.key as QuestionKind }; return u; }
  const lead = LEAD_CORRECT(toks, ctx);
  // the field's own names, with the words people use for them
  const field = b?.field;
  const fieldIdx: NameEntry[] = [], lineIdx: NameEntry[] = [];
  const norm = (s: string) => tokenise(s).map((t) => t.w).join(" ");
  for (const p of field?.places ?? []) fieldIdx.push({ id: p.id, name: p.name, kind: "place", aliases: [...new Set([norm(p.name), norm(p.name).replace(/^(the) /, ""), ...(B.fieldAliases[p.id] ?? []).map(norm)])] });
  for (const l of field?.lines ?? []) lineIdx.push({ id: l.id, name: l.name, kind: "place", aliases: [...new Set([norm(l.name), norm(l.name).replace(/^(the) /, ""), ...(B.fieldAliases[l.id] ?? []).map(norm)])] });
  const covered = new Set<number>();
  const verbHits = findPhrases(toks, B.verbs), limitHits = findPhrases(toks, { limit: B.limits }), condHits = findPhrases(toks, B.conditions), cmdHits = findPhrases(toks, { command: B.command });
  const viaHits = findPhrases(toks, B.via), fillHits = findPhrases(toks, { f: L.fillers }), allHits = findPhrases(toks, { all: B.all });
  // field names first (they may contain verb words: "the wood's edge"), then verbs among what is left
  const fieldHits = findNames(toks, [...fieldIdx, ...lineIdx], L.fuzzy, new Set());
  cover(covered, fieldHits);
  const free = (hs: Hit[]) => hs.filter((h) => { for (let k = h.start; k < h.end; k++) if (covered.has(k)) return false; return true; });
  const verbs = free(verbHits), lims = free(limitHits), conds = free(condHits), cmds = free(cmdHits), vias = free(viaHits);
  cover(covered, verbs); cover(covered, lims); cover(covered, conds); cover(covered, cmds); cover(covered, vias); cover(covered, fillHits); cover(covered, allHits);
  const people = findNames(toks, nameIndex(ctx.view).filter((e) => e.kind === "person"), L.fuzzy, covered);
  cover(covered, people);
  const u = emptyUnderstanding(text, "command");
  const asMention = (h: NameHit): Mention => ({ id: h.id, kind: h.kind, name: h.name, exact: h.exact, surface: toks.slice(h.start, h.end).map((t) => t.raw).join(" "), role: null });
  const cmdAt = cmds.length ? cmds[0].start : Infinity;
  const condAt = conds.length ? conds[0].start : Infinity;
  u.mentions = [...people.filter((h) => h.start < cmdAt).map(asMention), ...fieldHits.filter((h) => fieldIdx.some((e) => e.id === h.id) && !lims.some((l) => h.start >= l.end && h.start <= l.end + 2)).map(asMention)];
  u.command = people.filter((h) => h.start >= cmdAt).map((h) => h.id);
  // the recipient is the first person named before any "command" phrase
  const firstVerb = verbs.find((v) => v.start < condAt) ?? verbs[0];
  if (firstVerb) u.verb = firstVerb.key;
  const lim = lims[0];
  if (lim) { const ln = fieldHits.find((h) => lineIdx.some((e) => e.id === h.id) && h.start >= lim.end && h.start <= lim.end + 3); if (ln) u.limitLine = ln.id; }
  const cond = conds[0];
  if (cond) { const then = verbs.find((v) => v.start >= cond.end); u.when = { kind: cond.key as "enemy_engaged" | "enemy_horse_seen", ...(then ? { then: then.key } : {}) }; }
  u.modes = [...new Set(vias.map((h) => h.key))];
  if (u.modes.includes("signal")) {
    const rest = toks.filter((_, k) => !covered.has(k) || vias.some((v) => v.key === "signal" && k >= v.start && k < v.end)).map((t) => t.w).join(" ");
    const sig = Object.entries(B.signals).find(([, ws]) => ws.some((w) => rest.includes(tokenise(w).map((t) => t.w).join(" "))));
    if (sig) u.signal = sig[0];
  }
  u.unknown = leftovers(toks, covered, ctx).filter((w) => !/^(right|left|centre|center|wing|reserve|line|front|flank|archers|horse|cavalry|foot)$/i.test(w));
  if (lead > 0) {
    u.act = u.verb ? "command" : "correct";
    if (!u.verb && !u.mentions.length && !u.command.length && !u.modes.length && !u.unknown.length) return emptyUnderstanding(text, "correct");
    return u;
  }
  if (!u.verb) {
    if (!u.mentions.length && !u.command.length && !u.modes.length && !u.unknown.length && !u.limitLine) return emptyUnderstanding(text);
    u.act = "answer";
  }
  return u;
}

export function understand(text: string, ctx: UnderstandCtx): Understanding {
  return ctx.domain === "court" ? understandCourt(text, ctx) : understandBattle(text, ctx);
}
export type { View };
