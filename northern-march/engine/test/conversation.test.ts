// Phase 13 (docs/CONVERSATION.md): the conversation layer. Spec from the plan: typed words become a draft order that is read
// back and affirmed or corrected before anything reaches the engine; advisers answer "what would you do / why / how sure /
// what worries you / what else" from their cached Recommendation, which goes stale when a belief it rests on changes;
// technical recognition problems are out of the world and cost no time; talking in a battle costs game time; a voice
// transcript is corrected against what she knows; wording can never change the event log (G-16).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createSim, hashLog, type Sim } from "../src/engine.ts";
import { publicRules, playerActions, adviceChoices, type PublicRules } from "../src/presentation/affordances.ts";
import { planWords } from "../src/presentation/phrasing.ts";
import { beliefsAbout, type PlayerAction, type View } from "../src/view.ts";
import { createConversation, correctTranscript, loadLexicon, recommendationStale, templatedLayer, type Conversation, type Lexicon } from "../src/conversation/index.ts";
import { standInLayer } from "./conversation_layers.ts";
import { CONTENT, CONTENT_DIR } from "./helpers.ts";

const rules: PublicRules = publicRules(CONTENT);
const lexicon: Lexicon = loadLexicon(CONTENT_DIR);
const court = (layer = templatedLayer): Conversation => createConversation({ domain: "court", layer, lexicon, rules });
const battle = (layer = templatedLayer): Conversation => createConversation({ domain: "battle", layer, lexicon, rules });

/** Play an interactive game to the first decision point where `ok` holds. */
function pauseWhere(seed: number, ok: (v: View, reason: string) => boolean, limitDays = 140): { sim: Sim; view: View; reason: string } {
  const sim = createSim({ content: CONTENT, seed, policy: "external" });
  for (let i = 0; i < 4000; i++) {
    const r = sim.next(sim.tick + 2 * 86400);
    if (r.ended || sim.tick > limitDays * 86400) break;
    if (!r.paused) continue;
    if (ok(r.view!, r.reason!)) return { sim, view: r.view!, reason: r.reason! };
    sim.answer([]);
  }
  throw new Error(`no such pause for seed ${seed}`);
}
const withRepairAdvice = (v: View) => v.advice.some((a) => a.author === "elara" && (JSON.parse(a.plan.id) as { kind: string }).kind === "advise_repair");
const SEED = 2; // Elara and Selene advise repairing Greybridge at day 11

const say = (c: Conversation, v: View, text: string) => c.say(text, v);
const spoken = (t: { replies: { text: string }[] }) => t.replies.map((r) => r.text).join(" | ");

// ---- the boundary -----------------------------------------------------------------------------------------------------
test("conversation modules import only the view window, the presentation words and each other (static check)", () => {
  const dir = new URL("../src/conversation/", import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(m[1] === "../view.ts" || (m[1] === "node:fs" && f === "files.ts") || /^\.\.\/presentation\/[a-z]+\.ts$/.test(m[1]) || /^\.\/[a-z]+\.ts$/.test(m[1]), `${f} imports ${m[1]}`);
  }
});

test("the lexicon is data: every act has words and no word means two things", () => {
  for (const k of ["affirm", "cancel", "correct"] as const) assert.ok(lexicon[k].length > 0, k);
  assert.ok(Object.keys(lexicon.verbs).length >= 8);
  const seen = new Map<string, string>();
  for (const [verb, words] of Object.entries(lexicon.verbs)) for (const w of words) { assert.ok(!seen.has(w) || seen.get(w) === verb, `${w} is ${seen.get(w)} and ${verb}`); seen.set(w, verb); }
});

// ---- typed orders: draft, read-back, affirm ---------------------------------------------------------------------------
test("a typed order is read back and reaches the engine only after it is affirmed", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  const t1 = say(c, view, "Repair Greybridge");
  assert.equal(t1.actions.length, 0, "nothing is sent before the affirmation");
  assert.ok(t1.replies.some((r) => r.kind === "readback" && /Greybridge/.test(r.text)), spoken(t1));
  assert.equal(c.state, "readback");
  const t2 = say(c, view, "Yes, do so.");
  assert.equal(t2.actions.length, 1);
  assert.deepEqual({ action: t2.actions[0].action, target: t2.actions[0].target }, { action: "repair", target: "greybridge" });
  assert.equal(c.state, "idle");
});

