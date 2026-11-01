// Phase 5: Court, Map and personal presence. Everything the player sees is built from ViewOf(player).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, hashLog, loadSave, TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { validateDraft, beliefsAbout } from "../src/view.ts";
import { buildCourt } from "../src/presentation/court.ts";
import { buildMap } from "../src/presentation/map.ts";
import { sha256 } from "../src/canonical.ts";
import { createHash } from "node:crypto";
import { CONTENT, run, variant } from "./helpers.ts";

const threat = (day = 3, intensity = 800, days = 60) => variant((r) => {
  r.scenario.scripts = [{ day, kind: "threat", site: "blackwood", intensityPermille: intensity, durationDays: days }];
  r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
});

test("pure-JS sha256 matches the reference", () => {
  for (const s of ["", "abc", "Northern March ✓", "x".repeat(1000)]) assert.equal(sha256(s), createHash("sha256").update(s, "utf8").digest("hex"));
});

test("interactive play pauses at decision points and replays exactly from a save", () => {
  const sim = createSim({ content: threat(), seed: 3, policy: "external", params: { checkpoints: true } });
  const reasons = new Set<string>();
  let acted = false;
  for (let i = 0; i < 400 && sim.tick < 40 * DAY; i++) {
    const p = sim.next(40 * DAY);
    if (!p.paused) break;
    reasons.add(p.reason!);
    const nw = beliefsAbout(p.view!, "northwatch", "fortification.condition")[0];
    if (!acted && nw && (nw.believedValue as number) < 70000) { sim.answer([{ action: "repair", target: "northwatch" }]); acted = true; }
    else sim.answer([]);
  }
  assert.ok(reasons.has("checkpoint") && reasons.has("report"), [...reasons].join(","));
  assert.ok(acted && sim.log.some((e) => e.type === "PlayerInput" && e.payload.action === "repair"));
  const save = sim.save();
  const back = loadSave(JSON.parse(JSON.stringify(save)), sim.content);
  assert.equal(hashLog(back.log), hashLog(sim.log));
});

test("Anna travels; letters for her are read to the council at Ravenport, then follow her", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "northwatch", mode: "rider" }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 30);
  const arr = sim.log.find((e) => e.type === "Arrived" && e.payload.who === "anna")!;
  assert.equal(arr.payload.at, "northwatch");
  const toAnna = sim.log.filter((e) => e.type === "ReportDelivered" && e.payload.recipient === "anna" && e.tick > arr.tick);
  assert.ok(toAnna.length > 0 && toAnna.every((e) => e.payload.at === "northwatch"), "delivered where she is");
  assert.ok(sim.log.some((e) => e.type === "ReportShared" && e.payload.at === "ravenport" && e.tick > arr.tick && (e.payload.hearers as string[]).includes("elara")),
    "the council at Ravenport read it before it was sent on");
});

test("the regent decides within delegated authority, and Anna learns of it only by letter", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "greybridge", mode: "rider" }, { day: 3, kind: "threat", site: "blackwood", intensityPermille: 700, durationDays: 60 }];
    r.characters.find((x) => x.id === "bren")!.location = "northwatch";
    r.locations.find((x) => x.id === "northwatch")!.fortification!.conditionMilli = 62000;
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 2, content: c, policy: "passive" }, 40);
  const regentOrders = sim.log.filter((e) => e.type === "OrderIssued" && (e.payload.order as { issuer: string }).issuer === "elara");
  assert.ok(regentOrders.length > 0, "Elara acted as regent");
  for (const e of regentOrders) {
    const o = e.payload.order as { intent: string };
    assert.ok(["repair"].includes(o.intent), `within authority: ${o.intent}`);
  }
  const first = regentOrders[0];
  const informed = sim.log.find((e) => e.type === "ReportDelivered" && e.payload.recipient === "anna" && e.tick > first.tick &&
    (sim.unsafeWorldForDebug().reports[String(e.payload.reportId)].author === "elara"));
  assert.ok(informed, "she wrote to Anna");
  assert.ok(sim.log.some((e) => e.type === "DecisionMade" && (e.payload.trace as { kind: string; agent: string }).agent === "elara" &&
    (e.payload.trace as { kind: string }).kind === "regency"));
});

