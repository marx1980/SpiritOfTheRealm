// Phase 14B stage 1 (docs/FRONTIER.md): the court of the frontier, its four actors, instructions that arrive late and can disagree,
// and a host that marches. Spec: backlog P0.17 "Arvenese actors act on different, delayed instructions and can contradict each other".
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPairing } from "../src/invariants.ts";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { hashLog } from "../src/engine.ts";
import { stanceFor, weaknessOf } from "../src/systems/frontier.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const DAY = 86400;
const F = CONTENT.scenario.frontier!;
const sys = (log: readonly SimEvent[], s: string) => log.filter((e) => EVENT_TYPES[e.type].system === s);
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);
const byId = (log: readonly SimEvent[]) => new Map(log.map((e) => [e.id, e]));

/** The court reviews every five days, steps at once, is told in two days (the ambassador in thirty), and the commander never declines. */
const fast = variant((r) => {
  const f = r.scenario.frontier!;
  f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: "settle", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 0 } };
  f.delayDays = { ambassador: [30, 30], commander: [2, 2], merchant: [2, 2] };
  f.strike = { ...f.strike, declinePermille: 0, cooldownDays: 20 };
});

test("the frontier is in the content, with its actors, places and four stances", () => {
  assert.ok(F);
  for (const id of Object.values(F.actors)) assert.ok(CONTENT.byId.character.get(id), id);
  for (const id of [F.site, F.market, F.target]) assert.ok(CONTENT.byId.location.get(id), id);
  assert.ok(CONTENT.raidSites.some((x) => x.site === F.site && x.target === F.target), "the host's site is a raid site");
  assert.ok(!CONTENT.scenario.threat.sites.some((x) => x.site === F.site), "but it is not among the sites the old threat stream draws for");
});

test("without the block nothing of it runs", () => {
  const none = variant((r) => { delete (r.scenario as { frontier?: unknown }).frontier; });
  const sim = run({ seed: 3, content: none }, 120);
  assert.equal(sys(sim.log, "frontier").length, 0);
  assert.ok(!sim.streamsCreated().some((s) => s.startsWith("frontier")));
});

test("the same seed gives the same log", () => {
  assert.equal(hashLog(run({ seed: 5 }, 120).log), hashLog(run({ seed: 5 }, 120).log));
});

test("ablating the frontier emits nothing and draws nothing; the arms agree until it first acts", () => {
  const off = run({ seed: 7, ablate: ["frontier"] }, 120);
  assert.equal(sys(off.log, "frontier").length, 0);
  assert.ok(!off.streamsCreated().some((s) => s === "frontier" || s.startsWith("frontier:")));
  for (const seed of [1, 2, 3]) assert.deepEqual(checkPairing(run({ seed }, 120).log, run({ seed, ablate: ["frontier"] }, 120).log, "frontier"), [], `seed ${seed}`);
});

test("the court reviews, and every new stance goes to the three it instructs, each with its own delay", () => {
  const sim = run({ seed: 2, content: fast }, 60), log = sim.log, ids = byId(log);
  const reviews = ofType(log, "FrontierReview");
  assert.ok(reviews.length >= 8, "a review every five days");
  assert.ok(reviews.every((e) => e.causedBy.length === 0), "a review is a clock, a root");
  const ins = ofType(log, "FrontierInstruction");
  assert.ok(ins.length >= 3);
  for (const i of ins) {
    assert.equal(ids.get(i.causedBy[0])!.type, "FrontierReview");
    const p = i.payload as { actor: string; stance: string; arrivesAt: number };
    assert.ok(["ambassador", "commander", "merchant"].includes(p.actor));
    assert.equal(p.arrivesAt - i.tick, (fast.scenario.frontier!.delayDays as Record<string, [number, number]>)[p.actor][0] * DAY);
  }
  for (const a of ofType(log, "FrontierInstructionArrived")) {
    const i = ids.get(a.causedBy[0])!;
    assert.equal(i.type, "FrontierInstruction");
    assert.equal(a.tick, (i.payload as { arrivesAt: number }).arrivesAt);
  }
});

test("a stance moves one step at a time and is held for at least holdDays", () => {
  const c = { ...F.court, holdDays: 10, thresholds: { tradeFrom: 100, pressFrom: 300, strikeFrom: 500 } };
  assert.equal(stanceFor(900, "settle", 0, 100 * DAY, c), "trade", "one step toward strike, not a leap");
  assert.equal(stanceFor(900, "trade", 95 * DAY, 100 * DAY, c), "trade", "held");
  assert.equal(stanceFor(900, "trade", 80 * DAY, 100 * DAY, c), "press");
  assert.equal(stanceFor(50, "press", 0, 100 * DAY, c), "trade", "and one step back");
  assert.equal(stanceFor(320, "press", 0, 100 * DAY, c), "press");
});

