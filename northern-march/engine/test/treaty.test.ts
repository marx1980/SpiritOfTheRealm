// Phase 14B stage 2 (docs/FRONTIER.md, "Stage 2"): the offer of terms, the player's answer, the truce, the two endings it makes readable,
// and the merchant's grain. Spec: backlog P0.17, plan Phase 14 endings (negotiated settlement, military victory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/engine.ts";
import { checkPairing } from "../src/invariants.ts";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { readEnding } from "../src/endings.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const DAY = 86400;
const F = CONTENT.scenario.frontier!;
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);

/** The court is at peace, reviews often and offers terms often; the answer to the ambassador takes two days. */
const peace = variant((r) => {
  const f = r.scenario.frontier!;
  f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: "settle", thresholds: { tradeFrom: 2000, pressFrom: 2000, strikeFrom: 2000 } };
  f.delayDays = { ambassador: [2, 2], commander: [2, 2], merchant: [2, 2] };
  f.treaty = { ...f.treaty, cooldownDays: 10, openDays: 30 };
});

/** Play with an external hand: at each day end, `act(sim)` may answer. */
function play(content: typeof CONTENT, seed: number, days: number, act: (log: readonly SimEvent[], tick: number) => PlayerAction[]) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  for (let i = 0; i < 8000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY);
    if (!p.paused) break;
    sim.answer(act(sim.log, sim.tick));
  }
  return sim;
}
const answerOnce = (how: "accept" | "refuse") => { let done = false; return (log: readonly SimEvent[]): PlayerAction[] => {
  const offer = ofType(log, "TreatyProposed")[0];
  if (!offer || done) return [];
  done = true;
  return [{ action: "treaty", target: how, to: String(offer.id) }];
}; };

test("the offer carries its terms, and the ambassador writes the ruler a letter about it", () => {
  const log = run({ seed: 2, content: peace }, 60).log;
  const t = ofType(log, "TreatyProposed")[0];
  assert.ok(t, "an offer");
  const p = t.payload as { tributeMilli: number; truceDays: number };
  assert.equal(p.tributeMilli, F.treaty.tributeMilli);
  assert.equal(p.truceDays, F.treaty.truceDays);
  const letter = log.find((e) => e.type === "ReportComposed" && (e.payload.report as { author: string }).author === F.actors.ambassador);
  assert.ok(letter, "a letter");
  assert.ok((letter!.payload.report as { claims: { predicate: string; believedValue?: unknown; value?: unknown }[] }).claims.some((c) => c.predicate === "frontier.treaty"));
});

test("accepting: the word takes the ambassador's road, then the treaty is signed, the tribute paid and a truce begins", () => {
  const sim = play(peace, 2, 120, answerOnce("accept")), log = sim.log;
  const ans = ofType(log, "TreatyAnswered")[0], signed = ofType(log, "TreatySigned")[0];
  assert.ok(ans && signed);
  assert.equal(ans.payload.accepted, true);
  assert.equal(ans.causedBy.length > 0 && log.find((e) => e.id === ans.causedBy[0])!.type, "PlayerInput");
  assert.equal(signed.tick - ans.tick, 2 * DAY, "the ambassador's delay");
  assert.ok(signed.causedBy.includes(ans.id));
  assert.equal(signed.payload.tributeMilli, F.treaty.tributeMilli);
  assert.equal(ofType(log, "TreatyRefused").length, 0);
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.fr!.truceUntil, signed.tick + F.treaty.truceDays * DAY);
});

test("the tribute leaves the ruler's treasury", () => {
  const a = play(peace, 2, 60, answerOnce("accept")), b = play(peace, 2, 60, () => []);
  const ta = a.unsafeWorldForDebug().treasuryMilli[CONTENT.scenario.ruler], tb = b.unsafeWorldForDebug().treasuryMilli[CONTENT.scenario.ruler];
  assert.ok(tb - ta >= F.treaty.tributeMilli - 5000, `accepting costs about the tribute (${tb - ta})`);
});

