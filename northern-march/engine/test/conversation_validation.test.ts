// Phase 13 validation rules (docs/CONVERSATION.md §6): what another language layer may and may not say. Written as attacks:
// every line here is a way a model could mislead the player (a name she was not given, a number, a promise, a claim about
// someone's mind, a fact not in the act, swapped roles, a dropped "not", reasons turned round, a reworded system line) and
// must be rejected and replaced by the canonical line. A few harmless rewordings must still pass, or the layer is useless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, type Sim } from "../src/engine.ts";
import { publicRules } from "../src/presentation/affordances.ts";
import type { PlayerAction, View } from "../src/view.ts";
import { createConversation, loadLexicon, validateSpeech, type Conversation, type LanguageLayer, type SpeechAct, type Understanding } from "../src/conversation/index.ts";
import { understand } from "../src/conversation/understand.ts";
import { nameIndex } from "../src/conversation/text.ts";
import { CONTENT, CONTENT_DIR } from "./helpers.ts";

const rules = publicRules(CONTENT), lexicon = loadLexicon(CONTENT_DIR);

function pauseWhere(seed: number, ok: (v: View) => boolean): { sim: Sim; view: View } {
  const sim = createSim({ content: CONTENT, seed, policy: "external" });
  for (let i = 0; i < 4000; i++) {
    const r = sim.next(sim.tick + 2 * 86400);
    if (r.ended || sim.tick > 140 * 86400) break;
    if (!r.paused) continue;
    if (ok(r.view!)) return { sim, view: r.view! };
    sim.answer([]);
  }
  throw new Error(`no such pause for seed ${seed}`);
}
function toBattle(): View {
  for (let seed = 1; seed <= 12; seed++) {
    const sim = createSim({ content: CONTENT, seed, policy: "external" });
    let travelled = false, ordered = false;
    for (let i = 0; i < 20000; i++) {
      const r = sim.next(160 * 86400);
      if (!r.paused || r.ended) break;
      if (r.reason === "battle") return r.view!;
      const v = r.view!, acts: PlayerAction[] = [];
      if (!travelled) { acts.push({ action: "travel", target: "northwatch" }); travelled = true; }
      const b = Object.values(v.beliefs).find((x) => x.subject.id === "blackwood" && x.predicate === "threat.intensity");
      if ("at" in v.self.position && v.self.position.at === "northwatch" && !ordered && b && (b.believedValue as number) > 0) { acts.push({ action: "advance", target: "northwatch", mission: "attack", raid: "blackwood" }); ordered = true; }
      sim.answer(acts);
    }
  }
  throw new Error("no battle");
}

/** A layer that says nothing of its own and keeps every act it is asked to voice, so the tests attack real acts. */
function recorder(): { layer: LanguageLayer; acts: SpeechAct[]; views: Map<SpeechAct, View> } {
  const acts: SpeechAct[] = [], views = new Map<SpeechAct, View>();
  return { acts, views, layer: { id: "recorder", understand: () => undefined, say: (a, ctx) => { acts.push(a); views.set(a, ctx.view); return undefined; } } };
}
const withAdvice = (v: View) => v.advice.some((a) => a.reasons.some((r) => r.weight > 0) && a.reasons.some((r) => r.weight < 0) && a.alternatives.length > 0);

