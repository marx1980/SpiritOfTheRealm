// H-03 battle readability (plan C2, Phase 8): testers watch short clips of formations and name the behaviour, then tell
// a formation seen now from one only reported. No numbers are shown. Answers are kept per tester (db: h03/<id>);
// the owner's #results view scores them against the plan's bars (80% behaviour, 90% observed vs reported).
import { BATTLE_CSS, battleSvg, type Glyph } from "./battleart.ts";
import type { Behaviour, FieldSpec } from "../src/battlefield/core.ts";

declare const __CLIPS__: { version: number; items: Item[] };
declare const __FIELD__: FieldSpec;
type CF = { formations: { id: string; side: "crown" | "raiders"; kind: Glyph["kind"]; label: string; x: number; y: number; behaviour: Behaviour; men: number }[] };
type Item = { id: string; kind: "behaviour"; truth: Behaviour; target: string; box: number[]; frames: CF[] } | { id: string; kind: "marker"; truth: "observed" | "reported"; target: string; box: number[]; frame: CF };
interface Doc { order: string[]; answers: Record<string, string>; startedAt: number; finishedAt?: number }

const LABEL: Record<Behaviour, string> = { good_order: "In good order", yielding: "Yielding ground", disorganised: "Becoming disorganised", rallying: "Officers rallying men", withdrawing: "Withdrawing in order", retreat: "Uncontrolled retreat", rout: "Rout", gone: "" };
const BEH: Behaviour[] = ["good_order", "yielding", "disorganised", "rallying", "withdrawing", "retreat", "rout"];
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
  if (!cur) {
    app.innerHTML = `${head}<section class="card"><h2>Done</h2>${db ? `<p>${saveError ? `<span class="bad">${esc(saveError)}</span>` : "Saved."}</p>` : `<p>Copy this and send it back:</p><textarea readonly>${esc(JSON.stringify(doc))}</textarea>`}</section>`;
    return;
  }
  const it = items.get(cur)!;
  const choices = it.kind === "behaviour" ? BEH.map((b) => [b, LABEL[b]]) : [["observed", "Seen now"], ["reported", "Reported"]];
  app.innerHTML = `${head}<section class="card clip"><div class="q">${it.kind === "behaviour" ? "What is the marked formation doing?" : "Is the marked formation seen now, or reported?"}</div>
    <div class="stage">${view(it)}</div>
    <div class="answers">${choices.map(([k, l]) => `<button data-a="${k}" ${saving ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>
    ${saveError ? `<p class="bad">${esc(saveError)}</p>` : ""}</section>`;
}

async function answer(a: string) {
  const cur = doc!.order.find((id) => !(id in doc!.answers));
  if (!cur) return;
  doc!.answers[cur] = a;
  frame = 0;
  if (!doc!.order.some((id) => !(id in doc!.answers))) doc!.finishedAt = Date.now();
  if (db && uid) {
    saving = true; render();
    try { await db.doc(`h03/${uid}`).set(structuredClone(doc)); saveError = ""; } catch (e) { saveError = `Not saved: ${(e as { message?: string }).message ?? e}`; }
    saving = false;
  }
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
