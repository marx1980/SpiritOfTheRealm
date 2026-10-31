// Phase 3 / DESIGN_PIPELINE §11: retroactive failure attribution (belief / choice / communication / execution).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRun } from "../src/chronicle.ts";
import { hashLog } from "../src/engine.ts";
import { run, variant } from "./helpers.ts";

const crisis = variant((r) => {
  r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 900, durationDays: 80 }];
});

test("the chronicle pass never changes the log", () => {
  const sim = run({ seed: 1, content: crisis }, 120);
  const h = hashLog(sim.log);
  analyzeRun(sim);
  assert.equal(hashLog(sim.log), h);
});

test("every evaluated decision gets a verdict, and every bad one an origin", () => {
  let bad = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const a = analyzeRun(run({ seed, content: crisis }, 120));
    for (const d of a.decisions.filter((x) => x.evaluated)) {
      assert.equal(typeof d.bad, "boolean");
      if (d.bad) { bad++; assert.ok(["belief", "choice", "communication", "execution"].includes(d.failureOrigin!), JSON.stringify(d)); }
    }
  }
  assert.ok(bad > 0);
});

test("the four origins all occur across seeds", () => {
  const seen = new Set<string>();
  const lossy = variant((r) => {
    r.scenario.scripts = [{ day: 3, kind: "threat", site: "blackwood", intensityPermille: 900, durationDays: 80 }];
    r.scenario.messenger.lossPermillePerDay = 400;
  });
  for (let seed = 1; seed <= 30 && seen.size < 4; seed++)
    for (const c of [crisis, lossy])
      for (const d of analyzeRun(run({ seed, content: c, policy: seed % 2 ? "delegating" : "aggressive" }, 150)).decisions) if (d.bad) seen.add(d.failureOrigin!);
  assert.deepEqual([...seen].sort(), ["belief", "choice", "communication", "execution"]);
});

test("wrong-belief decisions are detected against the truth at decision time", () => {
  let wrong = 0, total = 0;
  for (const seed of [1, 2, 3, 4]) for (const d of analyzeRun(run({ seed, content: crisis }, 120)).decisions) { total++; if (d.wrongOrStale) wrong++; }
  assert.ok(total > 0 && wrong > 0 && wrong < total, `${wrong}/${total}`);
});

test("breaches are bad outcomes too, attributed to the responsible decision when there is one", () => {
  const a = analyzeRun(run({ seed: 2, content: crisis, policy: "passive" }, 200));
  for (const b of a.breaches) if (b.decisionEventId) assert.ok(["belief", "choice", "communication", "execution"].includes(b.failureOrigin!));
});
