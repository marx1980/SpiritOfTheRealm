// H-03, version 3 (D-066): does the battle screen work for play at real size? Version 2 showed the easy things are easy
// (finding a unit in trouble on a quiet field, telling the sides apart) and that labels got in the way. Now, with labels
// that make room and the pink flash: tap a unit of ours in trouble at the busiest moments (timed), find a unit by what it
// is (our cavalry, Caron's company, the unit under arrows), tell a unit seen now from a report, and rate how crowded each
// part looked. Answers are kept per tester (db: h03/<id>) with the stamp of the clip set they were given on.
import { BATTLE_CSS, STATE_WORD, battleSvg, frameBox, framePoints, unitBox, type Glyph } from "./battleart.ts";
import type { Behaviour, FieldSpec } from "../src/battlefield/core.ts";

interface Pic { t: number; hq: { x: number; y: number }; glyphs: Glyph[] }
type Find = "cavalry" | "caron" | "arrows";
type Item =
  | { id: string; kind: "spot"; frames: Pic[]; trouble: string[] }
  | { id: string; kind: "find"; what: Find; frame: Pic; truth: string[] }
  | { id: string; kind: "known"; frame: Pic; target: string; truth: "observed" | "reported" };
declare const __CLIPS__: { version: number; set: string; items: Item[] };
declare const __FIELD__: FieldSpec;
interface Answer { a: string; ms: number; note?: string }
interface Doc { version: 3; set: string; order: string[]; answers: Record<string, Answer>; startedAt: number; finishedAt?: number; guideSeenAt?: number; earlier?: unknown }

const PARTS = ["spot", "find", "known"] as const;
const PART_NAME: Record<(typeof PARTS)[number], string> = { spot: "In trouble", find: "Find", known: "Seen or reported" };
const FIND_Q: Record<Find, string> = { cavalry: "Tap our cavalry.", caron: "Tap Caron's company.", arrows: "Tap the unit of ours under arrows." };
const ORDER_OF_STATES: Behaviour[] = ["yielding", "disorganised", "rallying", "withdrawing", "retreat", "rout", "pursuing"];
const LOOK: Partial<Record<Behaviour, string>> = {
  yielding: "Shorter block, chevrons behind it.", disorganised: "Block broken into pieces.", rallying: "Men gathered round the banner, a turning ring.",
  withdrawing: "Whole block, one arrow to the rear.", retreat: "Block with a torn, jagged edge.", rout: "Scattered dots, no banner.", pursuing: "Loose wedge, arrows towards the enemy.",
};
const items = new Map(__CLIPS__.items.map((i) => [i.id, i]));
const app = document.getElementById("app")!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let earlier: unknown = undefined;
let db: any = null, uid: string | null = null, doc: Doc | null = null, frame = 0, saving = false, saveError = "", shownStep = "", shownAt = 0;
const results = location.hash === "#results";

