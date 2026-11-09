// H-03 clip set (Phase 8, plan C2): short clips of formations in each of the seven behaviours, cut from real battles,
// plus marker items (the same formation drawn as seen now, or as reported). Lab tool: reads reality, which the game never does.
//   node tools/phase8_clips.ts [perBehaviour=4] [markers=12] -> ui/h03/clips.json
import { mkdirSync, writeFileSync } from "node:fs";
import { BEHAVIOURS, runBattle, type Behaviour, type BattleOrder, type Frame } from "../src/battlefield/core.ts";
import { sampleSetup } from "../src/battlefield/sample.ts";

const per = Number(process.argv[2] ?? 4), markerCount = Number(process.argv[3] ?? 12);
const W = 1000, H = 640, LEN = 6; // window in metres, frames per clip (30 s apart)
interface ClipFrame { formations: { id: string; side: string; kind: string; label: string; x: number; y: number; behaviour: Behaviour; men: number }[] }
interface Clip { id: string; kind: "behaviour"; truth: Behaviour; target: string; box: [number, number, number, number]; frames: ClipFrame[]; source: string }
interface MarkerItem { id: string; kind: "marker"; truth: "observed" | "reported"; target: string; box: [number, number, number, number]; frame: ClipFrame; source: string }

const withdraw = (t: number, to: string): BattleOrder => ({ schemaVersion: 1, id: 900, t, from: "anna", to, task: { kind: "withdraw", place: "gate" }, via: "voice" });
const runs: { name: string; seed: number; frames: Frame[] }[] = [];
for (let seed = 1; seed <= 24; seed++) for (const raiders of [180, 360, 520]) for (const v of [0, 1]) {
  const s = sampleSetup({ seed, raiders, ...(v ? { anna: "rear" as const } : {}) });
  const orders = v && seed % 2 ? [withdraw(1200 + (seed % 5) * 300, seed % 4 === 1 ? "bren" : "caron")] : [];
  runs.push({ seed, name: `seed ${seed} raiders ${raiders}${v ? " anna" : ""}${orders.length ? " withdraw" : ""}`, frames: runBattle(s, orders).frames });
}

const box = (fs: { x: number; y: number }[]): [number, number, number, number] => {
  const cx = Math.round(fs.reduce((n, f) => n + f.x, 0) / fs.length), cy = Math.round(fs.reduce((n, f) => n + f.y, 0) / fs.length);
  return [Math.max(0, Math.min(2400 - W, cx - W / 2)), Math.max(0, Math.min(1600 - H, cy - H / 2)), W, H];
};
const inBox = (b: number[], f: { x: number; y: number }) => f.x > b[0] - 100 && f.x < b[0] + b[2] + 100 && f.y > b[1] - 100 && f.y < b[1] + b[3] + 100;
const strip = (f: Frame, b: number[]): ClipFrame => ({ formations: f.formations.filter((x) => x.behaviour !== "gone" && inBox(b, x)).map(({ id, side, kind, label, x, y, behaviour, men }) => ({ id, side, kind, label, x, y, behaviour, men })) });

// candidates: a formation that shows one behaviour for the middle frames of a clip
const cands: Record<string, { run: number; start: number; id: string; side: string; kind: string }[]> = {};
runs.forEach((r, ri) => {
  const ids = r.frames[0].formations.map((f) => f.id);
  for (const id of ids) for (let i = 0; i + LEN <= r.frames.length; i += LEN) {
    const bs = r.frames.slice(i, i + LEN).map((f) => f.formations.find((x) => x.id === id)!.behaviour);
    const mid = bs.slice(1, LEN - 1);
    if (mid.every((b) => b === mid[0]) && mid[0] !== "gone" && bs.filter((b) => b === mid[0]).length >= LEN - 1) {
      const f = r.frames[i].formations.find((x) => x.id === id)!;
      (cands[mid[0]] ??= []).push({ run: ri, start: i, id, side: f.side, kind: f.kind });
    }
  }
});
// pick spread over runs, sides and kinds
const clips: Clip[] = [];
for (const b of BEHAVIOURS) {
  const pool = cands[b] ?? [];
  const chosen: typeof pool = [], used = new Set<string>();
  for (const pass of [0, 1, 2]) for (const c of pool) {
    if (chosen.length >= per) break;
    const key = pass === 0 ? `${c.side}:${c.kind}` : pass === 1 ? `${c.run}` : `${c.run}:${c.id}:${c.start}`;
    if (used.has(key) || chosen.includes(c)) continue;
    if (chosen.some((x) => runs[x.run].seed === runs[c.run].seed)) continue; // different battles, not the same one twice
    used.add(key); chosen.push(c);
  }
  for (const [k, c] of chosen.entries()) {
    const fr = runs[c.run].frames.slice(c.start, c.start + LEN);
    const bx = box(fr.map((f) => f.formations.find((x) => x.id === c.id)!));
    clips.push({ id: `${b}-${k + 1}`, kind: "behaviour", truth: b, target: c.id, box: bx, frames: fr.map((f) => strip(f, bx)), source: `${runs[c.run].name}, ${c.id} from ${fr[0].t} s` });
  }
  console.log(b, "candidates", pool.length, "chosen", chosen.length);
}
// marker items: a formation in good order, drawn as seen now or as reported
const markers: MarkerItem[] = [];
for (let i = 0; markers.length < markerCount && i < runs.length; i += 3) {
  const r = runs[i], f = r.frames[Math.min(r.frames.length - 1, 20)];
  const t = f.formations.find((x) => x.behaviour === "good_order" && x.side === (markers.length % 2 ? "raiders" : "crown"));
  if (!t) continue;
  const bx = box([t]);
  markers.push({ id: `marker-${markers.length + 1}`, kind: "marker", truth: markers.length % 3 === 1 || markers.length % 4 === 0 ? "reported" : "observed", target: t.id, box: bx, frame: strip(f, bx), source: `${r.name}, ${t.id} at ${f.t} s` });
}
const out = new URL("../ui/h03/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + "clips.json", JSON.stringify({ version: 1, items: [...clips, ...markers] }));
console.log("clips", clips.length, "markers", markers.length, "(observed", markers.filter((m) => m.truth === "observed").length + ")");
