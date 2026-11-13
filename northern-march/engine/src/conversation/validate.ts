// The rules that make a language layer safe to listen to (docs/CONVERSATION.md §6). A line a layer produces is accepted only if
// it carries nothing the act does not: no name she has not been given, no number the act does not hold, no claim about what
// will happen. A rejected line is replaced by the canonical one.
import type { View } from "../view.ts";
import type { SpeechAct } from "./layer.ts";
import { nameIndex, tokenise } from "./text.ts";

export interface Verdict { ok: boolean; problems: string[] }

const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "dozen", "half", "twice", "thrice"]);
const NUMBER_VALUE: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000 };
/** Claims about what will happen, certainty beyond the act's, and odds as numbers: never carried by a line. */
const FORBIDDEN: [RegExp, string][] = [
  [/\b(will|shall|is going to|are going to) (surely|certainly|definitely|always|never)\b/i, "a certain claim about the future"],
  [/\b(will|shall) (win|lose|fall|die|fail|succeed|break|defeat|be killed|be taken|betray|attack|come)\b/i, "a claim about what will happen"],
  [/\b(certainly|definitely|without (a )?doubt|for certain|guarantee[ds]?|i promise|i swear|undoubtedly)\b/i, "more certainty than the act carries"],
  [/\b\d+\s*(%|per ?cent|percent|in \d+|to \d+)\b/i, "odds as a number"],
  [/\b(he|she|they) (secretly|really|truly) (wants?|intends?|plans?|means?)\b/i, "a claim about another person's mind"],
];

export function validateSpeech(v: View, act: SpeechAct, text: string): Verdict {
  const problems: string[] = [];
  const allowedNames = new Set(act.facts.names.flatMap((n) => tokenise(n).map((t) => t.w)));
  if (act.speaker) for (const t of tokenise(v.world.names[act.speaker] ?? act.speaker)) allowedNames.add(t.w);
  for (const t of tokenise(v.world.names[v.self.id] ?? "")) allowedNames.add(t.w); // she may be spoken of by name
  const toks = tokenise(text);
  // 1. every name in the line is one the act carries
  const known = nameIndex(v);
  for (const e of known) {
    const own = tokenise(e.name).map((t) => t.w), hit = e.aliases.some((a) => { const ws = tokenise(a).map((t) => t.w); return toks.some((_, i) => ws.every((w, k) => toks[i + k]?.w === w)); });
    if (hit && !own.some((w) => allowedNames.has(w))) problems.push(`names ${e.name}, which the line is not about`);
  }
  // 2. a capitalised word in the middle of a sentence that is no name she knows is a name made up
  const sentenceStart = new Set<number>([0]);
  toks.forEach((t, i) => { if (/[.!?]\s+$/.test(text.slice(0, text.indexOf(t.raw, 0) + t.raw.length + 1)) && i + 1 < toks.length) sentenceStart.add(i + 1); });
  const knownWords = new Set(known.flatMap((e) => e.aliases.flatMap((a) => tokenise(a).map((t) => t.w))));
  toks.forEach((t, i) => { if (/^[A-Z]/.test(t.raw) && !sentenceStart.has(i) && t.raw !== "I" && !knownWords.has(t.w) && !allowedNames.has(t.w)) problems.push(`names ${t.raw}, whom she has not been told of`); });
  // 3. numbers: only those the act holds
  const allowedNumbers = new Set(act.facts.numbers);
  for (const t of toks) {
    const n = /^\d+$/.test(t.w) ? Number(t.w) : NUMBER_WORDS.has(t.w) ? NUMBER_VALUE[t.w] : undefined;
    if (t.w === "one" || t.w === "half") continue; // "one of them", "half": not figures
    if (n !== undefined && !allowedNumbers.has(n)) problems.push(`gives the number ${t.raw}, which the line does not carry`);
  }
  // 4. nothing asserted beyond the act
  for (const [re, why] of FORBIDDEN) if (re.test(text)) problems.push(`says ${why}`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