// ---- the acts under attack ---------------------------------------------------------------------------------------------
const court = pauseWhere(2, withAdvice).view;
const rec = recorder();
{
  const c = createConversation({ domain: "court", layer: rec.layer, lexicon, rules });
  const adviser = court.advice.find((a) => a.reasons.some((r) => r.weight < 0))!.author, name = court.world.names[adviser];
  for (const q of ["what would you do", "why", "what worries you", "what else could we do"]) c.say(`${name}, ${q}?`, court);
  c.say("send timber from Crownwood to Northwatch", court); c.say("never mind", court);
  c.say("buy iron at Marchend for Northwatch", court); c.say("never mind", court);
  c.say("send relief to Grey fen", court); c.say("never mind", court);
  c.say("repair", court); c.say("never mind", court);
}
const field = toBattle();
{
  const c = createConversation({ domain: "battle", layer: rec.layer, lexicon, rules });
  c.say(`${field.battle!.commanders[0].name.split(" ")[0]}, attack the ford but not beyond the stream`, field);
  c.say("yes", field);
  const [c0, c1] = field.battle!.commanders;
  if (c1) { const d = createConversation({ domain: "battle", layer: rec.layer, lexicon, rules }); d.say(`${c0.name.split(" ")[0]}, attack the ford and command ${c1.name.split(" ")[0]}`, field); }
}
const A = (kind: SpeechAct["kind"], re?: RegExp) => { const a = rec.acts.find((x) => x.kind === kind && (!re || re.test(x.canonical))); assert.ok(a, `no ${kind} act ${re ?? ""}: ${rec.acts.map((x) => x.canonical).join(" / ")}`); return a!; };
const viewOf = (a: SpeechAct) => rec.views.get(a)!;
const check = (a: SpeechAct, text: string) => validateSpeech(viewOf(a), a, text, lexicon);
const rejects = (a: SpeechAct, text: string, why?: RegExp) => {
  const v = check(a, text);
  assert.equal(v.ok, false, `accepted: "${text}" for "${a.canonical}"`);
  if (why) assert.ok(v.problems.some((p) => why.test(p)), `"${text}": ${v.problems.join("; ")}`);
};
const accepts = (a: SpeechAct, text: string) => { const v = check(a, text); assert.ok(v.ok, `rejected "${text}" for "${a.canonical}": ${v.problems.join("; ")}`); };

test("the acts under attack are real ones: an order read back, an adviser's answers, a question, a system line, a battle read-back", () => {
  for (const [k, re] of [["readback", /from Crownwood to Northwatch/], ["answer", /^I would/], ["answer", /against/], ["answer", /^Otherwise/], ["question", /Which place/], ["technical", /Did you mean/], ["readback", /not beyond/]] as const) A(k, re);
});

test("harmless rewordings still pass: courtesy, the register's equivalents, case and punctuation", () => {
  const rb = A("readback", /from Crownwood to Northwatch/);
  accepts(rb, rb.canonical);
  accepts(rb, rb.canonical.replace("Let me be sure:", "My lady, if I have it right,"));
  accepts(rb, rb.canonical.replace("Is that right?", "Have I got that right, your majesty?"));
  accepts(rb, rb.canonical.toUpperCase().replace(/[.:]/g, ","));
  const would = A("answer", /^I would/);
  accepts(would, would.canonical.replace(/^I would/, "My lady, I'd"));
  const b = A("readback", /not beyond/);
  accepts(b, b.canonical.replace("Is that right, my lady?", "Have I that right, my queen?"));
});

test("a system line (out of the world) is never reworded", () => {
  const t = A("technical", /Did you mean/);
  rejects(t, t.canonical.replace("Did you mean", "Perhaps you meant"), /system/);
  rejects(t, `${t.canonical} `.trim() + "!", /system/);
});

test("names: none she was not given, none made up (capitalised, at a sentence start, or lower-case with a title), none dropped", () => {
  const rb = A("readback", /from Crownwood to Northwatch/), would = A("answer", /^I would/);
  const other = nameIndex(court).find((e) => e.kind === "place" && !/crownwood|northwatch|greybridge/i.test(e.name))!.name;
  const person = nameIndex(court).find((e) => e.kind === "person" && e.id !== court.self.id && !would.canonical.includes(e.name))!;
  rejects(rb, rb.canonical.replace("Is that right?", `${other} agrees. Is that right?`), /names/);
  rejects(rb, rb.canonical.replace("Is that right?", `${other.toLowerCase()} agrees. Is that right?`), /names/);
  rejects(would, `${would.canonical} ${person.name} thinks so too.`, /names/);
  rejects(would, `${would.canonical} ${person.aliases[person.aliases.length - 1]} thinks so too.`, /names/);
  rejects(would, `${would.canonical} Lord Morwen has agreed.`, /names|made up/);
  rejects(would, `Morwen agrees. ${would.canonical}`, /names|made up/);
  rejects(would, `${would.canonical} lord morwen has agreed.`);
  rejects(rb, rb.canonical.replace(" to Northwatch", ""), /drops|names/);
});

