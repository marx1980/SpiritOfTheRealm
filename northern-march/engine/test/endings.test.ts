// Phase 14A (docs/CONTENT.md): the six endings and the five pressures, read from the event log. Spec: plan Phase 14, backlog P0.24, gates G-07, G-08, G-09.
// The reading changes nothing. Constructed logs pin each rule; real runs pin the invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_TYPES, ENDING_TYPES, PRESSURES, SYSTEM_PRESSURE, readAttention, readEnding } from "../src/endings.ts";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { hashLog } from "../src/engine.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const DAY = 86400;
const E = CONTENT.scenario.endings;
const [F1, F2, F3] = CONTENT.scenario.objective.forts;
const [C1, C2, C3] = CONTENT.communities.communities.map((c) => c.id);
let n = 0;
const ev = (tick: number, type: string, causedBy: number[] = [], payload: Record<string, unknown> = {}): SimEvent => ({
  schemaVersion: 3, id: ++n, tick, type, domain: EVENT_TYPES[type].domain, significance: EVENT_TYPES[type].significance, causedBy, subjects: [], payload,
});
const stance = (day: number, community: string, to: string, supports?: string, cause: number[] = []) => ev(day * DAY, "CommunityStanceChanged", cause, { community, to, ...(supports ? { supports } : {}) });
const fresh = () => { n = 0; };

test("the registries only name event types and systems that exist", () => {
  for (const t of DECISION_TYPES) assert.ok(EVENT_TYPES[t], `${t} is not an event type`);
  const systems = new Set(Object.values(EVENT_TYPES).map((d) => d.system));
  for (const s of Object.keys(SYSTEM_PRESSURE)) assert.ok(systems.has(s as never), `${s} is not a system`);
  for (const p of Object.values(SYSTEM_PRESSURE)) assert.ok((PRESSURES as readonly string[]).includes(p));
  assert.equal(ENDING_TYPES.length, 6);
  assert.equal(PRESSURES.length, 5);
});

test("nothing happened: unresolved, and the two endings the world cannot reach yet say so", () => {
  fresh();
  const r = readEnding([ev(0, "ScenarioStarted", [])], CONTENT);
  assert.equal(r.type, "unresolved");
  assert.equal(r.tick, null);
  assert.equal(r.firstCause, null);
  assert.equal(r.reachable.military_victory, false);
  assert.equal(r.reachable.negotiated_settlement, false);
  assert.equal(r.reachable.death, true);
});

test("death and capture are the campaign's own endings", () => {
  for (const [how, want] of [["killed", "death"], ["captured", "capture_deposition"]] as const) {
    fresh();
    const raid = ev(5 * DAY, "ThreatBegan");
    const end = ev(9 * DAY, "CampaignEnded", [raid.id], { ending: how, where: F1 });
    const r = readEnding([raid, end], CONTENT);
    assert.equal(r.type, want);
    assert.equal(r.tick, 9 * DAY);
    assert.equal(r.trigger, end.id);
  }
});

test("territorial failure: enough objective forts held by raiders at once", () => {
  fresh();
  const a = ev(10 * DAY, "FortFell", [], { fort: F1, site: "x" }), b = ev(20 * DAY, "FortFell", [a.id], { fort: F2, site: "x" });
  const r = readEnding([a, b], CONTENT);
  assert.equal(r.type, "territorial_authority_failure");
  assert.equal(r.trigger, b.id);
  assert.equal(r.tick, 20 * DAY);
});

test("a retaken fort no longer counts, and a place that is not an objective never does", () => {
  fresh();
  const a = ev(10 * DAY, "FortFell", [], { fort: F1, site: "x" }), back = ev(15 * DAY, "FortRetaken", [a.id], { fort: F1 });
  const b = ev(20 * DAY, "FortFell", [], { fort: F2, site: "x" }), other = ev(21 * DAY, "FortFell", [], { fort: "somewhere-else", site: "x" });
  assert.equal(readEnding([a, back, b, other], CONTENT).type, "unresolved");
  assert.equal(E.lostForts <= CONTENT.scenario.objective.forts.length, true);
});

test("coalition fracture: enough communities supporting the same actor for the whole period", () => {
  fresh();
  const a = stance(10, C1, "support", "actorA"), b = stance(12, C2, "support", "actorA");
  const filler = ev((12 + E.fractureDays + 1) * DAY, "Storm");
  const r = readEnding([a, b, filler], CONTENT);
  assert.equal(r.type, "coalition_fracture");
  assert.equal(r.trigger, b.id);
  assert.equal(r.tick, (12 + E.fractureDays) * DAY);
});

