// Phase 13 gate G-16 (docs/CONVERSATION.md §8): swapping the language layer leaves the event log identical.
//   node tools/phase13_gate.ts probe <fromSeed> <toSeed>                          TUNE seeds only (1..9,999): print the numbers, log nothing
//   node tools/phase13_gate.ts shard <block> <fromOffset> <toOffset> <out.json>   run seeds block+from .. block+to-1
//   node tools/phase13_gate.ts eval <block> <out1.json> [out2.json ...]           merge shards, claim the block, record the verdict
// Each seed is played three ways with the same scripted intent (an order, advice to follow, a question, in words) and the same
// game: (1) the templated layer fed canonical sentences; (2) the stand-in layer fed padded, mistyped, corrected sentences;
// (3) the stand-in layer hearing, and an adversarial layer speaking (invented names, numbers, claims about the future). Two legs:
// the court for 40 days and the first battle with the ruler present (orders to commanders in words).
// (a) the three event logs are identical on every seed, and the three arms produce the same actions at every decision;
// (b) no line from the adversarial layer reaches the transcript (every one is rejected and replaced), and at least some were produced;
// (c) every action sent to the engine is accepted by it: 0 refusals;
// (d) no conversation is left open: every one ends in an action, a technical reply or a cancel within 8 turns.
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim, hashLog, type Sim } from "../src/engine.ts";
import { GateLog } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import { actionText, adviceChoices, playerActions, publicRules } from "../src/presentation/affordances.ts";
import { createConversation, loadLexicon, templatedLayer, type Conversation, type LanguageLayer, type Turn } from "../src/conversation/index.ts";
import { nameIndex } from "../src/conversation/text.ts";
import type { PlayerAction, View } from "../src/view.ts";
import { adversarialLayer, standInLayer } from "../test/conversation_layers.ts";

const dir = process.env.CONTENT_DIR ?? new URL("../content/march/", import.meta.url).pathname;
const content = loadContent(dir), cal = gateKey(content), lexicon = loadLexicon(dir), rules = publicRules(content);
const DAYS = 40, MAX_INTENTS = 8, MAX_TURNS = 8;

const KINDS = ["name", "number", "future", "mind", "odds"] as const;
function layerFor(arm: number): LanguageLayer {
  if (arm === 0) return templatedLayer;
  if (arm === 1) return standInLayer;
  let n = 0;
  return { id: "standin+adversarial", understand: standInLayer.understand, say: (act, ctx) => adversarialLayer(KINDS[n++ % KINDS.length]).say(act, ctx) };
}

