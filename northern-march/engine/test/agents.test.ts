// Phase 3 / ARCHITECTURE §20: event-driven BDI-lite agents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { keepOrSwitch, plan } from "../src/agents/planner.ts";
import type { Seen } from "../src/agents/model.ts";
import { buildSituation } from "../src/systems/agents.ts";
import { decideObedience } from "../src/agents/obedience.ts";
import { validateDecisionTrace, type DecisionTrace } from "../src/schemas.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { CONTENT, run, variant } from "./helpers.ts";

const CONTENT_OF = (sim: ReturnType<typeof run>) => sim.content;
const traces = (sim: ReturnType<typeof run>, agent?: string) =>
  sim.log.filter((e) => e.type === "DecisionMade" && (!agent || (e.payload.trace as DecisionTrace).agent === agent)).map((e) => ({ e, t: e.payload.trace as DecisionTrace }));
const wakes = (sim: ReturnType<typeof run>, agent?: string) => sim.log.filter((e) => e.type === "AgentWoke" && (!agent || e.payload.agent === agent));

// A scripted crisis: Caron rides to court, then Blackwood raiders hit Northwatch hard.
const crisis = variant((r) => {
  r.scenario.scripts = [
    { day: 1, kind: "travel", who: "caron", to: "ravenport", mode: "rider" },
    { day: 3, kind: "threat", site: "blackwood", intensityPermille: 800, durationDays: 60 },
  ];
  r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  // the fixture pins the old balance (repair cost, walls wearing): these tests are about how agents choose, not about the economy
  r.scenario.player.repairCostMilliPerMilli = 2; r.scenario.weather.decayMilliPerDay = 250;
});

test("inactive characters do no work", () => {
  for (const seed of [1, 2, 3]) {
    const sim = run({ seed }, 240);
    assert.equal(wakes(sim, "mara").length, 0, "Mara: nothing touches Greyfen");
    assert.equal(traces(sim, "mara").length, 0);
    assert.equal(traces(sim, "anna").length, 0, "the ruler is the player, not an agent");
  }
});

test("every decision has a trigger: a wake, a scheduled review of a live intention, or a received order", () => {
  for (const seed of [1, 2, 3, 4]) {
    const sim = run({ seed }, 240);
    const byId = new Map(sim.log.map((e) => [e.id, e]));
    for (const { e } of traces(sim)) {
      const causes = e.causedBy.map((c) => byId.get(c)!.type);
      assert.ok(causes.some((t) => ["AgentWoke", "OrderReceived", "DecisionMade"].includes(t)), `${e.id} caused by ${causes}`);
    }
  }
});

test("a meaningful event wakes only implicated agents", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 5; seed++) {
    const sim = run({ seed, policy: "passive" }, 120);
    const byId = new Map(sim.log.map((e) => [e.id, e]));
    for (const storm of sim.log.filter((e) => e.type === "Storm" && e.payload.location === "eastmarch")) {
      const woken = wakes(sim).filter((w) => w.tick === storm.tick && (w.payload.triggers as number[]).some((t) => {
        for (let x = byId.get(t); x; x = byId.get(x.causedBy[0])) if (x.id === storm.id) return true;
        return false;
      }));
      for (const w of woken) assert.equal(w.payload.agent, "varos", "only someone at Eastmarch experiences its storm");
      checked += woken.length ? 1 : 0;
    }
  }
  assert.ok(checked > 0, "found storms at Eastmarch that woke someone");
});

test("same-tick triggers coalesce into one wake", () => {
  const sim = run({ seed: 2, content: crisis }, 60);
  const seen = new Set<string>();
  for (const w of wakes(sim)) {
    const k = `${w.payload.agent}@${w.tick}`;
    assert.ok(!seen.has(k), `two wakes for ${k}`);
    seen.add(k);
  }
});

test("wake budgets per tier are respected (A: 20 per agent per day)", () => {
  for (const seed of [1, 2]) {
    const sim = run({ seed, content: crisis }, 120);
    const per = new Map<string, number>();
    for (const w of wakes(sim)) { const k = `${w.payload.agent}:${Math.floor(w.tick / DAY)}`; per.set(k, (per.get(k) ?? 0) + 1); }
    for (const [k, n] of per) assert.ok(n <= 20, `${k}: ${n}`);
  }
});

