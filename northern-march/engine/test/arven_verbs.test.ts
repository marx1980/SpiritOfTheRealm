// G-07 fix 2 (D-090): the ruler's verbs for Arven. Reinforce the border fort, send a gift to the court by its ambassador, buy the merchant's grain.
// Content `scenario.frontier.verbs` (march-0.19); without it nothing here runs and the old logs hold. Written before the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, hashLog } from "../src/engine.ts";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { deriveContent, readContentDir } from "../src/content.ts";
import { readAttention } from "../src/endings.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, CONTENT_DIR, LEGACY, run, variant } from "./helpers.ts";

const DAY = 86400;
const F = CONTENT.scenario.frontier!;
const V = F.verbs! as Required<NonNullable<typeof F.verbs>>;
const RULER = CONTENT.scenario.ruler;
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);
const codes = (edit: (r: ReturnType<typeof readContentDir>) => void) => { const raw = readContentDir(CONTENT_DIR); edit(raw); try { deriveContent(raw); return ""; } catch (e) { return String((e as Error).message); } };
const NEW = ["ReinforcementsSent", "ReinforcementsArrived", "ReinforcementsLeft", "EnvoySent", "EnvoyArrived", "MerchantGrainBought", "MerchantGrainDelivered", "FrontierActRefused"];

/** A court that reviews every five days and changes at once; the year is taken out so the stance set here holds. */
const court = (stance: "settle" | "trade" | "press" | "strike", thresholds = { tradeFrom: 2000, pressFrom: 2000, strikeFrom: 2000 }) => variant((r) => {
  delete (r.scenario as { year?: unknown }).year;
  const f = r.scenario.frontier!;
  f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: stance, thresholds };
  f.delayDays = { ambassador: [2, 2], commander: [2, 2], merchant: [2, 2] };
});

/** Play with an external hand: at each day end, `act(day)` may give orders. */
function play(content: typeof CONTENT, seed: number, days: number, act: (day: number, sim: ReturnType<typeof createSim>) => PlayerAction[], ablate: ("threat" | "frontier")[] = []) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true }, ablate });
  for (let i = 0; i < 8000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY);
    if (!p.paused) break;
    sim.answer(act(Math.floor(sim.tick / DAY), sim));
  }
  return sim;
}
/** Give `a` once, on the first day end at or after `day`. */
const onceOn = (day: number, ...a: PlayerAction[]) => { let done = false; return (d: number) => (done || d < day ? [] : ((done = true), a)); };
const treasury = (sim: ReturnType<typeof createSim>) => sim.unsafeWorldForDebug().treasuryMilli[RULER];

test("the verbs are content: validated, and their events registered with a reducer each", () => {
  assert.ok(V.reinforce && V.envoy && V.merchant);
  assert.equal(CONTENT.manifest.contentVersion, "march-0.19");
  for (const t of NEW) assert.ok(EVENT_TYPES[t], t);
  assert.equal(EVENT_TYPES.ReinforcementsSent.system, "frontier");
  assert.equal(codes(() => {}), "");
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.reinforce!.costMilli = -1; }), /verbs\.reinforce/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.reinforce!.men = 0; }), /verbs\.reinforce/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.reinforce!.delayDays = [5, 2]; }), /verbs\.reinforce/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.reinforce!.weaknessCut = 1200; }), /verbs\.reinforce/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.envoy!.days = 0; }), /verbs\.envoy/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.envoy!.giftMilli = 1.5; }), /verbs\.envoy/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.merchant!.sacks = 0; }), /verbs\.merchant/);
  assert.match(codes((r) => { r.scenario.frontier!.verbs!.merchant!.delayDays = [-1, 2]; }), /verbs\.merchant/);
  assert.match(codes((r) => { r.predicates = r.predicates.filter((p) => p.id !== "frontier.envoy"); }), /frontier\.envoy/);
  // each verb is optional on its own
  assert.equal(codes((r) => { delete (r.scenario.frontier!.verbs as { envoy?: unknown }).envoy; }), "");
});

