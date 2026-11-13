// Text helpers for the templated layer: normalising what was typed, finding the lexicon's phrases, and matching names she
// knows (exactly, joined or split, or with a small spelling slip). Pure.
import type { Lexicon } from "./lexicon.ts";
import type { View } from "../view.ts";

export interface Tok { w: string; raw: string; i: number }

/** Lower-case words, apostrophes kept, punctuation dropped; the original spelling kept beside each. */
export function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  const norm = text.replace(/[‘’]/g, "'");
  for (const m of norm.matchAll(/[A-Za-z0-9][A-Za-z0-9']*/g)) out.push({ w: m[0].toLowerCase().replace(/'+$/g, ""), raw: m[0], i: out.length });
  return out;
}
const words = (phrase: string) => tokenise(phrase).map((t) => t.w);

export interface Hit { start: number; end: number; key: string; phrase: string }
/** Every place in the tokens where one of the phrases occurs; overlaps resolved longest first, then earliest. */
export function findPhrases(toks: Tok[], table: Record<string, string[]>): Hit[] {
  const all: Hit[] = [];
  for (const [key, phrases] of Object.entries(table)) for (const ph of phrases) {
    const ws = words(ph);
    if (!ws.length) continue;
    for (let s = 0; s + ws.length <= toks.length; s++) if (ws.every((w, k) => toks[s + k].w === w)) all.push({ start: s, end: s + ws.length, key, phrase: ph });
  }
  all.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken = new Set<number>(), out: Hit[] = [];
  for (const h of all) {
    let free = true;
    for (let k = h.start; k < h.end; k++) if (taken.has(k)) free = false;
    if (!free) continue;
    for (let k = h.start; k < h.end; k++) taken.add(k);
    out.push(h);
  }
  return out.sort((a, b) => a.start - b.start);
}
export const listFlat = (list: string[]): Record<string, string[]> => ({ _: list });

/** Whether the whole utterance is made of the given phrases and little else (for "yes", "never mind", "yes, that's right"). */
export function onlyPhrases(toks: Tok[], list: string[], fillers: string[]): boolean {
  if (!toks.length) return false;
  const hits = findPhrases(toks, { a: list, f: fillers });
  const covered = new Set<number>();
  for (const h of hits) for (let k = h.start; k < h.end; k++) covered.add(k);
  return toks.every((t, k) => covered.has(k)) && hits.some((h) => h.key === "a");
}

export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** How many slips a word of this length is allowed before it stops being the same name. */
export const slips = (len: number, f: Lexicon["fuzzy"]) => (len < f.minLength ? 0 : len < f.twoEditsFrom ? 1 : 2);

export interface NameEntry { id: string; name: string; kind: "place" | "person"; aliases: string[] }
/** The names she knows: every place on her map and every person she knows of, with the short forms people use. */
export function nameIndex(v: View): NameEntry[] {
  const out: NameEntry[] = [];
  const placeIds = new Set(v.world.places.map((p) => p.id));
  for (const [id, name] of Object.entries(v.world.names).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const kind = placeIds.has(id) ? "place" : "person";
    const ws = words(name), aliases = new Set<string>([ws.join(" ")]);
    if (ws.length > 1 && (kind === "person" || ws[0].length >= 5)) aliases.add(ws[0]);
    if (kind === "person" && ws.length > 1 && ws[0] !== "brother") aliases.add(ws[ws.length - 1]);
    if (kind === "person" && ws[0] === "brother") aliases.add(ws[1]);
    out.push({ id, name, kind, aliases: [...aliases] });
  }
  return out;
}

export interface NameHit { start: number; end: number; id: string; name: string; kind: "place" | "person"; exact: boolean }
/** Names in the tokens: spans that equal a name or short form exactly; then spans that match once joined ("grey fen" for
 *  Greyfen) or with a spelling slip, which are not exact (they are confirmed out of the world). Longest first. */
export function findNames(toks: Tok[], idx: NameEntry[], f: Lexicon["fuzzy"], skip: Set<number> = new Set()): NameHit[] {
  const out: NameHit[] = [], taken = new Set<number>();
  const free = (s: number, e: number) => { for (let k = s; k < e; k++) if (taken.has(k)) return false; return true; };
  const claim = (h: NameHit) => { for (let k = h.start; k < h.end; k++) taken.add(k); out.push(h); };
  for (let len = 3; len >= 1; len--) for (let s = 0; s + len <= toks.length; s++) {
    if (!free(s, s + len)) continue;
    const span = toks.slice(s, s + len).map((t) => t.w).join(" ");
    const e = idx.find((x) => x.aliases.includes(span));
    if (e) claim({ start: s, end: s + len, id: e.id, name: e.name, kind: e.kind, exact: true });
  }
  // the near misses look only at words that are not the lexicon's own ("when" is not Bren)
  const freeFuzzy = (s: number, e: number) => { for (let k = s; k < e; k++) if (taken.has(k) || skip.has(k)) return false; return true; };
  // fewest slips first, so "grey fen" (none, once joined) is taken before anything that needs a guess
  for (let slip = 0; slip <= 2; slip++) for (let len = 1; len <= 3; len++) for (let s = 0; s + len <= toks.length; s++) {
    if (!freeFuzzy(s, s + len)) continue;
    const joined = squash(toks.slice(s, s + len).map((t) => t.w).join(""));
    if (joined.length < f.minLength || slips(joined.length, f) < slip) continue;
    let near = new Map<string, NameEntry>();
    for (const e of idx) for (const a of e.aliases) if (editDistance(joined, squash(a), 2) === slip) near.set(e.id, e);
    if (near.size === 1) { const e = [...near.values()][0]; claim({ start: s, end: s + len, id: e.id, name: e.name, kind: e.kind, exact: false }); }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const lowerFirst = (s: string) => s.replace(/^./, (c) => c.toLowerCase());
export const upperFirst = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
export function orList(xs: string[]): string { return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`; }
export function andList(xs: string[]): string { return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`; }
