// C0: gate evaluator. Reproduces the Phase 0 and Phase 0b verdicts from their per-seed flags (DECISIONS D-007, D-008).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { wilson, bandVerdict, evaluateCausalGate, policyRule, GateLog } from "../src/gates.ts";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/phase0_flags.json", import.meta.url), "utf8"));
const bits = (s: string) => [...s].map((c) => c === "1");

test("Wilson interval matches the Phase 0 number (60/1000 -> 4.7-7.6%)", () => {
  const [lo, hi] = wilson(60, 1000);
  assert.equal(Math.round(lo * 1000), 47);
  assert.equal(Math.round(hi * 1000), 76);
});

test("three-state band verdicts", () => {
  assert.equal(bandVerdict(0.10, [0.06, 0.14], 0.05, 0.40), "PASS");
  assert.equal(bandVerdict(0.058, [0.044, 0.074], 0.05, 0.40), "AMBER");
  assert.equal(bandVerdict(0.015, [-0.005, 0.034], 0.05, 0.40), "FAIL");
});

test("reproduces Phase 0 verdicts on block 10000 (D-007)", () => {
  const expect: Record<string, [string, string]> = { CAL: ["FAIL", "FAIL"], ALT1: ["FAIL", "PASS"], ALT2: ["FAIL", "PASS"] };
  for (const [cal, [g03, g04]] of Object.entries(expect)) {
    const r = evaluateCausalGate(bits(FIX.phase0[cal].on), bits(FIX.phase0[cal].off));
    assert.equal(r.G03, g03, `${cal} G-03 (A=${r.A})`);
    assert.equal(r.G04, g04, `${cal} G-04 (lift=${r.lift})`);
  }
  const cal = evaluateCausalGate(bits(FIX.phase0.CAL.on), bits(FIX.phase0.CAL.off));
  assert.equal(Math.round(cal.A * 1000), 15);
});

test("reproduces Phase 0b: AMBER on block 20000, PASS on the 30000 extension (D-008)", () => {
  const verdict = (block: string) => {
    const per = Object.fromEntries(Object.entries(FIX.phase0b[block]).map(([pol, f]) => {
      const x = f as { on: string; off: string };
      return [pol, evaluateCausalGate(bits(x.on), bits(x.off))];
    }));
    const logsDiffer = (a: string, b: string) => FIX.phase0b[block][a].distinctFrom?.includes(b) ?? true;
    return policyRule(per, "G03", logsDiffer);
  };
  assert.equal(verdict("20000"), "AMBER");
  assert.equal(verdict("30000"), "PASS");
});

test("identical policies count once (C0.5)", () => {
  const P = (v: string) => ({ G03: v }) as never;
  const per = { passive: P("PASS"), delegating: P("AMBER"), aggressive: P("PASS") };
  assert.equal(policyRule(per, "G03", () => true), "PASS");
  assert.equal(policyRule(per, "G03", (a, b) => !([a, b].includes("passive") && [a, b].includes("aggressive"))), "AMBER");
});

test("gate log refuses TUNE seeds and a reused block for the same calibration", () => {
  const log = new GateLog(mkdtempSync(tmpdir() + "/gl-") + "/gate_log.jsonl");
  assert.throws(() => log.claim(5000, "abc"), /TUNE/);
  assert.throws(() => log.claim(10500, "abc"), /block start/);
  log.claim(10000, "abc");
  log.record({ seedBlock: 10000, calibrationHash: "abc", verdict: "FAIL" });
  assert.throws(() => log.claim(10000, "abc"), /already used/);
  log.claim(10000, "def");
  log.claim(20000, "abc");
});
