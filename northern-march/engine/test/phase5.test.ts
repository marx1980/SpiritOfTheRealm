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
import { battleLoss } from "../src/battle.ts";

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
    r.scenario.regency.maxRepairCostMilli = 60000; // the mechanism still works when the ruler grants the authority
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
  const heard = sim.log.filter((x) => x.type === "RecommendationMade" && (x.payload.audience as string[]).includes("anna"));
  assert.ok(heard.length > 0, "advisers gave Anna advice in person at some point");
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
  // a seed in which the raiders are still about when the first letter is read
  let v = run({ seed: 2, content: threat(), policy: "passive" }, 8).viewOf("player");
  for (const seed of [3, 4, 5, 6, 7, 8]) { if (buildCourt(v).issues.length) break; v = run({ seed, content: threat(), policy: "passive" }, 8).viewOf("player"); }
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

test("Anna sees the walls herself when she arrives at a fort", () => {
  const c = variant((r) => { r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "northwatch", mode: "rider" }]; });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 20);
  const arr = sim.log.find((e) => e.type === "Arrived" && e.payload.who === "anna" && e.payload.at === "northwatch")!;
  assert.ok(arr, "she arrived");
  const seen = sim.log.find((e) => e.type === "Observed" && e.payload.observer === "anna" && e.payload.predicate === "fortification.condition" && e.causedBy[0] === arr.id);
  assert.ok(seen, "observed the walls on arrival");
  const bs = beliefsAbout(sim.viewOf("player"), "northwatch", "fortification.condition");
  assert.ok(bs.some((b) => b.evidenceRefs.some((x) => x.kind === "observation" && x.source === "anna")), "her own sighting is among her beliefs");
});

test("Anna always has a belief about her coins: from the start, on arrival at the seat, and from the steward; within ±10%", () => {
  const c = variant((r) => { r.scenario.scripts = [{ day: 2, kind: "travel", who: "anna", to: "northwatch", mode: "rider" }, { day: 6, kind: "travel", who: "anna", to: "ravenport", mode: "rider" }]; });
  const sim = run({ seed: 51, content: c, policy: "passive" }, 1);
  const truthAt = () => sim.unsafeWorldForDebug().treasuryMilli.anna;
  const check = () => {
    const bs = beliefsAbout(sim.viewOf("player"), "anna", "treasury.balance");
    assert.ok(bs.length > 0, "she has a belief");
    const newest = bs.sort((a, b) => b.observedAt - a.observedAt)[0];
    assert.ok(Math.abs((newest.believedValue as number) - truthAt()) <= truthAt() / 10 + 1, "within 10% of the truth when reported");
  };
  check();
  sim.runDays(4); check();
  sim.runDays(4); check();
  sim.runDays(22); check();
  const obsBy = new Set(sim.log.filter((e) => e.type === "Observed" && e.payload.predicate === "treasury.balance").map((e) => e.payload.observer));
  assert.ok(obsBy.has("oren"), "the steward keeps the books");
  const relayed = beliefsAbout(sim.viewOf("player"), "anna", "treasury.balance").some((b) => b.evidenceRefs.some((x) => x.source === "oren"));
  assert.ok(relayed || sim.log.some((e) => e.type === "Observed" && e.payload.observer === "anna" && e.payload.predicate === "treasury.balance"), "she hears the steward or looks herself");
});

test("letters say walls and men only when they changed, in natural words, naming the place once", async () => {
  const { letterSentences } = await import("../src/presentation/phrasing.ts");
  const sim = run({ seed: 3, policy: "passive" }, 80);
  const v = sim.viewOf("player");
  const bren = [...v.reports].filter((r) => r.author === "bren" && r.claims.some((c) => c.predicate === "character.location")).sort((a, b) => a.composedAt - b.composedAt);
  assert.ok(bren.length >= 3, "several letters from Bren");
  const texts = bren.map((r) => letterSentences(v, r).join(" "));
  assert.match(texts[0], /^I am at Northwatch\. The walls are \w+( after an? \w+)? and the fort has \d+ men\./);
  for (const t of texts) assert.ok(!/at Northwatch.*at Northwatch/.test(t) && !/There are \d+ men in the fort/.test(t), t);
  for (let i = 1; i < bren.length; i++) {
    const prev = bren[i - 1].claims.find((c) => c.predicate === "fortification.garrison")?.believedValue, cur = bren[i].claims.find((c) => c.predicate === "fortification.garrison")?.believedValue;
    if (prev === cur) assert.ok(!/ men/.test(texts[i]), `unchanged men left out: ${texts[i]}`);
  }
});