test("reinforce: paid now, the men reach the border fort after the drawn delay, stand, and go home; the court reads the March stronger", () => {
  const c = court("trade", { tradeFrom: 0, pressFrom: 2000, strikeFrom: 2000 });
  const sim = play(c, 4, 120, onceOn(3, { action: "reinforce", target: F.target })), log = sim.log, base = play(c, 4, 120, () => []);
  const sent = ofType(log, "ReinforcementsSent")[0], arr = ofType(log, "ReinforcementsArrived")[0], left = ofType(log, "ReinforcementsLeft")[0];
  assert.ok(sent && arr && left, "sent, arrived, left");
  assert.equal(log.find((e) => e.id === sent.causedBy[0])!.type, "PlayerInput");
  assert.equal(sent.payload.costMilli, V.reinforce.costMilli);
  assert.equal(sent.payload.fort, F.target);
  const days = (arr.tick - sent.tick) / DAY;
  assert.ok(days >= V.reinforce.delayDays[0] && days <= V.reinforce.delayDays[1], `delay ${days}`);
  assert.ok(arr.causedBy.includes(sent.id) && left.causedBy.includes(arr.id));
  assert.equal(arr.payload.men, V.reinforce.men);
  assert.equal(left.tick - arr.tick, V.reinforce.stayDays * DAY);
  // the garrison is larger while they stand, and the treasury paid the cost (other spending is about the same on both sides until the men arrive)
  const mid = play(c, 4, Math.ceil(arr.tick / DAY) + 1, onceOn(3, { action: "reinforce", target: F.target }));
  const plain = play(c, 4, Math.ceil(arr.tick / DAY) + 1, () => []);
  assert.ok(mid.unsafeWorldForDebug().fortifications[F.target].garrison >= plain.unsafeWorldForDebug().fortifications[F.target].garrison + V.reinforce.men - 5);
  assert.ok(treasury(plain) - treasury(mid) >= V.reinforce.costMilli - 2000, `${treasury(plain) - treasury(mid)}`);
  // the first review while they stand reads the March weaker by the cut exactly (same informants: the frontier stream is unmoved); later ones may
  // differ for other reasons (the men change what raids do), so with the raiders ablated every review while they stand is cut, and none after
  const rev = (l: readonly SimEvent[], lo: number, hi: number) => ofType(l, "FrontierReview").filter((e) => e.tick > lo && e.tick < hi).map((e) => e.payload.weakness as number);
  const a = rev(log, arr.tick, left.tick), b = rev(base.log, arr.tick, left.tick);
  assert.ok(a.length > 0 && a.length === b.length);
  assert.equal(a[0], Math.max(0, b[0] - V.reinforce.weaknessCut));
  const qa = play(c, 4, 120, onceOn(3, { action: "reinforce", target: F.target }), ["threat"]), qb = play(c, 4, 120, () => [], ["threat"]);
  const qArr = ofType(qa.log, "ReinforcementsArrived")[0], qLeft = ofType(qa.log, "ReinforcementsLeft")[0];
  assert.deepEqual(rev(qa.log, qArr.tick, qLeft.tick), rev(qb.log, qArr.tick, qLeft.tick).map((w) => Math.max(0, w - V.reinforce.weaknessCut)));
  assert.deepEqual(rev(qa.log, qLeft.tick, 120 * DAY), rev(qb.log, qLeft.tick, 120 * DAY));
  // the court's reading uses no new draw from a shared stream (with the raiders ablated, so that no battle at the fort draws on the frontier's stream)
  assert.equal(qa.rngDraws(true).frontier, qb.rngDraws(true).frontier);
  assert.ok(sim.streamsCreated().some((s) => s.startsWith("frontier:reinforce")));
});

