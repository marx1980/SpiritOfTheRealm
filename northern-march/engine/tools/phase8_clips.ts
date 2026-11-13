// H-03 clip set, version 2 (D-063): whole-field moments as headquarters sees them (the player's own view, with names,
// state words and report ages), cut from simulated battles at Northwatch. Three kinds of item:
//   spot  - a moment where some of the crown's units are seen breaking: the tester taps one ("which unit is in trouble?");
//   side  - one unit seen breaking, outlined: "whose unit is this?" (checks that a flash does not hide the side's colour);
//   known - one unit outlined in a single picture: seen now, or a report?
// Lab tool: reads the simulation's record; nothing here changes the game.
//   node tools/phase8_clips.ts -> ui/h03/clips.json
import { mkdirSync, writeFileSync } from "node:fs";
import { runBattle, type BattleOrder, type HqFrame, type Mark } from "../src/battlefield/core.ts";
import { glyphOf, type Glyph } from "../ui/battleart.ts";
import { sampleSetup } from "../test/battle_sample.ts";

const LEN = 6, SPOT = 18, SIDE = 12, KNOWN = 12;
interface Pic { t: number; hq: { x: number; y: number }; glyphs: Glyph[] }
type Item =
  | { id: string; kind: "spot"; frames: Pic[]; trouble: string[]; source: string }
  | { id: string; kind: "side"; frames: Pic[]; target: string; truth: "crown" | "raiders"; source: string }
  | { id: string; kind: "known"; frame: Pic; target: string; truth: "observed" | "reported"; source: string };

const attack = (id: number, t: number, to: string, limit?: string): BattleOrder => ({ schemaVersion: 1, id, t, from: "anna", to, via: "runner", task: { kind: "attack", ...(limit ? { limit } : {}) } });
const runs: { name: string; seed: number; hq: HqFrame[] }[] = [];
for (let seed = 1; seed <= 30; seed++) for (const raiders of [180, 360, 520]) for (const v of [0, 1]) {
  const s = sampleSetup({ seed, raiders, anna: v ? "centre" : "rear" });
  const orders = v ? [attack(1, 900, "caron", seed % 2 ? "stream" : undefined), attack(2, 900, "bren")] : [];
  runs.push({ seed, name: `seed ${seed} raiders ${raiders} anna ${v ? "centre, attack ordered" : "rear"}`, hq: runBattle(s, orders).hq });
}

const pic = (f: HqFrame): Pic => ({ t: f.t, hq: { x: f.x, y: f.y }, glyphs: f.marks.filter((m) => m.behaviour !== "gone").map(glyphOf) });
const seenBreaking = (m: Mark) => m.category === "observed" && !m.stale && (m.behaviour === "rout" || m.behaviour === "retreat");
/** No other unit within this many metres: an outline round it holds one unit only. */
const alone = (f: HqFrame, m: Mark, room = 140) => f.marks.every((x) => x.id === m.id || x.behaviour === "gone" || Math.hypot(x.x - m.x, x.y - m.y) > room);
const crownTrouble = (f: HqFrame) => f.marks.filter((m) => m.side === "crown" && seenBreaking(m)).map((m) => m.id);
const items: Item[] = [];