test("every action the layer returns is one the rules offer her now", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const offered = new Set(playerActions(view, rules).map((a) => JSON.stringify({ ...a, followed: undefined })));
  for (const text of ["repair Greybridge", "repair greybridge quickly", "mend Greybridge with the captain's men only", "send the captain to Northwatch", "raise a levy", "send relief to Greyfen", "travel to Northwatch", "buy timber at Greybridge for Crownwood"]) {
    const c = court();
    say(c, view, text);
    const t = say(c, view, "yes");
    assert.equal(t.actions.length, 1, `${text}: ${c.state}`);
    assert.ok(offered.has(JSON.stringify({ ...t.actions[0], followed: undefined })), `${text} → ${JSON.stringify(t.actions[0])}`);
  }
});

test("modes and goods in the words narrow the order", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const go = (text: string) => { const c = court(); say(c, view, text); return say(c, view, "agreed").actions[0]; };
  assert.equal(go("repair Greybridge quickly").repairMode, "rush");
  assert.equal(go("repair Greybridge with the captain's men only, no cost").repairMode, "labour");
  assert.equal(go("buy timber at Greybridge for Crownwood").good, "timber");
});

test("'do as Selene advises' follows her advice and names her", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  const t = say(c, view, "Do as Selene advises");
  assert.ok(t.replies.some((r) => r.kind === "readback"), spoken(t));
  const a = say(c, view, "proceed").actions[0];
  assert.equal(a.followed, "selene");
  assert.ok(adviceChoices(view).some((ch) => ch.byIds.includes("selene") && JSON.stringify({ ...ch.action, followed: undefined }) === JSON.stringify({ ...a, followed: undefined })));
});

test("affirmation words all affirm; with nothing to confirm nothing is sent", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  for (const yes of ["Yes", "agreed", "Do so", "proceed", "yes, that's right"]) {
    const c = court(); say(c, view, "repair Greybridge");
    assert.equal(say(c, view, yes).actions.length, 1, yes);
  }
  const c = court();
  const t = say(c, view, "yes");
  assert.equal(t.actions.length, 0);
  assert.ok(t.replies.length > 0 && t.replies.every((r) => r.speaker === null || r.kind !== "readback"));
});

test("a correction replaces what was wrong and the draft is read back again; 'never mind' drops it", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  say(c, view, "Repair Greybridge");
  const t = say(c, view, "No, I mean Northwatch");
  assert.equal(t.actions.length, 0);
  assert.ok(t.replies.some((r) => r.kind === "readback" && /Northwatch/.test(r.text) && !/Greybridge/.test(r.text)), spoken(t));
  assert.equal(say(c, view, "yes").actions[0].target, "northwatch");
  const d = court();
  say(d, view, "Repair Greybridge");
  const n = say(d, view, "never mind");
  assert.equal(n.actions.length, 0);
  assert.equal(d.state, "idle");
  assert.equal(say(d, view, "yes").actions.length, 0, "a dropped draft cannot be affirmed");
});

// ---- technical versus in-world ------------------------------------------------------------------------------------------
test("a near miss on a name is confirmed out of the world; an unknown name is said so; neither costs time or sends anything", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  const t = say(c, view, "send relief to Grey Fen");
  assert.ok(t.replies.some((r) => r.kind === "technical" && /Greyfen/.test(r.text) && r.speaker === null), spoken(t));
  assert.equal(t.costSeconds, 0);
  assert.equal(t.actions.length, 0);
  const t2 = say(c, view, "yes");
  assert.ok(t2.replies.some((r) => r.kind === "readback" && /Greyfen/.test(r.text)), spoken(t2));
  assert.equal(say(c, view, "yes").actions[0].target, "greyfen");
  const d = court();
  const u = say(d, view, "repair Atlantis");
  assert.ok(u.replies.some((r) => r.kind === "technical" && /Atlantis/.test(r.text)), spoken(u));
  assert.equal(u.actions.length, 0);
  assert.equal(d.state, "idle");
});

test("a missing slot is asked by an adviser who is present, from what he believes, and the answer fills it", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  const t = say(c, view, "repair");
  const q = t.replies.find((r) => r.kind === "question")!;
  assert.ok(q, spoken(t));
  assert.ok(q.speaker && view.world.areas[q.speaker] !== undefined, "an adviser asks");
  assert.match(q.text, /Greybridge/);
  assert.equal(c.state, "question");
  const t2 = say(c, view, "Greybridge");
  assert.ok(t2.replies.some((r) => r.kind === "readback" && /Greybridge/.test(r.text)), spoken(t2));
  assert.equal(say(c, view, "yes").actions[0].target, "greybridge");
});

