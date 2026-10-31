// G-01: same seed and inputs give an identical log hash. Within a process, across processes with
// different time zone / locale, and (if bun is installed) across a different JavaScript engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { hashLog } from "../src/engine.ts";
import { run } from "./helpers.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

test("same seed, same log hash (in process)", () => {
  for (const seed of [1, 2, 3, 77]) {
    assert.equal(hashLog(run({ seed }).log), hashLog(run({ seed }).log));
  }
});

test("different seeds give different logs", () => {
  const hashes = new Set([1, 2, 3, 4, 5, 6].map((seed) => hashLog(run({ seed }).log)));
  assert.ok(hashes.size > 1);
});

test("hash is independent of time zone and locale (separate processes)", () => {
  const out = (env: Record<string, string>) =>
    execFileSync(process.execPath, [CLI, "g01", "--seeds", "1..20"], { env: { ...process.env, ...env } }).toString().trim().split("\n").pop();
  const a = out({ TZ: "UTC", LANG: "C" });
  const b = out({ TZ: "Pacific/Kiritimati", LANG: "hr_HR.UTF-8", LC_ALL: "hr_HR.UTF-8" });
  assert.equal(a, b);
});

test("hash is identical under a different JavaScript engine (bun), if installed", (t) => {
  let bun: string;
  try { bun = execFileSync("bash", ["-lc", "command -v bun"]).toString().trim(); } catch { t.skip("bun not installed"); return; }
  const node = execFileSync(process.execPath, [CLI, "g01", "--seeds", "1..20"]).toString().trim().split("\n").pop();
  const other = execFileSync(bun, [CLI, "g01", "--seeds", "1..20"]).toString().trim().split("\n").pop();
  assert.equal(node, other);
});