/** A tiny generator of its own (never the simulation's streams). */
function lcg(seed: number) { let x = (seed * 2654435761) >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

interface Stats { turns: number; technical: number; questions: number; corrections: number; refusals: number; stuck: number; leaks: number; rejected: number; produced: number; actions: string[] }
const fresh = (): Stats => ({ turns: 0, technical: 0, questions: 0, corrections: 0, refusals: 0, stuck: 0, leaks: 0, rejected: 0, produced: 0, actions: [] });

/** Say it the way this arm says it. */
function phrase(arm: number, text: string, v: View, r: () => number): { first: string; fix?: string } {
  if (arm === 0) return { first: text };
  const out = text.replace(/\.$/, "");
  const roll = r();
  const names = nameIndex(v).filter((e) => e.kind === "place" && out.includes(e.name));
  const target = names.sort((a, b) => b.name.length - a.name.length)[0];
  if (roll < 0.25 && target && target.name.length >= 7) { // a slip of the typing, confirmed out of the world
    const n = target.name, k = 2 + Math.floor(r() * (n.length - 4)), slip = n.slice(0, k) + n[k + 1] + n[k] + n.slice(k + 2);
    return { first: `please ${out.replace(n, slip)}` };
  }
  if (roll < 0.45 && target) { // the wrong place first, then a correction
    const other = nameIndex(v).filter((e) => e.kind === "place" && e.id !== target.id && e.name.length >= 5).sort((a, b) => (a.id < b.id ? -1 : 1))[Math.floor(r() * 5)];
    if (other) return { first: out.replace(target.name, other.name), fix: `No, I mean ${target.name}` };
  }
  return { first: roll < 0.7 ? `${out.charAt(0).toLowerCase()}${out.slice(1)}, my queen` : `please ${out.charAt(0).toLowerCase()}${out.slice(1)}` };
}

/** Drive one conversation to its end. */
function converse(conv: Conversation, v: View, arm: number, first: string, again: string, fix: string | undefined, st: Stats, wants = false): PlayerAction[] {
  const actions: PlayerAction[] = [];
  let text = first, fixed = false, retried = false;
  const yes = arm === 0 ? "Yes" : "sure, go ahead";
  for (let i = 0; i < MAX_TURNS; i++) {
    const t: Turn = conv.say(text, v);
    st.turns++;
    if (process.env.TRACE && arm === Number(process.env.TRACE) && /arch/i.test(first)) console.log(JSON.stringify({ i, said: text, state: conv.state, replies: t.replies.map((r) => r.text), actions: t.actions.length }));
    for (const r of t.replies) {
      if (r.kind === "technical") st.technical++;
      if (r.kind === "question") st.questions++;
      if (arm === 2) { if (r.rejected) st.rejected++; else if (!r.templated) st.leaks++; if (r.rejected) st.produced++; }
    }
    actions.push(...t.actions);
    if (t.actions.length) return actions;
    // refused outright (a wrong place she named): she puts it again, plainly, once
    if (conv.state === "idle" && wants && !retried && arm !== 0) { retried = true; text = again; continue; }
    if (conv.state === "idle") return actions;
    if (conv.state === "readback" && fix && !fixed) { text = fix; fixed = true; st.corrections++; continue; }
    text = conv.state === "technical" ? yes : conv.state === "readback" ? yes : again;
  }
  conv.say("never mind", v); st.stuck++;
  return actions;
}

/** Leg 1: the court. At some decision points she says what she wants. */
function court(seed: number, arm: number, st: Stats): Sim {
  const sim = createSim({ content, seed, policy: "external" });
  const conv = createConversation({ domain: "court", layer: layerFor(arm), lexicon, rules });
  const r = lcg(seed), say = lcg(seed + 7919); // `r` picks the intent, `say` how it is put: kept apart so the arms choose alike
  let intents = 0;
  for (let i = 0; i < 6000; i++) {
    const n = sim.next(DAYS * 86400);
    if (n.ended || !n.paused) break;
    const v = n.view!;
    let acts: PlayerAction[] = [];
    if (n.reason !== "battle" && intents < MAX_INTENTS && r() < 0.3) {
      intents++;
      const pick = r(), choices = adviceChoices(v).filter((c) => !c.wait), allowed = playerActions(v, rules);
      const advisers = [...new Set(v.advice.map((a) => a.author))].sort();
      if (advisers.length && pick < 0.25) { // a question, then (maybe) nothing more
        const who = advisers[Math.floor(r() * advisers.length)], q = ["what would you do", "why", "how sure are you", "what worries you", "what else could we do"][Math.floor(r() * 5)];
        const name = v.world.names[who];
        converse(conv, v, arm, `${name}, ${q}?`, `${name}, ${q}?`, undefined, st);
      } else if (choices.length && pick < 0.55) {
        const c = choices[Math.floor(r() * choices.length)], by = c.byIds[0];
        const p = phrase(arm, `Do as ${v.world.names[by]} advises`, v, say);
        acts = converse(conv, v, arm, p.first, `Do as ${v.world.names[by]} advises`, p.fix, st, true);
      } else if (allowed.length) {
        const a = allowed[Math.floor(r() * allowed.length)], p = phrase(arm, actionText(v, a), v, say);
        acts = converse(conv, v, arm, p.first, actionText(v, a), p.fix, st, true);
      }
      st.actions.push(JSON.stringify({ t: v.now, acts: acts.map((a) => ({ ...a, decision: undefined })) }));
    }
    try { sim.answer(acts); } catch { st.refusals++; sim.answer([]); }
  }
  const until = sim.tick + 5 * 86400;
  for (let i = 0; i < 2000; i++) { const n = sim.next(until); if (n.ended || !n.paused) break; sim.answer([]); }
  return sim;
}

/** Leg 2: the first battle with the ruler present; orders to commanders in words. */
function battleLeg(seed: number, arm: number, st: Stats): Sim | undefined {
  const sim = createSim({ content, seed, policy: "external" });
  let travelled = false, ordered = false, inBattle = false;
  for (let i = 0; i < 20000; i++) {
    const n = sim.next(160 * 86400);
    if (!n.paused || n.ended) break;
    const v = n.view!;
    if (n.reason === "battle" && !inBattle) {
      inBattle = true;
      const conv = createConversation({ domain: "battle", layer: layerFor(arm), lexicon, rules }), say = lcg(seed + 104729), acts: PlayerAction[] = [];
      const orders = ["hold the ridge", "attack the ford but not beyond the stream", "hold the wood's edge"];
      v.battle!.commanders.slice(0, 3).forEach((c, k) => {
        const first = c.name.split(" ")[0], text = `${first}, ${orders[k]}`, p = phrase(arm, text, v, say);
        acts.push(...converse(conv, v, arm, p.first, text, undefined, st));
      });
      st.actions.push(JSON.stringify({ battle: acts.map((a) => ({ ...a, decision: undefined })) }));
      try { sim.answer(acts); } catch { st.refusals++; sim.answer([]); }
      continue;
    }
    const acts: PlayerAction[] = [];
    if (!travelled) { acts.push({ action: "travel", target: "northwatch" }); travelled = true; }
    const b = Object.values(v.beliefs).find((x) => x.subject.id === "blackwood" && x.predicate === "threat.intensity");
    if ("at" in v.self.position && v.self.position.at === "northwatch" && !ordered && b && (b.believedValue as number) > 0) { acts.push({ action: "advance", target: "northwatch", mission: "attack", raid: "blackwood" }); ordered = true; }
    try { sim.answer(acts); } catch { st.refusals++; sim.answer([]); }
  }
  return inBattle ? sim : undefined;
}

function seedRow(seed: number) {
  const arms = [0, 1, 2].map((arm) => { const st = fresh(), c = court(seed, arm, st), b = battleLeg(seed, arm, st); return { st, court: hashLog(c.log), battle: b ? hashLog(b.log) : null }; });
  const same = (f: (a: (typeof arms)[number]) => unknown) => arms.every((a) => JSON.stringify(f(a)) === JSON.stringify(f(arms[0])));
  return {
    seed, logsEqual: same((a) => a.court) && same((a) => a.battle), actionsEqual: same((a) => a.st.actions), battle: arms[0].battle !== null,
    turns: arms.map((a) => a.st.turns), technical: arms.map((a) => a.st.technical), corrections: arms.map((a) => a.st.corrections),
    refusals: arms.reduce((n, a) => n + a.st.refusals, 0), stuck: arms.reduce((n, a) => n + a.st.stuck, 0), leaks: arms[2].st.leaks, rejected: arms[2].st.rejected,
    diff: (() => { for (const k of [1, 2]) { const n = Math.max(arms[0].st.actions.length, arms[k].st.actions.length); for (let i = 0; i < n; i++) if (arms[0].st.actions[i] !== arms[k].st.actions[i]) return { arm: k, i, templated: arms[0].st.actions[i]?.slice(0, 300), other: arms[k].st.actions[i]?.slice(0, 300) }; } return null; })(),
    firstDivergence: arms[0].court !== arms[1].court || arms[0].court !== arms[2].court ? "court" : arms[0].battle !== arms[1].battle || arms[0].battle !== arms[2].battle ? "battle" : null,
  };
}

function summarise(rows: ReturnType<typeof seedRow>[]) {
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const a = { seeds: rows.length, identical: rows.filter((r) => r.logsEqual && r.actionsEqual).length, battles: rows.filter((r) => r.battle).length, divergent: rows.filter((r) => !r.logsEqual || !r.actionsEqual).map((r) => ({ seed: r.seed, where: r.firstDivergence, actions: r.actionsEqual, diff: r.diff })).slice(0, 10) };
  const b = { rejected: sum((r) => r.rejected), leaks: sum((r) => r.leaks) };
  const c = { refusals: sum((r) => r.refusals) }, d = { stuck: sum((r) => r.stuck) };
  const verdict = { a: a.identical === a.seeds ? "PASS" : "FAIL", b: b.leaks === 0 && b.rejected > 0 ? "PASS" : "FAIL", c: c.refusals === 0 ? "PASS" : "FAIL", d: d.stuck === 0 ? "PASS" : "FAIL" };
  const overall = Object.values(verdict).every((x) => x === "PASS") ? "PASS" : "FAIL";
  return { a, b, c, d, verdict, overall, turns: [0, 1, 2].map((k) => sum((r) => r.turns[k])), technical: [0, 1, 2].map((k) => sum((r) => r.technical[k])), corrections: [0, 1, 2].map((k) => sum((r) => r.corrections[k])) };
}

const [mode, a1, a2, a3, a4] = process.argv.slice(2);
if (mode === "probe") {
  const [from, to] = [Number(a1), Number(a2)];
  if (!(from >= 1 && to <= 10000)) throw new Error("probe runs on TUNE seeds (1..9,999) only");
  const rows: ReturnType<typeof seedRow>[] = [];
  for (let s = from; s < to; s++) rows.push(seedRow(s));
  console.log(JSON.stringify(summarise(rows), null, 1));
} else if (mode === "shard") {
  const block = Number(a1);
  if (!(block >= 10000 && block % 10000 === 0)) throw new Error("gate blocks start at a multiple of 10,000");
  const rows: ReturnType<typeof seedRow>[] = [];
  for (let s = Number(a2); s < Number(a3); s++) rows.push(seedRow(block + s));
  writeFileSync(a4, JSON.stringify({ block, cal, rows }));
  console.log(`shard ${a2}..${a3} done`);
} else if (mode === "eval") {
  const block = Number(a1);
  const rows = process.argv.slice(4).flatMap((f) => { const j = JSON.parse(readFileSync(f, "utf8")); if (j.cal !== cal || j.block !== block) throw new Error(`${f}: different block or calibration`); return j.rows; });
  const log = new GateLog("results/gate_log.jsonl");
  log.claim(block, cal);
  const s = summarise(rows), row = { gate: "G-16", seedBlock: block, calibrationHash: cal, contentVersion: content.version, ...s, verdict: s.overall, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row, null, 1));
} else throw new Error("usage: probe|shard|eval");
