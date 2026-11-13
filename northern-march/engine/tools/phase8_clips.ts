// H-03 clip set, version 3 (D-066): moments as headquarters sees them (the player's own view), cut from simulated battles
// at Northwatch. Version 2 showed that spotting a unit in trouble and telling the sides apart were easy; what is left to test:
//   spot  - the busiest moments where one or two of the crown's units are seen breaking: tap one;
//   find  - one picture: tap our cavalry, Caron's company, or the unit of ours under arrows (do the emblems, the knight
//           and the volleys read at real size?);
//   known - one unit outlined in a single picture, fully in view and clear of others: seen now, or a report?
// Every clip set carries a stamp; answers given on another set are not mixed in. Lab tool: nothing here changes the game.
//   node tools/phase8_clips.ts -> ui/h03/clips.json
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { runBattle, type BattleOrder, type HqFrame, type Mark } from "../src/battlefield/core.ts";
import { glyphOf, type Glyph } from "../ui/battleart.ts";
import { sampleSetup } from "../test/battle_sample.ts";

const LEN = 6, SPOT = 10, FIND_EACH = 4, KNOWN = 12;
interface Pic { t: number; hq: { x: number; y: number }; glyphs: Glyph[] }
type Find = "cavalry" | "caron" | "arrows";
type Item =
  | { id: string; kind: "spot"; frames: Pic[]; trouble: string[]; source: string }
  | { id: string; kind: "find"; what: Find; frame: Pic; truth: string[]; source: string }
  | { id: string; kind: "known"; frame: Pic; target: string; truth: "observed" | "reported"; source: string };

const attack = (id: number, t: number, to: string, limit?: string): BattleOrder => ({ schemaVersion: 1, id, t, from: "anna", to, via: "runner", task: { kind: "attack", ...(limit ? { limit } : {}) } });
const runs: { name: string; seed: number; raiders: number; way: string; hq: HqFrame[] }[] = [];
for (let seed = 1; seed <= 30; seed++) for (const raiders of [180, 360, 520]) for (const v of [0, 1]) {
  const s = sampleSetup({ seed, raiders, anna: v ? "centre" : "rear" });
  const orders = v ? [attack(1, 900, "caron", seed % 2 ? "stream" : undefined), attack(2, 900, "bren")] : [];
  runs.push({ seed, raiders, way: v ? "attack" : "rear", name: `seed ${seed} raiders ${raiders} anna ${v ? "centre, attack ordered" : "rear"}`, hq: runBattle(s, orders).hq });
}
// every strength and way of fighting in turn, seeds mixed
const spread = [...runs].sort((x, y) => ((x.seed * 31 + x.raiders + (x.way === "attack" ? 7 : 0)) % 101) - ((y.seed * 31 + y.raiders + (y.way === "attack" ? 7 : 0)) % 101));

const pic = (f: HqFrame): Pic => ({ t: f.t, hq: { x: f.x, y: f.y }, glyphs: f.marks.filter((m) => m.behaviour !== "gone").map(glyphOf) });
const live = (f: HqFrame) => f.marks.filter((m) => m.behaviour !== "gone");
const seenNow = (m: Mark) => m.category === "observed" && !m.stale;
const seenBreaking = (m: Mark) => seenNow(m) && (m.behaviour === "rout" || m.behaviour === "retreat");
/** No other unit within this many metres. */
const alone = (f: HqFrame, m: Mark, room: number) => live(f).every((x) => x.id === m.id || Math.hypot(x.x - m.x, x.y - m.y) > room);
const crownTrouble = (f: HqFrame) => f.marks.filter((m) => m.side === "crown" && seenBreaking(m)).map((m) => m.id);
/** How busy a picture is: units seen, plus pairs of units close enough to crowd each other. */
const busy = (f: HqFrame) => { const ls = live(f); let n = ls.length; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (Math.hypot(ls[i].x - ls[j].x, ls[i].y - ls[j].y) < 220) n += 2; return n; };
const items: Item[] = [];
const usedSeeds = new Set<number>();