test("during the truce the court's reading is settle, whatever the forts say", () => {
  const hawk = variant((r) => {
    const f = r.scenario.frontier!;
    f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: "settle", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 0 } };
    f.delayDays = { ambassador: [2, 2], commander: [2, 2], merchant: [2, 2] };
    f.treaty = { ...f.treaty, cooldownDays: 10, openDays: 30, truceDays: 40 };
  });
  const log = play(hawk, 2, 100, answerOnce("accept")).log, signed = ofType(log, "TreatySigned")[0];
  assert.ok(signed, "signed");
  const inside = ofType(log, "FrontierReview").filter((e) => e.tick > signed.tick && e.tick < signed.tick + 40 * DAY);
  assert.ok(inside.length >= 5);
  assert.ok(inside.every((e) => e.payload.stance === "settle"), "settle throughout");
  const after = ofType(log, "FrontierReview").filter((e) => e.tick >= signed.tick + 40 * DAY);
  assert.ok(after.some((e) => e.payload.stance !== "settle"), "and the court turns again when it ends");
});

test("refusing: the court reads the March weaker for a while", () => {
  const log = play(peace, 2, 100, answerOnce("refuse")).log, r = ofType(log, "TreatyRefused")[0];
  assert.ok(r, "refused");
  assert.equal(ofType(log, "TreatySigned").length, 0);
  const base = new Map(ofType(play(peace, 2, 100, () => []).log, "FrontierReview").map((e) => [e.tick, e.payload.weakness as number]));
  const until = r.tick + F.treaty.refuseDays * DAY, rv = ofType(log, "FrontierReview");
  const within = rv.filter((e) => e.tick > r.tick && e.tick < until && base.has(e.tick)), after = rv.filter((e) => e.tick >= until && base.has(e.tick));
  assert.ok(within.length >= 5 && after.length >= 3);
  for (const e of within) assert.equal(e.payload.weakness as number, Math.min(1000, base.get(e.tick)! + F.treaty.refusePermille), "refusePermille more than the same day without the refusal");
  for (const e of after) assert.equal(e.payload.weakness as number, base.get(e.tick)!, "and nothing more once it ends");
});

test("an answer to an offer that does not exist, or has lapsed, does nothing", () => {
  const none = play(peace, 2, 30, (log) => (ofType(log, "TreatyProposed").length ? [] : [{ action: "treaty", target: "accept", to: "999999" }])).log;
  assert.equal(ofType(none, "TreatyAnswered").length, 0);
  const late = (() => { let done = false; return (log: readonly SimEvent[], tick: number): PlayerAction[] => {
    const o = ofType(log, "TreatyProposed")[0];
    if (!o || done || tick < o.tick + (F.treaty.openDays + 1) * DAY) return [];
    done = true; return [{ action: "treaty", target: "accept", to: String(o.id) }];
  }; })();
  const lapsed = play(peace, 2, 100, late).log;
  assert.equal(ofType(lapsed, "TreatyAnswered").filter((e) => e.payload.offer === ofType(lapsed, "TreatyProposed")[0].id).length, 0);
});

test("the same seed and the same answers give the same log; ablating the frontier removes the offer, the answer and the trade", () => {
  const a = play(peace, 3, 60, answerOnce("accept")).log, b = play(peace, 3, 60, answerOnce("accept")).log;
  assert.deepEqual(a.map((e) => e.id + e.type), b.map((e) => e.id + e.type));
  const off = createSim({ content: peace, seed: 3, policy: "delegating", ablate: ["frontier"] }); off.runDays(60);
  for (const t of ["TreatyProposed", "TreatyAnswered", "TreatySigned", "TreatyRefused", "FrontierTrade"]) assert.equal(ofType(off.log, t).length, 0, t);
  for (const seed of [1, 2]) assert.deepEqual(checkPairing(run({ seed, content: peace }, 90).log, run({ seed, content: peace, ablate: ["frontier"] }, 90).log, "frontier"), [], `seed ${seed}`);
});

// ---- the endings it makes readable --------------------------------------------------------------------------------------------------
let n = 0;
const ev = (tick: number, type: string, causedBy: number[] = [], payload: Record<string, unknown> = {}): SimEvent => ({
  schemaVersion: 3, id: ++n, tick, type, domain: EVENT_TYPES[type].domain, significance: EVENT_TYPES[type].significance, causedBy, subjects: [], payload,
});
const SETTLE = CONTENT.scenario.endings.settlementDays;