test("reinforce: more defenders, and less damage, against the host from the gate", () => {
  const hawk = court("strike", { tradeFrom: 0, pressFrom: 0, strikeFrom: 0 });
  const go = play(hawk, 4, 40, onceOn(1, { action: "reinforce", target: F.target })), stay = play(hawk, 4, 40, () => []);
  const arr = ofType(go.log, "ReinforcementsArrived")[0];
  assert.ok(arr);
  const first = (l: readonly SimEvent[]) => ofType(l, "RaidDamage").find((e) => e.payload.site === F.site && e.tick > arr.tick)!;
  const a = first(go.log), b = first(stay.log);
  assert.ok(a && b && a.tick === b.tick, "the same host's first blow after they arrive");
  assert.equal(a.payload.defenders, (b.payload.defenders as number) + V.reinforce.men);
  assert.ok((a.payload.damageMilli as number) < (b.payload.damageMilli as number));
});

test("envoy: the gift leaves the treasury now, takes the ambassador's road, and moves the court toward settle for a while", () => {
  const c = variant((r) => {
    delete (r.scenario as { year?: unknown }).year;
    const f = r.scenario.frontier!;
    f.court = { ...f.court, reviewDays: [5, 5], holdDays: 0, startStance: "press", thresholds: { tradeFrom: 0, pressFrom: 0, strikeFrom: 2000 } };
    f.delayDays = { ambassador: [3, 3], commander: [2, 2], merchant: [2, 2] };
    f.verbs!.envoy!.thresholdShift = 1500;
  });
  const sim = play(c, 2, 160, onceOn(2, { action: "envoy" })), log = sim.log;
  const sent = ofType(log, "EnvoySent")[0], arr = ofType(log, "EnvoyArrived")[0];
  assert.ok(sent && arr);
  assert.equal(log.find((e) => e.id === sent.causedBy[0])!.type, "PlayerInput");
  assert.equal(sent.payload.giftMilli, V.envoy.giftMilli);
  assert.equal(sent.payload.by, F.actors.ambassador);
  assert.equal(arr.tick - sent.tick, 3 * DAY, "the ambassador's road");
  assert.ok(arr.causedBy.includes(sent.id));
  // before it arrives the court presses; at the first review after, it steps toward settle; once the goodwill runs out, it presses again
  const reviews = ofType(log, "FrontierReview");
  assert.ok(reviews.filter((e) => e.tick < arr.tick).every((e) => e.payload.stance === "press"));
  const after = reviews.find((e) => e.tick > arr.tick)!;
  assert.equal(after.payload.stance, "trade");
  const until = arr.tick + V.envoy.days * DAY;
  assert.equal(reviews.filter((e) => e.tick > until).at(-1)?.payload.stance, "press");
  // the ambassador writes the ruler that the gift was received
  assert.ok(log.some((e) => e.type === "ReportComposed" && (e.payload.report as { author: string; claims: { predicate: string }[] }).author === F.actors.ambassador
    && (e.payload.report as { claims: { predicate: string }[] }).claims.some((x) => x.predicate === "frontier.envoy")));
  const none = play(c, 2, 10, () => []), one = play(c, 2, 10, onceOn(2, { action: "envoy" }));
  assert.ok(treasury(none) - treasury(one) >= V.envoy.giftMilli - 1000, `${treasury(none) - treasury(one)}`);
});

test("the merchant's grain: bought while he trades, paid now, delivered to his place after the drawn delay and counted as imported", () => {
  const c = court("trade");
  const sim = play(c, 5, 40, onceOn(3, { action: "merchant" })), log = sim.log;
  const buy = ofType(log, "MerchantGrainBought")[0], got = ofType(log, "MerchantGrainDelivered")[0];
  assert.ok(buy && got, "bought and delivered");
  assert.equal(buy.payload.sacks, V.merchant.sacks);
  assert.equal(buy.payload.costMilli, V.merchant.sacks * V.merchant.priceMilliPerSack);
  assert.equal(got.payload.to, F.trade.dest);
  const d = (got.tick - buy.tick) / DAY;
  assert.ok(d >= V.merchant.delayDays[0] && d <= V.merchant.delayDays[1]);
  const base = play(c, 5, 40, () => []);
  const imp = (s: ReturnType<typeof createSim>) => s.unsafeWorldForDebug().grainLedger[F.trade.dest].imported;
  assert.equal(imp(sim) - imp(base), V.merchant.sacks);
});