test("roles and order: from and to swapped, the market and the store swapped, names in another order", () => {
  const rb = A("readback", /from Crownwood to Northwatch/);
  rejects(rb, rb.canonical.replace("from Crownwood to Northwatch", "from Northwatch to Crownwood"));
  rejects(rb, rb.canonical.replace("from Crownwood to Northwatch", "to Northwatch from Crownwood"));
  rejects(rb, rb.canonical.replace("from Crownwood to Northwatch", "to Crownwood from Northwatch"));
  const buy = A("readback", /at Marchend for Northwatch/);
  rejects(buy, buy.canonical.replace("at Marchend for Northwatch", "at Northwatch for Marchend"));
  rejects(buy, buy.canonical.replace("at Marchend for Northwatch", "for Northwatch at Marchend"));
});

test("negation: a 'not' added or dropped changes the order or the advice", () => {
  const would = A("answer", /^I would/), b = A("readback", /not beyond/);
  rejects(would, would.canonical.replace("I would", "I would not"), /not|negat/);
  rejects(would, would.canonical.replace("I would", "I wouldn't"), /not|negat/);
  rejects(would, would.canonical.replace("I would", "I would never"), /not|negat/);
  rejects(b, b.canonical.replace("not beyond", "beyond"), /not|negat/);
  rejects(b, b.canonical.replace("but not beyond", "and beyond"));
});

test("numbers: none the act does not carry, in digits, words, plurals or fractions", () => {
  const would = A("answer", /^I would/);
  for (const n of ["400 men", "4,000 men", "4k men", "four hundred men", "hundreds of men", "a score of men", "dozens of men", "two-thirds of the men", "thirteen men", "a third of them"])
    rejects(would, `${would.canonical.replace(/\.$/, "")} with ${n}.`, /number|word/);
});

test("no promise, no odds, no future told: certainty, chances and predictions in any form", () => {
  const would = A("answer", /^I would/), base = would.canonical.replace(/\.$/, "");
  for (const s of ["It will surely work", "It will work", "It'll work", "They won't hold", "We are bound to win", "It cannot fail", "Victory is assured", "I guarantee it", "Mark my words", "No doubt about it",
    "The odds are 70% in our favour", "Seven in ten it works", "Three to one it works", "It is most likely to work", "It will probably work", "There is a good chance", "They are going to run", "Without fail"])
    rejects(would, `${base}. ${s}.`);
});

test("no claim about anyone's mind and no fact the act does not carry", () => {
  const would = A("answer", /^I would/), base = would.canonical.replace(/\.$/, "");
  for (const s of ["He secretly wants the crown", "She is lying to you", "They fear you", "The captain is loyal", "He plans to betray you", "The walls are crumbling", "The raiders have left", "The fort has 80 men", "The people love you", "As an AI I cannot be sure", "The game is rigged"])
    rejects(would, `${base}. ${s}.`);
});

test("reasons turned round: what weighs for and what weighs against cannot swap places", () => {
  const why = A("answer", /, for .*; against it weigh/);
  const m = /^(I would .*?), for (.*); against it weigh (.*)\.$/.exec(why.canonical)!;
  assert.ok(m, why.canonical);
  rejects(why, `${m[1]}, for ${m[3]}; against it weigh ${m[2]}.`);
  rejects(why, `${m[1]}, for ${m[2]}.`);
  const alt = A("answer", /^Otherwise/);
  if (/ or /.test(alt.canonical)) rejects(alt, alt.canonical.replace(/^Otherwise: (.*) or (.*)\.$/, "Otherwise: $2 or $1."));
});

test("form: nothing empty, nothing far longer than the act, no markup, no line breaks, no links", () => {
  const rb = A("readback", /from Crownwood to Northwatch/);
  rejects(rb, "", /empty/);
  rejects(rb, "   ", /empty/);
  rejects(rb, `${rb.canonical} ${"Indeed ".repeat(60)}`, /long/);
  rejects(rb, rb.canonical.replace("Northwatch", "<b>Northwatch</b>"), /character/);
  rejects(rb, `${rb.canonical}\nYou: yes`, /character/);
  rejects(rb, `${rb.canonical} See https://example.com`, /character|link/);
});