test("weakness follows the forts: ruined ones and a fallen one raise it, repaired ones calm it", () => {
  const forts = (cond: number[]) => cond.map((c) => ({ conditionMilli: c, fallen: false }));
  assert.ok(weaknessOf(forts([90000, 90000, 90000]), 0) < weaknessOf(forts([90000, 40000, 90000]), 0));
  assert.ok(weaknessOf(forts([90000, 40000, 90000]), 0) < weaknessOf([...forts([90000, 90000]), { conditionMilli: 90000, fallen: true }], 300));
  assert.equal(weaknessOf(forts([0, 0, 0]), 400), 1000, "never above 1000");
  assert.equal(weaknessOf(forts([100000]), -50), 0, "never below 0");
});

test("different delays make the actors disagree, and the disagreement is recorded, caused by the arrival that made it", () => {
  const sim = run({ seed: 4, content: fast }, 60), log = sim.log, ids = byId(log);
  const clashes = ofType(log, "FrontierContradiction");
  assert.ok(clashes.length >= 1, "the commander is on a hostile stance while the ambassador still holds a peaceful one");
  const first = clashes[0], arrival = ids.get(first.causedBy[0])!;
  assert.equal(arrival.type, "FrontierInstructionArrived");
  const p = first.payload as { ambassador: string; commander: string };
  assert.ok(["settle", "trade"].includes(p.ambassador));
  assert.ok(["press", "strike"].includes(p.commander));
});

test("a commander on strike marches: the host appears at the gate, against the target fort, and raids it", () => {
  const sim = run({ seed: 4, content: fast }, 90), log = sim.log, ids = byId(log);
  const strike = ofType(log, "FrontierStrike")[0];
  assert.ok(strike, "a strike");
  assert.equal(ids.get(strike.causedBy[0])!.type, "FrontierInstructionArrived");
  const began = log.find((e) => e.type === "ThreatBegan" && e.payload.site === F.site);
  assert.ok(began, "the host's threat begins at the gate");
  assert.equal(began.payload.target, F.target);
  assert.ok(began.causedBy.includes(strike.id));
  assert.ok(log.some((e) => e.type === "RaidDamage" && e.payload.site === F.site && e.payload.location === F.target), "and it batters the target");
});

test("the host never comes by chance: with the court at peace there is no threat at the gate", () => {
  const calm = variant((r) => { const f = r.scenario.frontier!; f.court = { ...f.court, startStance: "settle", thresholds: { tradeFrom: 2000, pressFrom: 2000, strikeFrom: 2000 } }; });
  for (const seed of [1, 2]) assert.ok(!run({ seed, content: calm }, 200).log.some((e) => e.type === "ThreatBegan" && e.payload.site === F.site));
});

test("a commander may decline, with his reasons", () => {
  const timid = variant((r) => {
    const f = r.scenario.frontier!;
    f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: "settle", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 0 } };
    f.delayDays = { ambassador: [30, 30], commander: [2, 2], merchant: [2, 2] };
    f.strike = { ...f.strike, declinePermille: 1000, traitShift: {} };
  });
  const log = run({ seed: 4, content: timid }, 60).log;
  const d = ofType(log, "FrontierDeclined")[0];
  assert.ok(d, "he declines");
  assert.ok(Array.isArray((d.payload as { reasons: unknown[] }).reasons) && (d.payload as { reasons: unknown[] }).reasons.length > 0);
  assert.equal(ofType(log, "FrontierStrike").length, 0);
});

test("the ambassador on a peaceful stance proposes terms, no more than once per cooldown", () => {
  const sim = run({ seed: 2, content: fast }, 80), ts = ofType(sim.log, "TreatyProposed");
  const calm = run({ seed: 2, content: variant((r) => { const f = r.scenario.frontier!; f.court = { ...f.court, startStance: "settle", thresholds: { tradeFrom: 2000, pressFrom: 2000, strikeFrom: 2000 } }; }) }, 200);
  const t2 = ofType(calm.log, "TreatyProposed");
  assert.ok(t2.length >= 2);
  for (let i = 1; i < t2.length; i++) assert.ok(t2[i].tick - t2[i - 1].tick >= F.treaty.cooldownDays * DAY);
  void ts;
});

test("the crown's representative writes what he saw of the commander's stance, and the letter takes time", () => {
  const log = run({ seed: 2, content: fast }, 80).log, rep = F.actors.representative;
  const ruler = CONTENT.scenario.ruler;
  const composed = log.filter((e) => e.type === "ReportComposed" && e.payload.report && (e.payload.report as { author: string }).author === rep);
  assert.ok(composed.length >= 2);
  const c = composed[0], report = c.payload.report as { id: number; claims: { predicate: string }[] };
  assert.ok(report.claims.some((x) => x.predicate === "frontier.posture"));
  const got = log.find((e) => e.type === "ReportDelivered" && e.payload.reportId === report.id);
  if (got) assert.ok(got.tick > c.tick, "a rider's time at least");
  void ruler;
});

test("the view never holds the court's side", () => {
  const sim = run({ seed: 2, content: fast }, 30);
  const text = JSON.stringify(sim.viewOf("player"));
  assert.ok(!/weakness|FrontierReview|informant/.test(text));
});