// spot: the busiest windows (one or two of ours breaking in the last three pictures), one per seed, spread over strengths
{
  const cands: { r: (typeof runs)[number]; i: number; trouble: string[]; score: number }[] = [];
  for (const r of runs) for (let i = LEN; i + LEN <= r.hq.length; i += 3) {
    const w = r.hq.slice(i, i + LEN), tail = w.slice(-3), last = crownTrouble(w[LEN - 1]);
    if (!tail.every((f) => crownTrouble(f).length > 0) || last.length > 2) continue;
    cands.push({ r, i, trouble: [...new Set(w.flatMap(crownTrouble))], score: Math.min(...w.map(busy)) });
  }
  cands.sort((a, b) => b.score - a.score || a.r.seed - b.r.seed);
  const perBucket = new Map<string, number>();
  for (const c of cands) {
    if (items.length >= SPOT) break;
    const bucket = `${c.r.raiders}/${c.r.way}`;
    if (usedSeeds.has(c.r.seed) || (perBucket.get(bucket) ?? 0) >= Math.ceil(SPOT / 5)) continue;
    perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + 1); usedSeeds.add(c.r.seed);
    const w = c.r.hq.slice(c.i, c.i + LEN);
    items.push({ id: `spot-${items.length + 1}`, kind: "spot", frames: w.map(pic), trouble: c.trouble, source: `${c.r.name}, from ${w[0].t} s (busy ${c.score})` });
  }
}

// find: one busy picture, several of ours in view; the answer is any unit that fits
const fits: Record<Find, (f: HqFrame) => string[]> = {
  cavalry: (f) => live(f).filter((m) => m.side === "crown" && m.kind === "horse" && seenNow(m) && m.behaviour !== "rout").map((m) => m.id),
  caron: (f) => live(f).filter((m) => m.side === "crown" && m.kind === "foot" && /^Caron's /.test(m.label) && seenNow(m) && m.behaviour !== "rout").map((m) => m.id),
  arrows: (f) => [...new Set(live(f).filter((m) => m.side === "raiders" && m.shooting).map((m) => m.shooting!))].filter((id) => f.marks.some((m) => m.id === id && m.side === "crown" && seenNow(m))),
};
for (const what of ["cavalry", "caron", "arrows"] as Find[]) {
  let n = 0;
  for (const r of spread) {
    if (n >= FIND_EACH) break;
    if (items.some((x) => x.kind === "find" && x.source.startsWith(`seed ${r.seed} `))) continue;
    // a busy moment where the thing asked for is there, but not the only unit of ours
    const ok = r.hq.map((f, i) => ({ f, i })).filter(({ f, i }) => i > 20 && fits[what](f).length >= 1 && fits[what](f).length <= 2 && live(f).filter((m) => m.side === "crown" && seenNow(m)).length >= 4 && live(f).length >= 8);
    if (!ok.length) continue;
    const best = ok.sort((a, b) => busy(b.f) - busy(a.f))[0];
    items.push({ id: `find-${what}-${++n}`, kind: "find", what, frame: pic(best.f), truth: fits[what](best.f), source: `${r.name}, at ${best.f.t} s` });
  }
}

// known: one picture; the outlined unit fully clear of others (the page also frames on it)
for (const truth of ["observed", "reported"] as const) {
  let n = 0;
  for (const r of spread.filter((_, i) => i % 2 === (truth === "observed" ? 0 : 1))) {
    if (n >= KNOWN / 2) break;
    if (items.some((x) => x.kind === "known" && x.source.startsWith(`seed ${r.seed} `))) continue;
    for (const f of [40 + (r.seed % 5) * 6, 70, 25, 55, 90, 33].map((i) => r.hq[Math.min(r.hq.length - 1, i)])) {
      const m = live(f).find((x) => x.kind !== "guard" && alone(f, x, 200) && x.y > 250 && x.y < 1380 && x.x > 200 && x.x < 2200 && (truth === "observed" ? x.category === "observed" && x.age === 0 : x.category === "reported" && x.age >= 180 && !x.stale));
      if (!m) continue;
      items.push({ id: `known-${truth}-${++n}`, kind: "known", frame: pic(f), target: m.id, truth, source: `${r.name}, ${m.id} at ${f.t} s` });
      break;
    }
  }
}

const set = createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 12);
const out = new URL("../ui/h03/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + "clips.json", JSON.stringify({ version: 3, set, items }));
const count = (k: string) => items.filter((i) => i.kind === k).length;
console.log("set", set, "spot", count("spot"), "find", count("find"), items.filter((i) => i.kind === "find").map((i) => (i as { what: string }).what).join(","), "known", count("known"), "(reported", items.filter((i) => i.kind === "known" && i.truth === "reported").length + ")");