test("same evidence, different explainable plans: Elara and Caron advise differently", () => {
  // Both stand at court and are given exactly the same beliefs: Northwatch worn, raiders strong in the Blackwood.
  const sim = run({ seed: 1, content: crisis, policy: "passive", ablate: ["messenger"] }, 3);
  const w = sim.unsafeWorldForDebug();
  const beliefs: Record<string, number> = { "northwatch|fortification.condition": 60000, "blackwood|threat.intensity": 700, "eastmarch|fortification.condition": 84000, "greybridge|fortification.condition": 88000 };
  const shared = () => {
    const seen = new Map<string, Seen>();
    return { get: (id: string, p: string) => { const v = beliefs[`${id}|${p}`]; if (v === undefined) return null;
      const x: Seen = { value: v, propId: 1, ageTicks: 86400, band: "probable", subject: { kind: "location", id }, predicate: p }; seen.set(`${id}|${p}`, x); return x; },
      consulted: () => [...seen.values()] };
  };
  const decide = (who: string) => {
    const sit = buildSituation(w, CONTENT_OF(sim), who, sim.tick, "advise", sim.viewOf(who));
    assert.equal(sit.at, "ravenport", `${who} is at court`);
    return plan(sit, shared())!;
  };
  const el = decide("elara"), ca = decide("caron");
  assert.notDeepEqual(el.selected, ca.selected, `Elara ${JSON.stringify(el.selected)} vs Caron ${JSON.stringify(ca.selected)}`);
  for (const r of [el, ca]) {
    const sel = r.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(r.selected))!;
    assert.ok(sel.contributions.length >= 2, "explained by several reasons");
    assert.ok(sel.contributions.some((x) => x.kind === "trait" || x.kind === "objective"));
  }
});

test("councillors hearing the same dispatch can advise differently", () => {
  let differ = 0;
  for (const seed of [1, 2, 3]) {
    const sim = run({ seed, content: crisis, policy: "passive" }, 40);
    const byTrigger = new Map<number, Set<string>>();
    const byId = new Map(sim.log.map((e) => [e.id, e]));
    for (const { e, t } of traces(sim)) if (t.kind === "advise") {
      const woke = byId.get(e.causedBy[0])!;
      const k = (woke.payload.triggers as number[]).map((x) => byId.get(x)!.causedBy[0])[0];
      if (!byTrigger.has(k)) byTrigger.set(k, new Set());
      byTrigger.get(k)!.add(JSON.stringify(t.selected));
    }
    for (const s of byTrigger.values()) if (s.size > 1) differ++;
  }
  assert.ok(differ > 0);
});

test("commitment: a near-equal challenger does not replace the current intention", () => {
  assert.deepEqual(keepOrSwitch({ current: 10000, best: 10500, commitmentPermille: 500, baseMarginPermille: 150, absFloorMilli: 1000 }), { keep: true, margin: 1500 });
  assert.deepEqual(keepOrSwitch({ current: 10000, best: 12000, commitmentPermille: 500, baseMarginPermille: 150, absFloorMilli: 1000 }), { keep: false, margin: 1500 });
  // stubborn agents need a bigger margin
  assert.equal(keepOrSwitch({ current: 10000, best: 12000, commitmentPermille: 800, baseMarginPermille: 150, absFloorMilli: 1000 }).keep, true);
});

test("no agent flips between plans and back on successive minor events", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = run({ seed, content: crisis }, 120);
    const byAgent = new Map<string, { tick: number; sel: string; options: string[] }[]>();
    for (const { t } of traces(sim)) if (t.kind === "plan") {
      if (!byAgent.has(t.agent)) byAgent.set(t.agent, []);
      byAgent.get(t.agent)!.push({ tick: t.tick, sel: JSON.stringify(t.selected), options: t.candidates.map((c) => JSON.stringify(c.action)) });
    }
    // Dithering = going back to A while B was still possible. Returning because B is done or impossible is not.
    for (const [agent, xs] of byAgent)
      for (let i = 2; i < xs.length; i++)
        if (xs[i].sel === xs[i - 2].sel && xs[i].sel !== xs[i - 1].sel && xs[i].tick - xs[i - 2].tick < 3 * DAY)
          assert.ok(!xs[i].options.includes(xs[i - 1].sel), `${agent} flipped A-B-A within 3 days at ${xs[i].tick} (seed ${seed})`);
  }
});

test("every DecisionTrace validates, and its selection is reproducible from its candidates", () => {
  const sim = run({ seed: 3, content: crisis }, 90);
  const ts = traces(sim);
  assert.ok(ts.length > 10);
  for (const { t } of ts) {
    assert.deepEqual(validateDecisionTrace(t), []);
    for (const b of t.beliefsConsulted) { assert.ok(b.ageTicks >= 0); assert.ok(["certain", "probable", "uncertain", "doubtful"].includes(b.reliability)); }
    if (t.kind === "plan" && !t.keptCurrentIntention) {
      const top = [...t.candidates].sort((a, b) => b.score - a.score || (JSON.stringify(a.action) < JSON.stringify(b.action) ? -1 : 1))[0];
      assert.deepEqual(t.selected, top.action);
    }
  }
});

