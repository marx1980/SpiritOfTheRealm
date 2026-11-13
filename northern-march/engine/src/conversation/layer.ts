// The language layer's contract (docs/CONVERSATION.md §2). A layer turns words into an `Understanding` (a draft of what
// was meant) and a `SpeechAct` (canonical words plus the facts they may carry) into the speaker's words. The templated layer
// is complete on its own; any other layer is optional, and whatever it says is checked before it is shown.
import type { PublicRules } from "../presentation/affordances.ts";
import type { View } from "../view.ts";
import type { Lexicon } from "./lexicon.ts";

export type Domain = "court" | "battle";
export type QuestionKind = "what_would_you_do" | "why" | "how_sure" | "what_worries_you" | "alternatives" | "what_if";

/** A place or person the words named, resolved to an id she knows. `exact` is false for a join or a spelling slip, which is confirmed. */
export interface Mention { id: string; kind: "place" | "person"; surface: string; name: string; exact: boolean; role: "from" | "at" | "to" | null }

export interface Understanding {
  act: "command" | "question" | "affirm" | "correct" | "cancel" | "answer" | "unclear";
  text: string;
  /** Court: repair, scout, attack, advance, levy, relief, travel, buy, sell, send, muster, follow. Battle: hold, advance, attack, withdraw, give_ground, protect. */
  verb?: string;
  mentions: Mention[];
  /** Court: rush, labour, consult. Battle: runner, voice, signal. */
  modes: string[];
  goods: string[]; arms: string[];
  /** Battle: the line named after a limit phrase ("but not beyond the stream"). */
  limitLine?: string;
  when?: { kind: "enemy_engaged" | "enemy_horse_seen"; then?: string };
  /** Battle: people put under the recipient (sector delegation). */
  command: string[];
  signal?: string;
  question?: { kind: QuestionKind; addressee?: string };
  /** Words that look like a name she does not know. */
  unknown: string[];
}
export const emptyUnderstanding = (text: string, act: Understanding["act"] = "unclear"): Understanding => ({ act, text, mentions: [], modes: [], goods: [], arms: [], command: [], unknown: [] });

export interface UnderstandCtx { view: View; domain: Domain; lexicon: Lexicon; rules: PublicRules }

/** What may be said and what the saying may carry. `canonical` is the templated line; a layer may reword it but may add nothing. */
export interface SpeechAct {
  kind: "readback" | "question" | "answer" | "technical" | "ack" | "pressed" | "refusal";
  /** Who speaks: a person she knows, or null for the game itself (out of the world). */
  speaker: string | null;
  canonical: string;
  facts: { names: string[]; numbers: number[] };
}
export interface SpeakCtx { view: View; domain: Domain }

export interface LanguageLayer {
  id: string;
  /** Her words as an Understanding, or undefined to leave them to the templated parser. */
  understand(text: string, ctx: UnderstandCtx): Understanding | undefined;
  /** The speaker's words for an act, or undefined to use the canonical line. */
  say(act: SpeechAct, ctx: SpeakCtx): string | undefined;
}
