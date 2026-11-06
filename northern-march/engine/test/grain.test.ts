// Phase 7A, stage 1: the grain economy. Exact conservation, shortage caused by the raids, scarcity bands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../src/events.ts";
import { bandOf } from "../src/world.ts";
import { checkRun } from "../src/invariants.ts";
import { createSim } from "../src/engine.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const G = CONTENT.scenario.grain!;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Σ stores + Σ grain on the road = Σ start + produced - consumed - spilled - lost - seized, exactly. */
function conserved(sim: { unsafeWorldForDebug(): any }) {
  const w = sim.unsafeWorldForDebug(), L = Object.values(w.grainLedger) as { produced: number; consumed: number; spilled: number; lost: number; seized: number }[];
  const sum = (f: (x: (typeof L)[number]) => number) => L.reduce((a, x) => a + f(x), 0);
  const have = (Object.values(w.grain) as number[]).reduce((a, x) => a + x, 0) + (Object.values(w.convoys) as { sacks: number }[]).reduce((a, c) => a + c.sacks, 0);
  return { have, want: G.places.reduce((a, p) => a + p.store, 0) + sum((x) => x.produced) - sum((x) => x.consumed) - sum((x) => x.spilled) - sum((x) => x.lost) - sum((x) => x.seized) };
}
test("grain: stores plus grain on the road equal start + produced - consumed - spilled - lost - seized, exactly, on every seed", () => {
  for (const seed of SEEDS) {
    const sim = run({ seed });
    const c = conserved(sim); assert.equal(c.have, c.want, `seed ${seed}`);
    for (const p of G.places) assert.ok(sim.unsafeWorldForDebug().grain[p.location] >= 0 && sim.unsafeWorldForDebug().grain[p.location] <= p.cap, `${p.location} within 0..cap`);
    assert.deepEqual(checkRun(sim), [], `seed ${seed}`);
  }
});

test("grain: the log alone gives the same stores as the world (projection)", () => {
  const sim = run({ seed: 3 });
  const store = Object.fromEntries(G.places.map((p) => [p.location, p.store]));
  for (const e of sim.log) {
    if (e.type === "GrainDay") for (const [l, pr, c, sp] of e.payload.changes as number[][] as unknown as [string, number, number, number][]) store[l] += pr - c - sp;
    if (e.type === "GrainShipped") store[e.payload.from as string] -= e.payload.sacks as number;
    if (e.type === "GrainDelivered") store[e.payload.to as string] += (e.payload.sacks as number) - (e.payload.spilled as number);
  }
  assert.deepEqual(store, sim.unsafeWorldForDebug().grain);
});

test("grain: with the Blackwood threat ablated nothing cuts the harvest and no place runs short", () => {
  for (const seed of SEEDS) {
    const off = run({ seed, ablate: ["threat"] });
    assert.ok(!off.log.some((e) => e.type === "HarvestDamaged"), `seed ${seed}`);
    assert.ok(G.places.every((p) => off.unsafeWorldForDebug().grainLedger[p.location].unmet === 0), `seed ${seed} unmet need`);
  }
});

test("grain: raids cause HarvestDamaged and, on some seed, a shortage at Northwatch that the OFF arm does not have", () => {
  let short = 0;
  for (const seed of SEEDS) {
    const on = run({ seed });
    const hit = on.log.filter((e) => e.type === "HarvestDamaged");
    for (const h of hit) assert.equal(on.log[h.causedBy[0] - 1].type, "RaidDamage");
    if (on.unsafeWorldForDebug().grainLedger.northwatch.unmet > 0 || on.log.some((e) => e.type === "ScarcityChanged" && e.payload.place === "northwatch" && (e.payload.to === "short" || e.payload.to === "famine"))) short += 1;
  }
  assert.ok(short > 0, "no seed of 8 shows a Northwatch shortage");
});

