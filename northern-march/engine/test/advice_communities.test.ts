// 7B(b): advisers use what they hear at court about the communities (petitions) in their advice. D-036.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, generate } from "../src/agents/planner.ts";
import type { Seen } from "../src/agents/model.ts";
import { buildSituation } from "../src/systems/agents.ts";
import { TICKS_PER_DAY as DAY } from "../src/engine.ts";
import { run } from "./helpers.ts";
import { followAdviser } from "../src/policies.ts";

const sim = run({ seed: 1, policy: "passive", ablate: ["messenger"] }, 3);
const w = sim.unsafeWorldForDebug();
type B = { subject: string; predicate: string; value: unknown; age?: number };
const perceiver = (bs: B[]) => {
  const seen = new Map<string, Seen>();
  return { get: (id: string, p: string) => { const b = bs.find((x) => x.subject === id && x.predicate === p); if (!b) return null;
    const x: Seen = { value: b.value, propId: 1, ageTicks: b.age ?? DAY, band: "certain", subject: { kind: "location", id }, predicate: p }; seen.set(`${id}|${p}`, x); return x; },
    consulted: () => [...seen.values()] };
};
const base: B[] = [{ subject: "anna", predicate: "treasury.balance", value: 2_000_000 }];
const sitOf = (who: string) => buildSituation(w, sim.content, who, sim.tick, "advise", sim.viewOf(who));
const asked = (age?: number): B[] => [...base, { subject: "greyfen", predicate: "community.request", value: "relief", age }, { subject: "greyfen", predicate: "community.grievance", value: "levy", age }];
const kinds = (who: string, bs: B[]) => generate(sitOf(who), perceiver(bs)).map((a) => a.kind);

test("a crown-minded adviser who has heard a fresh request for relief can advise it, and a stale request is dropped", () => {
  assert.ok(kinds("elara", asked()).includes("advise_relief"));
  assert.ok(!kinds("elara", base).includes("advise_relief"), "no request, no relief advice");
  assert.ok(!kinds("elara", asked(40 * DAY)).includes("advise_relief"), "a request older than the freshness window is not advised on");
});

test("Elara prefers relief to waiting; the steward weighs it against the purse and the scholar does not give it", () => {
  const el = plan(sitOf("elara"), perceiver(asked()))!;
  const relief = el.candidates.find((c) => c.action.kind === "advise_relief")!;
  const wait = el.candidates.find((c) => c.action.kind === "advise_wait")!;
  assert.ok(relief.score > wait.score, `relief ${relief.score} vs wait ${wait.score}`);
  assert.deepEqual(el.selected, { kind: "advise_relief", target: "greyfen" });
  assert.ok(relief.contributions.some((r) => r.textKey === "reason.community_eased"), "the reason is recorded");
  const or = plan(sitOf("oren"), perceiver(asked()))!;
  assert.ok((or.candidates.find((c) => c.action.kind === "advise_relief")?.score ?? -1e9) < relief.score, "the steward values it less than Elara");
  assert.ok(!kinds("selene", asked()).includes("advise_relief"), "Selene's list does not include relief");
});

test("a fresh levy grievance lowers the advice to levy, and no grievance does not", () => {
  const levy = (who: string, bs: B[]) => plan(sitOf(who), perceiver(bs))!.candidates.find((c) => c.action.kind === "advise_levy")?.score;
  const poor = [{ subject: "anna", predicate: "treasury.balance", value: 1000 }];
  const quiet = levy("elara", poor), sore = levy("elara", [...poor, { subject: "greyfen", predicate: "community.grievance", value: "levy" }]);
  assert.ok(quiet !== undefined && sore !== undefined && sore < quiet, `quiet ${quiet} vs sore ${sore}`);
  const stale = levy("elara", [...poor, { subject: "greyfen", predicate: "community.grievance", value: "levy", age: 40 * DAY }]);
  assert.equal(stale, quiet, "a stale grievance changes nothing");
});

test("a follower turns advice to send relief into the relief action", () => {
  const view = { ...sim.viewOf("anna"), advice: [{ author: "elara", plan: { kind: "plan", id: JSON.stringify({ kind: "advise_relief", target: "greyfen" }) } }] } as never;
  let out: unknown[] = [];
  try { out = followAdviser("elara")(view, null as never) as unknown[]; } catch (e) { assert.fail(`follower threw: ${(e as Error).message}`); }
  assert.deepEqual((out as { action: string; target: string }[]).map((x) => [x.action, x.target]), [["relief", "greyfen"]]);
});

// 7B(c): a standing grievance is not petitioned again every 30 days; only when it grew, or as a reminder after 90 days. D-036.
test("a grievance is petitioned again only when it has grown, or after the reminder period", () => {
  const ladder = sim.content.communities.params.ladder as unknown as { repetitionDays: number; regrowth: number; reminderDays: number };
  assert.ok(ladder.regrowth > 0 && ladder.reminderDays > ladder.repetitionDays, "the rule is in the content");
  let repeats = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = run({ seed, policy: "aggressive" }, 240);
    const last = new Map<string, { tick: number; felt: number }>();
    for (const e of s.log.filter((x) => x.type === "PetitionMade")) {
      const key = `${e.payload.community}:${e.payload.grievanceId}`, felt = Number(e.payload.felt), prev = last.get(key);
      assert.ok(Number.isFinite(felt), "a petition records how sore the grievance was");
      if (prev) {
        repeats++;
        const gap = e.tick - prev.tick;
        assert.ok(gap >= ladder.repetitionDays * DAY, `seed ${seed}: ${key} repeated after ${gap / DAY} days`);
        assert.ok(gap >= ladder.reminderDays * DAY || felt - prev.felt >= ladder.regrowth, `seed ${seed}: ${key} repeated unchanged after ${gap / DAY} days (${prev.felt} -> ${felt})`);
      }
      last.set(key, { tick: e.tick, felt });
    }
  }
  assert.ok(repeats > 0, "the sample does exercise repeat petitions");
});