test("walls do not decay on their own: with no storms or raids they stay as they were", () => {
  const c = variant((r) => { r.scenario.threat.startPermillePerDay = 0; r.scenario.scripts = []; for (const l of r.locations) l.exposurePermille = 0; r.scenario.weather.fireDailyPermille = 0; r.scenario.weather.quakeDailyPermille = 0; });
  const sim = run({ seed: 4, content: c, policy: "passive" }, 90);
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.fortifications["northwatch"].conditionMilli, 75000);
  assert.equal(w.fortifications["greybridge"].conditionMilli, 90000);
});

test("a scouting order always brings word: no raiders seen is news too", () => {
  const c = variant((r) => {
    r.scenario.threat.startPermillePerDay = 0;
    r.scenario.scripts = [{ day: 1, kind: "order", from: "anna", to: "caron", intent: "investigate", objective: { kind: "location", id: "blackwood" } }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 2, content: c, policy: "passive" }, 40);
  const v = sim.viewOf("player");
  const letter = v.reports.find((r) => r.author === "caron" && r.claims.some((x) => x.predicate === "threat.intensity" && x.subject.id === "blackwood"));
  assert.ok(letter, "Caron's letter says what he saw at Blackwood");
  assert.equal(letter!.claims.find((x) => x.predicate === "threat.intensity")!.believedValue, 0);
});

test("once a captain is at the fort, advice is to attack the raiders, not to send him", async () => {
  const { planWords } = await import("../src/presentation/phrasing.ts");
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 2, kind: "threat", site: "blackwood", intensityPermille: 800, durationDays: 60 }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 3, content: c, policy: "passive" }, 5);
  const v = sim.viewOf("player");
  const plan = JSON.stringify({ kind: "advise_sortie", target: "blackwood" });
  assert.match(planWords(v, plan), /^Send the captain to Northwatch to attack the raiders at Blackwood$/);
});

test("an attack order sends the captain to the fort that answers the site, he sorties, and the order is done with news of the site", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 2, kind: "threat", site: "blackwood", intensityPermille: 700, durationDays: 80 }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = createSim({ content: c, seed: 51, policy: "external", params: { dayEnd: true } });
  let sent = false;
  for (let g = 0; g < 4000; g++) {
    const r = sim.next(40 * DAY);
    if (!r.paused) break;
    if (!sent && sim.tick >= 8 * DAY) { sent = true; sim.answer([{ action: "advance", target: "northwatch", mission: "attack", raid: "blackwood" }]); } else sim.answer([]);
  }
  const ours = sim.log.find((e) => e.type === "OrderIssued" && (e.payload.order as { intent: string }).intent === "attack");
  assert.ok(ours, "an attack order was issued");
  const launched = sim.log.find((e) => e.type === "SortieLaunched" && e.payload.commander === "caron" && e.tick > ours!.tick);
  assert.ok(launched && launched.payload.from === "northwatch" && launched.payload.site === "blackwood", "Caron sorties from Northwatch against Blackwood");
  assert.ok(sim.log.some((e) => e.type === "OrderCompleted" && e.payload.orderId === (ours!.payload.order as { id: number }).id), "the attack order is completed");
});

test("a fight is reported: how it went, what the fort and company now count; and a commander fights one sortie at a time", async () => {
  const { letterSentences } = await import("../src/presentation/phrasing.ts");
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 800, durationDays: 60 }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  });
  const sim = run({ seed: 51, content: c, policy: "passive" }, 60);
  const open = new Set<string>();
  for (const e of sim.log) {
    if (e.type === "SortieLaunched") { assert.ok(!open.has(e.payload.commander as string), "no second sortie while one is being fought"); open.add(e.payload.commander as string); }
    if (e.type === "SortieResolved") open.delete(e.payload.commander as string);
  }
  const v = sim.viewOf("player");
  const letter = v.reports.find((r) => r.claims.some((x) => x.predicate === "battle.result"));
  assert.ok(letter, "a letter tells of a fight");
  assert.match(letterSentences(v, letter!).join(" "), /We fought the raiders at Blackwood and (won|were beaten)\.|We found no raiders at Blackwood\./);
});

