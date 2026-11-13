// The conversation (docs/CONVERSATION.md §3-§4): a multi-turn exchange that turns her words into one validated action, and
// answers her questions, in the speakers' words. Out comes a Turn: what was said, the actions that may go to the engine
// (only after she affirmed, or an `ask`), and the battle seconds the talking cost. Everything else (transcripts, the lines
// a layer produced and which were rejected) is side data on `exchanges`; none of it enters the event log.
import { adviceChoices, type PublicRules } from "../presentation/affordances.ts";
import { nameOf } from "../presentation/phrasing.ts";
import type { PlayerAction, Recommendation, View } from "../view.ts";
import type { Domain, LanguageLayer, Mention, SpeechAct, Understanding } from "./layer.ts";
import type { Lexicon } from "./lexicon.ts";
import { answerFor, recommendationStale } from "./recommend.ts";
import { resolveBattle, resolveCourt, taskWords } from "./resolve.ts";
import * as say from "./speak.ts";
import { nameIndex, orList } from "./text.ts";
import { understand } from "./understand.ts";
import { validateSpeech } from "./validate.ts";

export interface Reply { speaker: string | null; kind: SpeechAct["kind"]; text: string; templated: boolean; rejected?: string[] }
export interface Turn { replies: Reply[]; actions: PlayerAction[]; costSeconds: number }
export interface Exchange { said: string; understood: Understanding; turn: Turn; layer: string }
export type ConversationState = "idle" | "technical" | "question" | "readback";

const PLACE_VERBS = new Set(["repair", "advance", "attack", "scout", "relief", "travel", "buy", "sell", "send", "muster"]);
const COURT_VERBS = new Set(["repair", "scout", "attack", "advance", "levy", "relief", "travel", "buy", "sell", "send", "muster", "follow"]);
const BATTLE_VERBS = new Set(["hold", "advance", "attack", "withdraw", "give_ground", "protect"]);

export class Conversation {
  state: ConversationState = "idle";
  readonly exchanges: Exchange[] = [];
  private pending?: Understanding;
  /** Battle seconds spent talking since the pause began; an order is dated this much later. */
  private elapsed = 0;
  private battleT: number | undefined;
  private spoken = new Map<string, number>();
  private awaiting?: { author: string; q: NonNullable<Understanding["question"]> };
  /** A correction that could replace more than one place: the orders each would make, until she says which place goes. */
  private replacing?: { id: string; name: string; u: Understanding }[];

  private readonly o: { domain: Domain; layer: LanguageLayer; lexicon: Lexicon; rules: PublicRules };
  constructor(o: { domain: Domain; layer: LanguageLayer; lexicon: Lexicon; rules: PublicRules }) { this.o = o; }

  /** One thing she says. `view` is what she knows now. */
  say(text: string, view: View): Turn {
    if (view.battle?.t !== this.battleT) { this.battleT = view.battle?.t; this.elapsed = 0; } // a new pause: the clock of the talk starts again
    const ctx = { view, domain: this.o.domain, lexicon: this.o.lexicon, rules: this.o.rules };
    const theirs = this.o.layer.understand(text, ctx);
    const u = this.sanitize(theirs ?? understand(text, ctx), view);
    const replies: Reply[] = [], actions: PlayerAction[] = [];
    let cost = 0;
    const speak = (a: SpeechAct, seconds = 0) => { replies.push(this.finalise(a, view)); cost += seconds; this.elapsed += seconds; };
    // consent is given in the lexicon's own words: another layer's "yes" that the templated reading does not also hear as a
    // yes sends nothing; she is asked plainly, out of the world, and the read-back stays open
    if (theirs && u.act === "affirm" && this.state !== "idle" && understand(text, ctx).act !== "affirm") speak(say.technical("Is that a yes?"));
    else this.step(u, view, speak, actions);
    const turn: Turn = { replies, actions, costSeconds: cost };
    this.exchanges.push({ said: text, understood: u, turn, layer: this.o.layer.id });
    return turn;
  }

