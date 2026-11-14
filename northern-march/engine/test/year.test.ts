// D-089: the year's moods. Drawn once at the start from keyed streams (no shared stream's draw schedule moves), recorded as YearDrawn,
// read by the raiders, the court and the winter. With no block nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, type SimEvent } from "../src/events.ts";
import { deriveContent, readContentDir } from "../src/content.ts";
import { hashLog } from "../src/engine.ts";
import { CONTENT, CONTENT_DIR, LEGACY, run, variant } from "./helpers.ts";

const DAY = 86400;
const Y = CONTENT.scenario.year!;
const ofType = (log: readonly SimEvent[], t: string) => log.filter((e) => e.type === t);
const drawn = (seed: number) => ofType(run({ seed }, 1).log, "YearDrawn")[0].payload.moods as Record<string, string>;
/** The content with every mood forced to one option (by weight: the others get none). */
const forced = (pick: Record<string, string>) => variant((r) => { for (const m of r.scenario.year!.moods) for (const o of m.options) o.weight = o.id === (pick[m.id] ?? "ordinary") || (pick[m.id] === undefined && o.id === "wary") ? 1 : 0; });
const codes = (edit: (r: ReturnType<typeof readContentDir>) => void) => { const raw = readContentDir(CONTENT_DIR); edit(raw); try { deriveContent(raw); return []; } catch (e) { return [String((e as Error).message)]; } };

test("the year is content: three moods with weights, and a root event of the core", () => {
  assert.deepEqual(Y.moods.map((m) => m.id), ["wilds", "court", "winter"]);
  for (const m of Y.moods) { assert.equal(m.options.length, 3); assert.ok(m.options.every((o) => o.weight > 0)); }
  assert.equal(EVENT_TYPES.YearDrawn.root, true);
  assert.equal(EVENT_TYPES.YearDrawn.system, "core");
});

test("the block is validated", () => {
  assert.ok(codes((r) => { r.scenario.year!.moods[0].options[0].weight = -1; }).length, "negative weight");
  assert.ok(codes((r) => { for (const o of r.scenario.year!.moods[0].options) o.weight = 0; }).length, "all weights zero");
  assert.ok(codes((r) => { r.scenario.year!.moods[1].options[0].frontier = { startStance: "nonsense" as never }; }).length, "unknown stance");
  assert.ok(codes((r) => { r.scenario.year!.moods[2].options[0].environment = { season: "monsoon" as never }; }).length, "unknown season");
  assert.equal(codes((r) => { delete (r.scenario as { frontier?: unknown }).frontier; delete (r.scenario as { environment?: unknown }).environment; }).length, 0, "effects on parts the scenario lacks are inert");
  assert.ok(codes((r) => { r.scenario.year!.moods[0].options[0].threat = { sites: ["nowhere"] }; }).length, "unknown site");
  assert.ok(codes((r) => { r.scenario.year!.moods.push(r.scenario.year!.moods[0]); }).length, "a mood twice");
  assert.equal(codes(() => {}).length, 0);
});

test("the draw is the first thing after the start, once, and the state holds it", () => {
  const sim = run({ seed: 4 }, 30), ev = ofType(sim.log, "YearDrawn");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].id, 2);
  assert.equal(ev[0].tick, 0);
  assert.deepEqual(ev[0].causedBy, []);
  const moods = ev[0].payload.moods as Record<string, string>;
  for (const m of Y.moods) assert.ok(m.options.some((o) => o.id === moods[m.id]), m.id);
  assert.deepEqual(sim.unsafeWorldForDebug().year!.moods, moods);
  assert.deepEqual(sim.unsafeWorldForDebug(), sim.projectFromLog());
});