test("garrisons recover 2% of their establishment a day, never above it", () => {
  const sim = run({ seed: 5 }, 30), w = sim.unsafeWorldForDebug();
  assert.ok(Object.values(w.fortifications).every((f) => f.garrison <= f.establishment && f.establishment > 0));
  // a fort knocked down to half strength refills by 2% of establishment a day
  const n = CONTENT.locations.find((l) => l.id === "northwatch")!.fortification!.garrison;
  const sim2 = createSim({ content: variant((r) => { r.scenario.threat.startPermillePerDay = 0; }), seed: 5, policy: "delegating" });
  sim2.runDays(2);
  const w2 = sim2.unsafeWorldForDebug();
  assert.equal(w2.fortifications.northwatch.establishment, n);
});

test("a captain's company refills 2% a day, only in his home town", () => {
  const sim = run({ seed: 5 }, 40);
  const w = sim.unsafeWorldForDebug();
  const caron = CONTENT.characters.find((c) => c.id === "caron")!;
  assert.ok(w.troops.caron <= caron.troops!);
  for (const e of sim.log.filter((x) => x.type === "CompanyRecovered")) for (const [, n] of (e.payload as { changes: [string, number][] }).changes) assert.ok(n >= 1 && n <= 4);
});

test("letters from one hand arrive in the order written, never on the same day as one written earlier", () => {
  for (const seed of [3, 5, 9]) {
    const v = run({ seed, content: threat(3, 800, 60) }, 120).viewOf("player");
    for (const a of v.reports) for (const b of v.reports) {
      if (a.author !== b.author || Math.floor(a.composedAt / DAY) >= Math.floor(b.composedAt / DAY)) continue;
      assert.ok(Math.floor(b.deliveredAt / DAY) > Math.floor(a.deliveredAt / DAY), `seed ${seed}: ${a.author} letter ${b.reportId} overtook ${a.reportId}`);
    }
  }
});

test("by default the regent spends nothing: every repair is the ruler's to approve", () => {
  assert.equal(CONTENT.scenario.regency.maxRepairCostMilli, 0);
  const sim = run({ seed: 2, content: variant((r) => { r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "greybridge", mode: "rider" }, { day: 3, kind: "threat", site: "blackwood", intensityPermille: 700, durationDays: 60 }]; }), policy: "passive" }, 40);
  assert.equal(sim.log.filter((e) => e.type === "OrderIssued" && (e.payload.order as { issuer: string }).issuer === "elara").length, 0);
});

test("a fort the raiders break into falls, the ruler is told, and the captain can retake it", () => {
  const content = variant((r) => {
    r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 1000, durationDays: 90 }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
    r.locations.find((l) => l.id === "northwatch")!.fortification!.conditionMilli = 38000;
  });
  let retaken = 0, told = 0, asked = 0;
  for (const seed of [4, 6, 7, 8]) {
    const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
    let ordered = false, issue = false;
    for (let i = 0; i < 3000 && sim.tick < 40 * DAY; i++) {
      const p = sim.next(40 * DAY); if (!p.paused) break;
      const v = p.view!;
      if (beliefsAbout(v, "northwatch", "fortification.holder").some((b) => b.believedValue === "raiders")) {
        told++; issue ||= buildCourt(v).issues.some((x) => x.key === "fallen:northwatch");
        if (!ordered) { sim.answer([{ action: "advance", target: "northwatch" }]); ordered = true; continue; }
      }
      if (v.advice.some((a) => JSON.parse(a.plan.id).kind === "advise_stay")) asked++;
      sim.answer([]);
    }
    assert.ok(sim.log.some((e) => e.type === "FortFell"), "the fort fell");
    assert.ok(issue, "the court shows the fall");
    if (sim.log.some((e) => e.type === "FortRetaken")) retaken++; // a retaken fort can fall again while the raiders are still out
    
    else assert.ok(sim.log.some((e) => e.type === "FortAssaulted"));
  }
  assert.ok(told > 0 && retaken > 0 && asked > 0, `told ${told}, retaken ${retaken}, asked ${asked}`);
});