test("the merchant will not sell while the court strikes, nor the crown buy or reinforce with an empty chest: refused, nothing paid", () => {
  const hawk = court("strike", { tradeFrom: 0, pressFrom: 0, strikeFrom: 0 });
  const sim = play(hawk, 5, 20, onceOn(3, { action: "merchant" }));
  assert.equal(ofType(sim.log, "MerchantGrainBought").length, 0);
  const no = ofType(sim.log, "FrontierActRefused")[0];
  assert.ok(no);
  assert.equal(no.payload.act, "merchant");
  assert.equal(treasury(sim), treasury(play(hawk, 5, 20, () => [])));
  const poor = variant((r) => { delete (r.scenario as { year?: unknown }).year; r.scenario.frontier!.verbs!.reinforce!.costMilli = 10_000_000; });
  const p = play(poor, 5, 20, onceOn(3, { action: "reinforce", target: F.target }));
  assert.equal(ofType(p.log, "ReinforcementsSent").length, 0);
  assert.equal(ofType(p.log, "FrontierActRefused")[0]?.payload.reason, "coin");
});

test("without the verbs block nothing runs; and the logs are march-0.18's exactly (hashes of the engine before the verbs)", () => {
  const was = variant((r) => { delete (r.scenario.frontier as { verbs?: unknown }).verbs; r.predicates = r.predicates.filter((p) => p.id !== "frontier.envoy"); r.manifest.contentVersion = "march-0.18"; });
  const pinned = [["delegating", 3, "8a55179091857dd45a7a7b11887f7b28d4e68b93f7b221332244626b7e812f0c"], ["delegating", 7, "544ce945884f9b1867b379176e020baef26f8205c58536835cce035f99fbd820"],
    ["aggressive", 3, "4b4ae556d3f3584dd2d5710123b7c7331e1cb15f59c4316359cd52fd47498751"], ["aggressive", 7, "75226249accf7691c38db12fd7c5e34eaf8574ae28639f0ffde063e8aaf73dfe"]] as const;
  for (const [policy, seed, hash] of pinned) assert.equal(hashLog(run({ seed, content: was, policy }, 120).log), hash, `${policy} ${seed}`);
  // an order to a verb the content does not have does nothing
  const sim = play(was, 3, 10, onceOn(2, { action: "reinforce", target: F.target }, { action: "envoy" }, { action: "merchant" }));
  for (const t of NEW) assert.equal(ofType(sim.log, t).length, 0, t);
  // legacy content has no frontier at all
  assert.equal(LEGACY.scenario.frontier, undefined);
});

test("same seed, same log, with the policies using the verbs; and the log is its own projection", () => {
  for (const policy of ["delegating", "aggressive"] as const) {
    const a = run({ seed: 9, policy }, 200), b = run({ seed: 9, policy }, 200);
    assert.equal(hashLog(a.log), hashLog(b.log), policy);
    assert.deepEqual(a.unsafeWorldForDebug(), a.projectFromLog(), policy);
  }
});