test("mutation fuzz: any content word added, dropped, swapped or replaced in a real line is caught (5,000 mutations)", () => {
  let x = 12345;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const pool = ["attack", "fall", "wait", "gold", "raiders", "walls", "safe", "lost", "east", "night", "soon", "more", "less", "all", "only", "twice", "Varos", "spies", "loyal", "ford", "ridge", "from", "to", "at", "not"];
  const lines = rec.acts.filter((a) => a.kind !== "technical");
  let n = 0;
  for (let i = 0; i < 5000; i++) {
    const a = lines[Math.floor(r() * lines.length)], ws = a.canonical.split(" ");
    const k = Math.floor(r() * ws.length), op = Math.floor(r() * 4);
    const out = [...ws];
    if (op === 0) out.splice(k, 0, pool[Math.floor(r() * pool.length)]);
    else if (op === 1) { if (ws.length < 3) continue; out.splice(k, 1); }
    else if (op === 2) { const j = Math.floor(r() * ws.length); if (ws[j].toLowerCase().replace(/\W/g, "") === ws[k].toLowerCase().replace(/\W/g, "")) continue; [out[k], out[j]] = [out[j], out[k]]; }
    else out[k] = pool[Math.floor(r() * pool.length)];
    const text = out.join(" ");
    const same = text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => !["a", "an", "the", "my", "lady", "your", "indeed"].includes(w)).join(" ") === a.canonical.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => !["a", "an", "the", "my", "lady", "your", "indeed"].includes(w)).join(" ");
    if (same) continue; // a courtesy word moved or dropped: harmless
    n++;
    assert.equal(validateSpeech(viewOf(a), a, text, lexicon).ok, false, `accepted mutation "${text}" of "${a.canonical}"`);
  }
  assert.ok(n > 3000, `${n}`);
});