test("the planner reads only beliefs: agent modules import nothing that exposes WorldState", () => {
  const dir = new URL("../src/agents/", import.meta.url).pathname;
  const allowed = new Set(["../view.ts", "../beliefs.ts", "../schemas.ts", "../content.ts", "./planner.ts", "./model.ts", "./obedience.ts", "./terms.ts"]);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(allowed.has(m[1]), `${f} imports ${m[1]}`);
  }
});

test("better planners consider more options", () => {
  // Same beliefs for both: a worn fort and raiders nearby. Elara (military 800) sees more ways to act than Selene (200).
  const sim = run({ seed: 1, content: crisis, policy: "passive", ablate: ["messenger"] }, 3);
  const w = sim.unsafeWorldForDebug();
  const B: Record<string, number> = { "northwatch|fortification.condition": 55000, "blackwood|threat.intensity": 700, "eastmarch|fortification.condition": 60000, "greybridge|fortification.condition": 65000 };
  const per = () => ({ get: (id: string, p: string) => B[`${id}|${p}`] === undefined ? null
    : ({ value: B[`${id}|${p}`], propId: 1, ageTicks: 0, band: "probable", subject: { kind: "location", id }, predicate: p }) as Seen, consulted: () => [] });
  const n = (who: string) => plan(buildSituation(w, sim.content, who, sim.tick, "advise", sim.viewOf(who)), per())!.candidates.length;
  assert.ok(n("elara") > n("selene"), `elara ${n("elara")} vs selene ${n("selene")}`);
});

test("obedience: obey, adapt and refuse follow margins, never a roll", () => {
  const base = { obey: 5000, bestServing: 5000, bestOther: 5000, adaptMargin: 3000, refuseMargin: 9000 };
  assert.equal(decideObedience(base).decision, "obey");
  assert.equal(decideObedience({ ...base, bestServing: 8500 }).decision, "adapt");
  assert.equal(decideObedience({ ...base, bestOther: 15000 }).decision, "refuse");
  assert.equal(decideObedience({ ...base, bestOther: 13000 }).decision, "obey", "below the refusal margin");
  assert.deepEqual(decideObedience({ ...base, bestServing: 8500 }), decideObedience({ ...base, bestServing: 8500 }));
});

test("order recipients decide, with reasons, and the decision is traced", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 2, kind: "order", from: "anna", to: "caron", intent: "advance", objective: { kind: "location", id: "northwatch" } }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  // the fixture pins the old balance (repair cost, walls wearing): these tests are about how agents choose, not about the economy
  r.scenario.player.repairCostMilliPerMilli = 2; r.scenario.weather.decayMilliPerDay = 250;
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const ob = sim.log.find((e) => e.type === "ObedienceDecided")!;
  assert.ok(["obey", "adapt", "refuse"].includes(ob.payload.decision as string));
  assert.ok((ob.payload.reasons as unknown[]).length > 0);
  const tr = sim.log.find((e) => e.id === ob.causedBy[0])!;
  assert.equal(tr.type, "DecisionMade");
  assert.equal((tr.payload.trace as DecisionTrace).kind, "obedience");
  const interp = sim.log.find((e) => e.type === "OrderInterpreted")!;
  assert.ok(typeof interp.payload.comprehensionPermille === "number");
});

test("a disloyal recipient refuses an order he thinks wrong; refusal is recorded as such", () => {
  const c = variant((r) => {
    r.scenario.scripts = [{ day: 2, kind: "order", from: "anna", to: "caron", intent: "advance", objective: { kind: "location", id: "highcairn" } }];
    r.characters.find((x) => x.id === "caron")!.relationships = [{ to: "anna", kind: "loyalty", value: 0 }];
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  // the fixture pins the old balance (repair cost, walls wearing): these tests are about how agents choose, not about the economy
  r.scenario.player.repairCostMilliPerMilli = 2; r.scenario.weather.decayMilliPerDay = 250;
  });
  const sim = run({ seed: 1, content: c, policy: "passive" }, 10);
  const ob = sim.log.find((e) => e.type === "ObedienceDecided")!;
  assert.equal(ob.payload.decision, "refuse");
  assert.ok(sim.log.some((e) => e.type === "OrderAbandoned" || e.type === "ReportComposed"));
});

test("experience grows from relevant work", () => {
  const sim = run({ seed: 2, policy: "aggressive" }, 240);
  assert.ok(sim.log.some((e) => e.type === "ExperienceGained" && e.payload.agent === "bren" && e.payload.domain === "engineering"));
});

test("councillors present at court hear dispatches read out; the absent do not", () => {
  const sim = run({ seed: 1, content: crisis, policy: "passive" }, 30);
  const shared = sim.log.filter((e) => e.type === "ReportShared");
  assert.ok(shared.length > 0);
  for (const e of shared) assert.ok(!(e.payload.hearers as string[]).includes("bren") && !(e.payload.hearers as string[]).includes("mara"));
  void CONTENT;
});
