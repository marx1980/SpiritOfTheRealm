// Playtest laboratory (docs/playtest/v4 and V4_1_AMENDMENTS.md): L1 contracts, L2 boundary, L3 replay, L4 batch,
// L5 shrink/regression, L7 reporting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { canonicalJson } from "../src/canonical.ts";
import { createSim, hashLog } from "../src/engine.ts";
import { checkDecision, parseManifest, parseNotification, parseObservation, parseRunRecord, PERSONAS, PLAYTEST_SCHEMA_VERSION, type PlaytestRunManifest } from "../src/playtest/contract.ts";
import { buildObservation } from "../src/playtest/observe.ts";
import { observationRules, playGame, replayRecord } from "../src/playtest/runner.ts";
import { CONTENT_DIR, labContent, readSummaries, runLab } from "../src/playtest/lab.ts";
import { CommandAdapter, FakeAdapter, Reporter } from "../src/playtest/reporting.ts";
import { analyse } from "../src/playtest/analysis.ts";
import { sealPackage, verifyPackage, compare } from "../src/playtest/paired.ts";

const content = labContent(CONTENT_DIR);
const DAY = 86400;
const SRC = new URL("../src/", import.meta.url).pathname;
const tmp = () => mkdtempSync(`${tmpdir()}/lab-`);
const importsOf = (f: string) => [...readFileSync(f, "utf8").matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

/** The first few observations of a real game. */
function observations(seed: number, n: number) {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } }), out = [];
  for (let i = 0; i < n; i++) { const r = sim.next(120 * DAY); if (!r.paused) break; out.push({ view: r.view!, built: buildObservation(r.view!, observationRules(content), { index: i, pause: r.reason!, newLetters: [] }) }); sim.answer([]); }
  return out;
}
const OBS = observations(51, 60);
const lastObs = OBS[OBS.length - 1].built.obs;

test("L1: observations from real play pass the strict schema and every cross-reference", () => {
  assert.ok(OBS.length >= 20);
  for (const { built } of OBS) { const r = parseObservation(JSON.parse(JSON.stringify(built.obs))); assert.ok(r.ok, r.ok ? "" : `${r.step}: ${r.reason}`); }
  assert.ok(OBS.some((o) => o.built.obs.letters.length && o.built.obs.evidence.length && o.built.obs.affordances.length > 3), "a mid-game observation has letters, evidence and choices");
});

test("L1: the decision chain rejects unknown fields, coercion, duplicates, wrong context and overspending", () => {
  const o = lastObs, act = o.affordances.find((a) => a.kind !== "wait")!;
  const ok = { schemaVersion: PLAYTEST_SCHEMA_VERSION, observationId: o.id, agent: "passive", choose: [act.id], rationale: { text: "x", cites: o.evidence.slice(0, 1).map((e) => e.id) } };
  assert.ok(checkDecision(ok, o).ok);
  const cases: [unknown, string][] = [
    [{ ...ok, extra: 1 }, "schema"], [{ ...ok, schemaVersion: "1" }, "schema"], [{ ...ok, schemaVersion: 2 }, "schema"], [{ ...ok, choose: [act.id, act.id] }, "crossref"],
    [{ ...ok, observationId: "obs:99999" }, "context"], [{ ...ok, choose: ["a999"] }, "allowlist"], [{ ...ok, rationale: { text: "x", cites: ["e9999"] } }, "allowlist"],
    [{ ...ok, choose: [o.affordances[0].id, act.id] }, "allowlist"], [{ ...ok, choose: 1 }, "schema"], [null, "schema"],
  ];
  for (const [raw, step] of cases) { const r = checkDecision(raw, o); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.step, step, JSON.stringify(raw).slice(0, 80)); }
  const pricey = { ...o, ruler: { ...o.ruler, coinsMilli: 1 }, affordances: o.affordances.map((a) => (a.id === act.id ? { ...a, costMilli: 5 } : a)) };
  const r = checkDecision(ok, pricey); assert.ok(!r.ok && r.step === "allowlist");
  const debt = { ...o, ruler: { ...o.ruler, coinsMilli: -500 } };
  assert.ok(checkDecision({ ...ok, choose: [] }, debt).ok, "waiting is always possible, even in debt");
});