// spot: the last three pictures all show one or two of the crown's units seen breaking, on a busy field.
// The set is spread on purpose: every raider strength and both ways of fighting equally, different seeds, and moments from
// early, middle and late in the fight, so no two clips look like the same scene.
interface Cand { r: (typeof runs)[number]; i: number; trouble: string[]; bucket: string }
const cands: Cand[] = [];
for (const r of runs) for (let i = LEN; i + LEN <= r.hq.length; i += LEN) {
  const w = r.hq.slice(i, i + LEN), tail = w.slice(-3), last = crownTrouble(w[LEN - 1]);
  if (!tail.every((f) => crownTrouble(f).length > 0) || last.length > 2 || w[LEN - 1].marks.length < 8) continue;
  const raiders = /raiders (\d+)/.exec(r.name)![1], way = r.name.includes("attack") ? "attack" : "rear";
  cands.push({ r, i, trouble: [...new Set(w.flatMap(crownTrouble))], bucket: `${raiders}/${way}` });
}
const buckets = [...new Set(cands.map((c) => c.bucket))].sort();
const spotSeeds = new Set<number>(), spotKeys = new Set<string>(), tAt: number[] = [];
const picked: Cand[] = [];
for (let round = 0; picked.length < SPOT && round < 12; round++) for (const b of buckets) {
  if (picked.length >= SPOT) break;
  // within a bucket: an unused seed, a different set of troubled units, and the start time furthest from those already chosen
  const pool = cands.filter((c) => c.bucket === b && !spotSeeds.has(c.r.seed) && !spotKeys.has(`${c.r.name}`) && !picked.some((p) => p.r.seed === c.r.seed && p.i === c.i));
  if (!pool.length) continue;
  const t = (c: Cand) => c.r.hq[c.i].t, gap = (c: Cand) => (tAt.length ? Math.min(...tAt.map((x) => Math.abs(x - t(c)))) : 0);
  pool.sort((x, y) => gap(y) - gap(x) || x.r.seed - y.r.seed);
  const c = pool[0];
  picked.push(c); spotSeeds.add(c.r.seed); spotKeys.add(c.r.name); tAt.push(t(c));
}
picked.sort((x, y) => (x.r.seed * 7919) % 97 - (y.r.seed * 7919) % 97); // shuffled by seed, not grouped by strength
for (const c of picked) {
  const w = c.r.hq.slice(c.i, c.i + LEN);
  items.push({ id: `spot-${items.filter((x) => x.kind === "spot").length + 1}`, kind: "spot", frames: w.map(pic), trouble: c.trouble, source: `${c.r.name}, from ${w[0].t} s` });
}
const usedSeed = new Set<number>(picked.map((c) => c.r.seed));
// the other two kinds draw from the runs in an interleaved order too: every strength and way of fighting in turn
const spread = [...runs].sort((x, y) => ((x.seed * 31 + x.name.length * 7) % 101) - ((y.seed * 31 + y.name.length * 7) % 101));
// side: one unit seen breaking through the whole clip, half of them the crown's, half the raiders'
for (const side of ["crown", "raiders"] as const) {
  let n = 0;
  for (const r of spread) {
    if (n >= SIDE / 2) break;
    if (items.some((x) => x.kind === "side" && x.source.startsWith(`seed ${r.seed} `))) continue; // one clip per seed
    found: for (let i = 0; i + LEN <= r.hq.length; i += LEN) {
      const w = r.hq.slice(i, i + LEN);
      for (const m of w[0].marks.filter((m) => m.side === side && seenBreaking(m))) {
        if (!w.every((f) => f.marks.some((x) => x.id === m.id && seenBreaking(x) && alone(f, x)))) continue;
        items.push({ id: `side-${side}-${++n}`, kind: "side", frames: w.map(pic), target: m.id, truth: side, source: `${r.name}, ${m.id} from ${w[0].t} s` });
        break found;
      }
    }
  }
}
// known: a single picture with one unit outlined, seen now or reported (at least three minutes old)
for (const truth of ["observed", "reported"] as const) {
  let n = 0;
  for (const r of spread.filter((_, i) => i % 3 === (truth === "observed" ? 0 : 1))) {
    if (n >= KNOWN / 2) break;
    if (items.some((x) => x.kind === "known" && x.source.startsWith(r.name))) continue;
    const f = r.hq[Math.min(r.hq.length - 1, 40 + (r.seed % 5) * 6)];
    const m = f.marks.find((x) => x.behaviour !== "gone" && x.kind !== "guard" && alone(f, x) && (truth === "observed" ? x.category === "observed" && x.age === 0 : x.category === "reported" && x.age >= 180 && !x.stale));
    if (!m) continue;
    items.push({ id: `known-${truth}-${++n}`, kind: "known", frame: pic(f), target: m.id, truth, source: `${r.name}, ${m.id} at ${f.t} s` });
  }
}

const out = new URL("../ui/h03/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + "clips.json", JSON.stringify({ version: 2, items }));
const count = (k: string) => items.filter((i) => i.kind === k).length;
console.log("spot", count("spot"), "side", count("side"), "known", count("known"), "(reported", items.filter((i) => i.kind === "known" && i.truth === "reported").length + ")");