// ---- questions to advisers, from the cached Recommendation -------------------------------------------------------------
test("'what would you do' is answered by the adviser from his own Recommendation, and never merged with the others'", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const c = court();
  const t = say(c, view, "Elara, what would you do?");
  const rep = t.replies.filter((r) => r.kind === "answer");
  assert.equal(rep.length, 1);
  assert.equal(rep[0].speaker, "elara");
  const rec = view.advice.find((a) => a.author === "elara")!;
  assert.ok(rep[0].text.includes(planWords(view, rec.plan.id).replace(/^./, (x) => x.toLowerCase())) || rep[0].text.includes(planWords(view, rec.plan.id)), rep[0].text);
  assert.equal(t.actions.length, 0, "a question changes nothing");
  const all = say(court(), view, "What would you do?");
  assert.ok(all.replies.filter((r) => r.kind === "answer").map((r) => r.speaker).sort().join() === [...new Set(view.advice.map((a) => a.author))].sort().join(), "each adviser answers separately");
});

test("why, how sure, what worries you and what else are voiced from the reasons, uncertainties and alternatives", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const rec = view.advice.find((a) => a.author === "elara" && withRepairAdvice({ ...view, advice: [a] } as View))!;
  const ask = (q: string) => spoken(say(court(), view, `Elara, ${q}`));
  assert.match(ask("why?"), /keeping the realm safe|what it costs|how the crown is seen/);
  const worries = ask("what worries you?");
  assert.ok(rec.uncertainties.length > 0 && /out of date|not sure|uncertain|perhaps|doubtful|cost/i.test(worries), worries);
  assert.match(ask("how sure are you?"), /sure|certain|doubt/i);
  const alts = ask("what else could we do?");
  for (const a of rec.alternatives) assert.ok(alts.includes(planWords(view, a.id).replace(/^./, (x) => x.toLowerCase())) || alts.includes(planWords(view, a.id)), `${planWords(view, a.id)} in ${alts}`);
});

test("a Recommendation is stale when she learns something material about what it concerns after it was given; a stale answer is not voiced and asks him to think again", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const rec = view.advice.find((a) => a.author === "elara" && (JSON.parse(a.plan.id) as { kind: string }).kind === "advise_repair")!;
  assert.equal(recommendationStale(view, rec), false);
  // she learns later that the walls at the place are in a very different state from the one he advised on
  const target = (JSON.parse(rec.plan.id) as { target: string }).target;
  const old = beliefsAbout(view, target, "fortification.condition")[0];
  assert.ok(old, "she holds a belief about the walls the advice is about");
  const newer = { ...old, id: old.id + 100000, observedAt: rec.computedAt + 60, ageTicks: 0, believedValue: (old.believedValue as number) + 40000 };
  const changed = { ...view, beliefs: { ...view.beliefs, [String(newer.id)]: newer } } as View;
  assert.equal(recommendationStale(changed, rec), true);
  const t = say(court(), changed, "Elara, what would you do?");
  assert.ok(t.replies.some((r) => r.speaker === "elara" && /think|changed/i.test(r.text)), spoken(t));
  assert.deepEqual(t.actions.map((a) => [a.action, a.target]), [["ask", "elara"]]);
  const fresh = say(court(), view, "Elara, why?");
  assert.equal(fresh.actions.length, 0);
  // news of something the advice is not about changes nothing
  const other = beliefsAbout(view, "oldmill", "fortification.condition")[0] ?? { ...old, subject: { kind: "location", id: "oldmill" } };
  const unrelated = { ...other, id: 999999, observedAt: rec.computedAt + 60, believedValue: 1 };
  assert.equal(recommendationStale({ ...view, beliefs: { ...view.beliefs, "999999": unrelated } } as View, rec), false);
});

