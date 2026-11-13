// Phase 11 (docs/EXPLORATION.md, D-073): the Blackwood creature and its rumours, expeditions and who leads them, reputation and
// the emergence of Stefan, and the Stone of Vey: actual against believed, custody, provenance. Spec from the plan and backlog
// P0.15/P0.16: Stefan can emerge through recommendation and performance in some seeds and not others; the artefact can end a
// run outside Anna's possession and its provenance is reconstructable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { EVENT_TYPES } from "../src/events.ts";
import { DAY } from "../src/systems/types.ts";
import { provenance } from "../src/systems/exploration.ts";
import { CONTENT, LEGACY, variant } from "./helpers.ts";

const B = CONTENT.scenario.wilds!;
type Ev = { id: number; tick: number; type: string; causedBy: number[]; payload: Record<string, any> };
const ofType = (sim: Sim, t: string) => sim.log.filter((e) => e.type === t) as Ev[];
const byId = (sim: Sim) => new Map(sim.log.map((e) => [e.id, e as Ev]));
const descends = (sim: Sim, e: Ev, type: string) => {
  const m = byId(sim), seen = new Set<number>(), stack = [...e.causedBy];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); const x = m.get(id); if (!x) continue; if (x.type === type) return true; stack.push(...x.causedBy); }
  return false;
};