function hash(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function shuffle<T>(xs: T[], seed: string): T[] {
  let h = hash(seed);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Each tester sees every item once, part by part, in an order of their own; a crowding rating closes each part. */
function plan(seed: string): Doc {
  const all = [...items.values()];
  const order = PARTS.flatMap((k) => [...shuffle(all.filter((x) => x.kind === k).map((x) => `${k}:${x.id}`), seed + k), `rate:${k}`]);
  return { version: 3, set: __CLIPS__.set, order, answers: {}, startedAt: Date.now() };
}

const pad = (g: Glyph, p: number) => { const b = unitBox(g); return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p }; };
const outlineBox = (g: Glyph) => pad(g, 22);
const outline = (g: Glyph) => { const b = outlineBox(g); return `<rect class="outline" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="16"/>`; };
const hits = (gs: Glyph[]) => gs.map((g) => { const b = pad(g, 20); return `<rect class="hit" data-hit="${esc(g.id)}" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}"/>`; }).join("");

function picture(step: string): string {
  const [kind, id] = step.split(":"), it = items.get(id)!;
  const p = it.kind === "spot" ? it.frames[frame % it.frames.length] : it.frame;
  const target = it.kind === "known" ? p.glyphs.find((g) => g.id === it.target) : undefined;
  const extra = (target ? outline(target) : "") + (kind !== "known" ? hits(p.glyphs) : "");
  return battleSvg(__FIELD__, p.glyphs, { hq: p.hq, flash: "pink", extra, viewBox: boxOf(it), avoid: target ? [outlineBox(target)] : [] });
}
// one steady frame per item, round what it shows (and always round the outlined unit); squarer on a narrow screen
const boxes = new Map<string, string>();
function boxOf(it: Item): string {
  const aspect = window.innerWidth < 600 ? 1 : 1.5, key = `${it.id}:${aspect}`;
  if (!boxes.has(key)) {
    // framed on our units seen now (where the question is), not on headquarters or distant reports, so units are big enough
    // on the busiest cluster of units (as a player would zoom), widened to take in the units the question is about
    const ps = it.kind === "spot" ? it.frames : [it.frame], last = ps[ps.length - 1].glyphs, seen = last.filter((g) => g.category === "observed" && !g.stale), first = seen.length ? seen : last;
    const near = (g: Glyph, h: Glyph) => Math.hypot(g.x - h.x, g.y - h.y) < 420;
    const hub = [...first].sort((a, b) => first.filter((x) => near(x, b)).length - first.filter((x) => near(x, a)).length || (a.id < b.id ? -1 : 1))[0];
    const must = it.kind === "spot" ? it.trouble : it.kind === "find" ? it.truth : [];
    let pts: { x: number; y: number }[] = ps.flatMap((p) => p.glyphs.filter((g) => (hub && near(g, hub)) || must.includes(g.id)));
    if (!pts.length) pts = ps.flatMap((p) => framePoints(p.glyphs));
    if (it.kind === "known") {
      const g = it.frame.glyphs.find((x) => x.id === it.target)!, b = outlineBox(g);
      pts = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }, ...it.frame.glyphs.filter((x) => Math.hypot(x.x - g.x, x.y - g.y) < 450)];
    }
    boxes.set(key, frameBox(pts, __FIELD__, aspect, aspect < 1.2 ? 650 : 900, 140));
  }
  return boxes.get(key)!;
}

function guide(head: string) {
  app.innerHTML = `${head}<section class="card guide-card"><h2>The screen</h2>
    <p>The battle as the queen's headquarters sees it. <b class="crown-key">Blue</b> units are ours, <b class="raid-key">dark red</b> are the raiders'. Ours push up the field.</p>
    <p>Inside each block: sword for foot, bow for archers, horse for cavalry, crown for the queen's guard; a knight marks a captain's own company.</p>
    <p>A <b>solid</b> unit is seen now. A <b>dashed</b> unit is a report, with its age. Units seen breaking flash pink. A dashed arc with falling arrows: archers shooting.</p>
    <p>Our units in good order have no word. Any other state is written by the unit:</p>
    <ul class="guide">${ORDER_OF_STATES.map((b) => `<li><b>${STATE_WORD[b]}</b><span>${esc(LOOK[b])}</span></li>`).join("")}</ul>
    <h2>What you do</h2>
    <ul class="guide"><li><b>${PART_NAME.spot}</b><span>tap a unit of ours that is in trouble, as fast as you can.</span></li>
    <li><b>${PART_NAME.find}</b><span>tap the unit asked for.</span></li>
    <li><b>${PART_NAME.known}</b><span>is the outlined unit seen now, or a report?</span></li>
    <li><b>Crowded?</b><span>after each part, rate how crowded the screen looked, and note what overlapped or hid something.</span></li></ul>
    <button class="start" data-a="start">Start</button></section>`;
}