test("L1: manifests, records and notifications are strict; partitions keep their seed ranges", () => {
  const m: PlaytestRunManifest = { schemaVersion: 1, runSetId: "t-1", mode: "quick", partition: "dev", commit: "x", engineHash: "y", contentVersion: content.version, contentHash: content.hash, scenario: "march", days: 30, seeds: { first: 1, count: 2 }, personas: ["passive"], params: {}, budgets: { maxGames: 2, workers: 1, wallMs: 60000, artifactBytes: 1 << 20, llmCalls: 0 } };
  assert.ok(parseManifest(m).ok);
  assert.ok(!parseManifest({ ...m, seeds: { first: 5000, count: 2 } }).ok, "dev seeds stop at 4999");
  assert.ok(!parseManifest({ ...m, partition: "sealed" }).ok, "sealed lab seeds start at 200,000");
  assert.ok(!parseManifest({ ...m, personas: ["passive", "passive"] }).ok);
  assert.ok(!parseManifest({ ...m, budgets: { ...m.budgets, llmCalls: 5 } }).ok, "no paid model calls");
  assert.ok(!parseManifest({ ...m, days: "30" }).ok, "no numeric coercion");
  assert.ok(!parseNotification({ schemaVersion: 1, key: "other:final:1", kind: "final", runSetId: "t-1", games: 1, subject: "s", body: "b", email: true, status: "pending", attempts: 0, nextAttemptAt: 0 }).ok);
  const { record } = playGame({ content, seed: 3, persona: "random-valid", days: 30 });
  assert.ok(parseRunRecord(JSON.parse(JSON.stringify(record))).ok);
  assert.ok(!parseRunRecord({ ...record, decisions: [...record.decisions].reverse() }).ok || record.decisions.length < 2);
});

test("L2: agents import only the contract and the agent kit; the bridge never imports engine, world, systems, content or RNG", () => {
  const agentDir = `${SRC}playtest/agents/`;
  for (const f of readdirSync(agentDir)) for (const i of importsOf(agentDir + f)) assert.ok(["../contract.ts", "../agentkit.ts"].includes(i), `${f} imports ${i}`);
  for (const i of importsOf(`${SRC}playtest/agentkit.ts`)) assert.equal(i, "./contract.ts");
  const banned = /(\.\.\/(engine|world|content|rng|inspect|chronicle|invariants|batch)\.ts|systems\/|agents\/(planner|model|obedience|terms))/;
  for (const f of ["playtest/observe.ts", "presentation/affordances.ts", "presentation/court.ts", "presentation/map.ts", "presentation/phrasing.ts"]) for (const i of importsOf(SRC + f)) assert.ok(!banned.test(i), `${f} imports ${i}`);
  assert.ok(importsOf(`${SRC}../ui/app.ts`).includes("../src/presentation/affordances.ts"), "the debug page uses the same affordance module (v4.1 A1)");
  for (const f of readdirSync(agentDir)) assert.ok(!/followAdviser|buildSituation|orderChoice|planOf\(/.test(readFileSync(agentDir + f, "utf8")), "personas never use the NPC planner (risk 12)");
});

test("L2: the observation is a pure function of the view and carries no hidden quantities", () => {
  for (const { view, built } of OBS.slice(-5)) {
    const again = buildObservation(structuredClone(view), observationRules(content), { index: built.obs.decisionIndex, pause: built.obs.pause, newLetters: [] });
    assert.equal(canonicalJson(again.obs), canonicalJson(built.obs));
  }
  const keys = new Set<string>(); const walk = (x: unknown) => { if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } };
  for (const { built } of OBS) walk(built.obs);
  for (const k of ["conditionMilli", "intensityPermille", "traits", "treasuryMilli", "candidates", "beliefsConsulted", "rngStream", "trace", "basedOnBeliefs", "believedValue", "evidenceRefs"]) assert.ok(!keys.has(k), `observation has ${k}`);
});

