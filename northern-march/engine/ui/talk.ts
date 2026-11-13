// Conversation panel (Phase 13): a text box and a transcript beside the pause. Labels and values only.
// The panel turns her words into the same PlayerActions the forms make; the page queues them like any other.
import { correctTranscript, createConversation, parseLexicon, type Conversation, type Domain } from "../src/conversation/index.ts";
import { publicRules } from "../src/presentation/affordances.ts";
import type { PlayerAction } from "../src/policies.ts";
import type { View } from "../src/view.ts";

declare const __LEXICON__: unknown;
type Line = { who: string; text: string; kind: "you" | "say" | "tech" };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface TalkHost {
  view(): View;
  /** Queue the actions her words came to (the page checks them again, as it does for the forms). */
  queue(actions: PlayerAction[]): void;
  render(): void;
  name(v: View, id: string): string;
  content: Parameters<typeof publicRules>[0];
}

export class Talk {
  lines: Line[] = [];
  input = "";
  listening = false;
  focus = false;
  private conv: Partial<Record<Domain, Conversation>> = {};
  private readonly lexicon = parseLexicon(__LEXICON__);
  private readonly rules: ReturnType<typeof publicRules>;
  private readonly host: TalkHost;
  constructor(host: TalkHost) { this.host = host; this.rules = publicRules(host.content); }

  reset() { this.lines = []; this.input = ""; this.conv = {}; this.listening = false; }
  private domainOf(v: View): Domain { return v.battle && !v.battle.ended ? "battle" : "court"; }
  private get(v: View): Conversation {
    const d = this.domainOf(v);
    return (this.conv[d] ??= createConversation({ domain: d, lexicon: this.lexicon, rules: this.rules }));
  }
  voiceAvailable(): boolean { const w = window as unknown as Record<string, unknown>; return !!(w.SpeechRecognition || w.webkitSpeechRecognition); }

  say(text: string) {
    text = text.trim();
    if (!text) return;
    const v = this.host.view(), conv = this.get(v);
    this.lines.push({ who: "You", text, kind: "you" });
    const turn = conv.say(text, v);
    this.take(v, turn.replies);
    if (turn.actions.length) this.host.queue(turn.actions);
    this.input = "";
    this.host.render();
  }
  /** A new pause: answer what was waiting for advice, if it has come. */
  resume() {
    const v = this.host.view();
    const turn = this.get(v).resume(v);
    if (!turn) return;
    this.take(v, turn.replies);
  }
  private take(v: View, replies: { speaker: string | null; kind: string; text: string }[]) {
    for (const r of replies) this.lines.push({ who: r.speaker ? this.host.name(v, r.speaker) : "", text: r.text, kind: r.kind === "technical" ? "tech" : "say" });
    if (this.lines.length > 40) this.lines.splice(0, this.lines.length - 40);
  }
  /** Browser speech recognition, if the browser has it; the words are corrected against the names she knows and then spoken as typed text. */
  listen() {
    const w = window as unknown as Record<string, new () => { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; onresult: (e: unknown) => void; onend: () => void; onerror: () => void }>;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec || this.listening) return;
    const rec = new Rec();
    rec.lang = "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1;
    this.listening = true; this.host.render();
    rec.onresult = (e) => {
      const alt = (e as { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }).results[0][0];
      const fixed = correctTranscript(this.host.view(), { text: alt.transcript, words: alt.transcript.split(/\s+/).map((x) => ({ w: x, conf: alt.confidence })) });
      this.input = fixed.text;
      this.host.render();
    };
    rec.onend = () => { this.listening = false; this.host.render(); };
    rec.onerror = () => { this.listening = false; this.host.render(); };
    rec.start();
  }

  html(): string {
    const v = this.host.view(), state = this.get(v).state;
    const log = this.lines.slice(-8).map((l) => `<div class="tl ${l.kind}">${l.who ? `<b>${esc(l.who)}</b> ` : ""}${esc(l.text)}</div>`).join("");
    return `<div class="card talk"><h2>Talk</h2>
      <div class="tlog">${log || "–"}</div>
      <form id="talk-form" autocomplete="off"><input id="talk-in" type="text" value="${esc(this.input)}" aria-label="Say">
        <button type="submit">Say</button>${this.voiceAvailable() ? `<button type="button" id="talk-mic" aria-pressed="${this.listening}">${this.listening ? "Listening" : "Speak"}</button>` : ""}
        ${state === "readback" ? `<button type="button" data-say="yes">Yes</button><button type="button" data-say="no">No</button>` : ""}</form></div>`;
  }
  static CSS = `.talk .tlog { display: grid; gap: 4px; margin-bottom: 8px; font-size: 14px; max-height: 220px; overflow: auto; } .talk .tl.you { color: var(--mute); } .talk .tl.tech { font-style: italic; }
.talk form { display: flex; gap: 6px; flex-wrap: wrap; } .talk input[type=text] { flex: 1; min-width: 12ch; }`;
}