test("personal danger is signalled before it can be lethal; capture or death ends the campaign", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "northwatch", mode: "rider" }, { day: 3, kind: "threat", site: "blackwood", intensityPermille: 1000, durationDays: 120 }];
    r.locations.find((x) => x.id === "northwatch")!.fortification!.conditionMilli = 55000;
    r.locations.find((x) => x.id === "northwatch")!.fortification!.garrison = 10;
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 120);
  const end = sim.log.find((e) => e.type === "CampaignEnded")!;
  assert.ok(end, "the walls fell with the queen inside");
  assert.ok(["captured", "killed"].includes(end.payload.ending as string));
  const warn = sim.log.find((e) => e.type === "DangerSignalled" && e.payload.who === "anna");
  assert.ok(warn && warn.tick < end.tick, "warned first");
  assert.equal(sim.log.at(-1)!.id, end.id, "nothing happens after the end");
});

test("the campaign objective is tracked", () => {
  const sim = run({ seed: 1, policy: "delegating" }, 240);
  const o = sim.objectiveStatus();
  assert.equal(typeof o.met, "boolean");
  assert.ok(Array.isArray(o.fortsBelowBreach));
});

test("advisers advise Anna only when they are with her", () => {
  const sim = run({ seed: 2, content: threat(), policy: "passive" }, 40);
  const v = sim.viewOf("player");
  assert.ok(v.advice.length > 0);
  for (const r of v.advice) {
    const e = sim.log.find((x) => x.type === "RecommendationMade" && (x.payload.recommendation as { id: number }).id === r.id)!;
    assert.ok((e.payload.audience as string[]).includes("anna"));
  }
});

test("orders are composed from what Anna knows, and validated", () => {
  const sim = run({ seed: 1, policy: "passive" }, 5);
  const v = sim.viewOf("player");
  const ok = validateDraft(v, { recipient: "bren", intent: "repair", objective: { kind: "location", id: "northwatch" }, discretion: "bounded",
    constraints: [{ kind: "budget_cap", textKey: "constraint.budget_cap" }], reportingPolicy: { onReceipt: true, onCompletion: true, onFailure: true } });
  assert.deepEqual(ok, []);
  assert.ok(validateDraft(v, { recipient: "stefan", intent: "repair", objective: { kind: "location", id: "northwatch" } }).length > 0, "Anna does not know Stefan");
  assert.ok(validateDraft(v, { recipient: "bren", intent: "conquer" as never, objective: { kind: "location", id: "northwatch" } }).length > 0);
  assert.ok(validateDraft(v, { recipient: "bren", intent: "repair", objective: { kind: "location", id: "atlantis" } }).length > 0);
  const live = createSim({ content: CONTENT, seed: 1, policy: "external", params: { checkpoints: true } });
  live.next(2 * DAY);
  live.answer([{ action: "order", order: { recipient: "bren", intent: "repair", objective: { kind: "location", id: "northwatch" }, discretion: "strict",
    constraints: [{ kind: "budget_cap", textKey: "constraint.budget_cap" }], reportingPolicy: { onReceipt: true, onCompletion: true, onFailure: true } } }]);
  const o = live.log.find((e) => e.type === "OrderIssued")!.payload.order as { discretion: string; constraints: unknown[]; reportingPolicy: { onReceipt: boolean } };
  assert.equal(o.discretion, "strict"); assert.equal(o.constraints.length, 1); assert.equal(o.reportingPolicy.onReceipt, true);
  assert.throws(() => { live.next(3 * DAY); live.answer([{ action: "order", order: { recipient: "stefan", intent: "repair", objective: { kind: "location", id: "northwatch" } } }]); }, /cannot order/);
});

test("Court and Map are built from the view only, and show no exact hidden numbers", () => {
  const sim = run({ seed: 2, content: threat(), policy: "passive" }, 30);
  const v = sim.viewOf("player");
  const court = buildCourt(v), map = buildMap(v);
  assert.ok(court.issues.length > 0);
  for (const i of court.issues) { assert.ok(i.title && i.priority >= 0); for (const s of i.evidence) assert.ok(s.age && s.source && s.certainty); }
  assert.ok(map.places.some((p) => p.id === "northwatch" && p.wall));
  const text = JSON.stringify({ court, map });
  assert.ok(!/\d{4,}/.test(text.replace(/"(id|tick|reportId|propId|x|y|key)":\s*-?\d+/g, "")), "no raw milli values or ticks in what is shown");
});

test("follow-the-adviser policies carry out an adviser's recommendations", () => {
  const sim = run({ seed: 2, content: threat(), policy: "follow:elara" }, 60);
  const inputs = sim.log.filter((e) => e.type === "PlayerInput");
  assert.ok(inputs.length > 0);
  for (const e of inputs) assert.equal(e.payload.followed, "elara");
});
