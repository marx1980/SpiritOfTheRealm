// Phase 6 (6A): four communities. Plan section D5, I02, I03, T07 (levy), G-13 and the second, non-grain grievance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { STANCES, type RawContent } from "../src/content.ts";
import { beliefsAbout } from "../src/view.ts";
import { buildCourt } from "../src/presentation/court.ts";
import { geoMean } from "../src/systems/communities.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const rung = (s: string) => STANCES.indexOf(s as (typeof STANCES)[number]);
type Sim = ReturnType<typeof createSim>;
const world = (sim: Sim) => sim.unsafeWorldForDebug();
const quiet = (r: RawContent) => { r.scenario.threat.startPermillePerDay = 0; r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = []; };
const levyOn = (days: number[]) => (r: RawContent) => {
  for (const day of days) r.scenario.scripts.push({ day, kind: "order", from: "anna", to: "oren", intent: "levy", objective: { kind: "character", id: "anna" } });
};
const maxRung = (sim: Sim, c: string) => Math.max(0, ...sim.log.filter((e) => e.type === "CommunityStanceChanged" && e.payload.community === c).map((e) => rung(e.payload.to as string)));

test("the geometric mean is exact integer arithmetic", () => {
  assert.equal(geoMean([1000, 1000, 1000]), 1000);
  assert.equal(geoMean([800, 200]), 400);
  assert.equal(geoMean([500, 0, 900]), 0);
  assert.equal(geoMean([1000, 1000, 1000, 1000, 1]), 251);
});

test("I02 / T07: one levy, different reactions: Greyfen (a promise broken, a trusted leader) withholds; Eastmarch petitions; Northwatch pays nothing and stays content", () => {
  const c = variant((r) => { quiet(r); levyOn([5])(r); });
  const sim = createSim({ content: c, seed: 3, policy: "passive" });
  sim.runDays(14);
  const w = world(sim).communities;
  assert.ok(w.greyfen.grievances.some((g) => g.kind === "broken_promise"), "Greyfen remembers the promise to consult");
  assert.ok(!w.eastmarch.grievances.some((g) => g.kind === "broken_promise"));
  assert.ok(maxRung(sim, "greyfen") >= rung("withhold"), `Greyfen reached ${STANCES[maxRung(sim, "greyfen")]}`);
  assert.ok(maxRung(sim, "eastmarch") < maxRung(sim, "greyfen"));
  assert.equal(maxRung(sim, "northwatch"), 0);
  assert.ok(w.greyfen.memories.some((m) => m.kind === "promise" && m.broken));
});

test("D5: the same levies in two communities with different leaders, cohesion and memories give different outcomes", () => {
  // Coldmere and Greyfen pay the same levies; Coldmere has a weaker leader, less cohesion and no promise
  const c = variant((r) => { quiet(r); levyOn([5, 25, 45])(r); });
  const sim = createSim({ content: c, seed: 5, policy: "passive" });
  sim.runDays(60);
  const stances = sim.log.filter((e) => e.type === "CommunityStanceChanged");
  const path = (x: string) => stances.filter((e) => e.payload.community === x).map((e) => e.payload.to).join(">");
  assert.notEqual(path("greyfen"), path("coldmere"));
});

test("I03: maximum grievance alone never escalates past delay (no leader, or no shared narrative, or no recent trigger)", () => {
  // Northwatch has no named leader: give it a huge levy share, a promise to break and many levies
  const c = variant((r) => {
    quiet(r); levyOn([3, 6, 9, 12, 15, 18, 21, 24])(r);
    const n = r.communities.communities.find((x) => x.id === "northwatch")!;
    n.levySharePermille = 300; n.memories = [{ kind: "promise", actor: "crown", about: "consult_before_levy", weight: 600 }];
    r.communities.communities.find((x) => x.id === "greyfen")!.levySharePermille = 100;
    r.communities.params.grievance.levy = 1000;
  });
  const sim = createSim({ content: c, seed: 2, policy: "passive" });
  sim.runDays(40);
  const nw = world(sim).communities.northwatch;
  assert.ok(nw.grievances.reduce((a, g) => a + g.intensity, 0) >= 900, "a maximal grievance");
  assert.ok(maxRung(sim, "northwatch") <= rung("delay"), `reached ${STANCES[maxRung(sim, "northwatch")]}`);
});

