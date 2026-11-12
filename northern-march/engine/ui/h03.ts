// H-03, version 2 (D-063): does the battle screen work for play? Testers see the whole field as headquarters sees it,
// with state words, in three styles for units seen breaking (no flash, light pink flash, pale flash of the unit's own
// colour), and: tap the unit of ours in trouble (timed), say whose an outlined breaking unit is, rate how crowded each
// part looked, and tell a unit seen now from a report. Answers are kept per tester (db: h03/<id>); the owner's #results
// view sums them by style.
import { BATTLE_CSS, STATE_WORD, battleSvg, frameBox, framePoints, type FlashStyle, type Glyph } from "./battleart.ts";
import type { Behaviour, FieldSpec } from "../src/battlefield/core.ts";

interface Pic { t: number; hq: { x: number; y: number }; glyphs: Glyph[] }
type Item =
  | { id: string; kind: "spot"; frames: Pic[]; trouble: string[] }
  | { id: string; kind: "side"; frames: Pic[]; target: string; truth: "crown" | "raiders" }
  | { id: string; kind: "known"; frame: Pic; target: string; truth: "observed" | "reported" };
declare const __CLIPS__: { version: number; items: Item[] };
declare const __FIELD__: FieldSpec;
interface Answer { a: string; ms: number; note?: string }
interface Doc { version: 2; rot: number; order: string[]; answers: Record<string, Answer>; startedAt: number; finishedAt?: number; guideSeenAt?: number }

const STYLES: FlashStyle[] = ["none", "pink", "pale"];
const STYLE_NAME: Record<FlashStyle, string> = { none: "No flash", pink: "Pink flash", pale: "Pale flash" };
const ORDER_OF_STATES: Behaviour[] = ["yielding", "disorganised", "rallying", "withdrawing", "retreat", "rout", "pursuing"];
const LOOK: Partial<Record<Behaviour, string>> = {
  yielding: "Shorter block, chevrons behind it.", disorganised: "Block broken into pieces.", rallying: "Men gathered round the banner, a turning ring.",
  withdrawing: "Whole block, one arrow to the rear.", retreat: "Ragged shape streaming back.", rout: "Scattered dots, no banner.", pursuing: "Loose wedge, arrows towards the enemy.",
};
const items = new Map(__CLIPS__.items.map((i) => [i.id, i]));
const app = document.getElementById("app")!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
/** Each tester sees every item once; which style an item is shown in rotates between testers (rot), so every item is seen in every style across testers. */
function plan(seed: string): Doc {
  const rot = hash(seed) % 3, all = [...items.values()];
  const styleOf = (kind: string, i: number) => STYLES[(i + rot) % 3];
  const steps: Record<FlashStyle, string[]> = { none: [], pink: [], pale: [] };
  for (const kind of ["spot", "side"]) all.filter((x) => x.kind === kind).forEach((x, i) => steps[styleOf(kind, i)].push(`${kind}:${x.id}:${styleOf(kind, i)}`));
  const order = shuffle(STYLES, seed + ":blocks").flatMap((s) => [...shuffle(steps[s], seed + s), `rate:${s}`]);
  order.push(...shuffle(all.filter((x) => x.kind === "known").map((x) => `known:${x.id}`), seed + ":known"));
  return { version: 2, rot, order, answers: {}, startedAt: Date.now() };
}

const outline = (g: Glyph) => {
  const w = g.width + 56, top = g.side === "raiders" ? g.y - 52 : g.y - 80, h = 140;
  return `<rect class="outline" x="${g.x - w / 2}" y="${top}" width="${w}" height="${h}" rx="18"/>`;
};
const hits = (gs: Glyph[]) => gs.map((g) => `<rect class="hit" data-hit="${esc(g.id)}" x="${g.x - g.width / 2 - 30}" y="${g.side === "raiders" ? g.y - 50 : g.y - 78}" width="${g.width + 60}" height="136"/>`).join("");