test("the verbs take no draw from a shared stream: the same schedule with and without an act", () => {
  const c = court("trade");
  // over the delay and before anything the acts change can feed back (grain, garrison, a letter), the shared streams draw alike
  const sa = play(c, 6, 4, onceOn(1, { action: "reinforce", target: F.target }, { action: "envoy" }, { action: "merchant" })), sb = play(c, 6, 4, () => []);
  for (const t of ["ReinforcementsSent", "EnvoySent", "MerchantGrainBought"]) assert.equal(ofType(sa.log, t).length, 1, t);
  const a = sa.rngDraws(true), b = sb.rngDraws(true);
  assert.deepEqual(a, b);
  // and the verbs' own draws are keyed streams of their own
  for (const k of ["frontier:reinforce:", "frontier:envoy:", "frontier:merchant:"]) assert.ok(sa.streamsCreated().some((x) => x.startsWith(k)), k);
});

test("the policies: delegating sends gifts and men on Pell's letters, aggressive men and grain; no act is repeated before its time; delegating-core never acts", () => {
  const count = (policy: "delegating" | "aggressive" | "delegating-core", seeds: number[]) => {
    const n: Record<string, number> = { reinforce: 0, envoy: 0, merchant: 0 };
    let maxPerWindow = 0;
    for (const seed of seeds) {
      const log = run({ seed, policy }, 360).log, ins = ofType(log, "PlayerInput").filter((e) => (e.payload.action as string) in n);
      for (const e of ins) n[e.payload.action as string]++;
      // the dedupe: at most one of each verb in any 12-day window (Pell writes every 12 days)
      for (const v of Object.keys(n)) { const t = ins.filter((e) => e.payload.action === v).map((e) => e.tick); for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 12 * DAY, `${policy} ${seed} ${v} twice in ${(t[i] - t[i - 1]) / DAY} days`); maxPerWindow = Math.max(maxPerWindow, t.length); }
      // each one answers a letter of Pell's (the posture) delivered that hour
      for (const e of ins) {
        const why = log.find((x) => x.id === e.causedBy[0]);
        assert.ok(why, `${policy} ${seed}: the input has a cause`);
      }
    }
    return { n, maxPerWindow };
  };
  const d = count("delegating", [1, 2, 3, 4, 5, 6]), g = count("aggressive", [1, 2, 3, 4, 5, 6]), core = count("delegating-core", [1, 2, 3]);
  assert.ok(d.n.envoy > 0, `delegating envoys ${JSON.stringify(d.n)}`);
  assert.equal(d.n.merchant, 0);
  assert.ok(g.n.reinforce > 0 && g.n.merchant > 0, `aggressive ${JSON.stringify(g.n)}`);
  assert.equal(g.n.envoy, 0);
  assert.deepEqual(core.n, { reinforce: 0, envoy: 0, merchant: 0 });
  // a year is 360 days: no verb anywhere near once a day
  assert.ok(d.maxPerWindow <= 30 && g.maxPerWindow <= 30, `${d.maxPerWindow} ${g.maxPerWindow}`);
});

test("attention (D-088): reinforce and envoy answer the frontier; the merchant's grain answers food when she believes a store is short, else the frontier", () => {
  let n = 0;
  const ev = (tick: number, type: string, payload: Record<string, unknown> = {}): SimEvent => ({ schemaVersion: 3, id: ++n, tick, type, domain: EVENT_TYPES[type].domain, significance: EVENT_TYPES[type].significance, causedBy: [], subjects: [], payload });
  const at = readAttention([ev(DAY, "PlayerInput", { action: "reinforce", target: F.target }), ev(2 * DAY, "PlayerInput", { action: "envoy" }), ev(3 * DAY, "PlayerInput", { action: "merchant", short: false })], CONTENT);
  assert.equal(at.counted, 3);
  assert.equal(at.shares.frontier, 1);
  const food = readAttention([ev(DAY, "PlayerInput", { action: "merchant", short: true })], CONTENT);
  assert.equal(food.shares.food_security, 1);
  // and the engine marks the input from her own beliefs about the stores
  const c = court("trade"), sim = play(c, 5, 30, onceOn(3, { action: "merchant" }));
  const inp = ofType(sim.log, "PlayerInput").find((e) => e.payload.action === "merchant")!;
  assert.equal(typeof inp.payload.short, "boolean");
});
