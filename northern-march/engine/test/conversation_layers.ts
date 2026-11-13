// A stand-in for a language model (tests and the G-16 gate): it hears loose wording, typos and padding and returns the
// same Understanding by a different route, and it speaks in its own words, sometimes inventing a name, a number or a claim.
// It knows nothing the templated layer does not: its parse is only as good as the words it can match.
import type { LanguageLayer, SpeakCtx, SpeechAct, Understanding, UnderstandCtx } from "../src/conversation/index.ts";
import { understand } from "../src/conversation/understand.ts";

/** Loose wording: padding, courtesy and run-together words are stripped to what a person would mean, then read. */
const PAD = /\b(please|kindly|if you would|if you could|my queen|my lady|your majesty|i was thinking|i think we should|why don't we|let's just|let us just|really|just)\b/gi;
export const standInLayer: LanguageLayer = {
  id: "standin",
  understand(text: string, ctx: UnderstandCtx): Understanding | undefined {
    const plain = text.replace(PAD, " ").replace(/\s+/g, " ").replace(/\bgo with what ([a-z]+) said\b/i, "do as $1 advises").replace(/\bsounds good\b|\bsure[, ]+go ahead\b|\bgo for it\b/i, "yes").trim();
    return understand(plain, ctx);
  },
  say(act: SpeechAct, _ctx: SpeakCtx): string | undefined {
    if (act.kind === "technical") return undefined;
    return `${act.canonical.replace(/^Let me be sure: /, "If I have it right, ")}`;
  },
};

/** A layer that hallucinates: every line it speaks carries something the act does not. For the validation tests and the gate. */
export function adversarialLayer(kind: "name" | "number" | "future" | "mind" | "odds" = "name"): LanguageLayer {
  const add: Record<string, string> = { name: " Lord Morwen has already agreed.", number: " It will take 4000 men.", future: " It will certainly succeed.", mind: " He secretly wants the crown.", odds: " The odds are 70% in our favour." };
  return { id: `adversarial-${kind}`, understand: () => undefined, say: (act) => (act.kind === "technical" ? undefined : act.canonical + add[kind]) };
}
