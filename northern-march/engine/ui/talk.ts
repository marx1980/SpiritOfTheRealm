// Conversation panel (Phase 13): a text box and a transcript beside the pause. Labels and values only.
// The panel turns her words into the same PlayerActions the forms make; the page queues them like any other.
import { correctTranscript, createConversation, parseLexicon, type Conversation, type Domain } from "../src/conversation/index.ts";
import { publicRules } from "../src/presentation/affordances.ts";
import type { PlayerAction } from "../src/policies.ts";
import type { View } from "../src/view.ts";

declare const __LEXICON__: unknown;
type Line = { who: string; text: string; kind: "you" | "say" | "tech" };
/** The browser's speech recogniser, only what the panel uses. */
interface BrowserRec { lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; start(): void; stop(): void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void }
/** The platform's dictation namespace (artifact runtime contract), only what the panel uses. */
interface Dictation { start(): Promise<void>; stop(): Promise<void>; onPartial(h: (e: { text: string }) => void): () => void; onFinal(h: (e: { text: string }) => void): () => void; onState(h: (e: { state: string; reason?: string }) => void): () => void }
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

  reset() { this.lines = []; this.input = ""; this.heard = ""; this.conv = {}; }
  private domainOf(v: View): Domain { return v.battle && !v.battle.ended ? "battle" : "court"; }
  private get(v: View): Conversation {
    const d = this.domainOf(v);
    return (this.conv[d] ??= createConversation({ domain: d, lexicon: this.lexicon, rules: this.rules }));
  }
  say(text: string) {
    text = text.trim();
    if (!text) return;
    this.lines.push({ who: "You", text, kind: "you" });
    try {
      const v = this.host.view(), turn = this.get(v).say(text, v);
      this.take(v, turn.replies);
      if (turn.actions.length) this.host.queue(turn.actions);
    } catch (e) { this.lines.push({ who: "", text: `Error: ${(e as Error).message}`, kind: "tech" }); }
    this.input = ""; this.heard = "";
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
  /** The platform's dictation (an artifact capability), where this view offers it; otherwise there is no Speak button. */
  private dict: Dictation | null = null;
  private heard = "";
  init() {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (!c?.use) return;
    c.use("dictation").then((d) => {
      if (!d) return;
      const D = d as Dictation;
      this.dict = D;
      D.onPartial(({ text }) => this.show(this.heard + text));
      D.onFinal(({ text }) => { this.heard += text; this.input = correctTranscript(this.host.view(), { text: this.heard.trim() }).text; this.show(this.input); });
      D.onState(({ state, reason }) => {
        const was = this.listening;
        this.listening = state !== "idle";
        if (state === "idle" && reason && !["stopped", "viewer_stopped", "hidden"].includes(reason)) this.lines.push({ who: "", text: `Speak: ${reason.replace(/_/g, " ")}`, kind: "tech" });
        if (reason === "not_granted" || reason === "unavailable") this.dict = null;
        if (was !== this.listening || state === "idle") this.host.render();
      });
      this.host.render();
    }, () => {});
  }
  /** Put words in the box without redrawing the page (the live guess changes many times a second). */
  private show(text: string) { this.input = text; const i = document.getElementById("talk-in") as HTMLInputElement | null; if (i) i.value = text; }
  /** Whether this view can listen: the platform's dictation in an artifact, else the browser's own recogniser (Safari, Chrome) on a page of its own. */
  private browserRec(): (new () => BrowserRec) | undefined { const w = window as unknown as Record<string, new () => BrowserRec>; return w.SpeechRecognition ?? w.webkitSpeechRecognition; }
  canSpeak(): boolean { return !!this.dict || !!this.browserRec(); }
  private rec?: BrowserRec;
  private listenBrowser() {
    const Rec = this.browserRec();
    if (!Rec) return;
    if (this.rec) { this.rec.stop(); return; }
    const base = this.input.trim() ? `${this.input.trim()} ` : "";
    const rec = this.rec = new Rec();
    rec.lang = "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
    this.listening = true; this.host.render();
    let got = false;
    rec.onresult = (e) => {
      got = true;
      // one phrase: every piece the recogniser settled on, in order (as HeadJams does it)
      const said = Array.from(e.results).map((r) => r[0].transcript).join(" ").replace(/\s+/g, " ").trim();
      this.show(correctTranscript(this.host.view(), { text: (base + said).trim() }).text);
    };
    // iOS reports "service not allowed" when the recogniser closes, even after it has heard her: only a silence is worth saying
    const done = (why?: string) => { this.rec = undefined; this.listening = false; if (why && why !== "aborted" && why !== "no-speech" && !(got && why === "service-not-allowed")) this.lines.push({ who: "", text: why === "service-not-allowed" ? "Speak: switch on Dictation in the phone's keyboard settings" : `Speak: ${why.replace(/-/g, " ")}`, kind: "tech" }); this.host.render(); };
    rec.onend = () => done();
    rec.onerror = (e) => done(e.error);
    try { rec.start(); } catch { done("unavailable"); }
  }
  /** Speak: start listening (straight from the click, as the platform requires), or stop. */
  listen() {
    const d = this.dict;
    if (!d) return this.listenBrowser();
    if (this.listening) { d.stop().catch(() => {}); return; }
    this.heard = this.input.trim() ? `${this.input.trim()} ` : "";
    d.start().catch((e: { code?: string }) => {
      if (e?.code === "not_granted" || e?.code === "unavailable") this.dict = null;
      if (e?.code && e.code !== "stopped" && e.code !== "dismissed") this.lines.push({ who: "", text: `Speak: ${e.code.replace(/_/g, " ")}`, kind: "tech" });
      this.listening = false; this.host.render();
    });
  }
  /** Listeners on the panel's own controls, after every redraw (a tap on a button reaches it directly, on any phone). */
  bind() {
    const i = document.getElementById("talk-in") as HTMLInputElement | null;
    if (!i) return;
    const log = document.querySelector<HTMLElement>(".tlog");
    if (log) log.scrollTop = log.scrollHeight; // the newest line is always in view
    i.addEventListener("input", () => { this.input = i.value; this.focus = true; });
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.order(); } });
    document.getElementById("talk-say")?.addEventListener("click", () => this.order());
    document.getElementById("talk-mic")?.addEventListener("click", () => this.listen());
    for (const b of document.querySelectorAll<HTMLButtonElement>(".talk [data-say]")) b.addEventListener("click", () => this.say(b.dataset.say!));
  }
  private order() {
    if (this.listening) this.dict?.stop().catch(() => {});
    const i = document.getElementById("talk-in") as HTMLInputElement | null;
    this.say(i?.value ?? this.input);
  }

  html(): string {
    const v = this.host.view(), state = this.get(v).state;
    const log = this.lines.slice(-8).map((l) => `<div class="tl ${l.kind}">${l.who ? `<b>${esc(l.who)}</b> ` : ""}${esc(l.text)}</div>`).join("");
    return `<div class="card talk"><h2>Talk</h2>
      <div class="tlog">${log || "–"}</div>
      <div class="talk-row"><input id="talk-in" type="text" autocomplete="off" enterkeyhint="send" value="${esc(this.input)}" aria-label="Order">
        ${this.canSpeak() ? `<button type="button" id="talk-mic" aria-pressed="${this.listening}">${this.listening ? "Stop" : "Speak"}</button>` : ""}
        <button type="button" id="talk-say" class="primary">Order</button>
        ${state === "readback" ? `<button type="button" data-say="yes">Yes</button><button type="button" data-say="no">No</button>` : ""}</div></div>`;
  }
  static CSS = `.talk .tlog { display: grid; gap: 4px; margin-bottom: 8px; font-size: 14px; max-height: 220px; overflow: auto; } .talk .tl.you { color: var(--mute); } .talk .tl.tech { font-style: italic; }
.talk .talk-row { display: flex; gap: 6px; flex-wrap: wrap; } .talk input[type=text] { flex: 1; min-width: 12ch; }`;
}