test("coalition fracture needs the same actor and an unbroken hold", () => {
  fresh();
  const split = [stance(10, C1, "support", "actorA"), stance(12, C2, "support", "actorB"), ev(60 * DAY, "Storm")];
  assert.equal(readEnding(split, CONTENT).type, "unresolved");
  fresh();
  const broken = [stance(10, C1, "support", "actorA"), stance(12, C2, "support", "actorA"), stance(12 + E.fractureDays - 1, C2, "petition"), ev(60 * DAY, "Storm")];
  assert.equal(readEnding(broken, CONTENT).type, "unresolved");
  fresh();
  const short = [stance(10, C1, "support", "actorA"), stance(12, C2, "support", "actorA")];
  assert.equal(readEnding(short, CONTENT).type, "unresolved", "a log that ends before the hold is over has not shown a fracture");
  void C3;
});

test("the first ending counts, and nothing after the horizon does", () => {
  fresh();
  const a = ev(10 * DAY, "FortFell", [], { fort: F1, site: "x" }), b = ev(20 * DAY, "FortFell", [], { fort: F2, site: "x" });
  const end = ev(30 * DAY, "CampaignEnded", [], { ending: "killed", where: F3 });
  assert.equal(readEnding([a, b, end], CONTENT).type, "territorial_authority_failure");
  fresh();
  const late = ev((E.horizonDays + 5) * DAY, "CampaignEnded", [], { ending: "killed", where: F3 });
  assert.equal(readEnding([late], CONTENT).type, "unresolved");
});

test("first cause: a decision anywhere in the ancestry, else exogenous", () => {
  fresh();
  const storm = ev(DAY, "Storm"), fell = ev(5 * DAY, "FortFell", [storm.id], { fort: F1, site: "x" }), fell2 = ev(6 * DAY, "FortFell", [fell.id], { fort: F2, site: "x" });
  const r1 = readEnding([storm, fell, fell2], CONTENT);
  assert.equal(r1.firstCause, "exogenous");
  fresh();
  const input = ev(DAY, "PlayerInput", [], { action: "repair" }), storm2 = ev(2 * DAY, "Storm", []);
  const fa = ev(5 * DAY, "FortFell", [input.id], { fort: F1, site: "x" }), fb = ev(6 * DAY, "FortFell", [storm2.id, fa.id], { fort: F2, site: "x" });
  const r2 = readEnding([input, storm2, fa, fb], CONTENT);
  assert.equal(r2.firstCause, "decision");
});

test("ancestry domains: every domain the trigger's causes passed through", () => {
  fresh();
  const storm = ev(DAY, "Storm"); // environment
  const rep = ev(2 * DAY, "ReportComposed", [storm.id]); // info
  const fell = ev(5 * DAY, "FortFell", [rep.id], { fort: F1, site: "x" }); // military
  const fell2 = ev(6 * DAY, "FortFell", [fell.id], { fort: F2, site: "x" });
  const stray = ev(7 * DAY, "UpkeepPaid"); // not an ancestor: economic must not appear
  const r = readEnding([storm, rep, fell, fell2, stray], CONTENT);
  assert.deepEqual([...r.ancestryDomains].sort(), ["environment", "info", "military"]);
});

test("attention: each input goes to the pressures of the roots it came from, split equally", () => {
  fresh();
  const storm = ev(DAY, "Storm"), threat = ev(2 * DAY, "ThreatBegan"), weather = ev(3 * DAY, "UpkeepPaid");
  const a = ev(4 * DAY, "PlayerInput", [storm.id], { action: "repair" }); // environment only
  const b = ev(5 * DAY, "PlayerInput", [storm.id, threat.id], { action: "repair" }); // environment and wilds, half each
  const c = ev(6 * DAY, "PlayerInput", [], { action: "ask" }); // routine
  const d = ev(7 * DAY, "PlayerInput", [weather.id], { action: "levy" }); // food and security (economy)
  const at = readAttention([storm, threat, weather, a, b, c, d], CONTENT);
  assert.equal(at.counted, 3);
  assert.equal(at.routine, 1);
  assert.ok(Math.abs(at.shares.environment - 1.5 / 3) < 1e-9, String(at.shares.environment));
  assert.ok(Math.abs(at.shares.wilds - 0.5 / 3) < 1e-9);
  assert.ok(Math.abs(at.shares.food_security - 1 / 3) < 1e-9);
  assert.equal(at.shares.frontier, 0);
  assert.equal(at.shares.rebellion, 0);
  assert.equal(at.dominant, "environment");
  assert.equal(at.runnerUp, "food_security");
});