// ---- the other direction: a layer's reading of her words ----------------------------------------------------------------
test("a layer cannot turn her 'no' into a yes: an affirmation the templated reading contradicts is not one", () => {
  const liar: LanguageLayer = {
    id: "liar",
    understand: (text, ctx): Understanding | undefined => (/^(no|wait|cancel|never mind|don't|do not)/i.test(text) ? { ...understand("yes", ctx)! } : undefined),
    say: () => undefined,
  };
  for (const no of ["no", "no, wait", "wait", "cancel", "never mind", "don't", "do not do that"]) {
    const c: Conversation = createConversation({ domain: "court", layer: liar, lexicon, rules });
    c.say("send timber from Crownwood to Northwatch", court);
    assert.equal(c.state, "readback");
    const t = c.say(no, court);
    assert.equal(t.actions.length, 0, `"${no}" sent an order`);
  }
  // a plain yes from such a layer still works
  const c = createConversation({ domain: "court", layer: liar, lexicon, rules });
  c.say("send timber from Crownwood to Northwatch", court);
  assert.equal(c.say("yes", court).actions.length, 1);
});

test("the conversation replaces a rejected line with the canonical one and records why", () => {
  const evil: LanguageLayer = { id: "evil", understand: () => undefined, say: (a) => (a.kind === "technical" ? undefined : `${a.canonical} It will certainly work.`) };
  const c = createConversation({ domain: "court", layer: evil, lexicon, rules });
  const t = c.say("send timber from Crownwood to Northwatch", court);
  const r = t.replies.find((x) => x.kind === "readback")!;
  assert.equal(r.templated, true);
  assert.ok(!/certainly/.test(r.text));
  assert.ok(r.rejected && r.rejected.length > 0);
});

// ---- found by the independent review (D-080): punctuation, loose courtesy and loose equivalents -------------------------
test("punctuation is part of what a line says: moving a stop, a question mark or an exclamation turns it round", () => {
  const b = A("readback", /not beyond the stream/), why = A("answer", /; against it weigh/), would = A("answer", /^I would [^,;]*\.$/), q = A("question", /Which place/);
  rejects(b, b.canonical.replace("attack the ford, but not beyond the stream.", "attack the ford, but not so. Beyond the stream."));
  rejects(b, b.canonical.replace("attack the ford, but not beyond the stream.", "attack: the ford? But not! Beyond the stream."));
  rejects(b, b.canonical.replace("but not beyond", "but not. Beyond"));
  rejects(why, why.canonical.replace("; against it weigh", ", against it! Weigh"));
  rejects(why, why.canonical.replace(/^(I would [^,]*),/, "$1?"));
  rejects(would, would.canonical.replace(/^I would (.*)\.$/, "I would? $1?"));
  rejects(would, would.canonical.replace(/\.$/, "?"));
  rejects(q, q.canonical.replace(/: (.*) or (.*)\?$/, "? $1! Or $2?"));
  const cmd = rec.acts.find((x) => x.kind === "readback" && /and command/.test(x.canonical));
  if (cmd) rejects(cmd, cmd.canonical.replace(/and command (\w+)\. Is that right/, "and command. $1, is that right"));
});

test("courtesy is a fixed set of phrases: no loose 'your', 'the', 'so' or 'aye' to own, blame, intensify or answer", () => {
  const worry = A("answer", /^What worries me/), rb = A("readback", /from Crownwood to Northwatch/), b = A("readback", /not beyond the stream/);
  if (/word that may/.test(worry.canonical)) {
    for (const w of ["your word that may", "the queen' word that may", "Lady Grace' word that may", "my word that may"]) rejects(worry, worry.canonical.replace("word that may", w));
  }
  rejects(rb, rb.canonical.replace("send timber from Crownwood", "send your timber from my Crownwood"));
  rejects(rb, rb.canonical.replace("Is that right?", "Is that right? Aye."));
  rejects(b, b.canonical.replace("attack the ford", "attack a ford"));
  accepts(b, b.canonical.replace("attack the ford", "attack ford")); // an article dropped before a name of the field: the same place
});

test("equivalents are equivalents: 'let me be clear', 'to be sure', 'failing that' and 'consider it done' are not", () => {
  const rb = A("readback", /from Crownwood to Northwatch/), alt = A("answer", /^Otherwise/), ack = A("ack", /It shall be done/);
  rejects(rb, rb.canonical.replace("Let me be sure:", "Let me be clear:"));
  rejects(rb, rb.canonical.replace("Let me be sure:", "To be sure,"));
  rejects(alt, alt.canonical.replace("Otherwise:", "Failing that:"));
  rejects(ack, "Consider it done.");
  accepts(ack, "It will be done.");
});

test("harmless forms the review found rejected now pass", () => {
  const rb = A("readback", /from Crownwood to Northwatch/), ack = A("ack", /It shall be done/);
  accepts(rb, rb.canonical.replace("Is that right?", "Is that correct?"));
  accepts(rb, rb.canonical.replace("Is that right?", "Is that your will, my liege?"));
  accepts(rb, rb.canonical.replace("Is that right?", "Is that right, Your Highness?"));
  accepts(ack, "It shall be done, my lady.");
});

test("punctuation fuzz: a question mark, an exclamation or a new full stop put mid-line is caught (3,000 mutations)", () => {
  let x = 777;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const lines = rec.acts.filter((a) => a.kind !== "technical");
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    const a = lines[Math.floor(r() * lines.length)], ws = a.canonical.split(" ");
    if (ws.length < 3) continue;
    const k = Math.floor(r() * (ws.length - 1)); // never after the last word
    if (/[^A-Za-z']$/.test(ws[k])) continue; // a stop already there
    const mark = ["?", "!", "."][Math.floor(r() * 3)];
    const out = [...ws]; out[k] = ws[k] + mark;
    n++;
    assert.equal(validateSpeech(viewOf(a), a, out.join(" "), lexicon).ok, false, `accepted "${out.join(" ")}"`);
  }
  assert.ok(n > 1500, `${n}`);
});
