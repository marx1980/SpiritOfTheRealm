// A7 / B5 invariant: presentation and planners see ViewOf only; beliefs come only from delivered reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderCourtSummary } from "../src/presentation/court.ts";
import { run } from "./helpers.ts";

test("sim.world is not readable from outside the simulation", () => {
  const sim = run({ seed: 1 }, 30);
  assert.throws(() => (sim as unknown as { world: unknown }).world, /ViewOf/);
});

test("ViewOf(player) is frozen and holds only beliefs, delivered reports and the clock", () => {
  const sim = run({ seed: 1 }, 60);
  const v = sim.viewOf("player");
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.beliefs));
  assert.deepEqual(Object.keys(v).sort(), ["advice", "beliefs", "environment", "ledger", "now", "reports", "self", "world"]); // the environment block is Phase 10 (D-072); the ledger is the steward's books of goods, given to the ruler at the seat (D-044)
  assert.throws(() => { (v as { now: number }).now = 0; });
});

test("no belief from a report before its ReportDelivered event, and only for its recipient", () => {
  for (const seed of [1, 2, 3, 4]) {
    const sim = run({ seed });
    const delivered = new Map<number, { id: number; recipient: string }>();
    for (const e of sim.log) {
      if (e.type === "ReportDelivered") delivered.set(e.payload.reportId as number, { id: e.id, recipient: e.payload.recipient as string });
      if (e.type !== "BeliefUpdated") continue;
      for (const ev of (e.payload.prop as { evidenceRefs: { kind: string; reportId?: number; eventId: number }[] }).evidenceRefs) {
        if (ev.kind !== "report" || !e.causedBy.includes(ev.eventId)) continue;
        if (ev.reportId === undefined) {
          // told in person (steward relays what he saw to the ruler at the seat): backed by his observation
          const obs = sim.log.find((x) => x.id === ev.eventId)!;
          assert.equal(obs.type, "Observed", `seed ${seed}: told evidence must come from an observation`);
          assert.equal(obs.payload.observer, (ev as { source?: string }).source);
          continue;
        }
        const d = delivered.get(ev.reportId!);
        assert.ok(d, `seed ${seed}: belief from undelivered report ${ev.reportId}`);
        const src = sim.log.find((x) => x.id === ev.eventId)!;
        if (src.type === "ReportShared") assert.ok((src.payload.hearers as string[]).includes(e.payload.holder as string), "heard at court");
        else { assert.equal(d.recipient, e.payload.holder); assert.equal(ev.eventId, d.id); }
      }
    }
  }
});

test("the player's belief can differ from the truth (reports age and can be lost)", () => {
  let differs = false;
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = run({ seed }, 120);
    const truth = sim.unsafeWorldForDebug();
    for (const b of Object.values(sim.viewOf("player").beliefs))
      if (b.predicate === "fortification.condition" && truth.fortifications[b.subject.id].conditionMilli !== b.believedValue) differs = true;
  }
  assert.ok(differs);
});

test("presentation renders from a view", () => {
  const sim = run({ seed: 2 }, 60);
  const text = renderCourtSummary(sim.viewOf("player"));
  assert.match(text, /day 60/);
});

test("presentation modules import nothing that exposes WorldState (static check)", () => {
  const dir = new URL("../src/presentation/", import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(m[1] === "../view.ts" || /^\.\/[a-z]+\.ts$/.test(m[1]), `${f} imports ${m[1]}`);
  }
});
