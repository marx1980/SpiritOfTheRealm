// A1 / B1 / C3: the log is the source of truth and every event is well-formed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, EVENT_SCHEMA_VERSION } from "../src/events.ts";
import { canonicalJson } from "../src/canonical.ts";
import { run } from "./helpers.ts";

test("every event has the B1 envelope", () => {
  const { log } = run({ seed: 4 });
  assert.ok(log.length > 100);
  for (const e of log) {
    assert.equal(e.schemaVersion, EVENT_SCHEMA_VERSION);
    for (const k of ["id", "tick", "type", "domain", "significance", "causedBy", "subjects", "payload"]) assert.ok(k in e, k);
    assert.ok(EVENT_TYPES[e.type], `unregistered type ${e.type}`);
    assert.equal(e.domain, EVENT_TYPES[e.type].domain);
  }
});

test("ids increase, ticks never go backwards, causes point to earlier events", () => {
  for (const seed of [1, 2, 3, 9]) {
    const { log } = run({ seed });
    const ids = new Set<number>();
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      if (i > 0) { assert.ok(e.id > log[i - 1].id); assert.ok(e.tick >= log[i - 1].tick); }
      for (const c of e.causedBy) { assert.ok(ids.has(c), `dangling cause ${c}`); assert.ok(c < e.id); }
      ids.add(e.id);
    }
  }
});

test("empty causedBy only on exogenous or player-input types", () => {
  for (const seed of [1, 2, 3]) {
    for (const e of run({ seed }).log) {
      if (e.causedBy.length === 0) assert.ok(EVENT_TYPES[e.type].root, `${e.type} has no cause but is not a root type`);
    }
  }
});

test("no floats anywhere in the log (A2)", () => {
  assert.throws(() => canonicalJson({ a: 1.5 }), /non-integer/);
  assert.throws(() => canonicalJson({ a: [1, NaN] }), /non-integer/);
  for (const e of run({ seed: 5 }).log) canonicalJson(e); // throws on any float
});

test("canonical JSON sorts keys, so insertion order cannot change a hash", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
});

test("WorldState is a projection: folding the log rebuilds the live state", () => {
  for (const seed of [1, 6]) {
    const sim = run({ seed });
    assert.equal(canonicalJson(sim.projectFromLog()), canonicalJson(sim.unsafeWorldForDebug()));
  }
});