test("attention: the nearest crisis on the chain counts, not the first cause of everything", () => {
  fresh();
  const threat = ev(DAY, "ThreatBegan"); // wilds, but far back
  const st = ev(2 * DAY, "CommunityStanceChanged", [threat.id], { community: C1, to: "refuse" }); // rebellion, nearer
  const rep = ev(3 * DAY, "ReportDelivered", [st.id]); // belongs to no pressure
  const inp = ev(4 * DAY, "PlayerInput", [rep.id], { action: "relief" });
  const at = readAttention([threat, st, rep, inp], CONTENT);
  assert.equal(at.shares.rebellion, 1);
  assert.equal(at.shares.wilds, 0);
});

test("attention: a raid from the frontier's gate is the frontier's pressure, not the wilds'", () => {
  fresh();
  const gate = CONTENT.scenario.frontier!.site;
  const began = ev(DAY, "ThreatBegan", [], { site: gate, target: F1 }), raid = ev(2 * DAY, "RaidDamage", [began.id], { site: gate, location: F1 });
  const inp = ev(3 * DAY, "PlayerInput", [raid.id], { action: "advance" });
  const at = readAttention([began, raid, inp], CONTENT);
  assert.equal(at.shares.frontier, 1);
  assert.equal(at.shares.wilds, 0);
});

test("attention: nothing counted means no dominant crisis; a tie goes to the earlier pressure in the list", () => {
  fresh();
  const none = readAttention([ev(0, "ScenarioStarted"), ev(DAY, "PlayerInput", [], { action: "ask" })], CONTENT);
  assert.equal(none.dominant, null);
  assert.equal(none.runnerUp, null);
  fresh();
  const s = ev(DAY, "Storm"), t = ev(DAY, "ThreatBegan");
  const tie = readAttention([s, t, ev(2 * DAY, "PlayerInput", [s.id]), ev(2 * DAY, "PlayerInput", [t.id])], CONTENT);
  assert.equal(tie.dominant, PRESSURES.find((p) => p === "wilds" || p === "environment"));
});

test("attention: the busiest 30 days of each pressure are recorded", () => {
  fresh();
  const s = ev(DAY, "Storm");
  const inputs = [3, 100, 101, 102, 130].map((d) => ev(d * DAY, "PlayerInput", [s.id], { action: "repair" }));
  const at = readAttention([s, ...inputs], CONTENT);
  assert.equal(at.peakDay.environment, 100);
  assert.equal(at.peakDay.rebellion, null);
});

test("real runs: the readings change nothing, repeat exactly and are well formed", () => {
  for (const [seed, policy] of [[1, "delegating"], [2, "aggressive"], [3, "passive"]] as const) {
    const sim = run({ seed, policy }, 120);
    const h = hashLog(sim.log);
    const a = readEnding(sim.log, CONTENT), b = readEnding(sim.log, CONTENT), x = readAttention(sim.log, CONTENT), y = readAttention(sim.log, CONTENT);
    assert.equal(hashLog(sim.log), h);
    assert.deepEqual(a, b);
    assert.deepEqual(x, y);
    assert.ok(a.type === "unresolved" || (ENDING_TYPES as readonly string[]).includes(a.type));
    if (a.type !== "unresolved") assert.ok(a.trigger !== null && a.tick !== null && a.firstCause !== null);
    const total = Object.values(x.shares).reduce((s, v) => s + v, 0);
    assert.ok(x.counted === 0 ? total === 0 : Math.abs(total - 1) < 1e-9, `shares sum to ${total}`);
  }
});

test("the endings settings are checked: whole numbers, and no more forts than the objective has", () => {
  assert.throws(() => variant((r) => { r.scenario.endings.lostForts = 0; }), /endings/);
  assert.throws(() => variant((r) => { r.scenario.endings.lostForts = r.scenario.objective.forts.length + 1; }), /endings|objective forts/);
  assert.throws(() => variant((r) => { r.scenario.endings.horizonDays = 2.5; }), /endings/);
});