  /** The advice she asked for has arrived: answer the question that was waiting, from the fresh view. */
  resume(view: View): Turn | undefined {
    if (!this.awaiting) return undefined;
    const { author, q } = this.awaiting;
    const replies: Reply[] = [], actions: PlayerAction[] = [];
    const rec = this.latest(view, author);
    if (!rec || recommendationStale(view, rec)) return undefined;
    this.awaiting = undefined;
    replies.push(this.finalise(answerFor(view, rec, q.kind), view));
    return { replies, actions, costSeconds: 0 };
  }

  // ---- the state machine ------------------------------------------------------------------------------------------------
  private step(u: Understanding, view: View, speak: (a: SpeechAct, s?: number) => void, actions: PlayerAction[]) {
    const L = this.o.lexicon.battle.cost, battle = this.o.domain === "battle";
    // "Did you mean Northwatch?" is answered by saying the name again (or any phrase that holds it), not only by "yes"; a
    // different place named exactly replaces the one she was asked about
    if (this.state === "technical" && this.pending && !u.verb && (u.act === "answer" || u.act === "correct" || u.act === "affirm")) {
      const asked = new Set(this.pending.mentions.filter((m) => !m.exact).map((m) => m.id));
      if (u.act === "affirm" || u.mentions.some((m) => asked.has(m.id))) { this.pending = { ...this.pending, mentions: this.pending.mentions.map((m) => ({ ...m, exact: true })) }; return this.pipeline(this.pending, view, speak); }
      if (u.mentions.some((m) => m.exact)) return this.corrected(this.merge(this.pending, u, true, view), view, speak);
    }
    switch (u.act) {
      case "cancel": this.reset(); speak(say.ack(this.voice(view), "As you wish.")); return;
      case "affirm":
        if (this.state === "readback") return this.compile(view, speak, actions);
        if (this.state === "technical" && this.pending) { this.pending = { ...this.pending, mentions: this.pending.mentions.map((m) => ({ ...m, exact: true })) }; return this.pipeline(this.pending, view, speak); }
        speak(say.technical(this.state === "question" ? "I am still waiting for your answer." : "There is nothing waiting for your word.")); return;
      case "correct":
        if (this.state === "technical") { this.reset(); speak(say.technical("Then tell me again.")); return; }
        if (!this.pending) { speak(say.technical("There is nothing to correct.")); return; }
        if (u.verb || u.mentions.length || u.modes.length || u.goods.length || u.arms.length || u.when || u.command.length || u.limitLine || u.unknown.length) return this.corrected(this.merge(this.pending, u, true, view), view, speak);
        speak(say.ack(this.voice(view), "What would you have me change?")); return;
      case "question":
        if (battle) { speak(say.technical("Commanders do not yet answer questions in battle.")); return; }
        return this.questions(u, view, speak, actions);
      case "command": this.replacing = undefined; this.pending = u; return this.pipeline(u, view, speak);
      case "answer":
        if (this.replacing) {
          const places = u.mentions.filter((x) => x.kind === "place"), pick = places.length === 1 ? this.replacing.find((r) => r.id === places[0].id) : undefined;
          const opts = this.replacing;
          this.replacing = undefined;
          if (pick) return this.pipeline(pick.u, view, speak);
          this.state = "question"; this.replacing = opts;
          speak(say.act("question", this.voice(view), `In place of ${orList(opts.map((o) => o.name))}, my lady?`, opts.map((o) => o.name))); return;
        }
        if (this.pending && this.state !== "idle") return this.corrected(this.merge(this.pending, u, this.state === "readback", view), view, speak);
        speak(say.technical("I did not understand what you want done.")); return;
      default:
        speak(say.technical("I did not catch that.")); void L;
    }
  }

