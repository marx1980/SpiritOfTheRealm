// A6 / C1 / C3: batch runner, metrics row, invariant harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runBatch, METRIC_FIELDS } from "../src/batch.ts";
import { checkRun } from "../src/invariants.ts";
import { CONTENT, run } from "./helpers.ts";

test("metrics row carries every C1 field (null = not measurable before its phase)", () => {
  const rows = runBatch({ content: CONTENT, seeds: [1, 2, 3], days: 60, policy: "delegating" });
  assert.equal(rows.length, 3);
  for (const r of rows) {
    for (const f of METRIC_FIELDS) assert.ok(f in r, f);
    assert.equal(r.armId, "on");
    assert.equal(r.policyId, "delegating");
    assert.match(r.calibrationHash, /^[0-9a-f]{12}$/);
    assert.equal(typeof r.endStateFlags.fortificationBreached, "boolean");
  }
});

test("invariant harness passes on every seed and policy", () => {
  for (const policy of ["passive", "delegating", "aggressive", "random-valid"] as const)
    for (let seed = 1; seed <= 15; seed++) assert.deepEqual(checkRun(run({ seed, policy })), [], `${policy} ${seed}`);
});

test("invariant harness catches a planted violation", () => {
  const sim = run({ seed: 1 }, 30);
  const log = sim.log.map((e) => ({ ...e }));
  log[5] = { ...log[5], causedBy: [log[9].id] };
  assert.ok(checkRun({ ...sim, log } as never).some((v) => /earlier/.test(v)));
});

test("CLI run writes one metrics row per seed", () => {
  const out = mkdtempSync(tmpdir() + "/nm-");
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  execFileSync(process.execPath, [cli, "run", "--seeds", "1..5", "--days", "30", "--policy", "passive", "--ablate", "threat", "--out", out]);
  const lines = readFileSync(out + "/metrics.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 5);
  assert.equal(lines[0].armId, "off:threat");
});