function picture(step: string): string {
  const [kind, id, style] = step.split(":"), it = items.get(id)!;
  const p = it.kind === "known" ? it.frame : it.frames[frame % it.frames.length];
  const target = it.kind === "spot" ? undefined : p.glyphs.find((g) => g.id === it.target);
  const extra = (target ? outline(target) : "") + (kind === "spot" ? hits(p.glyphs) : "");
  return battleSvg(__FIELD__, p.glyphs, { hq: p.hq, flash: (style as FlashStyle | undefined) ?? "none", extra, viewBox: boxOf(it) });
}
// one steady frame per item, round everything it shows; squarer on a narrow screen
const boxes = new Map<string, string>();
function boxOf(it: Item): string {
  const aspect = window.innerWidth < 600 ? 1 : 1.5, key = `${it.id}:${aspect}`;
  if (!boxes.has(key)) { const ps = it.kind === "known" ? [it.frame] : it.frames; boxes.set(key, frameBox(ps.flatMap((p) => [...framePoints(p.glyphs), p.hq]), __FIELD__, aspect)); }
  return boxes.get(key)!;
}

function guide(head: string) {
  app.innerHTML = `${head}<section class="card guide-card"><h2>The screen</h2>
    <p>The battle as the queen's headquarters sees it, framed on the units seen now. <b class="crown-key">Blue</b> units are ours, <b class="raid-key">dark red</b> are the raiders'.</p>
    <p>A <b>solid</b> unit is seen now. A <b>dashed</b> unit is a report, with its age in minutes.</p>
    <p>A unit in good order has no word. Any other state is written on the unit:</p>
    <ul class="guide">${ORDER_OF_STATES.map((b) => `<li><b>${STATE_WORD[b]}</b><span>${esc(LOOK[b])}</span></li>`).join("")}</ul>
    <p>Units seen breaking may flash, in one of two styles, or not at all. The style changes between parts.</p>
    <h2>What you do</h2>
    <ul class="guide"><li><b>Tap</b><span>the unit of ours that is in trouble, as fast as you can.</span></li>
    <li><b>Whose?</b><span>say whose the outlined unit is.</span></li>
    <li><b>Crowded?</b><span>after each part, rate how crowded the screen looked, and note anything that overlapped or hid something.</span></li>
    <li><b>Seen or reported?</b><span>at the end, say whether the outlined unit is seen now or a report.</span></li></ul>
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
  const [kind, , style] = cur.split(":");
  const err = saveError ? `<p class="bad">${esc(saveError)}</p>` : "";
  const dis = saving ? "disabled" : "";
  if (kind === "rate") {
    app.innerHTML = `${head}<section class="card"><div class="q">How crowded did the screen look in this part?</div>
      <div class="scale">${[1, 2, 3, 4, 5].map((v) => `<button data-a="${v}" ${dis}>${v}</button>`).join("")}</div>
      <div class="scale-ends"><span>Clear</span><span>Crowded</span></div>
      <label class="note-l" for="note">Overlapping or hidden</label><textarea id="note" class="note"></textarea>${err}</section>`;
    return;
  }
  const q = kind === "spot" ? "Tap the unit of ours that is in trouble." : kind === "side" ? "Whose is the outlined unit?" : "Is the outlined unit seen now, or a report?";
  const choices = kind === "side" ? [["crown", "Ours"], ["raiders", "The raiders'"]] : kind === "known" ? [["observed", "Seen now"], ["reported", "A report"]] : [];
  app.innerHTML = `${head}<section class="card clip ${kind}"><div class="q">${q}</div>
    <div class="stage">${picture(cur)}</div>
    ${choices.length ? `<div class="answers">${choices.map(([k, l]) => `<button data-a="${k}" ${dis}>${esc(l)}</button>`).join("")}</div>` : ""}${err}</section>`;
  void style;
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
  const v2 = rows.filter((d) => d.version === 2);
  const per = Object.fromEntries(STYLES.map((s) => [s, { spotN: 0, spotOk: 0, ms: [] as number[], wrongRaider: 0, sideN: 0, sideOk: 0, rate: [] as number[], notes: [] as string[] }]));
  let kn = 0, kok = 0;
  for (const d of v2) for (const [step, ans] of Object.entries(d.answers ?? {})) {
    const [kind, id, style] = step.split(":");
    if (kind === "rate") { const p = per[id as FlashStyle]; if (p) { p.rate.push(Number(ans.a)); if (ans.note) p.notes.push(ans.note); } continue; }
    const it = items.get(id);
    if (!it) continue;
    if (it.kind === "known") { kn++; if (ans.a === it.truth) kok++; continue; }
    const p = per[style as FlashStyle];
    if (!p) continue;
    if (it.kind === "spot") {
      p.spotN++;
      if (it.trouble.includes(ans.a)) { p.spotOk++; p.ms.push(ans.ms); }
      else if (it.frames.some((f) => f.glyphs.some((g) => g.id === ans.a && g.side === "raiders"))) p.wrongRaider++;
    } else { p.sideN++; if (ans.a === it.truth) p.sideOk++; }
  }
  const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)}%` : "–");
  const secs = (ms: number) => (Number.isNaN(ms) ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "–");
  app.innerHTML = `${head}<section class="card"><table>
    <tr><th>Testers</th><td colspan="3">${v2.length} (finished ${v2.filter((d) => d.finishedAt).length})</td></tr>
    <tr><th></th>${STYLES.map((s) => `<th>${STYLE_NAME[s]}</th>`).join("")}</tr>
    <tr><th>Tapped a unit in trouble</th>${STYLES.map((s) => `<td>${pct(per[s].spotOk, per[s].spotN)}</td>`).join("")}</tr>
    <tr><th>Median time to tap</th>${STYLES.map((s) => `<td>${secs(median(per[s].ms))}</td>`).join("")}</tr>
    <tr><th>Tapped a raider unit</th>${STYLES.map((s) => `<td>${per[s].wrongRaider}</td>`).join("")}</tr>
    <tr><th>Side told correctly</th>${STYLES.map((s) => `<td>${pct(per[s].sideOk, per[s].sideN)}</td>`).join("")}</tr>
    <tr><th>Crowding (1 clear, 5 crowded)</th>${STYLES.map((s) => `<td>${mean(per[s].rate)}</td>`).join("")}</tr>
    <tr><th>Seen now or report</th><td colspan="3">${pct(kok, kn)}</td></tr>
  </table></section>
  <section class="card"><h2>Notes</h2>${STYLES.flatMap((s) => per[s].notes.map((n) => `<p><b>${STYLE_NAME[s]}:</b> ${esc(n)}</p>`)).join("") || `<p class="dim">None</p>`}</section>`;
}

app.addEventListener("click", (e) => {
  if (saving) return;
  const el = e.target as Element;
  const b = el.closest("[data-a]") as HTMLElement | null;
  if (b) return void answer(b.dataset.a!);
  const h = el.closest("[data-hit]") as SVGElement | null;
  if (h) void answer(h.getAttribute("data-hit")!);
});
// a picture every two seconds: two flashes per picture, six pictures 30 battle seconds apart
setInterval(() => {
  if (results || !doc) return;
  const cur = doc.order.find((id) => !(id in doc!.answers));
  if (!cur || cur.startsWith("rate") || cur.startsWith("known") || !doc.guideSeenAt) return;
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
    try { const s = await db.doc(`h03/${uid}`).get(); if (s.exists && (s.data() as Doc).version === 2) doc = s.data() as Doc; } catch { /* start fresh */ }
  }
  clearTimeout(timer);
  doc ??= plan(uid ?? String(Math.random()));
  doc = structuredClone(doc);
  render();
})();

document.head.insertAdjacentHTML("beforeend", `<style>${BATTLE_CSS}</style>`);