test("grain: scarcity bands follow days of cover; a change is an event caused by the daily tally", () => {
  assert.equal(bandOf(1200, 40, G.bandDays), "plenty");
  assert.equal(bandOf(560, 40, G.bandDays), "adequate");
  assert.equal(bandOf(280, 40, G.bandDays), "tight");
  assert.equal(bandOf(120, 40, G.bandDays), "short");
  assert.equal(bandOf(39, 40, G.bandDays), "famine");
  const sim = run({ seed: 2 });
  for (const e of sim.log.filter((x) => x.type === "ScarcityChanged")) assert.equal(sim.log[e.causedBy[0] - 1].type, "GrainDay");
});

test("grain: grain events belong to the grain system and the content rejects a place that does not exist", () => {
  for (const t of ["GrainDay", "HarvestDamaged", "ScarcityChanged"]) assert.equal(EVENT_TYPES[t].system, "grain");
  assert.throws(() => variant((r) => { r.scenario.grain!.places[0].location = "nowhere"; }));
  assert.throws(() => variant((r) => { r.scenario.grain!.places[0].store = r.scenario.grain!.places[0].cap + 1; }));
});

test("grain: a surplus above the cap is spilled, not created", () => {
  const sim = run({ seed: 1 });
  assert.ok(sim.unsafeWorldForDebug().grainLedger.greyfen.spilled > 0);
});

test("grain stage 2: Anna learns of the stores only through letters, as an estimate that is usually not the true figure", () => {
  let wrong = 0, heard = 0;
  for (const seed of SEEDS) {
    const sim = run({ seed }, 120);
    const w = sim.unsafeWorldForDebug();
    const anna = Object.values(w.beliefs.anna ?? {}).filter((b) => b.predicate === "grain.stock");
    for (const b of anna) {
      assert.ok(b.evidenceRefs.every((e) => e.kind === "report"), "no first-hand reading at the seat");
      heard += 1;
    }
    const nw = anna.find((b) => b.subject.id === "northwatch");
    if (nw && nw.believedValue !== w.grain.northwatch) wrong += 1;
    // the error stays inside the observer's bound (half the true figure at worst, at skill zero)
    for (const b of anna) assert.ok(Math.abs((b.believedValue as number) - (w.grain[b.subject.id] ?? 0)) <= 1500, `${b.subject.id} estimate wildly off`);
  }
  assert.ok(heard > 0, "Anna never heard of the stores");
  assert.ok(wrong > 0, "Anna's estimates are always exact");
});

test("grain stage 2: Bren's letters carry Northwatch's stores and what he hears of Greyfen and Coldmere", () => {
  const sim = run({ seed: 2 }, 60);
  const claims = sim.log.filter((e) => e.type === "ReportComposed" && (e.payload.report as any).author === "bren").flatMap((e) => (e.payload.report as any).claims as { predicate: string; subject: { id: string } }[]);
  const g = new Set(claims.filter((c) => c.predicate === "grain.stock").map((c) => c.subject.id));
  assert.ok(g.has("northwatch") && g.has("greyfen"), [...g].join());
});

/** Play one game with the ruler giving a single grain order on a day; returns the finished simulation. */
function ordered(seed: number, action: PlayerAction, day = 5, days = 60, content = CONTENT) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 4000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= day * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}
const REQ: PlayerAction = { action: "requisition", target: "greyfen", to: "northwatch", consult: true };
const quiet = (edit: (r: any) => void = () => {}) => variant((r) => { r.scenario.scripts = []; r.scenario.threat.startPermillePerDay = 0; edit(r); });

test("grain stage 3: a requisition becomes a physical convoy; the stock moves only on arrival, and conservation holds with grain on the road", () => {
  const sim = ordered(2, REQ, 5, 40, quiet());
  const ship = sim.log.find((e) => e.type === "GrainShipped")!;
  assert.ok(ship, "shipped"); assert.equal(ship.payload.how, "requisition");
  const done = sim.log.find((e) => e.type === "GrainDelivered" || e.type === "GrainLost")!;
  assert.ok(done && done.tick > ship.tick, "arrival is later than departure (carts walk)");
  assert.equal(done.causedBy[0], ship.id);
  const c = conserved(sim); assert.equal(c.have, c.want);
  assert.ok(sim.log.some((e) => e.type === "GrainShipped") && Object.keys(sim.unsafeWorldForDebug().convoys).length === 0);
});