test("the same seed gives the same year; seeds give each mood at least once", () => {
  assert.deepEqual(drawn(11), drawn(11));
  const seen: Record<string, Set<string>> = Object.fromEntries(Y.moods.map((m) => [m.id, new Set<string>()]));
  for (let seed = 1; seed <= 48; seed++) { const d = drawn(seed); for (const m of Y.moods) seen[m.id].add(d[m.id]); }
  for (const m of Y.moods) assert.deepEqual([...seen[m.id]].sort(), m.options.map((o) => o.id).sort(), m.id);
  // the moods are independent: some seed has a quiet wood with a hostile court, and one with a roused wood and a friendly one
  const ds = Array.from({ length: 48 }, (_, i) => drawn(i + 1));
  assert.ok(ds.some((d) => d.wilds === "quiet" && d.court === "hostile"));
  assert.ok(ds.some((d) => d.wilds === "roused" && d.court === "friendly"));
});

test("the draw uses keyed streams only: no shared stream's draws change", () => {
  const withYear = run({ seed: 6 }, 1), without = run({ seed: 6, content: variant((r) => { delete (r.scenario as { year?: unknown }).year; }) }, 1);
  const a = withYear.rngDraws(), b = without.rngDraws();
  for (const k of Object.keys(b)) assert.equal(a[k], b[k], k);
  assert.ok(withYear.streamsCreated().some((s) => s.startsWith("year:")));
  assert.ok(!without.streamsCreated().some((s) => s.startsWith("year")));
  // and over a run, a mood that changes nothing leaves the shared streams' schedules the same as no block
  const flat = variant((r) => { for (const m of r.scenario.year!.moods) for (const o of m.options) for (const k of ["threat", "frontier", "environment"] as const) delete (o as unknown as Record<string, unknown>)[k]; });
  const x = run({ seed: 6, content: flat }, 90).rngDraws(), y = run({ seed: 6, content: variant((r) => { delete (r.scenario as { year?: unknown }).year; }) }, 90).rngDraws();
  for (const k of Object.keys(y)) if (!k.startsWith("year")) assert.equal(x[k], y[k], k);
});

test("with the block absent the log is the old one: no event, the same ids as the scenario without moods", () => {
  const none = variant((r) => { delete (r.scenario as { year?: unknown }).year; });
  const a = run({ seed: 3, content: none }, 60);
  assert.equal(ofType(a.log, "YearDrawn").length, 0);
  assert.equal(hashLog(a.log), hashLog(run({ seed: 3, content: none }, 60).log));
  // and it is the old log exactly: these are the hashes of march-0.17 on the engine before the year (delegating, 90 days)
  const was = variant((r) => { delete (r.scenario as { year?: unknown }).year; r.manifest.contentVersion = "march-0.17"; });
  for (const [seed, hash] of [[3, "77a3eede08f4557edcc4e60b450dc31e16b57d375b0311ce5b1df98ef24882e7"], [7, "e0cfbdd2f2246889570314aff8c58ebc0224054c471dea0fdbd1f064d266b872"]] as const) assert.equal(hashLog(run({ seed, content: was, policy: "delegating" }, 90).log), hash, `seed ${seed}`);
  // every stripped (legacy) variant has no year either
  assert.equal(LEGACY.scenario.year, undefined);
  assert.equal(ofType(run({ seed: 3, content: LEGACY }, 5).log, "YearDrawn").length, 0);
  // moods with no effects: nothing but the one event differs in kind (ids shift by one, and keyed draws that are named by an event id with them)
  const flat = variant((r) => { for (const m of r.scenario.year!.moods) for (const o of m.options) for (const k of ["threat", "frontier", "environment"] as const) delete (o as unknown as Record<string, unknown>)[k]; });
  assert.equal(run({ seed: 3, content: flat }, 1).log.length, run({ seed: 3, content: none }, 1).log.length + 1);
});

