// The rules that make a language layer safe to listen to (docs/CONVERSATION.md §6). Another layer may reword a line, but it
// may add nothing, drop nothing and turn nothing round: a line is accepted only if, once courtesy is set aside and the
// register's equivalent phrases are read as one, it says the canonical line's words in the canonical line's order (the
// closure, rule 7). Rules 0-6 are named checks for the common ways a line goes wrong; they explain a rejection and guard the
// closure, but the closure alone decides that nothing new gets through. A rejected line is replaced by the canonical one.
// What the closure cannot see: a rewording that keeps every word and its order but means something else by tone. Rewording
// is therefore narrow by design; understanding her (the other direction) is where another layer earns its keep.
import type { View } from "../view.ts";
import type { SpeechAct } from "./layer.ts";
import type { Lexicon } from "./lexicon.ts";
import { findPhrases, nameIndex, tokenise, type NameEntry, type Tok } from "./text.ts";

export interface Verdict { ok: boolean; problems: string[] }

/** Words that carry a figure, in any form. */
const NUMBER = /^(\d[\d,.]*\w*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|scores?|dozens?|half|halves|thirds?|quarters?|twice|thrice|double|triple|couple|pair|several|few|many|most|all|every|none|both|first|second|third)$/;
const NEGATOR = /^(not|no|never|nothing|none|nor|neither|nobody|nowhere|without|cannot|unless|.*n't)$/;
/** Shapes of claim a line may only make as often as the canonical line does (rule 5). */
const CLAIMS: [string, RegExp][] = [
  ["what will happen", /\b(will|shall|won't|shan't|\w+'ll|going to|bound to|sure to|about to|soon|tomorrow|tonight|surely|inevitabl\w*)\b/gi],
  ["more certainty than the act carries", /\b(certain\w*|definite\w*|undoubted\w*|doubt\w*|guarantee\w*|promise\w*|swear\w*|assured|assure\w*|of course|mark my words|without fail|cannot fail|can't fail|never fails?|no question)\b/gi],
  ["odds or chances", /(%|\b(per ?cent|percent|odds|chances?|likel\w*|unlikel\w*|probabl\w*|possib\w*|even money|in \w+ times|\w+ in (ten|a hundred|\d+)|\w+ to one)\b)/gi],
  ["what someone else thinks or means", /\b(wants?|wanted|intends?|intended|plans?|planned|plots?|plotting|schemes?|scheming|hopes?|fears?|hates?|loves?|trusts?|distrusts?|lying|lies|lied|loyal|disloyal|betray\w*|believes?|thinks|feels|secretly|really|truly)\b/gi],
  ["the world outside the game", /\b(ai|model|game|player|simulation|seed|computer|program|chatbot|assistant)\b/gi],
];
/** Rule 0: characters a spoken line may hold (quotation marks are allowed and read as nothing). */
const CHARS = /^[A-Za-z0-9 .,;:!?'’"“”\-–—()]+$/;
const STRENGTH: Record<string, number> = { "|": 1, "!": 2, "?": 3 };

interface Read { seq: string[]; entities: string[]; words: Tok[]; residual: string }
/** Words and stops: a stop is "?" or "!" or "|" (any of . , ; : ( ) and dashes); a trailing apostrophe stays on its word. */
function lex(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.replace(/[‘’]/g, "'").matchAll(/[A-Za-z0-9][A-Za-z0-9']*|[?!]|[.,;:()–—]|\s-\s|-/g)) {
    const r = m[0].trim();
    out.push({ w: /^[?!]$/.test(r) ? r : /^[.,;:()–—-]$/.test(r) ? "|" : r.toLowerCase(), raw: r, i: out.length });
  }
  return out;
}
const isStop = (w: string) => w in STRENGTH;
/** Names she knows, and in a battle the places and lines of the field, each with its short forms. */
function names(v: View, L: Lexicon): NameEntry[] {
  const idx = nameIndex(v), f = v.battle?.field;
  if (f) for (const p of [...f.places, ...f.lines]) idx.push({ id: `field:${p.id}`, name: p.name, kind: "place", aliases: [...new Set([tokenise(p.name).map((t) => t.w).join(" "), ...(L.battle.fieldAliases[p.id] ?? []).map((a) => tokenise(a).map((t) => t.w).join(" "))])] });
  return idx;
}
/** A line as the closure sees it: names as entities, equivalent phrases as one, courtesy set aside, stops kept. */
function read(text: string, idx: NameEntry[], L: Lexicon): Read {
  const toks = lex(text);
  const tag: (string | undefined)[] = toks.map(() => undefined);
  // names first, longest first, exact short forms only, never across a stop; a short form that fits several stands for all
  for (let len = 4; len >= 1; len--) for (let s = 0; s + len <= toks.length; s++) {
    const span = toks.slice(s, s + len);
    if (tag.slice(s, s + len).some((x) => x !== undefined) || span.some((t) => isStop(t.w))) continue;
    const ids = idx.filter((e) => e.aliases.includes(span.map((t) => t.w).join(" "))).map((e) => e.id).sort();
    if (!ids.length) continue;
    for (let k = s; k < s + len; k++) tag[k] = "";
    tag[s] = `@${ids.join("|")}`;
  }
  const rest: Tok[] = toks.map((t, i) => (tag[i] === undefined ? t : { ...t, w: tag[i] || "\u0000" }));
  const table: Record<string, string[]> = { free: L.speech.free, ...Object.fromEntries(L.speech.same.map((g, i) => [`§${i}`, g])) };
  const at = new Map(findPhrases(rest, table).map((h) => [h.start, h]));
  const seq: string[] = [], entities: string[] = [], residual: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const h = at.get(i), w = rest[i].w;
    if (h) { if (h.key !== "free") seq.push(h.key); i = h.end - 1; continue; }
    if (w === "\u0000") continue;
    residual.push(toks[i].raw);
    if (w.startsWith("@")) { seq.push(w); entities.push(w); continue; }
    if (L.speech.openers.includes(w) && (!seq.length || isStop(seq[seq.length - 1]))) continue; // "Indeed, ..." / "... . So, ..."
    seq.push(w);
  }
  // stops: a run is its strongest; none at the start; a plain stop at the end is the line's end
  const out: string[] = [];
  for (const w of seq) {
    if (!isStop(w)) { out.push(w); continue; }
    if (!out.length) continue;
    const last = out[out.length - 1];
    if (isStop(last)) { if (STRENGTH[w] > STRENGTH[last]) out[out.length - 1] = w; } else out.push(w);
  }
  if (out[out.length - 1] === "|") out.pop();
  return { seq: out, entities, words: toks.filter((t) => !isStop(t.w)), residual: residual.join(" ") };
}
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** Whether `text` may be spoken for `act` in place of its canonical line, judged with what the player knows (`v`). */
export function validateSpeech(v: View, act: SpeechAct, text: string, L: Lexicon): Verdict {
  const problems: string[] = [];
  const C = act.canonical;
  // 0. form
  if (!text.trim()) return { ok: false, problems: ["is empty"] };
  if (!CHARS.test(text)) problems.push("has characters a spoken line does not (markup, a line break, a link)");
  if (text.length > Math.max(2 * C.length, C.length + 80)) problems.push("is far longer than what it has to say");
  // 1. a system line (out of the world) is the game speaking: never reworded
  if (act.kind === "technical" && text !== C) return { ok: false, problems: [...problems, "rewords a system line"] };
  const idx = names(v, L), mine = read(text, idx, L), canon = read(C, idx, L);
  // 2. names: only those the act carries (its facts or its own line), and none dropped
  const allowed = new Set(canon.entities);
  for (const n of act.facts.names) for (const e of read(n, idx, L).entities) allowed.add(e);
  for (const e of new Set(mine.entities)) if (!allowed.has(e)) problems.push(`names ${e.slice(1).split("|").map((id) => v.world.names[id] ?? id).join(" or ")}, which the line is not about`);
  for (const e of new Set(canon.entities)) if (!mine.entities.includes(e)) problems.push(`drops ${e.slice(1).split("|").map((id) => v.world.names[id] ?? id).join(" or ")}`);
  // 3. a capitalised word she has not been given, anywhere in the line (a sentence start included), is a name made up
  const ok = new Set([...canon.words.map((t) => t.w), ...L.speech.free.flatMap((p) => tokenise(p).map((t) => t.w)), ...L.speech.openers, ...L.speech.same.flat().flatMap((p) => tokenise(p).map((t) => t.w)), ...idx.flatMap((e) => e.aliases.flatMap((a) => tokenise(a).map((t) => t.w)))]);
  for (const t of mine.words) if (/^[A-Z]/.test(t.raw) && t.raw !== "I" && !ok.has(t.w)) problems.push(`names ${t.raw}, whom she has not been told of (a name made up)`);
  // 4. figures: only those the canonical line gives or the act holds
  const figures = (r: Read) => r.words.map((t) => t.w).filter((w) => NUMBER.test(w));
  const have = figures(canon), nums = new Set(act.facts.numbers.map(String));
  for (const w of figures(mine)) { const i = have.indexOf(w); if (i >= 0) have.splice(i, 1); else if (!nums.has(w.replace(/,/g, ""))) problems.push(`gives the number word "${w}", which the line does not carry`); }
  // 5. claims: no more of each shape than the canonical line makes
  // counted outside the phrases the register lists as equivalent ("is that your will" is a question, not a prophecy)
  const pct = (t: string) => (t.includes("%") ? " %" : "");
  for (const [why, re] of CLAIMS) if (count(re, mine.residual + pct(text)) > count(re, canon.residual + pct(C))) problems.push(`says ${why}`);
  // 6. negation: as many "not"s as the canonical line, no more and no fewer
  const neg = (r: Read) => r.words.filter((t) => NEGATOR.test(t.w)).length;
  if (neg(mine) !== neg(canon)) problems.push(`adds or drops a "not" (negation)`);
  // 7. the closure: the same words in the same order, once courtesy is set aside and equivalents are read as one
  if (mine.seq.join(" ") !== canon.seq.join(" ")) {
    const k = mine.seq.findIndex((w, i) => w !== canon.seq[i]);
    const at = k < 0 ? canon.seq[mine.seq.length] : mine.seq[k];
    problems.push(k < 0 ? `leaves out "${at}"` : isStop(at) || isStop(canon.seq[k] ?? "") ? `stops or asks in another place (at "${at}")` : canon.seq.includes(at) ? `says things in another order (at "${at}")` : `adds or changes words (at "${at}")`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
