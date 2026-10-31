// A5: content is data; the validator fails the build on unknown IDs, foreign traits, orphans, unreachable places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validateContent, readContentDir, TRAIT_VOCABULARY } from "../src/content.ts";

const DIR = new URL("../content/testbed/", import.meta.url).pathname;
const fresh = () => readContentDir(DIR);
const codes = (raw: ReturnType<typeof fresh>) => validateContent(raw).errors.map((e) => e.code);

test("testbed content is valid", () => {
  assert.deepEqual(validateContent(fresh()).errors, []);
});

test("trait vocabulary is the capped 14 (B6)", () => {
  assert.equal(TRAIT_VOCABULARY.length, 14);
  assert.deepEqual(fresh().traits.map((t) => t.id).sort(), [...TRAIT_VOCABULARY].sort());
});

test("unknown trait is rejected", () => {
  const raw = fresh(); raw.characters[0].traits.push("telepathic");
  assert.ok(codes(raw).includes("TRAIT_UNKNOWN"));
});

test("unknown location reference is rejected", () => {
  const raw = fresh(); raw.characters[0].location = "atlantis";
  assert.ok(codes(raw).includes("ID_UNKNOWN"));
});

test("orphan relationship is rejected", () => {
  const raw = fresh(); raw.characters[0].relationships.push({ to: "nobody", kind: "trust", value: 500 });
  assert.ok(codes(raw).includes("RELATIONSHIP_ORPHAN"));
});

test("unreachable location is rejected", () => {
  const raw = fresh(); raw.locations.push({ id: "island", name: "Island", kind: "village", exposurePermille: 0 });
  assert.ok(codes(raw).includes("LOCATION_UNREACHABLE"));
});

test("duplicate ids and non-integer numbers are rejected", () => {
  const raw = fresh(); raw.locations.push({ ...raw.locations[0] });
  assert.ok(codes(raw).includes("ID_DUPLICATE"));
  const raw2 = fresh(); raw2.routes[0].travelTicks = 1.5;
  assert.ok(codes(raw2).includes("NOT_INTEGER"));
});

test("wrong content schemaVersion is rejected", () => {
  const raw = fresh(); raw.manifest.schemaVersion = 7;
  assert.ok(codes(raw).includes("SCHEMA_VERSION"));
});

test("the engine contains no named characters or places (A5)", () => {
  const names = [...fresh().characters.map((c) => c.name), ...fresh().locations.map((l) => l.name)];
  const srcDir = new URL("../src/", import.meta.url).pathname;
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? walk(d + f.name + "/") : [d + f.name]);
  for (const f of walk(srcDir)) {
    const src = readFileSync(f, "utf8").toLowerCase();
    for (const n of names) assert.ok(!src.includes(n.toLowerCase()), `${f} mentions ${n}`);
  }
});