test("L3: a game is deterministic, replays exactly without the agent, and the agent's RNG never touches the simulation", () => {
  for (const persona of ["random-valid", "adversarial-probe", "impulsive-war-ruler"] as const) {
    const a = playGame({ content, seed: 11, persona, days: 60 }), b = playGame({ content, seed: 11, persona, days: 60 });
    assert.equal(a.record.logHash, b.record.logHash); assert.deepEqual(a.record.decisions, b.record.decisions);
    assert.ok(replayRecord(a.record, content).ok, `${persona} replays`);
    assert.ok(!Object.keys(a.sim.rngDraws()).includes("player"), "the player stream is untouched: the agent has its own");
  }
  const waits = createSim({ content, seed: 11, policy: "external", params: { dayEnd: true } });
  for (;;) { const r = waits.next(60 * DAY); if (!r.paused) break; waits.answer([]); }
  assert.equal(playGame({ content, seed: 11, persona: "passive", days: 60 }).record.logHash, hashLog(waits.log), "passive = answering nothing");
});

test("L3: the adversarial probe's malformed answers are all rejected and the game goes on", () => {
  const { record } = playGame({ content, seed: 5, persona: "adversarial-probe", days: 80 });
  assert.ok(record.outcome.invalid > 0);
  assert.ok(record.decisions.filter((d) => d.rejected).every((d) => d.actions.length === 0), "a rejected answer becomes a wait");
  assert.ok(!record.failures.some((f) => f.startsWith("decision")), "probe rejections are expected, not failures");
});

test("L4: results do not depend on the number of workers; a stopped run resumes to the same result", async () => {
  const m = (id: string): PlaytestRunManifest => ({ schemaVersion: 1, runSetId: id, mode: "quick", partition: "dev", commit: "test", engineHash: "test", contentVersion: content.version, contentHash: content.hash, scenario: "march", days: 40, seeds: { first: 21, count: 2 }, personas: ["random-valid", "cautious-administrator", "community-protector"], params: {}, budgets: { maxGames: 6, workers: 2, wallMs: 600000, artifactBytes: 50 << 20, llmCalls: 0 } });
  const d1 = tmp(), d2 = tmp(), d3 = tmp();
  await runLab(m("t-inline"), { outDir: d1, inline: true });
  await runLab(m("t-inline"), { outDir: d2, workers: 2 });
  const strip = (d: string) => readSummaries(d).map(({ ms, ...s }) => { void ms; return s; });
  assert.deepEqual(strip(d2), strip(d1));
  const first = await runLab(m("t-inline"), { outDir: d3, inline: true, stopAfter: 2 });
  assert.equal(first.reason, "interrupted"); assert.equal(readSummaries(d3).length, 2);
  const rest = await runLab(m("t-inline"), { outDir: d3, inline: true });
  assert.equal(rest.reason, "complete");
  assert.deepEqual(strip(d3), strip(d1));
  await assert.rejects(runLab(m("other"), { outDir: d3, inline: true }), /different run set/);
  sealPackage(d1); assert.deepEqual(verifyPackage(d1), []);
  const a = analyse(readSummaries(d1));
  assert.ok(a.panels.every((p) => ["PASS", "REVIEW", "FAIL", "INSUFFICIENT EVIDENCE", "NOT EVALUATED"].includes(p.state)));
  assert.equal(compare(readSummaries(d1), readSummaries(d2)).all.diverged, 0, "paired arms with no change do not diverge");
});