test("asking the adviser to think again makes him work out his advice now, for him only, and changes nothing when never used", () => {
  const { sim, view } = pauseWhere(SEED, withRepairAdvice);
  const before = sim.log.length;
  sim.answer([{ action: "ask", target: "elara" }]);
  for (let i = 0; i < 30; i++) { const r = sim.next(sim.tick + 3600); if (!r.paused || sim.log.slice(before).some((e) => e.type === "RecommendationMade")) break; sim.answer([]); } // the day's other advice is put to her first
  const after = sim.log.slice(before);
  assert.ok(after.some((e) => e.type === "PlayerInput" && e.payload.action === "ask"));
  const made = after.filter((e) => e.type === "RecommendationMade");
  assert.ok(made.length > 0 && made.every((e) => (e.payload.recommendation as { author: string }).author === "elara"), made.map((e) => (e.payload.recommendation as { author: string }).author).join());
  assert.throws(() => { const p = pauseWhere(SEED, withRepairAdvice); p.sim.answer([{ action: "ask", target: "anna" } as PlayerAction]); }, /cannot ask/);
  void view;
});

test("a conversation that only asks questions leaves the log exactly as if nothing had been said", () => {
  const run = (talk: boolean) => {
    const { sim, view } = pauseWhere(SEED, withRepairAdvice);
    if (talk) { const c = court(); for (const q of ["Elara, why?", "What would you do?", "Selene, how sure are you?", "what worries you", "repair Atlantis", "never mind"]) say(c, view, q); }
    sim.answer([]);
    const until = sim.tick + 20 * 86400;
    for (let i = 0; i < 4000; i++) { const r = sim.next(until); if (r.ended || !r.paused) break; sim.answer([]); }
    return hashLog(sim.log);
  };
  assert.equal(run(true), run(false));
});

// ---- the voice adapter and transcript correction ------------------------------------------------------------------------
test("a transcript is corrected against the names she knows, shows what changed and costs no game time", () => {
  const { view } = pauseWhere(SEED, withRepairAdvice);
  const r = correctTranscript(view, { text: "send relief to grey fen and repair high cairn", words: [{ w: "send", conf: 0.9 }, { w: "relief", conf: 0.9 }, { w: "to", conf: 0.95 }, { w: "grey", conf: 0.4 }, { w: "fen", conf: 0.4 }, { w: "and", conf: 0.9 }, { w: "repair", conf: 0.9 }, { w: "high", conf: 0.3 }, { w: "cairn", conf: 0.3 }] });
  assert.match(r.text, /Greyfen/);
  assert.match(r.text, /Highcairn/);
  assert.ok(r.changes.length >= 2 && r.changes.every((c) => c.from && c.to));
  assert.equal(r.costSeconds, 0);
  const same = correctTranscript(view, { text: "repair Greybridge", words: [] });
  assert.equal(same.text, "repair Greybridge");
  assert.equal(same.changes.length, 0);
});

// ---- battle conversation ------------------------------------------------------------------------------------------------
function toBattle(): { sim: Sim; view: View } {
  for (let seed = 1; seed <= 12; seed++) {
    const sim = createSim({ content: CONTENT, seed, policy: "external" });
    let travelled = false, ordered = false;
    for (let i = 0; i < 20000; i++) {
      const r = sim.next(160 * 86400);
      if (!r.paused || r.ended) break;
      if (r.reason === "battle") return { sim, view: r.view! };
      const v = r.view!, acts: PlayerAction[] = [];
      if (!travelled) { acts.push({ action: "travel", target: "northwatch" }); travelled = true; }
      const b = Object.values(v.beliefs).find((x) => x.subject.id === "blackwood" && x.predicate === "threat.intensity");
      if ("at" in v.self.position && v.self.position.at === "northwatch" && !ordered && b && (b.believedValue as number) > 0) { acts.push({ action: "advance", target: "northwatch", mission: "attack", raid: "blackwood" }); ordered = true; }
      sim.answer(acts);
    }
  }
  throw new Error("no battle with the ruler present in seeds 1-12");
}
const present = (v: View) => v.battle!.commanders[0];

test("a typed battle order is read back by the commander it is for and costs game time as it is spoken", () => {
  const { view } = toBattle();
  const cmd = present(view), c = battle();
  const t1 = say(c, view, `${cmd.name.split(" ")[0]}, hold the ridge`);
  const rb = t1.replies.find((r) => r.kind === "readback")!;
  assert.ok(rb && rb.speaker === cmd.id && /ridge/i.test(rb.text), spoken(t1));
  assert.equal(t1.costSeconds, 15, "a read-back costs 15 battle seconds");
  const t2 = say(c, view, "yes");
  assert.equal(t2.actions.length, 1);
  const a = t2.actions[0];
  assert.equal(a.action, "battle");
  assert.deepEqual({ to: a.battle!.to, kind: a.battle!.task.kind, place: a.battle!.task.place }, { to: cmd.id, kind: "hold", place: "ridge" });
  assert.equal(a.battle!.delay, 15 + t2.costSeconds, "the order is dated after the time spent talking");
});

