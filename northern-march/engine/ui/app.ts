// Debug UI (Phase 5): Court, Map, letters, order composer, travel and auto-pause, all from ViewOf(player).
// The observer panel (Shift+O or #observer) shows hidden truth for H-01 observers only.
import { deriveContent, type RawContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { buildCourt, type AdviceLine } from "../src/presentation/court.ts";
import { buildMap } from "../src/presentation/map.ts";
import { letterSentences, letterGist, planWords, reasonWords } from "../src/presentation/phrasing.ts";
import { beliefsAbout, validateDraft, type OrderDraft, type View } from "../src/view.ts";
import { INTENTS, type Recommendation } from "../src/schemas.ts";
import type { PlayerAction } from "../src/policies.ts";

declare const __RAW__: RawContent;
declare const __H01__: { seed: number; days: number; scripts: RawContent["scenario"]["scripts"] };
const DAY = 86400;
const raw = structuredClone(__RAW__);
raw.scenario.scripts = __H01__.scripts;
const content = deriveContent(raw);
const END = __H01__.days * DAY;
const REASONS = ["report", "advice", "danger", "arrival"] as const;
const REASON_LABEL: Record<string, string> = { report: "Letters", advice: "Advice", danger: "Danger", arrival: "Arrival", checkpoint: "Day" };

type Sim = ReturnType<typeof createSim>;
const st = {
  sim: null as unknown as Sim, log: [] as PlayerAction[][], seed: __H01__.seed, paused: null as null | string, over: false, letter: null as number | null, advice: null as number | null, tab: "game" as "game" | "settings",
  queue: [] as PlayerAction[], autoPause: new Set<string>(REASONS), selected: "northwatch",
  draft: { recipient: "", action: "p:repair", objective: "northwatch", discretion: "bounded" } as { recipient: string; action: string; objective: string; discretion: string },
  error: "", observer: location.hash === "#observer", answered: 0, openLetter: null as number | null,
};

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const name = (v: View, id: string) => v.world.names[id] ?? id;

/** Every answer given so far in this browser, per seed. Replayed on load, so a republish does not restart the game. */
const LOG_KEY = (seed: number) => `northern-march-log-${seed}`;
function loadLog(seed: number): PlayerAction[][] {
  try { const raw = localStorage.getItem(LOG_KEY(seed)); return raw ? (JSON.parse(raw) as PlayerAction[][]) : []; } catch { return []; }
}
function saveLog() { try { localStorage.setItem(LOG_KEY(st.seed), JSON.stringify(st.log)); } catch { /* storage may be blocked: the game still plays */ } }
function clearLog(seed: number) { try { localStorage.removeItem(LOG_KEY(seed)); } catch { /* ignore */ } }

/** Give the engine one answer and remember it. */
function answer(actions: PlayerAction[]) {
  st.sim.answer(actions);
  st.log.push(actions); saveLog();
}

function start(seed: number, restore = true) {
  st.sim = createSim({ content, seed, policy: "external" });
  st.seed = seed; st.queue = []; st.error = ""; st.over = false; st.log = [];
  if (!restore) clearLog(seed);
  const saved = restore ? loadLog(seed) : [];
  try {
    for (const acts of saved) {
      const r = st.sim.next(END);
      if (!r.paused) break;
      st.sim.answer(acts); st.log.push(acts);
    }
  } catch {
    // the saved answers no longer fit this version of the game: start again
    st.sim = createSim({ content, seed, policy: "external" }); st.log = []; clearLog(seed);
  }
  st.answered = st.log.length;
  advance();
}

/** Run to the next pause the player wants to see; other decision points pass with no action. */
function advance() {
  for (let guard = 0; guard < 5000; guard++) {
    const r = st.sim.next(END);
    if (r.ended || !r.paused) { st.paused = null; st.over = true; return render(); }
    // advice to wait asks for no decision: the page passes it (the engine still records it; G-12 is unaffected)
    if (r.reason === "advice" && r.view) {
      const a = r.view.advice.find((x) => x.id === r.adviceId);
      if (a && (JSON.parse(a.plan.id) as { kind: string }).kind === "advise_wait") { answer([]); continue; }
    }
    if (st.autoPause.has(r.reason!) || r.reason === "danger") { st.paused = r.reason!; st.letter = r.letterId ?? null; st.advice = r.adviceId ?? null; st.openLetter = st.letter; return render(); }
    answer([]);
  }
  render();
}

function send() {
  try { answer(st.queue); } catch (e) { st.error = (e as Error).message; return render(); }
  st.answered++; st.queue = []; st.error = "";
  advance();
}

function fortNear(v: View, site: string) {
  const s = v.world.places.find((p) => p.id === site);
  if (!s) return undefined;
  const d = (p: { pos: [number, number] }) => (p.pos[0] - s.pos[0]) ** 2 + (p.pos[1] - s.pos[1]) ** 2;
  return v.world.places.filter((p) => p.fortified).sort((a, b) => d(a) - d(b))[0]?.id;
}
function adviceAction(v: View, r: Recommendation): PlayerAction | null {
  const a = JSON.parse(r.plan.id) as { kind: string; target?: string };
  if (a.kind === "advise_repair") return { action: "repair", target: a.target, followed: r.author };
  if (a.kind === "advise_send_captain") return { action: "advance", target: a.target, followed: r.author };
  if (a.kind === "advise_sortie") { const f = fortNear(v, a.target!); return f ? { action: "advance", target: f, followed: r.author } : null; }
  if (a.kind === "advise_levy") return { action: "levy", followed: r.author };
  return null;
}
const actionText = (v: View, a: PlayerAction) =>
  a.action === "order" ? `Order ${name(v, a.order!.recipient)}: ${a.order!.intent} ${name(v, a.order!.objective.id)}`
  : a.action === "levy" ? "Raise a levy" : a.action === "travel" ? `Travel to ${name(v, a.target!)}`
  : a.action === "repair" ? `Repair ${name(v, a.target!)}` : `Send the captain to ${name(v, a.target!)}`;
const queue = (a: PlayerAction) => { if (!st.paused) return; st.queue.push(a); st.error = ""; render(); };

function pauseText(v: View): string {
  if (st.over) {
    const o = st.sim.objectiveStatus();
    return o.ended ? (o.ended === "killed" ? `Anna is dead` : `Anna is captured`) : `Day ${__H01__.days}: ${o.met ? "the forts hold" : "fallen: " + o.fortsBelowBreach.map((f) => name(v, f)).join(", ")}`;
  }
  const r = st.paused;
  if (r === "report") {
    const l = v.reports.find((x) => x.reportId === st.letter);
    return l ? `Letter from ${name(v, l.author)}: ${letterSentences(v, l).join(" ")}` : "Letter";
  }
  if (r === "advice") {
    const a = v.advice.find((x) => x.id === st.advice);
    return a ? `${name(v, a.author)}${v.world.areas[a.author] ? ` (${v.world.areas[a.author]})` : ""} advises: ${planWords(v, a.plan.id)}` : "Advice";
  }
  if (r === "danger") return "You are in danger";
  if (r === "arrival") { const p = v.self.position; return "at" in p ? `Arrived at ${name(v, p.at)}` : "Arrived"; }
  return REASON_LABEL[r ?? ""] ?? "";
}

function adviceRows(v: View, lines: AdviceLine[]) {
  return lines.map((l) => {
    const r = v.advice.find((x) => x.id === l.id), a = r ? adviceAction(v, r) : null;
    return `<div class="row"><span class="who">${esc(l.adviser)}${l.area ? ` <small class="area">(${esc(l.area)})</small>` : ""}</span><span>${esc(l.plan)}. <em class="${l.fresh ? "" : "old"}">(${esc(l.heard)})</em></span>
      ${a && st.paused ? `<button data-act='${esc(JSON.stringify(a))}'>Do it</button>` : ""}
      <span class="why">${l.supports.length ? `Supports: ${esc(l.supports.join(", "))}. ` : ""}${l.concerns.length ? `Concerns: ${esc(l.concerns.join(", "))}.` : ""}</span></div>`;
  }).join("");
}

function court(v: View) {
  const c = buildCourt(v);
  const issues = c.issues.map((i) => `<div class="card issue ${i.priority >= 45 ? "p-hi" : i.priority >= 25 ? "p-mid" : ""}">
    <div class="t">${esc(i.title)}</div>
    <div class="ev">${i.evidence.map((e) => `<span><b>${esc(e.text)}</b> · ${esc(e.source)} · ${esc(e.age)} · ${esc(e.certainty)}</span>`).join("")}</div>
    ${i.advice.length ? `<div class="adv">${adviceRows(v, i.advice)}</div>` : ""}</div>`).join("");
  const general = c.advice.length ? `<div class="card"><h2>Council</h2><div class="adv">${adviceRows(v, c.advice)}</div></div>` : "";
  return `<div class="col"><h2>Court · ${esc(c.at)}</h2>${issues || `<div class="card">No pressing matters</div>`}${general}</div>`;
}

function map(v: View) {
  const m = buildMap(v), byId = new Map(m.places.map((p) => [p.id, p]));
  const wcls = (w?: string) => !w ? "w-none" : w === "sound" ? "w-sound" : w === "worn" ? "w-worn" : w === "damaged" ? "w-damaged" : "w-bad";
  const routes = m.routes.map((r) => { const a = byId.get(r.from)!, b = byId.get(r.to)!; return `<line class="route${r.crossing ? " ford" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }).join("");
  const places = m.places.map((p) => {
    const sel = p.id === st.selected ? " sel" : "";
    const shape = p.fortified ? `<rect class="place ${wcls(p.wall?.words)}${sel}" x="${p.x - 13}" y="${p.y - 13}" width="26" height="26" rx="2" data-place="${p.id}"/>`
      : `<circle class="place${sel}" cx="${p.x}" cy="${p.y}" r="${p.raiders ? 9 : 6}" data-place="${p.id}"/>`;
    const raid = p.raiders && p.raiders.words !== "no raiders" ? `<path class="raid" d="M${p.x + 14} ${p.y - 26} l10 18 h-20 z"/>` : "";
    const you = p.you ? `<circle class="you" cx="${p.x}" cy="${p.y}" r="22"/>` : "";
    const sub = p.fortified ? (p.wall ? p.wall.words : "unknown") : p.raiders && p.raiders.words !== "no raiders" ? p.raiders.words : "";
    return `${you}${shape}${raid}<text x="${p.x + 18}" y="${p.y + 5}">${esc(p.name)}</text>${sub ? `<text class="sub" x="${p.x + 18}" y="${p.y + 20}">${esc(sub)}</text>` : ""}`;
  }).join("");
  const s = byId.get(st.selected);
  const line = (k: string, x?: { words: string; source: string; age: string; certainty: string }) => x ? `<div><span class="k">${k}</span> ${esc(x.words)} · ${esc(x.source)} · ${esc(x.age)} · ${esc(x.certainty)}</div>` : "";
  const hasNews = !!s && (!!s.wall || !!s.raiders || s.people.length > 0);
  const detail = hasNews ? `<div class="card detail"><h2>${esc(s.name)}</h2>${line("Walls", s.wall)}${line("Raiders", s.raiders)}
    ${s.people.length ? `<div><span class="k">People</span> ${s.people.map((x) => `${esc(x.name)} (${esc(x.age)}, ${esc(x.certainty)})`).join(", ")}</div>` : ""}
    </div>` : "";
  return `<div class="col"><div class="card map"><svg viewBox="40 30 980 920" role="img" aria-label="Map of the realm">
    <rect x="40" y="30" width="980" height="920" fill="var(--land)"/>${routes}${places}</svg></div>${detail}</div>`;
}

function side(v: View) {
  const p = st.paused;
  const forts = v.world.places.filter((x) => x.fortified);
  const opt = (val: string, label: string, cur: string) => `<option value="${esc(val)}"${val === cur ? " selected" : ""}>${esc(label)}</option>`;
  const here = "at" in v.self.position ? v.self.position.at : null;
  const travel = content.scenario.presence.travelTo.filter((t) => t !== here);
  const others = [...new Set(Object.values(v.beliefs).filter((b) => b.predicate === "character.location" && b.subject.id !== v.self.id).map((b) => b.subject.id))].sort();
  const known = [...others, v.self.id];
  if (!st.draft.recipient || !known.includes(st.draft.recipient)) st.draft.recipient = known[0] ?? "";
  const places = [...v.world.places].sort((a, b) => (a.name < b.name ? -1 : 1));
  const isPlayer = st.draft.action.startsWith("p:");
  const pAct = st.draft.action.slice(2);
  const fortId = !st.draft.objective.startsWith("@") && content.byId.location.get(st.draft.objective)?.fortification ? st.draft.objective : null;
  const ACTIONS: [string, string][] = [["p:repair", "Repair"], ["p:advance", "Send captain"], ["p:levy", "Levy"], ["p:travel", "Travel"], ...INTENTS.map((k) => [`o:${k}`, k] as [string, string])];
  const draft = isPlayer ? null : toDraft();
  const problems: string[] = isPlayer ? (
      (pAct === "repair" || pAct === "advance") && !fortId ? ["choose a fort under Where"]
      : pAct === "travel" && !travel.includes(st.draft.objective) ? ["choose a place to travel to under Where"] : [])
    : draft ? validateDraft(v, draft) : ["no recipient"];
  const act = `<div class="card"><h2>Act</h2>
    <div class="form">
      <label for="o-to">To</label><select id="o-to">${known.map((k) => opt(k, name(v, k), st.draft.recipient)).join("")}</select>
      <label for="o-action">Action</label><select id="o-action">${ACTIONS.map(([k, l]) => opt(k, l, st.draft.action)).join("")}</select>
      <label for="o-obj">Where</label><select id="o-obj">${places.map((x) => opt(x.id, x.name, st.draft.objective)).join("")}${known.map((k) => opt("@" + k, name(v, k), st.draft.objective)).join("")}</select>
      ${isPlayer ? "" : `<label for="o-disc">Freedom</label><select id="o-disc">${[["strict", "Exactly as told"], ["bounded", "Some freedom"], ["delegated", "Full freedom"]].map(([k, l]) => opt(k, l, st.draft.discretion)).join("")}</select>`}
      <span></span><button id="o-add" ${p && !problems.length ? "" : "disabled"}>Add</button>
    </div>
    ${problems.length ? `<div class="err">${esc(problems.join("; "))}</div>` : ""}</div>`;
  const open = v.reports.find((r) => r.reportId === st.openLetter);
  const letters = `<div class="card"><h2>Letters</h2><div class="letters">${[...v.reports].reverse().slice(0, 40).map((r) => {
    const isOpen = r.reportId === st.openLetter;
    const body = isOpen ? `<div class="lr-body"><span class="speaker">${esc(name(v, r.author))}:</span> ${esc(letterSentences(v, r).join(" "))}</div>` : `<div class="c">${esc(letterGist(v, r))}</div>`;
    const tags = isOpen ? `<span class="tags"><span class="tag arrived">arrived ${esc(dayAgo(v, r.deliveredAt))}</span><span class="tag written">written ${esc(dayAgo(v, r.composedAt))}</span></span>` : `<span class="when">written ${esc(dayAgo(v, r.composedAt))}</span>`;
    return `<div class="letter${isOpen ? " open" : ""}" data-letter="${r.reportId}" role="button" tabindex="0"><div class="h"><b>${esc(name(v, r.author))}</b>${tags}</div>${body}</div>`;
  }).join("") || `<div class="c">None</div>`}</div></div>`;
  const orders = v.self.orders.length ? `<div class="card"><h2>Orders given</h2><div class="letters">${[...v.self.orders].reverse().slice(0, 20).map((o) => {
    const b = v.beliefs[Object.keys(v.beliefs).find((k) => v.beliefs[k].predicate === "order.status" && v.beliefs[k].subject.id === String(o.orderId)) ?? ""];
    return `<div class="letter"><div class="h"><b>${esc(name(v, o.recipient))}</b><span>${esc(dayAgo(v, o.tick))}</span></div><div class="c">${esc(o.action)} ${esc(name(v, o.target))} · ${esc(b ? String(b.believedValue) : "no word")}</div></div>`;
  }).join("")}</div></div>` : "";
  return `<div class="col">${act}${letters}${orders}</div>`;
}
const dayAgo = (v: View, t: number) => { const d = Math.floor(v.now / DAY) - Math.floor(t / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
function toDraft(): OrderDraft | null {
  if (!st.draft.recipient) return null;
  const obj = st.draft.objective.startsWith("@") ? { kind: "character" as const, id: st.draft.objective.slice(1) } : { kind: "location" as const, id: st.draft.objective };
  return { recipient: st.draft.recipient, intent: st.draft.action.slice(2) as OrderDraft["intent"], objective: obj, discretion: st.draft.discretion as OrderDraft["discretion"],
    reportingPolicy: { onReceipt: true, onCompletion: true, onFailure: true } };
}

function observer() {
  const w = st.sim.unsafeWorldForDebug();
  const rows = Object.entries(w.fortifications).map(([id, f]) => `<tr><td>${id}</td><td>${Math.round(f.conditionMilli / 1000)}%</td><td>${w.troops?.[id] ?? ""}</td></tr>`).join("");
  const threats = Object.entries(w.threats).map(([id, t]) => `<tr><td>${id}</td><td>${(t as { intensityPermille: number }).intensityPermille}</td></tr>`).join("");
  const pos = Object.entries(w.positions).filter(([id]) => w.tiers[id] === "A" || id === content.scenario.ruler).map(([id, p]) => `<tr><td>${id}</td><td>${"at" in p ? p.at : "→ " + p.transit.dest}</td></tr>`).join("");
  const log = st.sim.log.slice(-60).map((e) => `${Math.floor(e.tick / DAY)} ${e.type} ${JSON.stringify(e.payload).slice(0, 140)}`).join("\n");
  return `<div class="card obs"><h2>Observer · seed ${st.seed} · answered ${st.answered} · treasury ${Math.round(w.treasuryMilli[content.scenario.ruler] / 1000)}</h2>
    <div class="scroll"><table><tr><th>fort</th><th>walls</th><th>troops</th></tr>${rows}</table></div>
    <div class="scroll"><table><tr><th>site</th><th>raiders</th></tr>${threats || "<tr><td>none</td><td></td></tr>"}</table></div>
    <div class="scroll"><table><tr><th>who</th><th>where</th></tr>${pos}</table></div>
    <div class="quick" style="margin:6px 0"><button id="copy-log">Copy log</button></div>
    <div class="log">${esc(log)}</div></div>`;
}

/** Coins as Anna believes them (words, never the true amount). Goods are not in the engine yet (Phase 7). */
function coinStatus(v: View): string {
  const bs = beliefsAbout(v, content.scenario.ruler, "treasury.balance");
  const b = bs.sort((x, y) => y.observedAt - x.observedAt)[0];
  if (!b) return `<span class="stat"><span class="emo" aria-hidden="true">🪙</span> Coins: unknown</span>`;
  const n = b.believedValue as number;
  const word = n < 30000 ? "empty" : n < 60000 ? "low" : n < 120000 ? "adequate" : "good";
  return `<span class="stat${b.effectiveBand === "stale" ? " old" : ""}"><span class="emo" aria-hidden="true">🪙</span> Coins: ${word}</span>
    <span class="stat-age">seen ${esc(dayAgo(v, b.observedAt))}</span>`;
}

/** Settings tab: what pauses the game, and the observer panel for H-01 observers. */
function settingsTab(): string {
  return `<div class="card settings"><h2>Settings</h2>
    <div class="setting-group"><h2>Pause on</h2>
      ${REASONS.map((r) => `<label class="setting"><input type="checkbox" data-pause="${r}" ${st.autoPause.has(r) || r === "danger" ? "checked" : ""} ${r === "danger" ? "disabled" : ""}> ${REASON_LABEL[r]}</label>`).join("")}
    </div>
    <div class="setting-group"><h2>Observer</h2>
      <label class="setting"><input type="checkbox" id="observer-toggle" ${st.observer ? "checked" : ""}> Show observer panel</label>
    </div></div>`;
}

function render() {
  const v = st.sim.viewOf("player");
  const o = st.sim.objectiveStatus();
  const pos = v.self.position;
  const cls = st.over ? "ended" : st.paused === "danger" ? "danger" : "";
  const cont = st.over ? "" : `<button class="primary" id="go">${st.queue.length ? "Send and continue" : "Continue"}</button>`;
  const adv = st.paused === "advice" ? v.advice.find((x) => x.id === st.advice) : undefined;
  const why = adv ? [
    ...(adv.reasons.some((x) => x.weight > 0) ? [`Supports: ${adv.reasons.filter((x) => x.weight > 0).slice(0, 3).map((x) => reasonWords(x.textKey)).join(", ")}`] : []),
    ...(adv.reasons.some((x) => x.weight < 0) ? [`Concerns: ${adv.reasons.filter((x) => x.weight < 0).slice(0, 3).map((x) => reasonWords(x.textKey)).join(", ")}`] : []),
  ].map((x) => x + ".").join(" ") : "";
  const doIt = adv && adviceAction(v, adv) && st.paused ? `<button data-act='${esc(JSON.stringify(adviceAction(v, adv)))}'>Do it</button>` : "";
  document.getElementById("app")!.innerHTML = `
  <div class="top"><h1>Northern March</h1>
    <div class="meta"><span>Day ${Math.floor(v.now / DAY) + 1} / ${__H01__.days}</span><span>${"at" in pos ? esc(name(v, pos.at)) : "on the road to " + esc(name(v, pos.transit.dest))}</span></div>
    <div class="grow"></div>
    ${cont}
    <button id="restart">Restart</button>
    <button id="settings-tab" aria-pressed="${st.tab === "settings"}">${st.tab === "settings" ? "Back" : "Settings"}</button>
  </div>
  <div class="status-row" aria-label="Realm status">${coinStatus(v)}</div>
  ${st.tab === "settings" ? settingsTab() : `
  <div class="pause ${cls}"><span class="what">${esc(pauseText(v))}</span>${why ? `<span class="why-line">${esc(why)}</span>` : ""}${doIt}
    <span class="queue">${st.queue.map((a, i) => `<span class="chip">${esc(actionText(v, a))} <button data-unq="${i}" aria-label="Remove">×</button></span>`).join("")}</span>
    ${st.error ? `<span class="err">${esc(st.error)}</span>` : ""}</div>
  <div class="grid">${court(v)}${map(v)}${side(v)}</div>
  ${st.observer ? observer() : ""}`}`;
  void o;
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const el = t.closest("[data-act],[data-place],[data-q],[data-unq],[data-letter],[data-close-letter],#go,#restart,#settings-tab,#o-add,#copy-log") as HTMLElement | null;
  if (!el) return;
  if (el.dataset.letter) { const id = Number(el.dataset.letter); st.openLetter = st.openLetter === id ? null : id; return render(); }
  if (el.dataset.closeLetter !== undefined) { st.openLetter = null; return render(); }
  if (el.dataset.act) return queue(JSON.parse(el.dataset.act));
  if (el.dataset.place) { st.selected = el.dataset.place; if (content.byId.location.get(st.selected)?.fortification) st.draft.objective = st.selected; return render(); }
  if (el.dataset.unq) { st.queue.splice(Number(el.dataset.unq), 1); return render(); }
  if (el.id === "go") return send();
  if (el.id === "restart") return start(st.seed, false);
  if (el.id === "settings-tab") { st.tab = st.tab === "settings" ? "game" : "settings"; return render(); }
  if (el.id === "o-add") {
    const pa = st.draft.action.slice(2);
    if (st.draft.action.startsWith("p:")) {
      if (pa === "levy") return queue({ action: "levy" });
      if (pa === "travel") return queue({ action: "travel", target: st.draft.objective });
      return queue({ action: pa as "repair" | "advance", target: st.draft.objective });
    }
    const d = toDraft(); if (d) queue({ action: "order", order: d }); return;
  }
  if (el.id === "copy-log") navigator.clipboard?.writeText(st.sim.log.map((x) => JSON.stringify(x)).join("\n")).catch(() => {});
});
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (t.id === "observer-toggle") { st.observer = (t as HTMLInputElement).checked; return render(); }
  if (t.dataset.pause) { (t as HTMLInputElement).checked ? st.autoPause.add(t.dataset.pause) : st.autoPause.delete(t.dataset.pause); return; }
  const k = ({ "o-to": "recipient", "o-action": "action", "o-obj": "objective", "o-disc": "discretion" } as Record<string, keyof typeof st.draft>)[t.id];
  if (t.id === "o-obj" && content.byId.location.get(t.value)?.fortification) st.selected = t.value;
  if (k) { st.draft[k] = t.value; render(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "O" && e.shiftKey) { st.observer = !st.observer; render(); } });
start(st.seed);