test("negotiated settlement: a treaty signed and no strike for settlementDays", () => {
  n = 0;
  const signed = ev(50 * DAY, "TreatySigned", [], { tributeMilli: 1, truceUntil: 170 * DAY });
  const r = readEnding([ev(0, "ScenarioStarted"), signed], CONTENT, 50 * DAY + SETTLE * DAY);
  assert.equal(r.type, "negotiated_settlement");
  assert.equal(r.tick, 50 * DAY + SETTLE * DAY);
  assert.equal(r.trigger, signed.id);
  assert.equal(r.reachable.negotiated_settlement, true);
  assert.equal(readEnding([ev(0, "ScenarioStarted"), signed], CONTENT, 50 * DAY + SETTLE * DAY - DAY).type, "unresolved", "not before it has held");
  n = 0;
  const s2 = ev(50 * DAY, "TreatySigned"), strike = ev(60 * DAY, "FrontierStrike", [], { site: F.site });
  assert.equal(readEnding([s2, strike], CONTENT, 240 * DAY).type, "unresolved", "a strike inside the hold breaks it");
});

test("military victory: hosts at the gate ended by the March's arms; a host that goes home is not a victory", () => {
  n = 0;
  const b = ev(10 * DAY, "ThreatBegan", [], { site: F.site });
  const home = ev(20 * DAY, "ThreatEnded", [b.id], { site: F.site });
  assert.equal(readEnding([b, home], CONTENT, 240 * DAY).type, "unresolved");
  n = 0;
  const b2 = ev(10 * DAY, "ThreatBegan", [], { site: F.site }), won = ev(15 * DAY, "ThreatEnded", [b2.id], { site: F.site, endedBy: "sortie" });
  const r = readEnding([b2, won], CONTENT, 240 * DAY);
  assert.equal(r.type, "military_victory");
  assert.equal(r.trigger, won.id);
  n = 0;
  const other = ev(15 * DAY, "ThreatEnded", [], { site: CONTENT.scenario.threat.sites[0].site, endedBy: "sortie" });
  assert.equal(readEnding([other], CONTENT, 240 * DAY).type, "unresolved", "only the gate's host");
});

// ---- the merchant -----------------------------------------------------------------------------------------------------------------
const market = variant((r) => {
  const f = r.scenario.frontier!;
  f.court = { ...f.court, startStance: "trade", thresholds: { tradeFrom: 0, pressFrom: 2000, strikeFrom: 2000 } };
  f.trade = { ...f.trade, everyDays: 10 };
});

test("on trade the merchant brings grain to the March, and the ledger counts it", () => {
  const sim = run({ seed: 2, content: market }, 90), trades = ofType(sim.log, "FrontierTrade");
  assert.ok(trades.length >= 5);
  for (const t of trades) {
    const p = t.payload as { sacks: number; to: string };
    assert.equal(p.to, F.trade.dest);
    assert.ok(p.sacks >= F.trade.sacks[0] && p.sacks <= F.trade.sacks[1]);
  }
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.grainLedger[F.trade.dest].imported, trades.reduce((n, t) => n + (t.payload.sacks as number), 0));
});

test("no grain while the court presses or strikes, or while a host stands at the gate", () => {
  const press = variant((r) => { const f = r.scenario.frontier!; f.court = { ...f.court, startStance: "press", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 2000 } }; f.trade = { ...f.trade, everyDays: 10 }; });
  assert.equal(ofType(run({ seed: 2, content: press }, 90).log, "FrontierTrade").length, 0);
  const log = run({ seed: 4, content: market }, 200).log;
  const hosts: [number, number][] = []; let from = -1;
  for (const e of log) { if (e.type === "ThreatBegan" && e.payload.site === F.site) from = e.tick; else if (e.type === "ThreatEnded" && e.payload.site === F.site && from >= 0) { hosts.push([from, e.tick]); from = -1; } }
  for (const t of ofType(log, "FrontierTrade")) assert.ok(!hosts.some(([a, b]) => t.tick > a && t.tick < b), "never in a host's season");
});