  private pipeline(u: Understanding, view: View, speak: (a: SpeechAct, s?: number) => void) {
    const battle = this.o.domain === "battle", cost = this.o.lexicon.battle.cost, present = battle && (view.battle?.t ?? 1) === 0;
    this.pending = u;
    const places = u.mentions.filter((m) => m.kind === "place"), people = u.mentions.filter((m) => m.kind === "person");
    // a name she has not been given: out of the world, said plainly
    const needsPlace = battle ? false : PLACE_VERBS.has(u.verb ?? "");
    if (u.unknown.length && ((needsPlace && !places.length) || (battle && !people.length))) { this.reset(); speak(say.technical(`I know of no place or person called "${u.unknown[0]}" on your map.`)); return; }
    if (battle && u.verb && !people.length) { this.state = "technical"; speak(say.technical("To whom is the order given?")); this.state = "idle"; this.pending = undefined; return; }
    // near misses are confirmed out of the world
    const inexact = u.mentions.filter((m) => !m.exact);
    if (inexact.length) { this.state = "technical"; speak(say.technical(`Did you mean ${orList(inexact.map((m) => m.name))}?`, inexact.map((m) => m.name)), cost.technicalSeconds); return; }
    if (!battle) {
      const r = resolveCourt(u, view, this.o.rules, this.o.lexicon);
      if (r.kind === "none") { this.reset(); speak(say.technical(`I cannot do that: ${r.why}.`)); return; }
      if (r.kind === "ambiguous") { this.state = "question"; speak(say.question(this.voice(view), r.slot, r.options.map((x) => x.name)), 0); return; }
      this.state = "readback";
      speak(say.readback(view, this.voice(view), r.text, u.mentions.map((m) => m.name)), 0);
      return;
    }
    if (u.unparsed?.length) { this.reset(); speak(say.technical(`I cannot give that as one order: ${u.unparsed.join("; ")}.`)); return; }
    const r = resolveBattle(u, view, this.o.lexicon);
    if (r.kind === "none") { this.reset(); speak(say.technical(`I cannot give that order: ${r.why}.`)); return; }
    const who = people[0], speaker = present ? who.id : null;
    if (r.kind === "ambiguous") {
      this.state = "question";
      speak(say.battleQuestion(speaker, r.verb.replace(/^./, (c) => c.toUpperCase()).replace("_", " ")), present ? cost.questionSeconds : 0);
      this.press(who.id, present, speak);
      return;
    }
    this.state = "readback";
    const names = [...u.mentions.map((m) => m.name), ...(r.task.command ?? []).map((id) => nameOf(view, id))];
    speak(say.battleReadback(speaker, nameOf(view, r.to), taskWords(view, r.task), names), present ? cost.readbackSeconds : 0);
    this.press(who.id, present, speak);
  }

  /** After a correction: the order it makes, or, when it could replace more than one place, the question which. */
  private corrected(u: Understanding, view: View, speak: (a: SpeechAct, s?: number) => void) {
    if (!this.replacing) return this.pipeline(u, view, speak);
    this.state = "question";
    speak(say.act("question", this.voice(view), `In place of ${orList(this.replacing.map((o) => o.name))}, my lady?`, this.replacing.map((o) => o.name)));
  }

  private press(commander: string, present: boolean, speak: (a: SpeechAct, s?: number) => void) {
    if (!present) return;
    const n = (this.spoken.get(commander) ?? 0) + 1;
    this.spoken.set(commander, n);
    if (n >= this.o.lexicon.battle.cost.pressAfter) speak(say.pressed(commander));
  }