test("a commander asks what he does not know, at 30 seconds a question; a missing recipient is a technical prompt", () => {
  const { view } = toBattle();
  const cmd = present(view), c = battle();
  const t = say(c, view, `${cmd.name.split(" ")[0]}, hold`);
  const q = t.replies.find((r) => r.kind === "question")!;
  assert.ok(q && q.speaker === cmd.id, spoken(t));
  assert.equal(t.costSeconds, 30);
  const t2 = say(c, view, "the ridge");
  assert.ok(t2.replies.some((r) => r.kind === "readback"));
  const d = battle();
  const u = say(d, view, "hold the ridge");
  assert.ok(u.replies.some((r) => r.kind === "technical" && r.speaker === null), spoken(u));
  assert.equal(u.costSeconds, 0);
});

test("limits, conditions, sector delegation and the carrier are understood", () => {
  const { view } = toBattle();
  const ids = view.battle!.commanders.map((x) => x.id), first = (id: string) => view.battle!.commanders.find((x) => x.id === id)!.name.split(" ")[0];
  const [a, b] = ids;
  const go = (text: string) => { const c = battle(); say(c, view, text); const t = say(c, view, "yes"); return t.actions[0]?.battle; };
  assert.equal(go(`${first(a)}, attack the ford but not beyond the stream`)?.task.limit, "stream");
  const cond = go(`${first(a)}, hold the ridge and when the enemy is engaged, attack`);
  assert.equal(cond?.task.when?.kind, "enemy_engaged");
  assert.equal(cond?.task.when?.then.kind, "attack");
  if (b) assert.deepEqual(go(`${first(a)}, hold the ridge and command ${first(b)}`)?.task.command, [b]);
  assert.equal(go(`${first(a)}, hold the ridge, send a runner`)?.via, "runner");
});

test("an order to someone who is not in the battle is a technical prompt, never an order", () => {
  const { view } = toBattle();
  const c = battle();
  const t = say(c, view, "Selene, hold the ridge");
  assert.equal(t.actions.length, 0);
  assert.equal(say(c, view, "yes").actions.length, 0);
});

test("the engine dates a battle order by the time spent talking, and the battle runs on meanwhile", () => {
  const { sim, view } = toBattle();
  const cmd = present(view), c = battle();
  say(c, view, `${cmd.name.split(" ")[0]}, hold the ridge`);
  const a = say(c, view, "yes").actions[0];
  const t0 = view.battle!.t;
  sim.answer([a]);
  const given = [...sim.log].reverse().find((e) => e.type === "BattleOrderGiven")!;
  assert.equal((given.payload.order as { t: number }).t, t0 + a.battle!.delay!);
});

// ---- the layer can be swapped (G-16, short form) -----------------------------------------------------------------------
test("a different layer, speaking and hearing differently, leaves the event log identical", () => {
  for (const seed of [2, 3, 4]) {
    const logs = [templatedLayer, standInLayer].map((layer) => {
      const sim = createSim({ content: CONTENT, seed, policy: "external" });
      const c = court(layer);
      let n = 0;
      for (let i = 0; i < 4000 && n < 8; i++) {
        const r = sim.next(sim.tick + 2 * 86400);
        if (r.ended || sim.tick > 90 * 86400) break;
        if (!r.paused) continue;
        const v = r.view!, acts: PlayerAction[] = [];
        const ch = adviceChoices(v).filter((x) => !x.wait)[0];
        if (ch && n < 8) {
          const words = layer === templatedLayer ? `Do as ${ch.by[0]} advises` : `please just go with what ${ch.by[0]} said`;
          say(c, v, "Elara, why?"); say(c, v, words);
          acts.push(...say(c, v, layer === templatedLayer ? "yes" : "sure, go ahead").actions);
          n++;
        }
        sim.answer(acts);
      }
      const until = sim.tick + 30 * 86400;
      for (let i = 0; i < 4000; i++) { const r = sim.next(until); if (r.ended || !r.paused) break; sim.answer([]); }
      return hashLog(sim.log);
    });
    assert.equal(logs[0], logs[1], `seed ${seed}`);
  }
});
