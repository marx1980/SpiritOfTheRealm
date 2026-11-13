// Voice to text (docs/CONVERSATION.md §5). The adapter is an interface: a recogniser (the browser's, a service, a scripted one in
// tests) returns words with a confidence each. `correctTranscript` snaps what looks like a name she knows to that name and says
// what it changed, so the transcript can be shown and edited before it is understood. Out of the world: no game time.
import type { View } from "../view.ts";
import type { Lexicon } from "./lexicon.ts";
import { findNames, nameIndex, tokenise } from "./text.ts";

export interface Transcript { text: string; words?: { w: string; conf: number }[] }
export interface Transcriber { id: string; transcribe(audio: unknown): Transcript | Promise<Transcript> }
export interface Correction { text: string; changes: { from: string; to: string }[]; /** Words the recogniser was unsure of that matched nothing she knows. */ suspects: string[]; costSeconds: 0 }

const FUZZY: Lexicon["fuzzy"] = { minLength: 5, oneEditUpTo: 7, twoEditsFrom: 8 };
const SURE = 0.8;

export function correctTranscript(v: View, t: Transcript, fuzzy: Lexicon["fuzzy"] = FUZZY): Correction {
  const toks = tokenise(t.text), conf = new Map<number, number>();
  if (t.words?.length && t.words.length === toks.length) t.words.forEach((x, i) => conf.set(i, x.conf));
  // words the recogniser was sure of, and that are not part of a name, are left alone
  const idx = nameIndex(v);
  const hits = findNames(toks, idx, fuzzy, new Set());
  const changes: Correction["changes"] = [], replace = new Map<number, { end: number; to: string }>();
  for (const h of hits) {
    const unsure = !conf.size || [...Array(h.end - h.start).keys()].some((k) => (conf.get(h.start + k) ?? 0) < SURE);
    const from = toks.slice(h.start, h.end).map((x) => x.raw).join(" ");
    if (h.exact || !unsure || from === h.name) continue;
    replace.set(h.start, { end: h.end, to: h.name }); changes.push({ from, to: h.name });
  }
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) { const r = replace.get(i); if (r) { out.push(r.to); i = r.end - 1; } else out.push(toks[i].raw); }
  const matched = new Set<number>(); for (const h of hits) for (let k = h.start; k < h.end; k++) matched.add(k);
  const suspects = toks.filter((x, i) => (conf.get(i) ?? 1) < 0.5 && !matched.has(i)).map((x) => x.raw);
  return { text: out.join(" "), changes, suspects, costSeconds: 0 };
}

/** A recogniser that says what it was told to (for tests and the lab). */
export function scriptedTranscriber(lines: Transcript[]): Transcriber {
  let n = 0;
  return { id: "scripted", transcribe: () => lines[Math.min(n++, lines.length - 1)] };
}