/** Anna sends Caron to Blackwood on day 2, delegated, with the kind of expedition chosen; nothing else happens to disturb it. */
function sent(seed: number, edit: (b: typeof B) => void = () => {}, kind: "scholarly" | "military" = "scholarly", days = 60, extra: (r: any) => void = () => {}) {
  const c = variant((r) => {
    edit(r.scenario.wilds!);
    r.scenario.scripts = [{ day: 2, kind: "order", from: "anna", to: "caron", intent: "investigate", objective: { kind: "location", id: "blackwood" }, discretion: "delegated", constraints: [{ kind: "expedition", textKey: kind }] }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = []; r.scenario.threat.startPermillePerDay = 0;
    extra(r);
  });
  const sim = createSim({ content: c, seed, policy: "passive" });
  sim.runDays(days);
  return sim;
}
/** Content that makes the search certain to find the hollow and the Stone, and the creature absent unless asked. */
const lucky = (b: typeof B) => { b.expedition.hollowPermille = 1000; b.expedition.signsPermille = 1000; b.stone.foundPermillePerDay = 1000; b.expedition.encounterPermille = 0; };
const only = (id: string) => (r: any) => { for (const c of r.characters) c.relationships = c.relationships.filter((x: any) => x.kind !== "recommends" || x.to === id); };

test("content: the Blackwood block is validated and a scenario without it has no hunts", () => {
  assert.ok(B.range.coldmere > 0);
  assert.throws(() => variant((r) => { r.scenario.wilds!.expedition.encounter.military.killed += 1; }), /sum to 1000/);
  const sim = createSim({ content: LEGACY, seed: 1, policy: "passive" }); sim.runDays(60);
  assert.ok(!sim.log.some((e) => EVENT_TYPES[e.type].system === "exploration"));
});

test("the creature: hunts on its own schedule in its range, the place loses stock at once, and the tale is told round about", () => {
  const sim = createSim({ content: CONTENT, seed: 3, policy: "passive" }); sim.runDays(120);
  const hunts = ofType(sim, "CreatureHunt");
  assert.ok(hunts.length >= 4, `hunts ${hunts.length}`);
  for (const h of hunts) { assert.ok(h.payload.place in B.range, "only in its range"); assert.equal(h.causedBy.length, 0, "a clock-driven step"); }
  for (let i = 1; i < hunts.length; i++) { const gap = (hunts[i].tick - hunts[i - 1].tick) / DAY; assert.ok(gap >= B.creature.intervalDays[0] - 1 && gap <= B.creature.intervalDays[1] + 1, `gap ${gap}`); }
  const heard = ofType(sim, "CommunityHeard").filter((e) => e.payload.type === "CreatureHunt" && e.causedBy[0] === hunts[0].id);
  const here = heard.find((e) => e.payload.community === hunts[0].payload.place);
  if (here) assert.ok(here.payload.material < 0, "the place loses stock");
  const w = sim.unsafeWorldForDebug();
  assert.equal(w.bw!.kills, hunts.reduce((n, h) => n + h.payload.livestock, 0));
});

test("rumour: officials near enough hear it late and not as it was; the size differs from hearer to hearer and seed to seed; Anna reads it in a letter", () => {
  const levels = new Set<number>();
  let letters = 0;
  for (const seed of [1, 2, 3, 4]) {
    const sim = createSim({ content: CONTENT, seed, policy: "passive" }); sim.runDays(100);
    const heard = ofType(sim, "BeliefUpdated").filter((e) => e.payload.prop.predicate === "site.rumour");
    assert.ok(heard.length >= 1, `seed ${seed}: someone hears`);
    for (const e of heard) { levels.add(e.payload.prop.believedValue); assert.ok(["uncertain", "doubtful"].includes(e.payload.prop.reliabilityBand), "never better than a rumour"); assert.ok(descends(sim, e, "CreatureHunt") || e.causedBy.length > 0); }
    letters += ofType(sim, "ReportComposed").filter((e) => e.payload.report.claims.some((c: any) => c.predicate === "site.rumour")).length;
  }
  assert.ok(levels.size >= 3, "exaggeration varies");
  assert.ok(letters >= 1, "a routine letter carries the talk to Anna");
});

test("expedition: Caron picks a leader, who goes, searches over days, and reports what he found as a letter", () => {
  const sim = sent(1, lucky, "scholarly", 40, only("stefan"));
  const ap = ofType(sim, "LeaderAppointed")[0];
  assert.equal(ap.payload.by, "caron"); assert.ok(ap.payload.candidates.length >= 1, "the weights are recorded");
  const st = ofType(sim, "ExpeditionStarted")[0], en = ofType(sim, "ExpeditionEnded")[0];
  assert.equal(st.payload.leader, ap.payload.leader); assert.equal(st.payload.kind, "scholarly");
  const days = ofType(sim, "SiteSearched");
  assert.ok(days.length >= 1 && days.length <= B.expedition.searchDays);
  assert.ok(en.tick > st.tick && descends(sim, en, "ExpeditionStarted"));
  assert.equal(en.payload.outcome, "completed"); assert.ok(en.payload.signs && en.payload.hollow && en.payload.stone);
  const letter = ofType(sim, "ReportComposed").find((e) => e.payload.report.author === ap.payload.leader && e.payload.report.claims.some((c: any) => c.predicate === "stone.found"))!;
  assert.ok(letter, "his letter says he found the Stone");
  const preds = new Set(letter.payload.report.claims.map((c: any) => c.predicate));
  for (const p of ["site.signs", "creature.nature", "stone.found", "stone.properties"]) assert.ok(preds.has(p), p);
  assert.deepEqual(checkRun(sim), []);
});

test("leader choice: a weighted draw among the candidates the delegate knows, fitted to the kind of expedition; the weights are in the event", () => {
  const led = (kind: "scholarly" | "military") => { const m: Record<string, number> = {}; for (let seed = 1; seed <= 24; seed++) { const a = ofType(sent(seed, (b) => { b.expedition.searchDays = 1; }, kind, 12), "LeaderAppointed")[0]; if (a) m[a.payload.leader] = (m[a.payload.leader] ?? 0) + 1; } return m; };
  const sch = led("scholarly"), mil = led("military");
  assert.ok((sch.stefan ?? 0) > (mil.stefan ?? 0), `Stefan suits scholars: ${JSON.stringify(sch)} against ${JSON.stringify(mil)}`);
  assert.ok((mil.tobin ?? 0) > (sch.tobin ?? 0), `Tobin suits soldiers: ${JSON.stringify(mil)} against ${JSON.stringify(sch)}`);
  assert.ok(Object.keys(sch).length >= 2 && Object.keys(mil).length >= 2, "not always the same man");
  const ap = ofType(sent(2, () => {}, "scholarly", 12), "LeaderAppointed")[0];
  for (const c of ap.payload.candidates) assert.ok(c.w >= 1 && typeof c.id === "string");
});

test("meeting the creature: it is killed, the party flees, is mauled, or the leader falls; each has its consequence", () => {
  const force = (o: "killed" | "fled" | "mauled" | "fell") => (b: typeof B) => { b.expedition.encounterPermille = 1000; b.expedition.skillShift = 0; for (const k of ["scholarly", "military"] as const) b.expedition.encounter[k] = { killed: 0, fled: 0, mauled: 0, fell: 0, [o]: 1000 }; };
  const killed = sent(1, force("killed"), "military", 40);
  assert.equal(ofType(killed, "CreatureEncountered")[0].payload.outcome, "killed");
  assert.equal(killed.unsafeWorldForDebug().bw!.alive, false);
  const lastHunt = ofType(killed, "CreatureHunt").pop()?.tick ?? 0, kill = ofType(killed, "CreatureEncountered")[0].tick;
  assert.ok(lastHunt <= kill, "a dead creature hunts no more");
  assert.ok(ofType(killed, "ReputationChanged")[0].payload.why.includes("killed"));
  const fled = sent(1, force("fled"), "scholarly", 40), fe = ofType(fled, "ExpeditionEnded")[0];
  assert.equal(fe.payload.outcome, "fled"); assert.ok(ofType(fled, "ReputationChanged")[0].payload.delta < 0);
  assert.ok(ofType(fled, "OrderAbandoned").length >= 1);
  assert.equal(ofType(sent(1, force("mauled"), "scholarly", 40), "ExpeditionEnded")[0].payload.outcome, "mauled");
  const fell = sent(1, (b) => { force("fell")(b); lucky(b); b.expedition.encounterPermille = 1000; }, "scholarly", 40);
  const lf = ofType(fell, "LeaderFell")[0], leader = lf.payload.leader;
  assert.ok(lf && fell.unsafeWorldForDebug().bw!.dead[leader], "the leader fell");
  assert.ok(ofType(fell, "OrderAbandoned").some((e) => e.causedBy.includes(lf.id)));
  assert.ok(!ofType(fell, "Departed").some((e) => e.payload.who === leader && e.tick > lf.tick), "he does not ride home");
});

test("a leader who fell is not chosen again; one who carried the Stone drops it where he lay", () => {
  const edit = (b: typeof B) => { lucky(b); b.expedition.encounterPermille = 500; b.expedition.skillShift = 0; b.expedition.searchDays = 4; for (const k of ["scholarly", "military"] as const) b.expedition.encounter[k] = { killed: 0, fled: 0, mauled: 0, fell: 1000 }; };
  const again = (r: any) => { r.scenario.scripts.push({ day: 40, kind: "order", from: "anna", to: "caron", intent: "investigate", objective: { kind: "location", id: "blackwood" }, discretion: "delegated", constraints: [{ kind: "expedition", textKey: "scholarly" }] }); };
  let lost: Sim | null = null;
  for (let seed = 1; seed <= 40 && !lost; seed++) { const sim = sent(seed, edit, "scholarly", 70, again); if (ofType(sim, "StoneLost").length) lost = sim; }
  assert.ok(lost, "on some seed he finds the Stone and then falls");
  const lf = ofType(lost!, "LeaderFell")[0], sl = ofType(lost!, "StoneLost")[0];
  assert.ok(sl.causedBy.includes(lf.id) && sl.payload.from === lf.payload.leader && sl.payload.at === B.site);
  const w = lost!.unsafeWorldForDebug().bw!;
  assert.ok(w.dead[lf.payload.leader]);
  const second = ofType(lost!, "LeaderAppointed").filter((e) => e.tick > 30 * DAY);
  for (const a of second) assert.notEqual(a.payload.leader, lf.payload.leader, "the fallen are not chosen");
  assert.ok(provenance(lost!.log).some((p) => p.type === "StoneLost"));
});

test("reputation: performance moves it by the content's table; crossing the line is an emergence, and one who has emerged keeps his place and is a candidate for anyone", () => {
  const sim = sent(1, (b) => { lucky(b); b.reputation.activeAt = 300; }, "scholarly", 60, only("stefan"));
  const re = ofType(sim, "ReputationChanged")[0];
  assert.equal(re.payload.who, "stefan");
  const R = B.reputation;
  assert.equal(re.payload.delta, R.signs + R.hollow + R.stone + R.survived);
  const em = ofType(sim, "CharacterEmerged")[0];
  assert.ok(em && em.causedBy.includes(re.id) && em.payload.reputation >= 300);
  assert.equal(sim.unsafeWorldForDebug().tiers.stefan, "A", "he keeps his place");
  assert.ok(!ofType(sim, "CharacterDemoted").some((e) => e.payload.who === "stefan"));
});

test("Stefan emerges through recommendation and performance in some seeds and not in others, and every emergence can be traced", () => {
  let emerged = 0, led = 0, n = 0;
  for (let seed = 1; seed <= 14; seed++) {
    const sim = createSim({ content: CONTENT, seed, policy: "delegating" }); sim.runDays(200); n++;
    if (ofType(sim, "ExpeditionStarted").some((e) => e.payload.leader === "stefan")) led++;
    for (const e of ofType(sim, "CharacterEmerged").filter((x) => x.payload.who === "stefan")) {
      emerged++;
      assert.ok(descends(sim, e, "ReputationChanged") && descends(sim, e, "ExpeditionEnded") && descends(sim, e, "ExpeditionStarted"), "performance");
      assert.ok(ofType(sim, "LeaderAppointed").some((a) => a.payload.leader === "stefan" && a.payload.recommendedBy === "bren"), "recommendation");
    }
  }
  assert.ok(led >= 5, `Stefan led in ${led} of ${n}`);
  assert.ok(emerged >= 1 && emerged < led, `emerged in ${emerged} of ${n} games (led in ${led})`);
});

test("the Stone: found and carried by the leader, handed on or kept by each holder with the reasons recorded, and its provenance reads back from the log", () => {
  const hand = (b: typeof B) => { lucky(b); b.custody.keepBase = 0; b.custody.keepTrait = 0; b.custody.keepOtherHouse = 0; b.custody.believedWorth = 0; };
  const sim = sent(1, hand, "scholarly", 90, only("stefan"));
  const prov = provenance(sim.log);
  assert.deepEqual(prov.slice(0, 2).map((p) => p.type), ["StoneFound", "StoneTaken"]);
  const kinds = prov.map((p) => p.type);
  assert.ok(kinds.includes("StoneDelivered"), kinds.join(","));
  // nothing held it but the leader, then each one it was handed to, in order
  let holder: string | null = null;
  for (const p of prov) {
    if (p.type === "StoneTaken") holder = p.payload.holder as string;
    else if (p.type === "StoneSent") assert.equal(p.payload.holder, holder);
    else if (p.type === "StoneDelivered") { assert.ok(p.payload.from === holder || holder === p.payload.from); holder = p.payload.to as string; }
    else if (p.type === "StoneKept") assert.equal(p.payload.holder, holder);
    assert.ok(p.causedBy.length >= 1, `${p.type} has a cause`);
  }
  const w = sim.unsafeWorldForDebug().bw!.stone;
  assert.equal(w.holder, holder);
  assert.ok(w.status === "held" || w.status === "transit");
  const decisions = ofType(sim, "StoneDelivered").concat(ofType(sim, "StoneSent"));
  for (const d of decisions) assert.ok(Array.isArray(d.payload.reasons));
});

test("the Stone reaching the crown: what it is worth is learned only by examining it, and the people trust the crown by that, not by the legend", () => {
  const hand = (b: typeof B) => { lucky(b); b.custody.keepBase = 0; b.custody.keepTrait = 0; b.custody.keepOtherHouse = 0; b.custody.believedWorth = 0; };
  let got: Sim | null = null;
  for (const seed of [1, 2, 3, 4, 5, 6]) { const s = sent(seed, hand, "scholarly", 120, only("stefan")); if (ofType(s, "StoneDelivered").some((e) => e.payload.to === "anna")) { got = s; break; } }
  assert.ok(got, "it reaches Anna on some seed when every holder is faithful");
  const del = ofType(got!, "StoneDelivered").find((e) => e.payload.to === "anna")!;
  const exam = ofType(got!, "StoneExamined")[0];
  assert.ok(exam && exam.causedBy.includes(del.id) && exam.tick - del.tick === B.stone.examineDays * DAY);
  assert.equal(exam.payload.actual, B.stone.actualLegitimacy); assert.notEqual(exam.payload.actual, exam.payload.believed);
  const beliefs = Object.values(got!.unsafeWorldForDebug().beliefs.anna).filter((b: any) => b.predicate === "stone.properties") as any[];
  assert.ok(beliefs.some((b) => b.believedValue === B.stone.actualLegitimacy && b.reliabilityBand === "certain"));
  const heard = ofType(got!, "CommunityHeard").filter((e) => e.payload.type === "StoneDelivered");
  assert.ok(heard.length >= 1 && heard.every((e) => e.payload.trust.some((t: any) => t[0] === "crown" && t[1] === Math.floor((B.stone.trustPerLegitimacy * B.stone.actualLegitimacy) / 1000))));
});

test("the artefact can end a run outside Anna's possession: kept, or lost where the leader fell, and the log still says how", () => {
  const keep = (b: typeof B) => { lucky(b); b.custody.deliverLoyalty = 0; b.custody.deliverTrait = 0; };
  const sim = sent(1, keep, "scholarly", 90, only("stefan"));
  const w = sim.unsafeWorldForDebug().bw!.stone;
  assert.equal(w.status, "held"); assert.notEqual(w.holder, "anna");
  const kept = ofType(sim, "StoneKept")[0];
  assert.ok(kept && kept.payload.reasons.length >= 3 && kept.payload.keep > kept.payload.deliver);
  assert.ok(!ofType(sim, "StoneDelivered").some((e) => e.payload.to === "anna"));
  const p = provenance(sim.log);
  assert.equal(p[p.length - 1].type, "StoneKept");
});

test("ablation: with exploration off nothing of the wood happens and nothing is drawn", () => {
  const sim = createSim({ content: CONTENT, seed: 5, policy: "delegating", ablate: ["exploration"] }); sim.runDays(120);
  assert.ok(!sim.log.some((e) => EVENT_TYPES[e.type].system === "exploration"));
  assert.ok(!sim.streamsCreated().some((s) => s === "exploration" || s.startsWith("exploration:") || s.startsWith("orders:leader")));
});

test("G-02: extra exploration draws move the creature and change nothing about the economy", () => {
  for (const seed of [1, 2, 3]) {
    const a = createSim({ content: CONTENT, seed, policy: "passive" }), b = createSim({ content: CONTENT, seed, policy: "passive", params: { extraDraws: { exploration: 3 } } });
    a.runDays(80); b.runDays(80);
    const hunts = (s: Sim) => JSON.stringify(ofType(s, "CreatureHunt").map((e) => [e.tick, e.payload.place]));
    assert.notEqual(hunts(a), hunts(b), "the switch is live");
    const eco = (s: Sim) => JSON.stringify(ofType(s, "TreasuryCollected").map((e) => [e.tick, e.payload.amountMilli + (e.payload.withheldMilli ?? 0)]));
    assert.equal(eco(a), eco(b));
  }
});

test("exploration: invariants hold under the three scripted policies, and runs repeat exactly", () => {
  for (const policy of ["passive", "delegating", "aggressive"] as const) {
    const a = createSim({ content: CONTENT, seed: 7, policy }), b = createSim({ content: CONTENT, seed: 7, policy });
    a.runDays(200); b.runDays(200);
    assert.deepEqual(checkRun(a), [], policy);
    assert.equal(JSON.stringify(a.log), JSON.stringify(b.log), `${policy}: the same run twice`);
    assert.deepEqual(a.unsafeWorldForDebug(), a.projectFromLog(), `${policy}: the world is the log's projection`);
  }
});
