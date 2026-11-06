// A1 / A4: save = seed + content version + inputs + log; load replays and verifies; schemas migrate or fail loudly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashLog, loadSave, SAVE_SCHEMA_VERSION } from "../src/engine.ts";
import { migrateSave } from "../src/save.ts";
import { CONTENT, run } from "./helpers.ts";

test("save mid-run, load, continue = uninterrupted run", () => {
  for (const policy of ["delegating", "aggressive", "random-valid"] as const) {
    const whole = run({ seed: 12, policy }, 240);
    const half = run({ seed: 12, policy }, 100);
    const save = JSON.parse(JSON.stringify(half.save()));
    const resumed = loadSave(save, CONTENT);
    resumed.runDays(140);
    assert.equal(hashLog(resumed.log), hashLog(whole.log), policy);
  }
});

test("a save records player inputs, and replay does not need the policy", () => {
  const sim = run({ seed: 3, policy: "aggressive" });
  const save = sim.save();
  assert.ok(save.inputs.length > 0);
  const replayed = loadSave({ ...save }, CONTENT);
  assert.equal(replayed.policyId, "replay");
  assert.equal(hashLog(replayed.log), hashLog(sim.log));
});

test("tampered log hash is rejected", () => {
  const save = run({ seed: 3 }, 30).save();
  assert.throws(() => loadSave({ ...save, logHash: "0".repeat(64) }, CONTENT), /hash mismatch/);
});

test("content version mismatch is rejected", () => {
  const save = run({ seed: 3 }, 30).save();
  assert.throws(() => loadSave({ ...save, contentVersion: "other-9" }, CONTENT), /content version/);
});

test("old save versions migrate explicitly; unknown versions fail loudly", () => {
  const save = run({ seed: 3 }, 30).save();
  assert.equal(save.schemaVersion, SAVE_SCHEMA_VERSION);
  const v0 = { ...save, schemaVersion: 0, playerInputs: save.inputs } as Record<string, unknown>;
  delete v0.inputs;
  const migrated = migrateSave(v0);
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(hashLog(loadSave(migrated, CONTENT).log), hashLog(run({ seed: 3 }, 30).log));
  assert.throws(() => migrateSave({ ...save, schemaVersion: 99 }), /unsupported save schemaVersion 99/);
});

test("a save replays the captain's mission and the repair mode the ruler chose (playtest L3 find)", async () => {
  const { loadContent } = await import("../src/content.ts");
  const { createSim } = await import("../src/engine.ts");
  const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
  const sim = createSim({ content, seed: 51, policy: "external", params: { dayEnd: true } });
  let sent = 0;
  for (let g = 0; g < 400 && sent < 2; g++) {
    const r = sim.next(120 * 86400);
    if (!r.paused) break;
    const v = sim.viewOf("player");
    const raid = v.world.places.find((p) => Object.values(v.beliefs).some((b) => b.predicate === "threat.intensity" && b.subject.id === p.id && (b.believedValue as number) > 0));
    if (sent === 0) { sim.answer([{ action: "repair", target: "northwatch", repairMode: "rush" }]); sent++; continue; }
    if (sent === 1 && raid) { sim.answer([{ action: "advance", target: "northwatch", mission: "scout", raid: raid.id }]); sent++; continue; }
    sim.answer([]);
  }
  assert.equal(sent, 2, "both orders were given");
  for (let g = 0; g < 400; g++) { const r = sim.next(sim.tick + 20 * 86400); if (!r.paused) break; sim.answer([]); }
  const back = loadSave(JSON.parse(JSON.stringify(sim.save())), content);
  assert.equal(hashLog(back.log), hashLog(sim.log));
});
