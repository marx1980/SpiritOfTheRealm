// H-03 battle readability (plan C2, Phase 8): testers watch short clips of formations and name the behaviour, then tell
// a formation seen now from one only reported. No numbers are shown. Answers are kept per tester (db: h03/<id>);
// the owner's #results view scores them against the plan's bars (80% behaviour, 90% observed vs reported).
import { BATTLE_CSS, battleSvg, type Glyph } from "./battleart.ts";
import type { Behaviour, FieldSpec } from "../src/battlefield/core.ts";

declare const __CLIPS__: { version: number; items: Item[] };
declare const __FIELD__: FieldSpec;
type CF = { formations: { id: string; side: "crown" | "raiders"; kind: Glyph["kind"]; label: string; x: number; y: number; behaviour: Behaviour; men: number }[] };
type Item = { id: string; kind: "behaviour"; truth: Behaviour; target: string; box: number[]; frames: CF[] } | { id: string; kind: "marker"; truth: "observed" | "reported"; target: string; box: number[]; frame: CF };
interface Doc { order: string[]; answers: Record<string, string>; startedAt: number; finishedAt?: number; guideSeenAt?: number }

const LABEL: Record<Behaviour, string> = { good_order: "In good order", yielding: "Yielding ground", disorganised: "Becoming disorganised", rallying: "Officers rallying men", withdrawing: "Withdrawing in order", retreat: "Uncontrolled retreat", rout: "Rout", gone: "" };
const BEH: Behaviour[] = ["good_order", "yielding", "disorganised", "rallying", "withdrawing", "retreat", "rout"];
// what each behaviour should look like and mean (same text as docs/BATTLE_READING.md)
const GUIDE: Record<string, { look: string; means: string }> = {
  good_order: { look: "One solid, unbroken block, banner upright, men in a line.", means: "Men are together and obeying orders." },
  yielding: { look: "Solid block, slightly shorter, banner tilted back, small chevrons (V shapes) under it.", means: "In contact with the enemy, losing men, still holding a line but giving ground slowly." },
  disorganised: { look: "The block breaks into several uneven pieces, banner leaning.", means: "Men are still there but control is slipping. Usually not running." },
  rallying: { look: "Men gathered in a tight cluster round an upright banner, with a dashed ring turning around them.", means: "A formation that had broken is being pulled back together by nearby officers." },
  withdrawing: { look: "Intact solid block with one straight arrow pointing back toward its own side.", means: "An ordered pull-back on orders. Men stay together." },
  retreat: { look: "Stretched, ragged outline with a jagged arrow streaming back toward its own side.", means: "The line has broken and is falling back without control, but some shape remains." },
  rout: { look: "No block and no banner. Scattered dots running away.", means: "Men are fleeing and have lost all control." },
};
const SIMILAR = [
  "Withdrawing or retreat: withdrawing is intact with a neat arrow. Retreat is ragged and loose.",
  "Retreat or rout: retreat still has a shape, however ragged. Rout has no shape at all.",
  "Yielding or disorganised: yielding is one block getting shorter. Disorganised is the block broken into pieces, usually standing still.",
  "Yielding or withdrawing: yielding is still facing the enemy in contact. Withdrawing is moving away.",
  "Rallying: the dashed ring and the cluster round the banner are the cue. The ring is not the marker.",
];
const guideList = () => `<ul class="guide">${BEH.map((b) => `<li><b>${LABEL[b]}</b><span>${esc(GUIDE[b].look)} <i>${esc(GUIDE[b].means)}</i></span></li>`).join("")}</ul>`;
const items = new Map(__CLIPS__.items.map((i) => [i.id, i]));
const app = document.getElementById("app")!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let db: any = null, uid: string | null = null, doc: Doc | null = null, frame = 0, saving = false, saveError = "";
const results = location.hash === "#results";