test("grain stage 3: consulting Greyfen first keeps the crown's promise; taking without asking breaks it", () => {
  const grievances = (sim: ReturnType<typeof ordered>, kind: string) => sim.log.filter((e) => e.type === "CommunityHeard" && e.payload.community === "greyfen" && ((e.payload.grievances ?? []) as { kind: string }[]).some((g) => g.kind === kind));
  const asked = ordered(2, REQ, 5, 40, quiet()), taken = ordered(2, { ...REQ, consult: false }, 5, 40, quiet());
  assert.ok(asked.log.some((e) => e.type === "GrainConsulted"), "the consultation happened");
  assert.equal(grievances(asked, "broken_promise").length, 0, "consulted: the promise stands");
  assert.ok(grievances(taken, "broken_promise").length > 0, "not consulted: the promise is broken");
  const s1 = asked.log.find((e) => e.type === "GrainShipped")!, s2 = taken.log.find((e) => e.type === "GrainShipped")!;
  assert.ok(s1.tick > s2.tick, "consulting is slower");
  const g = (sim: ReturnType<typeof ordered>) => sim.unsafeWorldForDebug().communities.greyfen;
  assert.ok(g(asked).grievances.reduce((a, x) => a + x.intensity, 0) < g(taken).grievances.reduce((a, x) => a + x.intensity, 0), "less grievance when consulted");
});

test("grain stage 3: a purchase is limited by coin and pays for what it buys", () => {
  const BUY: PlayerAction = { action: "purchase", target: "greyfen", to: "northwatch" };
  const rich = ordered(2, BUY, 5, 30, quiet()), poor = ordered(2, BUY, 5, 30, quiet((r) => { r.scenario.treasuryMilli = 2500; r.scenario.economy.holdings.forEach((h: any) => { h.dailyIncomeMilli = 0; h.jitterMilli = 0; }); r.scenario.economy.dailyUpkeepMilli = 0; r.scenario.economy.captainAwayMilli = 0; }));
  const a = rich.log.find((e) => e.type === "GrainShipped")!, b = poor.log.find((e) => e.type === "GrainShipped");
  assert.equal(a.payload.sacks, G.purchase.sacks); assert.equal(a.payload.costMilli, G.purchase.sacks * G.purchase.priceMilliPerSack);
  assert.ok(b && (b.payload.sacks as number) * G.purchase.priceMilliPerSack <= 2500 && (b.payload.sacks as number) < G.purchase.sacks, "bought only what the coin allowed");
  assert.ok(!rich.log.some((e) => e.type === "CommunityHeard" && e.payload.community === "greyfen" && ((e.payload.grievances ?? []) as unknown[]).length), "a sale makes no grievance");
});

test("grain stage 3: a convoy can be lost or seized, and the grain is accounted for", () => {
  const lost = ordered(2, REQ, 5, 40, quiet((r) => { r.scenario.grain.convoy.lossPermillePerDay = 1000; }));
  const e = lost.log.find((x) => x.type === "GrainLost")!;
  assert.ok(e && !lost.log.some((x) => x.type === "GrainDelivered"));
  const w = lost.unsafeWorldForDebug();
  assert.equal(w.grainLedger.greyfen.lost, e.payload.sacks);
  const raided = ordered(2, REQ, 5, 40, variant((r) => { r.scenario.grain!.convoy.seizurePermilleAtFull = 1000; r.scenario.scripts = [{ day: 1, kind: "threat", site: "blackwood", intensityPermille: 1000, durationDays: 90 }]; }));
  const s = raided.log.find((x) => x.type === "GrainLost");
  if (s) assert.equal(s.payload.reason, "seized");
});