test("a roused wood raids more and harder than a quiet one, on the same seed", () => {
  const quiet = forced({ wilds: "quiet" }), roused = forced({ wilds: "roused" });
  const count = (c: typeof CONTENT, seed: number) => { const log = run({ seed, content: c, policy: "passive" }, 240).log, sites = CONTENT.scenario.threat.sites.map((x) => x.site); return { n: ofType(log, "ThreatBegan").filter((e) => sites.includes(e.payload.site as string)).length, raids: ofType(log, "RaidDamage").filter((e) => sites.includes(e.payload.site as string)).length, power: ofType(log, "ThreatBegan").reduce((t, e) => t + (e.payload.intensityPermille as number), 0) }; };
  let q = 0, r = 0, qp = 0, rp = 0, qn = 0, rn = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) { const a = count(quiet, seed), b = count(roused, seed); q += a.raids; r += b.raids; qn += a.n; rn += b.n; qp += a.power; rp += b.power; }
  assert.ok(rn > qn, `${rn} v ${qn} raiders arriving`);
  assert.ok(r > q * 2, `${r} v ${q}`);
  assert.ok(rp / Math.max(1, rn) > qp / Math.max(1, qn), "and harder");
});

test("a hostile court starts at press, a friendly one at settle; the thresholds move with the year", () => {
  for (const [mood, stance] of [["hostile", "press"], ["friendly", "settle"], ["wary", "trade"]] as const) {
    const sim = run({ seed: 2, content: forced({ court: mood }) }, 1), f = sim.unsafeWorldForDebug().fr!;
    assert.equal(f.stance, stance, mood);
    for (const a of Object.values(f.current)) assert.equal(a.stance, stance, mood);
  }
  // the first review reads the same March against moved thresholds
  const first = (mood: string) => ofType(run({ seed: 2, content: forced({ court: mood }) }, 40).log, "FrontierReview")[0];
  const h = first("hostile"), f = first("friendly");
  assert.ok(h && f);
  assert.equal(h.payload.weakness, f.payload.weakness, "the same March, the same informants");
  const rank = (x: unknown) => ["settle", "trade", "press", "strike"].indexOf(x as string);
  assert.ok(rank(h.payload.stance) >= rank(f.payload.stance) && rank(h.payload.from) > rank(f.payload.from));
  const hostile = forced({ court: "hostile" }), friendly = forced({ court: "friendly" });
  assert.ok(hostile.scenario.year!.moods[1].options.find((o) => o.id === "hostile")!.frontier!.thresholdShift! < 0);
  assert.ok(friendly.scenario.year!.moods[1].options.find((o) => o.id === "friendly")!.frontier!.thresholdShift! > 0);
});

test("a hard winter is colder and stormier than a mild one, and only in winter", () => {
  const mild = forced({ winter: "mild" }), hard = forced({ winter: "hard" });
  const days = (c: typeof CONTENT) => ofType(run({ seed: 5, content: c, policy: "passive" }, 150).log, "EnvironmentDay");
  const a = days(mild), b = days(hard);
  const mean = (es: SimEvent[], season: string) => { const xs = es.filter((e) => e.payload.season === season).flatMap((e) => Object.values(e.payload.regions as Record<string, { tempC10: number }>).map((r) => r.tempC10)); return xs.reduce((n, x) => n + x, 0) / xs.length; };
  assert.ok(mean(b, "winter") < mean(a, "winter") - 100, `${mean(b, "winter")} v ${mean(a, "winter")}`);
  assert.ok(Math.abs(mean(b, "spring") - mean(a, "spring")) < 60, "spring is the spring of the same seed, give or take what the cold left in the snow");
  // the draws are the same: the same days are wet in both, only what falls changes
  assert.equal(a.length, b.length);
});

test("a year does not break the world: the log is its own projection, and the run repeats", () => {
  for (const seed of [1, 2, 3]) {
    const a = run({ seed }, 120), b = run({ seed }, 120);
    assert.equal(hashLog(a.log), hashLog(b.log));
    assert.deepEqual(a.unsafeWorldForDebug(), a.projectFromLog());
  }
});