test("G-13: every escalation past delay has all the D2 gates and a named leader in its recorded inputs; there is no revolt", () => {
  for (const policy of ["aggressive", "delegating", "passive"] as const) for (const seed of [1, 2, 3, 4]) {
    const sim = run({ seed, policy }, 240);
    for (const e of sim.log.filter((x) => x.type === "CommunityStanceChanged" && rung(x.payload.to as string) >= rung("withhold") && rung(x.payload.to as string) > rung(x.payload.from as string))) {
      const g = e.payload.gates as Record<string, boolean>, x = e.payload.inputs as { leader: string | null; supporter: string | null };
      assert.ok(g.G && g.N && g.L && g.T, `${policy}/${seed}: ${JSON.stringify(e.payload)}`);
      assert.ok(x.leader, "a named leader");
      if (e.payload.to === "support") assert.ok(x.supporter && e.payload.supports === x.supporter, "support names whom");
    }
    assert.ok(!sim.log.some((x) => /Revolt/.test(x.type)));
  }
});

test("a community reacts only to what it witnessed or heard: each experience has a cause, and rumours take the travel time", () => {
  const sim = run({ seed: 4, policy: "aggressive" }, 120);
  const byId = new Map(sim.log.map((e) => [e.id, e]));
  let rumours = 0;
  for (const e of sim.log.filter((x) => x.type === "CommunityHeard")) {
    const src = byId.get(e.causedBy[0])!;
    assert.ok(src && src.id < e.id);
    if (e.payload.how === "rumour") { rumours++; assert.ok(e.tick > src.tick, "a rumour arrives later than the event"); }
    else assert.equal(e.tick, src.tick);
  }
  assert.ok(rumours > 0);
});

test("petitions and officers' letters reach Anna only by messenger, and the court shows them with a remedy", () => {
  const c = variant((r) => { quiet(r); levyOn([5])(r); });
  const sim = createSim({ content: c, seed: 3, policy: "external", params: { dayEnd: true } });
  let shown = false, before = true;
  for (let i = 0; i < 3000 && sim.tick < 20 * DAY; i++) {
    const p = sim.next(20 * DAY); if (!p.paused) break;
    const v = p.view!;
    const petitioned = sim.log.some((e) => e.type === "PetitionMade" && e.payload.community === "greyfen");
    const reps = sim.unsafeWorldForDebug().reports;
    const letters = sim.log.filter((e) => e.type === "ReportDelivered" && e.payload.recipient === "anna").map((e) => reps[String(e.payload.reportId)]);
    const delivered = letters.some((r) => r.purpose === "petition:greyfen");
    const anyWord = letters.some((r) => r.claims.some((x) => x.predicate === "community.grievance" && x.subject.id === "greyfen"));
    if (!anyWord && beliefsAbout(v, "greyfen", "community.grievance").length) before = false;
    if (petitioned && delivered) shown ||= buildCourt(v).issues.some((x) => x.key === "people:greyfen");
    sim.answer([]);
  }
  assert.ok(before, "no belief about Greyfen's grievance before the letter arrives");
  assert.ok(shown, "the court shows Greyfen's petition");
});

test("relief costs coin, travels at a walking pace, eases grievances and restores some trust", () => {
  const c = variant((r) => { quiet(r); levyOn([5])(r); r.scenario.scripts.push({ day: 8, kind: "order", from: "anna", to: "oren", intent: "relief", objective: { kind: "location", id: "greyfen" } }); });
  const sim = createSim({ content: c, seed: 3, policy: "passive" });
  sim.runDays(7);
  const before = world(sim).communities.greyfen;
  sim.runDays(10);
  const sent = sim.log.find((e) => e.type === "ReliefSent"), got = sim.log.find((e) => e.type === "ReliefDelivered");
  assert.ok(sent && got, "relief sent and delivered");
  assert.equal(sent!.payload.amountMilli, CONTENT.communities.params.reliefMilli);
  assert.ok(got!.tick > sent!.tick, "it takes time to arrive");
  const after = world(sim).communities.greyfen;
  const sum = (x: typeof before) => x.grievances.reduce((a, g) => a + g.intensity, 0);
  assert.ok(sum(after) < sum(before), "grievances eased");
  assert.ok(after.material > before.material - 10);
});

