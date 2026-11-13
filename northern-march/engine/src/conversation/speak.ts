// What people say, in the templated words. Every line is built as a SpeechAct: canonical words plus the facts they carry, so a
// reworded line from another layer can be checked against the same facts (validate.ts). Words only; no hidden numbers.
import { beliefsAbout, type View } from "../view.ts";
import { nameOf } from "../presentation/phrasing.ts";
import type { SpeechAct } from "./layer.ts";
import type { Slot } from "./resolve.ts";
import { lowerFirst, orList } from "./text.ts";

export const act = (kind: SpeechAct["kind"], speaker: string | null, canonical: string, names: string[] = [], numbers: number[] = []): SpeechAct => ({ kind, speaker, canonical, facts: { names, numbers } });

/** The adviser who is with her and answers for the court: the one whose advice she holds first, else the first one believed to be at her side. */
export function listener(v: View): string | null {
  const here = "at" in v.self.position ? v.self.position.at : null;
  const authors = [...new Set(v.advice.map((a) => a.author))].sort();
  if (authors.length) return authors[0];
  if (!here) return null;
  const near = Object.keys(v.world.areas).filter((id) => id !== v.self.id && v.world.areas[id] && beliefsAbout(v, id, "character.location")[0]?.believedValue === here).sort();
  return near[0] ?? null;
}
export const isPresent = (v: View, id: string): boolean => {
  const here = "at" in v.self.position ? v.self.position.at : null;
  return !!here && (v.advice.some((a) => a.author === id) || beliefsAbout(v, id, "character.location")[0]?.believedValue === here);
};

export const readback = (v: View, speaker: string | null, text: string, names: string[]): SpeechAct =>
  act("readback", speaker, `Let me be sure: ${lowerFirst(text)}. Is that right?`, names);
export const battleReadback = (speaker: string | null, who: string, text: string, names: string[]): SpeechAct =>
  speaker ? act("readback", speaker, `I am to ${text}. Is that right, my lady?`, names) : act("readback", null, `To ${who}: ${text}. Is that right?`, [who, ...names]);

const SLOT: Record<Slot, string> = { place: "Which place", from: "From where", to: "To where", market: "At which market", good: "Which goods", arm: "Which kind of men", adviser: "Whose advice", recipient: "Who" };
export const question = (speaker: string | null, slot: Slot, options: string[]): SpeechAct => act("question", speaker, `${SLOT[slot]}, my lady: ${orList(options.slice(0, 6))}?`, options);
export const battleQuestion = (speaker: string | null, verbWord: string): SpeechAct => act("question", speaker, `${verbWord} where, my lady?`);
export const technical = (text: string, names: string[] = []): SpeechAct => act("technical", null, text, names);
export const ack = (speaker: string | null, text: string): SpeechAct => act("ack", speaker, text);
export const pressed = (speaker: string): SpeechAct => act("pressed", speaker, "My lady, I must see to my men.");
export const refusal = (speaker: string | null, text: string, names: string[] = []): SpeechAct => act("refusal", speaker, text, names);
export { nameOf };