test("L7: milestones are exactly once, 10,000 replaces that 1,000 report, retries back off, restarts do not duplicate", async () => {
  const dir = tmp(); let now = 0;
  const rep = () => new Reporter({ dir, runSetId: "t-rep", expected: 20000, now: () => now, baseDelayMs: 1000, maxAttempts: 3, every1kEmail: false });
  const r1 = rep();
  assert.equal((await r1.milestone(1000)).queued, true);
  assert.equal((await r1.milestone(1000)).queued, false, "same milestone twice is queued once");
  assert.equal((await rep().milestone(1000)).queued, false, "a restarted reporter knows it was queued");
  await r1.milestone(10000);
  const st = r1.state();
  assert.equal(st.get("t-rep:progress-1k:1000")!.status, "dashboard-only", "1k goes to the dashboard only by default");
  assert.ok(st.has("t-rep:deep-10k:10000") && !st.has("t-rep:progress-1k:10000"), "the deep report replaces the 10,000 progress report");
  const fake = new FakeAdapter(`${dir}/sent.jsonl`, 1);
  assert.deepEqual(await r1.deliver(fake), { sent: 0, failed: 0, waiting: 1 });
  assert.deepEqual(await r1.deliver(fake), { sent: 0, failed: 0, waiting: 1 }, "not retried before its back-off");
  now = 1000;
  assert.deepEqual(await rep().deliver(fake), { sent: 1, failed: 0, waiting: 0 }, "retried after back-off, by a restarted reporter");
  assert.deepEqual(await rep().deliver(fake), { sent: 0, failed: 0, waiting: 0 }, "never sent twice");
  assert.equal(readFileSync(`${dir}/sent.jsonl`, "utf8").trim().split("\n").length, 1);
  const r2 = rep(); r2.final(5, "budget", "test");
  const dead = new FakeAdapter(`${dir}/x.jsonl`, 99);
  for (let i = 0; i < 5; i++) { now += 10_000; await r2.deliver(dead); }
  assert.equal(r2.state().get("t-rep:final:5")!.status, "failed", "gives up after the maximum attempts");
  assert.ok(r2.state().get("t-rep:final:5")!.body.includes("COVERAGE INCOMPLETE"));
  const saved = process.env.PLAYTEST_REAL_EMAIL_APPROVED; delete process.env.PLAYTEST_REAL_EMAIL_APPROVED;
  await assert.rejects(new CommandAdapter().send({ subject: "s", body: "b" }), /not approved/);
  if (saved !== undefined) process.env.PLAYTEST_REAL_EMAIL_APPROVED = saved;
  assert.ok(!readFileSync(`${dir}/outbox.jsonl`, "utf8").includes("@"), "no address is written to the outbox");
});

test("L5: every permanent regression case still replays to its recorded outcome", async () => {
  const { holds, playInputs } = await import("../src/playtest/shrink.ts");
  const dir = new URL("./regression/", import.meta.url).pathname;
  const cases = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  for (const f of cases) {
    const c = JSON.parse(readFileSync(dir + f, "utf8"));
    const sim = playInputs(content, c.seed, c.days, c.inputs, c.params);
    assert.equal(hashLog(sim.log), c.logHash, `${f}: same log as when it was shrunk`);
    // "fails": a known issue still reproduces. "passes": a fixed issue must not come back (permanent guard).
    if (c.expect === "passes") assert.ok(!holds(sim, c.predicate), `${f}: ${c.title} has come back`);
    else assert.ok(holds(sim, c.predicate), `${f}: ${c.knownIssue} no longer reproduces: fixed? set expect to passes`);
  }
  assert.ok(PERSONAS.length === 10);
});

test("L8: the grid, behaviour cells and neighbours are as specified", async () => {
  const s = await import("../src/playtest/search.ts");
  assert.equal(s.gridSize(), 7 * 5 * 5, "three allowlisted parameters on their grids");
  assert.equal(s.CELLS, 48);
  assert.equal(s.levyBin(0), 0); assert.equal(s.levyBin(5), 1); assert.equal(s.levyBin(6), 2); assert.equal(s.levyBin(16), 3);
  assert.equal(s.reliefBin(9), 1); assert.equal(s.reliefBin(10), 2);
  assert.equal(s.cellOf({ levies: 20, reliefs: 0, objectiveMet: true, topStance: { a: "support" } }), "L3R0O1V1");
  assert.ok(s.isExploitCell("L2R0O1V0") && s.isExploitCell("L3R1O1V1"), "objective met with 6 or more levies");
  assert.ok(!s.isExploitCell("L1R0O1V0") && !s.isExploitCell("L3R0O0V1"), "few levies, or objective not met, is not flagged");
  const g = s.GRID.map((x) => Math.floor(x.length / 2));
  assert.equal(s.neighbours(g).length, 6, "an interior genome has two neighbours per parameter");
  assert.equal(s.neighbours(s.GRID.map((x) => 0)).length, 3, "a corner has one neighbour per parameter");
  assert.deepEqual(s.patchOf(g, g), [], "the baseline needs no patch");
});