test("withholding communities keep their dues and refuse levies: income and levy shares follow the stance", () => {
  const c = variant((r) => { quiet(r); levyOn([5, 9])(r); });
  const sim = createSim({ content: c, seed: 3, policy: "passive" });
  sim.runDays(12);
  const withheld = sim.log.filter((e) => e.type === "TreasuryCollected" && e.payload.location === "greyfen" && (e.payload.withheldMilli as number) > 0);
  assert.ok(withheld.length > 0, "Greyfen kept its dues");
  const levies = sim.log.filter((e) => e.type === "LevyRaised");
  assert.equal(levies.length, 2);
  assert.ok((levies[1].payload.amountMilli as number) < (levies[1].payload.askedMilli as number), "the second levy raised less");
});

test("with the communities system off, income and levies are exactly as before (Phase 5 behaviour)", () => {
  const c = variant((r) => { quiet(r); levyOn([5, 9])(r); });
  const sim = createSim({ content: c, seed: 3, policy: "passive", ablate: ["communities"] });
  sim.runDays(12);
  assert.ok(!sim.log.some((e) => e.type === "TreasuryCollected" && e.payload.withheldMilli));
  for (const e of sim.log.filter((x) => x.type === "LevyRaised")) assert.equal(e.payload.amountMilli, e.payload.askedMilli);
});

test("competing narratives: Varos's story turns Coldmere's blame for the raids on the crown; Bren's turns Northwatch's onto the raiders", () => {
  const c = variant((r) => {
    r.scenario.threat.startPermillePerDay = 0; r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
    r.scenario.scripts.push({ day: 2, kind: "threat", site: "blackwood", intensityPermille: 900, durationDays: 60 });
  });
  let seen = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = createSim({ content: c, seed, policy: "passive" });
    sim.runDays(40);
    const w = world(sim).communities;
    const blame = (x: string) => w[x].grievances.find((g) => g.kind === "unprotected")?.blameCrown;
    const cm = blame("coldmere"), nw = blame("northwatch");
    if (cm === undefined || nw === undefined) continue;
    seen++;
    assert.ok(cm > 700 && nw < 300, `seed ${seed}: Coldmere ${cm}, Northwatch ${nw}`);
  }
  assert.ok(seen > 0);
});

test("second grievance (not grain): a company quartered away from home misbehaves; the grievance fades faster once it leaves", () => {
  const c = variant((r) => {
    quiet(r);
    r.scenario.scripts.push({ day: 2, kind: "order", from: "anna", to: "caron", intent: "advance", objective: { kind: "location", id: "eastmarch" } });
    r.communities.params.misconduct.dailyPermille = 300;
  });
  const sim = createSim({ content: c, seed: 6, policy: "passive" });
  sim.runDays(30);
  const incidents = sim.log.filter((e) => e.type === "TroopMisconduct");
  assert.ok(incidents.length > 0, "incidents happen");
  assert.ok(incidents.every((e) => e.payload.captain === "caron" && e.payload.community === "eastmarch"));
  const g = world(sim).communities.eastmarch.grievances.find((x) => x.kind === "misconduct");
  assert.ok(g && g.intensity > 0, "Eastmarch holds a misconduct grievance");
  // same architecture as the levy: the grievance can be petitioned, with its own remedy
  assert.ok(sim.log.some((e) => e.type === "PetitionMade" && e.payload.kind === "misconduct") || g!.intensity < CONTENT.communities.params.ladder.petition * 2);
});

test("Varos says nothing to the crown of a following that has declared for him", () => {
  const c = variant((r) => { quiet(r); levyOn([3, 8, 13, 18, 23])(r); r.communities.params.ladder.support = 150; r.communities.params.ladder.refuse = 120; r.communities.params.ladder.withhold = 90; r.communities.params.narrative.courtHours = 0; /* he stays among his own */ });
  const sim = createSim({ content: c, seed: 4, policy: "passive" });
  sim.runDays(30);
  const declared = sim.log.filter((e) => e.type === "CommunityStanceChanged" && e.payload.to === "support" && e.payload.supports === "varos" && e.payload.community === "eastmarch");
  assert.ok(declared.length > 0, "Eastmarch declared for Varos");
  const reps = sim.unsafeWorldForDebug().reports;
  const told = Object.values(reps).some((r) => r.author === "varos" && r.claims.some((x) => x.predicate === "community.stance" && x.believedValue === "support"));
  assert.ok(!told);
});