function render() {
  if (results) return renderResults();
  if (!doc) { app.innerHTML = `<header><h1>Battle clips</h1></header><p class="dim">Loading…</p>`; return; }
  const done = doc.order.filter((id) => id in doc!.answers).length, cur = doc.order.find((id) => !(id in doc!.answers));
  const head = `<header><h1>Battle clips</h1><span class="prog">${done} / ${doc.order.length}</span></header>`;
  if (!doc.guideSeenAt && done === 0) return guide(head);
  if (!cur) {
    app.innerHTML = `${head}<section class="card"><h2>Done</h2>${db ? `<p>${saveError ? `<span class="bad">${esc(saveError)}</span>` : "Saved."}</p>` : `<p>Copy this and send it back:</p><textarea readonly>${esc(JSON.stringify(doc))}</textarea>`}</section>`;
    return;
  }
  if (cur !== shownStep) { shownStep = cur; shownAt = performance.now(); frame = 0; }
  const [kind, id] = cur.split(":");
  const err = saveError ? `<p class="bad">${esc(saveError)}</p>` : "";
  const dis = saving ? "disabled" : "";
  if (kind === "rate") {
    app.innerHTML = `${head}<section class="card"><div class="q">How crowded did the screen look in this part?</div>
      <div class="scale">${[1, 2, 3, 4, 5].map((v) => `<button data-a="${v}" ${dis}>${v}</button>`).join("")}</div>
      <div class="scale-ends"><span>Clear</span><span>Crowded</span></div>
      <label class="note-l" for="note">Overlapping or hidden</label><textarea id="note" class="note"></textarea>${err}</section>`;
    return;
  }
  const it = items.get(id);
  const q = kind === "spot" ? "Tap a unit of ours that is in trouble." : it?.kind === "find" ? FIND_Q[it.what] : "Is the outlined unit seen now, or a report?";
  const choices = kind === "known" ? [["observed", "Seen now"], ["reported", "A report"]] : [];
  app.innerHTML = `${head}<section class="card clip ${kind}"><div class="q">${q}</div>
    <div class="stage">${picture(cur)}</div>
    ${choices.length ? `<div class="answers">${choices.map(([k, l]) => `<button data-a="${k}" ${dis}>${esc(l)}</button>`).join("")}</div>` : ""}${err}</section>`;
}

async function save() {
  if (!db || !uid) return;
  saving = true; render();
  try { await db.doc(`h03/${uid}`).set(structuredClone(doc)); saveError = ""; } catch (e) { saveError = `Not saved: ${(e as { message?: string }).message ?? e}`; }
  saving = false;
}

async function answer(a: string) {
  if (!doc) return;
  if (a === "start") { doc.guideSeenAt = Date.now(); await save(); return render(); }
  const cur = doc.order.find((id) => !(id in doc!.answers));
  if (!cur) return;
  const note = (document.getElementById("note") as HTMLTextAreaElement | null)?.value.trim();
  doc.answers[cur] = { a, ms: Math.round(performance.now() - shownAt), ...(note ? { note } : {}) };
  if (!doc.order.some((id) => !(id in doc!.answers))) doc.finishedAt = Date.now();
  await save();
  render();
}