test("grain stage 3: an order with nothing to take is abandoned with a reason, not silently dropped", () => {
  const sim = ordered(2, { ...REQ, target: "northwatch", to: "greyfen" }, 5, 40, quiet((r) => { r.scenario.grain.places.find((p: any) => p.location === "northwatch").store = 100; }));
  const o = sim.log.find((e) => e.type === "OrderAbandoned" && (e.payload as any).reason);
  assert.ok(o, "abandoned with a reason"); assert.ok(!sim.log.some((e) => e.type === "GrainShipped" && e.payload.orderId !== 0), "the ordered shipment never left (an official may send his own)");
});

import { readCrisis, OUTCOMES } from "../src/crisis.ts";
test("grain stage 4: a hungry fort loses men, and a castellan with a nearly empty store sends for grain himself, unasked and unconsulted", () => {
  const c = quiet((r) => { const n = r.scenario.grain.places.find((p: any) => p.location === "northwatch"); n.store = 60; n.production = 0; });
  const sim = run({ seed: 2, content: c, policy: "passive" }, 40);
  const log = sim.log;
  assert.ok(log.some((e) => e.type === "GarrisonStarved" && (e.payload.changes as [string, number][]).some(([l]) => l === "northwatch")), "men lost to hunger");
  const own = log.find((e) => e.type === "GrainShipped" && e.payload.by === "bren");
  assert.ok(own && own.payload.orderId === 0 && own.payload.consulted === false && own.payload.how === "requisition", "an official's own shipment");
  assert.ok(log.some((e) => e.type === "GrainDelivered" && e.payload.to === "northwatch"));
  assert.ok(log.find((e) => e.id === own!.causedBy[0])!.type === "GrainAsked" && log.find((e) => e.id === log.find((x) => x.id === own!.causedBy[0])!.causedBy[0])!.type === "BeliefUpdated", "caused by what he saw, not by an order");
});

test("grain stage 4: Varos rides to Greyfen when it has a fresh grievance, and earns its trust there; he does not go when it has none", () => {
  const sim = ordered(2, { ...REQ, consult: false }, 5, 40, quiet());
  const went = sim.log.find((e) => e.type === "Departed" && e.payload.who === "varos" && e.payload.dest === "greyfen");
  assert.ok(went, "Varos went to Greyfen");
  const w = sim.unsafeWorldForDebug();
  assert.ok(w.communities.greyfen.trust.varos > 450, "his standing there grew");
  const calm = ordered(2, { ...REQ, consult: true }, 5, 40, quiet());
  assert.ok(!calm.log.some((e) => e.type === "Departed" && e.payload.who === "varos" && e.payload.dest === "greyfen"), "no grievance, no visit");
});

test("grain stage 4: the crisis reading is silent without raids, and every reading is one of the named outcomes", () => {
  for (const seed of SEEDS) {
    const off = readCrisis(run({ seed, ablate: ["threat"], policy: "passive" }).log, CONTENT);
    assert.equal(off.outcome, "no_crisis", `seed ${seed}`); assert.equal(off.endState, false);
    const on = readCrisis(run({ seed, policy: "passive" }).log, CONTENT);
    assert.ok([...OUTCOMES, "unresolved", "no_crisis"].includes(on.outcome));
  }
});

test("grain stage 4: the end state needs the grievance to trace back to a requisition, not to a levy alone", () => {
  // Aggressive play levies Greyfen too; with grain orders removed from the world (no stores to take from) the end state cannot count
  const c = variant((r) => { r.scenario.grain!.places.forEach((p) => { if (p.location === "greyfen") p.store = 0; p.production = Math.min(p.production, p.need); }); });
  for (const seed of [1, 2, 3, 4]) assert.equal(readCrisis(run({ seed, content: c, policy: "aggressive" }, 160).log, c).endState, false, `seed ${seed}`);
});