function shuffled(seed: string): string[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const pick = (xs: string[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const all = [...items.values()];
  return [...pick(all.filter((i) => i.kind === "behaviour").map((i) => i.id)), ...pick(all.filter((i) => i.kind === "marker").map((i) => i.id))];
}

const glyphs = (f: CF, target: string, reported = false): Glyph[] => [...f.formations].sort((a, b) => Number(a.id === target) - Number(b.id === target)).map((x) => ({ ...x, width: x.men < 60 ? 80 : x.men < 140 ? 120 : 160, category: x.id === target && reported ? "reported" : "observed", stale: false, age: reported && x.id === target ? 300 : 0 }));
function view(it: Item): string {
  const f = it.kind === "behaviour" ? it.frames[frame % it.frames.length] : it.frame;
  const t = f.formations.find((x) => x.id === it.target);
  const svg = battleSvg(__FIELD__, glyphs(f, it.target, it.kind === "marker" && it.truth === "reported"), { showLabels: false, viewBox: it.box.join(" ") });
  const ptr = t ? `<path class="ptr" d="M${t.x - 26} ${t.y - 120} h52 l-26 36 z"/>` : "";
  return svg.replace("</svg>", `${ptr}</svg>`);
}

function render() {
  if (results) return renderResults();
  if (!doc) { app.innerHTML = `<header><h1>Battle clips</h1></header><p class="dim">Loading…</p>`; return; }
  const done = doc.order.filter((id) => id in doc!.answers).length, cur = doc.order.find((id) => !(id in doc!.answers));
  const head = `<header><h1>Battle clips</h1><span class="prog">${done} / ${doc.order.length}</span></header>`;
  if (!doc.guideSeenAt && done === 0) {
    app.innerHTML = `${head}<section class="card guide-card"><h2>How to read a clip</h2>
      <p>Each clip shows one marked formation. The <b class="ptr-key">yellow pointer</b> above it marks which formation is meant. Other formations nearby may be doing something else. A clip loops six frames, 30 battle seconds apart, so watch the whole loop.</p>
      <p>A <b>solid block</b> is a formation seen now. A <b>dashed or hollow outline</b> is a formation as it was reported, so it may be out of date or wrong.</p>
      <h2>The seven behaviours</h2>${guideList()}
      <h2>Telling similar ones apart</h2><ul class="guide">${SIMILAR.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="dim">No sound: every cue is visual. Pick the behaviour from the seven buttons, and the reference stays under each clip while you answer.</p>
      <button class="start" data-a="start">Start</button></section>`;
    return;
  }
  if (!cur) {
    app.innerHTML = `${head}<section class="card"><h2>Done</h2>${db ? `<p>${saveError ? `<span class="bad">${esc(saveError)}</span>` : "Saved."}</p>` : `<p>Copy this and send it back:</p><textarea readonly>${esc(JSON.stringify(doc))}</textarea>`}</section>`;
    return;
  }
  const it = items.get(cur)!;
  const choices = it.kind === "behaviour" ? BEH.map((b) => [b, LABEL[b]]) : [["observed", "Seen now"], ["reported", "Reported"]];
  app.innerHTML = `${head}<section class="card clip"><div class="q">${it.kind === "behaviour" ? "What is the marked formation doing?" : "Is the marked formation seen now, or reported?"}</div>
    <div class="stage">${view(it)}</div>
    <details class="ref" open><summary>Reference: what each behaviour looks like</summary>${it.kind === "behaviour" ? guideList() : `<ul class="guide"><li><b>Seen now</b><span>Drawn solid.</span></li><li><b>Reported</b><span>Drawn with a dashed or hollow outline.</span></li></ul>`}</details>
    <div class="answers">${choices.map(([k, l]) => `<button data-a="${k}" ${saving ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>
    ${saveError ? `<p class="bad">${esc(saveError)}</p>` : ""}</section>`;
}

async function save() {
  if (!db || !uid) return;
  saving = true; render();
  try { await db.doc(`h03/${uid}`).set(structuredClone(doc)); saveError = ""; } catch (e) { saveError = `Not saved: ${(e as { message?: string }).message ?? e}`; }
  saving = false;
}

async function answer(a: string) {
  if (a === "start") { doc!.guideSeenAt = Date.now(); await save(); return render(); }
  const cur = doc!.order.find((id) => !(id in doc!.answers));
  if (!cur) return;
  doc!.answers[cur] = a;
  frame = 0;
  if (!doc!.order.some((id) => !(id in doc!.answers))) doc!.finishedAt = Date.now();
  await save();
  render();
}

// ---- results (owner and editors) ----
let rows: Doc[] | null = null, resultsError = "";
function renderResults() {
  const head = `<header><h1>Battle clips</h1><span class="prog">Results</span></header>`;
  if (resultsError) { app.innerHTML = `${head}<p class="bad">${esc(resultsError)}</p>`; return; }
  if (!rows) { app.innerHTML = `${head}<p class="dim">Loading…</p>`; return; }
  const per: Record<string, { n: number; ok: number }> = {};
  let bn = 0, bok = 0, mn = 0, mok = 0;
  for (const d of rows) for (const [id, a] of Object.entries(d.answers ?? {})) {
    const it = items.get(id);
    if (!it) continue;
    const ok = a === it.truth;
    if (it.kind === "behaviour") { bn++; if (ok) bok++; const p = (per[it.truth] ??= { n: 0, ok: 0 }); p.n++; if (ok) p.ok++; }
    else { mn++; if (ok) mok++; }
  }
  const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)}%` : "–");
  const verdict = (a: number, n: number, bar: number) => (n ? (a / n >= bar ? `<span class="ok">PASS</span>` : `<span class="bad">FAIL</span>`) : "–");
  app.innerHTML = `${head}<section class="card"><table>
    <tr><th>Testers</th><td>${rows.length}</td><td></td></tr>
    <tr><th>Finished</th><td>${rows.filter((d) => d.finishedAt).length}</td><td></td></tr>
    <tr><th>Behaviour</th><td>${pct(bok, bn)}</td><td>${verdict(bok, bn, 0.8)}</td></tr>
    <tr><th>Seen now or reported</th><td>${pct(mok, mn)}</td><td>${verdict(mok, mn, 0.9)}</td></tr>
    ${BEH.map((b) => `<tr class="sub"><th>${LABEL[b]}</th><td>${pct(per[b]?.ok ?? 0, per[b]?.n ?? 0)}</td><td></td></tr>`).join("")}
  </table></section>`;
}

app.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null; if (b && !saving) void answer(b.dataset.a!); });
setInterval(() => { if (!results && doc) { frame++; const st = document.querySelector(".stage"); const cur = doc.order.find((id) => !(id in doc!.answers)); if (st && cur) st.innerHTML = view(items.get(cur)!); } }, 800);

(async () => {
  render();
  const claude = (window as { claude?: { use(n: string): Promise<any> } }).claude;
  const timer = setTimeout(() => { if (!doc && !results) { doc = { order: shuffled(String(Math.random())), answers: {}, startedAt: Date.now() }; render(); } }, 10000);
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
    try { const s = await db.doc(`h03/${uid}`).get(); if (s.exists) doc = s.data() as Doc; } catch { /* start fresh */ }
  }
  clearTimeout(timer);
  doc ??= { order: shuffled(uid ?? String(Math.random())), answers: {}, startedAt: Date.now() };
  doc = structuredClone(doc);
  render();
})();

document.head.insertAdjacentHTML("beforeend", `<style>${BATTLE_CSS}</style>`);