// ---- results (owner and editors) ----
let rows: Doc[] | null = null, resultsError = "";
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function renderResults() {
  const head = `<header><h1>Battle clips</h1><span class="prog">Results</span></header>`;
  if (resultsError) { app.innerHTML = `${head}<p class="bad">${esc(resultsError)}</p>`; return; }
  if (!rows) { app.innerHTML = `${head}<p class="dim">Loading…</p>`; return; }
  const mine = rows.filter((d) => d.version === 3 && d.set === __CLIPS__.set);
  const per = Object.fromEntries(PARTS.map((k) => [k, { n: 0, ok: 0, ms: [] as number[], rate: [] as number[], notes: [] as string[] }]));
  const finds: Record<Find, { n: number; ok: number }> = { cavalry: { n: 0, ok: 0 }, caron: { n: 0, ok: 0 }, arrows: { n: 0, ok: 0 } };
  for (const d of mine) for (const [step, ans] of Object.entries(d.answers ?? {})) {
    const [kind, id] = step.split(":");
    if (kind === "rate") { const p = per[id]; if (p) { p.rate.push(Number(ans.a)); if (ans.note) p.notes.push(ans.note); } continue; }
    const it = items.get(id), p = per[kind];
    if (!it || !p) continue;
    const ok = it.kind === "spot" ? it.trouble.includes(ans.a) : it.kind === "find" ? it.truth.includes(ans.a) : ans.a === it.truth;
    p.n++; if (ok) { p.ok++; p.ms.push(ans.ms); }
    if (it.kind === "find") { finds[it.what].n++; if (ok) finds[it.what].ok++; }
  }
  const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)}%` : "–");
  const secs = (ms: number) => (Number.isNaN(ms) ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "–");
  app.innerHTML = `${head}<section class="card"><table>
    <tr><th>Testers</th><td colspan="3">${mine.length} (finished ${mine.filter((d) => d.finishedAt).length})</td></tr>
    <tr><th></th>${PARTS.map((k) => `<th>${PART_NAME[k]}</th>`).join("")}</tr>
    <tr><th>Correct</th>${PARTS.map((k) => `<td>${pct(per[k].ok, per[k].n)}</td>`).join("")}</tr>
    <tr><th>Median time</th>${PARTS.map((k) => `<td>${secs(median(per[k].ms))}</td>`).join("")}</tr>
    <tr><th>Crowding (1 clear, 5 crowded)</th>${PARTS.map((k) => `<td>${mean(per[k].rate)}</td>`).join("")}</tr>
    ${(Object.keys(finds) as Find[]).map((w) => `<tr class="sub"><th>${esc(FIND_Q[w])}</th><td></td><td>${pct(finds[w].ok, finds[w].n)}</td><td></td></tr>`).join("")}
  </table></section>
  <section class="card"><h2>Notes</h2>${PARTS.flatMap((k) => per[k].notes.map((n) => `<p><b>${PART_NAME[k]}:</b> ${esc(n)}</p>`)).join("") || `<p class="dim">None</p>`}</section>`;
}

app.addEventListener("click", (e) => {
  if (saving) return;
  const el = e.target as Element;
  const b = el.closest("[data-a]") as HTMLElement | null;
  if (b) return void answer(b.dataset.a!);
  const h = el.closest("[data-hit]") as SVGElement | null;
  if (h) void answer(h.getAttribute("data-hit")!);
});
// in the spot part, a picture every two seconds: six pictures 30 battle seconds apart
setInterval(() => {
  if (results || !doc) return;
  const cur = doc.order.find((id) => !(id in doc!.answers));
  if (!cur || !cur.startsWith("spot") || !doc.guideSeenAt) return;
  frame++;
  const st = document.querySelector(".stage");
  if (st) st.innerHTML = picture(cur);
}, 2000);

(async () => {
  render();
  const claude = (window as { claude?: { use(n: string): Promise<any> } }).claude;
  const timer = setTimeout(() => { if (!doc && !results) { doc = plan(String(Math.random())); render(); } }, 10000);
  try {
    db = claude ? await claude.use("db") : null;
    const user = claude ? await claude.use("user") : null;
    uid = user ? await user.id() : null;
  } catch { db = null; }
  if (results) {
    clearTimeout(timer);
    if (!db) { resultsError = "Results can be read only inside the artifact, by its owner or editors."; return render(); }
    try { const q = await db.collection("h03").get(); rows = q.docs.filter((d: { exists: boolean }) => d.exists).map((d: { data(): unknown }) => d.data() as Doc); } catch (e) { resultsError = String((e as { message?: string }).message ?? e); }
    return render();
  }
  if (db && uid) {
    try {
      const s = await db.doc(`h03/${uid}`).get();
      if (s.exists) { const d = s.data() as Doc; if (d.version === 3 && d.set === __CLIPS__.set) doc = d; else earlier = d; }
    } catch { /* start fresh */ }
  }
  clearTimeout(timer);
  doc ??= { ...plan(uid ?? String(Math.random())), ...(earlier ? { earlier } : {}) };
  doc = structuredClone(doc);
  render();
})();

document.head.insertAdjacentHTML("beforeend", `<style>${BATTLE_CSS}</style>`);
