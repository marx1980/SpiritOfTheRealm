// Phase 14B stage 3 (docs/CONTENT.md, D-086): rebellion and food must pull on decisions, or the scripted player never answers them.
// The people's petitions (relief, protection) reach the ruler as letters; the delegating and aggressive policies answer them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_TYPES, readAttention, readEnding } from "../src/endings.ts";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { CONTENT, run } from "./helpers.ts";

const DAY = 86400;
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);

/** The first delivery, to the ruler, of a letter holding a petition of this kind. */
function petition(log: readonly SimEvent[], what: string) {
  const comp = new Map(ofType(log, "ReportComposed").map((e) => [(e.payload.report as { id: number }).id, e.payload.report as { claims: { predicate: string; subject: { id: string }; believedValue: unknown }[] }]));
  for (const e of ofType(log, "ReportDelivered")) {
    const c = comp.get(e.payload.reportId as number)?.claims.find((x) => x.predicate === "community.request" && x.believedValue === what);
    if (c) return { at: e, community: c.subject.id };
  }
  return null;
}

test("a petition for relief is answered by a relief order, at the hour the letter arrives and caused by it", () => {
  for (const policy of ["delegating", "aggressive"] as const) {
    let log: readonly SimEvent[] = [], p = null as ReturnType<typeof petition>;
    for (const seed of [2, 3, 4, 6, 7, 9]) { log = run({ seed, policy }, 120).log; p = petition(log, "relief"); if (p) break; }
    assert.ok(p, "a petition");
    const input = log.find((e) => e.type === "PlayerInput" && e.payload.action === "relief" && e.tick === p!.at.tick);
    assert.ok(input, `${policy}: relief at once`);
    assert.equal(input!.payload.target, p!.community);
    assert.ok(input!.causedBy.includes(p!.at.id));
  }
});

test("a petition for protection sends the captain to the fort that answers the place", () => {
  const log = run({ seed: 2, policy: "delegating" }, 120).log, p = petition(log, "protection");
  assert.ok(p, "a petition");
  assert.ok(log.some((e) => e.type === "PlayerInput" && e.payload.action === "advance" && e.tick === p!.at.tick && e.causedBy.includes(p!.at.id)));
});

test("the same petition is not answered twice in a month, and the passive policy answers none", () => {
  const log = run({ seed: 2, policy: "delegating" }, 200).log;
  const reliefs = ofType(log, "PlayerInput").filter((e) => e.payload.action === "relief");
  for (const a of reliefs) for (const b of reliefs) if (a !== b && a.payload.target === b.payload.target && b.tick > a.tick) assert.ok(b.tick - a.tick >= 30 * DAY, "a month between");
  assert.equal(ofType(run({ seed: 2, policy: "passive" }, 200).log, "PlayerInput").length, 0);
});

test("so rebellion now draws attention from the policies that answer, and none from the one that does not", () => {
  let rebel = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) rebel += readAttention(run({ seed, policy: "delegating" }, 240).log, CONTENT).shares.rebellion;
  assert.ok(rebel > 0.3, `rebellion share summed over six games: ${rebel}`);
  assert.equal(readAttention(run({ seed: 2, policy: "passive" }, 240).log, CONTENT).counted, 0);
});

test("an agent's decision counts as a decision in an ending's ancestry", () => {
  assert.ok(DECISION_TYPES.includes("DecisionMade"));
  assert.ok(EVENT_TYPES.DecisionMade);
  const ev = (id: number, type: string, causedBy: number[], payload: Record<string, unknown> = {}): SimEvent => ({ schemaVersion: 3, id, tick: id * DAY, type, domain: EVENT_TYPES[type].domain, significance: EVENT_TYPES[type].significance, causedBy, subjects: [], payload });
  const site = CONTENT.scenario.frontier!.site, log = [ev(1, "ThreatBegan", [], { site }), ev(2, "DecisionMade", [1]), ev(3, "ThreatEnded", [2], { site, endedBy: "sortie" })];
  const r = readEnding(log, CONTENT, 240 * DAY);
  assert.equal(r.type, "military_victory");
  assert.equal(r.firstCause, "decision");
});

test("the aggressive ruler rides to a fort under a strong raid, and a death there follows from her riding", () => {
  const log = run({ seed: 18, policy: "aggressive" }, 240).log, ruler = CONTENT.scenario.ruler;
  const ride = ofType(log, "PlayerInput").find((e) => e.payload.action === "travel");
  assert.ok(ride, "she rides out");
  const end = ofType(log, "CampaignEnded")[0];
  assert.ok(end && end.payload.ending === "killed", "and is killed at the fort");
  const arrival = log.find((e) => e.type === "Arrived" && e.payload.who === ruler && end.causedBy.includes(e.id));
  assert.ok(arrival, "the death cites her arrival");
  assert.equal(readEnding(log, CONTENT).type, "death");
  assert.equal(readEnding(log, CONTENT).firstCause, "decision");
  assert.equal(ofType(run({ seed: 18, policy: "delegating" }, 240).log, "PlayerInput").filter((e) => e.payload.action === "travel").length, 0, "the delegating policy stays at her seat");
});
