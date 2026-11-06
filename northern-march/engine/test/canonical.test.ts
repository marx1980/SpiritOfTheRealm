// Plan section C5: the canonical scenarios T01-T10 and I01-I03. Most are covered by tests elsewhere; this file names
// them, checks that each named test still exists, and holds the checks that had no test of their own (T04, T06).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createSim } from "../src/engine.ts";
import { decideObedience } from "../src/agents/obedience.ts";
import { variant } from "./helpers.ts";

const DIR = new URL("./", import.meta.url).pathname;
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".test.ts")).map((f) => readFileSync(DIR + f, "utf8")).join("\n");

/** Scenario -> the test(s) that carry it (by title prefix). Built-in checks below carry T04 and T06. */
const CANON: Record<string, string[]> = {
  T01: ["lazy staleness: the band drops one step per half-life", "the player's belief can differ from the truth"],
  T02: ["contradictions from different sources are kept"],
  T03: ["a disloyal recipient refuses an order he thinks wrong", "obedience: obey, adapt and refuse follow margins"],
  T04: ["T04: as the margin moves"],
  T05: ["a new order supersedes the old one only when it is received"],
  T06: ["T06: an empty treasury"],
  T07: ["I02 / T07: one levy, different reactions"],
  T08: ["Stefan promotes from background to expedition commander"],
  T10: ["councillors hearing the same dispatch can advise differently", "same evidence, different explainable plans"],
  I02: ["I02 / T07: one levy, different reactions", "competing narratives"],
  I03: ["I03: maximum grievance alone never escalates past delay"],
};

test("every canonical scenario built so far has its named test (T09 waits for the battlefield, I01 for grain)", () => {
  for (const [id, titles] of Object.entries(CANON)) for (const t of titles)
    assert.ok(ALL.includes(`test("${t}`), `${id}: no test titled "${t}..."`);
});

test("T04: as the margin moves, obedience changes gradually: obey, then adapt, then refuse, never back and forth", () => {
  for (const [adaptMargin, refuseMargin] of [[200, 600], [500, 1500], [1000, 2500]]) {
    const seq: string[] = [];
    for (let gap = -2000; gap <= 4000; gap += 50) {
      // the better alternative grows; a serving adaptation trails it by a fixed amount
      seq.push(decideObedience({ obey: 0, bestServing: Math.floor(gap * 0.7), bestOther: gap, adaptMargin, refuseMargin }).decision);
    }
    const changes = seq.filter((x, i) => i > 0 && x !== seq[i - 1]);
    assert.ok(changes.length <= 2, `at most two changes: ${changes.join(",")}`);
    const order = ["obey", "adapt", "refuse"];
    for (let i = 1; i < seq.length; i++) assert.ok(order.indexOf(seq[i]) >= order.indexOf(seq[i - 1]), "monotone");
    assert.equal(seq[0], "obey"); assert.equal(seq[seq.length - 1], "refuse");
  }
});

test("T06: an empty treasury changes what happens (repairs are abandoned for funds) without spawning unrest", () => {
  const c = variant((r) => {
    r.scenario.treasuryMilli = 0; r.scenario.economy.holdings = r.scenario.economy.holdings.map((h) => ({ ...h, dailyIncomeMilli: 0, jitterMilli: 0 }));
    r.scenario.threat.startPermillePerDay = 0;
    r.scenario.scripts.push({ day: 3, kind: "order", from: "anna", to: "bren", intent: "repair", objective: { kind: "location", id: "northwatch" } });
    r.locations.find((l) => l.id === "northwatch")!.fortification!.conditionMilli = 60000;
  });
  const sim = createSim({ content: c, seed: 2, policy: "passive" });
  sim.runDays(40);
  assert.ok(sim.log.some((e) => e.type === "OrderAbandoned" && e.payload.reason === "funds"), "the repair is abandoned for lack of funds");
  assert.ok(!sim.log.some((e) => e.type === "CommunityStanceChanged"), "no community stirs because the crown is poor");
});