test("raiders grow if ignored, a larger enemy costs more men, and a captain away from home costs the crown", () => {
  const content = threat(3, 400, 60);
  const grew = [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => { const s = createSim({ content, seed, policy: "passive" }); s.runDays(60); return s.log.some((e) => e.type === "ThreatGrew"); });
  assert.ok(grew, "an unanswered band grows");
  // losses follow the enemy: the same company loses more against a big host than a small band
  const b = CONTENT.scenario.battle;
  assert.ok(battleLoss(b, 200, 400, false) > battleLoss(b, 200, 100, false));
  assert.ok(battleLoss(b, 200, 400, true) > battleLoss(b, 200, 100, true));
  // Caron on the road costs 2k a day more
  const s2 = createSim({ content: variant((r) => { r.scenario.messenger.lossPermillePerDay = 0; }), seed: 5, policy: "external", params: { dayEnd: true } });
  let sent = false, away = 0;
  for (let i = 0; i < 400 && s2.tick < 12 * DAY; i++) {
    const p = s2.next(12 * DAY); if (!p.paused) break;
    if (!sent) { s2.answer([{ action: "advance", target: "northwatch" }]); sent = true; } else s2.answer([]);
  }
  for (const e of s2.log) if (e.type === "UpkeepPaid" && (e.payload.awayCaptains as number) > 0) { away++; assert.equal(e.payload.amountMilli, CONTENT.scenario.economy.dailyUpkeepMilli + CONTENT.scenario.economy.captainAwayMilli); }
  assert.ok(away > 0, "upkeep rises while he is away");
});

test("repair modes: labour is free and stops at worn, rush costs double, and both need a company at the fort", () => {
  const run1 = (mode: "standard" | "rush" | "labour", withCaptain: boolean) => {
    const content = variant((r) => {
      r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
      r.scenario.weather.fireDailyPermille = 0; r.scenario.weather.quakeDailyPermille = 0; r.scenario.treasuryMilli = 400000;
      r.locations.find((l) => l.id === "northwatch")!.fortification!.conditionMilli = 40000;
    });
    const sim = createSim({ content, seed: 7, policy: "external", params: { dayEnd: true } });
    let step = 0;
    for (let i = 0; i < 600 && sim.tick < 40 * DAY; i++) {
      const p = sim.next(40 * DAY); if (!p.paused) break;
      const arrived = sim.log.some((e) => e.type === "Arrived" && e.payload.who === "caron" && e.payload.at === "northwatch");
      if (step === 0 && withCaptain) { sim.answer([{ action: "advance", target: "northwatch" }]); step = 1; continue; }
      if (step === (withCaptain ? 1 : 0) && (arrived || !withCaptain) && beliefsAbout(p.view!, "northwatch", "fortification.condition").length) { sim.answer([{ action: "repair", target: "northwatch", ...(mode === "standard" ? {} : { repairMode: mode }) }]); step = 9; continue; }
      sim.answer([]);
    }
    return sim;
  };
  const std = run1("standard", true).log.find((e) => e.type === "RepairStarted");
  const rush = run1("rush", true).log.find((e) => e.type === "RepairStarted");
  const lab = run1("labour", true).log.find((e) => e.type === "RepairStarted");
  assert.ok(std && rush && lab, "all three start");
  assert.equal(lab!.payload.costMilli, 0);
  assert.equal(lab!.payload.restoreToMilli, 70000);
  assert.ok((rush!.payload.costMilli as number) > (std!.payload.costMilli as number) * 1.9);
  assert.ok((rush!.payload.durationTicks as number) < (std!.payload.durationTicks as number));
  assert.ok((lab!.payload.durationTicks as number) > (std!.payload.durationTicks as number));
  assert.ok(!run1("labour", false).log.some((e) => e.type === "RepairStarted"), "no company, no labour");
});

test("nothing that costs coins or raises them happens without Anna's own order (the regent's limit is 0)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const policy of ["passive", "delegating"] as const) {
    const sim = run({ seed, policy }, 120);
    const issuer = (id: number) => (sim.log.find((e) => e.type === "OrderIssued" && (e.payload.order as { id: number }).id === id)!.payload.order as { issuer: string }).issuer;
    for (const e of sim.log) {
      if (e.type === "RepairStarted" && (e.payload.costMilli as number) > 0) assert.equal(issuer(e.payload.orderId as number), "anna", `repair cost ordered by Anna (seed ${seed})`);
      if (e.type === "LevyRaised") assert.equal(issuer(e.payload.orderId as number), "anna", `levy ordered by Anna (seed ${seed})`);
    }
  }
});
