// Phase 13 conversation layer (docs/CONVERSATION.md). Imports only the view window and the presentation words.
import { Conversation } from "./converse.ts";
import type { Domain, LanguageLayer } from "./layer.ts";
import type { Lexicon } from "./lexicon.ts";
import type { PublicRules } from "../presentation/affordances.ts";
import { understand } from "./understand.ts";

/** The permanent layer: the lexicon's words and the canonical sentences. Complete on its own. */
export const templatedLayer: LanguageLayer = { id: "templated", understand: (text, ctx) => understand(text, ctx), say: () => undefined };

export function createConversation(o: { domain: Domain; layer?: LanguageLayer; lexicon: Lexicon; rules: PublicRules }): Conversation {
  return new Conversation({ domain: o.domain, layer: o.layer ?? templatedLayer, lexicon: o.lexicon, rules: o.rules });
}
export { Conversation, type Turn, type Reply, type Exchange, type ConversationState } from "./converse.ts";
export { correctTranscript, scriptedTranscriber, type Correction, type Transcript, type Transcriber } from "./voice.ts";
export { recommendationStale, answerFor } from "./recommend.ts";
export { validateSpeech, type Verdict } from "./validate.ts";
export { parseLexicon, type Lexicon } from "./lexicon.ts";
export { loadLexicon } from "./files.ts";
export type { Domain, LanguageLayer, SpeechAct, SpeakCtx, Understanding, UnderstandCtx, Mention, QuestionKind } from "./layer.ts";
export { emptyUnderstanding } from "./layer.ts";