  private compile(view: View, speak: (a: SpeechAct, s?: number) => void, actions: PlayerAction[]) {
    const u = this.pending!;
    if (this.o.domain === "court") {
      const r = resolveCourt(u, view, this.o.rules, this.o.lexicon);
      if (r.kind !== "action") { this.reset(); speak(say.technical("Things have changed since I read that back; tell me again.")); return; }
      actions.push(r.action); this.reset(); speak(say.ack(this.voice(view), "It is done.")); return;
    }
    const r = resolveBattle(u, view, this.o.lexicon);
    if (r.kind !== "draft") { this.reset(); speak(say.technical("The field has changed since I read that back; tell me again.")); return; }
    const delay = Math.min(3600, this.elapsed);
    actions.push({ action: "battle", battle: { to: r.to, task: r.task, via: r.via, ...(r.signal ? { signal: r.signal } : {}), ...(delay ? { delay } : {}) } });
    const who = u.mentions.find((m) => m.kind === "person")!;
    this.reset(); speak(say.ack((view.battle?.t ?? 1) === 0 ? who.id : null, "It shall be done."));
  }

  // ---- questions to advisers --------------------------------------------------------------------------------------------
  private latest(view: View, author: string): Recommendation | undefined {
    const mine = view.advice.filter((a) => a.author === author);
    if (!mine.length) return undefined;
    const t = Math.max(...mine.map((a) => a.computedAt));
    return mine.filter((a) => a.computedAt === t).sort((a, b) => a.id - b.id)[0];
  }
  private questions(u: Understanding, view: View, speak: (a: SpeechAct, s?: number) => void, actions: PlayerAction[]) {
    const q = u.question!, who = q.addressee, known = new Set(nameIndex(view).filter((e) => e.kind === "person").map((e) => e.id));
    if (who && (!known.has(who) || who === view.self.id)) { speak(say.technical(`${who === view.self.id ? "You" : nameOf(view, who)} cannot be asked that.`)); return; }
    const authors = who ? [who] : [...new Set(view.advice.map((a) => a.author))].sort();
    if (!authors.length) { speak(say.technical("No one has given you advice lately. Name an adviser to ask.")); return; }
    const asked = new Set<string>();
    for (const a of authors) {
      const rec = this.latest(view, a);
      if (!rec) {
        if (say.isPresent(view, a)) { speak(say.act("answer", a, "Let me think on it, my lady.")); actions.push({ action: "ask", target: a }); this.awaiting = { author: a, q }; asked.add(a); }
        else speak(say.act("refusal", a, "I am not with you, my lady; send for me."));
        continue;
      }
      if (recommendationStale(view, rec)) { speak(say.act("answer", a, "Things have changed since I spoke; let me think again.")); if (!asked.has(a)) { actions.push({ action: "ask", target: a }); this.awaiting = { author: a, q }; asked.add(a); } continue; }
      speak(answerFor(view, rec, q.kind));
    }
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------------
  private voice(view: View): string | null { return this.o.domain === "court" ? say.listener(view) : null; }
  private reset() { this.state = "idle"; this.pending = undefined; this.replacing = undefined; }

  /** Her correction or answer folded into the draft. A correction replaces the part it names; an answer adds what was missing. */
  private merge(base: Understanding, add: Understanding, replace: boolean, view: View): Understanding {
    const m: Understanding = { ...base, act: "command", text: `${base.text} / ${add.text}`, verb: add.verb ?? base.verb, mentions: [...base.mentions], modes: [...base.modes], goods: add.goods.length ? add.goods : base.goods, arms: add.arms.length ? add.arms : base.arms,
      command: add.command.length ? add.command : base.command, unknown: add.unknown, ...(add.when ? { when: add.when } : base.when ? { when: base.when } : {}), ...(add.limitLine ? { limitLine: add.limitLine } : base.limitLine ? { limitLine: base.limitLine } : {}), ...(add.signal ? { signal: add.signal } : base.signal ? { signal: base.signal } : {}) };
    for (const x of add.mentions) {
      const same = m.mentions.findIndex((y) => y.kind === x.kind && (x.role === null ? (replace && m.mentions.filter((z) => z.kind === x.kind).length === 1) : y.role === x.role));
      if (same >= 0 && replace) m.mentions[same] = { ...x, role: x.role ?? m.mentions[same].role };
      else if (!m.mentions.some((y) => y.id === x.id && y.kind === x.kind)) m.mentions.push(x);
    }
    // a correction that names a place without saying which one it replaces: the one whose replacing makes a working order;
    // a place the order already names is not replaced by itself; if more than one could be meant, she is asked (D-081)
    const bare = add.mentions.filter((x) => x.kind === "place" && x.role === null);
    if (replace && bare.length === 1 && base.mentions.filter((x) => x.kind === "place").length > 1) {
      const idx = base.mentions.map((x, i) => (x.kind === "place" && x.id !== bare[0].id ? i : -1)).filter((i) => i >= 0);
      const trials = idx.map((i) => ({ i, u: { ...m, mentions: base.mentions.map((x, k) => (k === i ? { ...bare[0], role: x.role } : x)), modes: [...m.modes, ...add.modes.filter((x) => !m.modes.includes(x))] } }))
        .filter((t) => (this.o.domain === "court" ? resolveCourt(t.u, view, this.o.rules, this.o.lexicon).kind === "action" : resolveBattle(t.u, view, this.o.lexicon).kind === "draft"));
      if (trials.length === 1) return trials[0].u;
      if (trials.length > 1) { this.replacing = trials.map((t) => ({ id: base.mentions[t.i].id, name: base.mentions[t.i].name, u: t.u })); return base; }
    }
    const conflict: Record<string, string> = { rush: "labour", labour: "rush", runner: "voice", voice: "runner" };
    for (const mode of add.modes) { m.modes = m.modes.filter((x) => x !== conflict[mode]); if (!m.modes.includes(mode)) m.modes.push(mode); }
    return m;
  }

  /** A parse from another layer is trusted for nothing: every id must be one she knows, every word one the engine has. */
  private sanitize(u: Understanding, view: View): Understanding {
    const battle = this.o.domain === "battle", b = view.battle;
    const names = new Set(Object.keys(view.world.names)), places = new Set([...(b?.field.places ?? []).map((p) => p.id)]), lines = new Set((b?.field.lines ?? []).map((l) => l.id));
    const out: Understanding = { ...u, mentions: [], unknown: [...u.unknown] };
    for (const m of u.mentions) {
      const ok = battle ? (m.kind === "person" ? names.has(m.id) : places.has(m.id)) : names.has(m.id);
      if (ok) out.mentions.push(m); else out.unknown.push(m.surface || m.id);
    }
    if (u.verb && !(battle ? BATTLE_VERBS : COURT_VERBS).has(u.verb)) { out.unknown.push(u.verb); delete out.verb; if (out.act === "command") out.act = "unclear"; }
    if (out.limitLine && !lines.has(out.limitLine)) delete out.limitLine;
    if (out.signal && !(b?.signals ?? []).some((s) => s.id === out.signal)) delete out.signal;
    out.command = out.command.filter((id) => names.has(id));
    const goods = new Set([...(view.world.goods?.kinds ?? []), "grain"]);
    out.goods = out.goods.filter((g) => goods.has(g));
    void adviceChoices;
    return out;
  }

  /** The speaker's words for an act: another layer's if it passes the checks, else the canonical line. */
  private finalise(a: SpeechAct, view: View): Reply {
    const cand = this.o.layer.say(a, { view, domain: this.o.domain });
    if (cand === undefined || cand === a.canonical) return { speaker: a.speaker, kind: a.kind, text: a.canonical, templated: true };
    const verdict = validateSpeech(view, a, cand, this.o.lexicon);
    return verdict.ok ? { speaker: a.speaker, kind: a.kind, text: cand, templated: false } : { speaker: a.speaker, kind: a.kind, text: a.canonical, templated: true, rejected: verdict.problems };
  }
}

export type { Mention };
