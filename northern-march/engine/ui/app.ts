// Debug UI (Phase 5): Court, Map, letters, order composer, travel and auto-pause, all from ViewOf(player).
// The observer panel (Shift+O or #observer) shows hidden truth for H-01 observers only.
import { deriveContent, type RawContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { adviceSettled, buildCourt, type AdviceLine } from "../src/presentation/court.ts";
import { buildMap } from "../src/presentation/map.ts";
import { mapSvg } from "./maparts.ts";
import { captainSentTo, planOf, certainty, letterSentences, letterGist, planWords, reasonWords, sourceOf } from "../src/presentation/phrasing.ts";
import { beliefsAbout, validateDraft, type OrderDraft, type View } from "../src/view.ts";
import { INTENTS, type Recommendation } from "../src/schemas.ts";
import type { PlayerAction } from "../src/policies.ts";

declare const __RAW__: RawContent;
declare const __H01__: { seed: number; days: number; scripts: RawContent["scenario"]["scripts"] };
const DAY = 86400;
const raw = structuredClone(__RAW__);
// Play starts on the day the first letter arrives, so that letter is always a live decision on Day 1.
// Everything before that (sending the first letters) runs silently. Scripted events count from the start of play.
const LIMIT = 240 * DAY;
function firstLetterDay(): number {
  const noScripts = deriveContent({ ...raw, scenario: { ...raw.scenario, scripts: [] } });
  const sim = createSim({ content: noScripts, seed: __H01__.seed, policy: "external" });
  for (let guard = 0; guard < 5000; guard++) {
    const r = sim.next(LIMIT);
    if (!r.paused) break;
    if (r.reason === "report") {
      const v = sim.viewOf("player");
      return Math.floor(Math.min(...v.reports.map((x) => x.deliveredAt)) / DAY);
    }
    sim.answer([]);
  }
  return 0;
}
const PRE = firstLetterDay() * DAY;
raw.scenario.scripts = __H01__.scripts.map((s) => ({ ...s, day: s.day + PRE / DAY }));
const content = deriveContent(raw);
const END = PRE + __H01__.days * DAY;
const REASONS = ["report", "advice", "danger", "arrival"] as const;
const REASON_LABEL: Record<string, string> = { report: "Letters", advice: "Advice", danger: "Danger", arrival: "Arrival", checkpoint: "Day" };

type Sim = ReturnType<typeof createSim>;
const st = {
  sim: null as unknown as Sim, log: [] as PlayerAction[][], shownPause: null as string | null, seed: __H01__.seed, paused: null as null | string, over: false, letter: null as number | null, advice: null as number | null, tab: "game" as "game" | "settings",
  batch: [] as number[], queue: [] as PlayerAction[], autoPause: new Set<string>(REASONS), selected: "northwatch",
  draft: { recipient: "", action: "p:repair", objective: "northwatch", discretion: "bounded", mission: "defend" } as { recipient: string; action: string; objective: string; discretion: string; mission: string },
  error: "", observer: location.hash === "#observer", answered: 0, openLetter: null as number | null, openIssue: null as string | null,
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

/** What a decision point means to the page: pass it silently, gather its letter into the day's batch, or stop and show it. */
function triage(r: ReturnType<Sim["next"]>, batch: number[], batchDay: number): "pass" | "gather" | "show" {
  if (r.reason === "advice" && r.view) {
    const a = r.view.advice.find((x) => x.id === r.adviceId);
    if (a && (JSON.parse(a.plan.id) as { kind: string }).kind === "advise_wait") return "pass"; // advice to wait asks for no decision
    if (r.adviceId !== undefined && adviceSettled(r.view, r.adviceId)) return "pass"; // advice already carried out is not put again
  }
  if (r.reason === "report" && r.letterId !== undefined && st.autoPause.has("report")) {
    const day = Math.floor(st.sim.viewOf("player").now / DAY);
    if (batchDay === -1 || batchDay === day) return "gather";
  }
  return batch.length || st.autoPause.has(r.reason!) || r.reason === "danger" ? "show" : "pass";
}
function start(seed: number, restore = true) {
  st.sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } });
  st.seed = seed; st.queue = []; st.error = ""; st.over = false; st.log = [];
  st.batch = []; st.openIssue = null; st.letter = null; st.advice = null; st.openLetter = null; st.paused = null; st.shownPause = null; st.tab = "game"; st.answered = 0;
  // the silent prelude, up to the first day of play
  for (let guard = 0; guard < 5000; guard++) { const r = st.sim.next(PRE); if (!r.paused) break; st.sim.answer([]); }
  if (!restore) clearLog(seed);
  const saved = restore ? loadLog(seed) : [];
  let tail: number[] = [], tailDay = -1; // letters gathered for a pause that was still showing when the page was left
  try {
    for (const acts of saved) {
      const r = st.sim.next(END);
      if (!r.paused) break;
      const t = triage(r, tail, tailDay);
      if (t === "gather") { tail.push(r.letterId!); tailDay = Math.floor(st.sim.viewOf("player").now / DAY); } else if (t === "show") { tail = []; tailDay = -1; }
      st.sim.answer(acts); st.log.push(acts);
    }
  } catch {
    // the saved answers no longer fit this version of the game: start again
    st.sim = createSim({ content, seed, policy: "external", params: { dayEnd: true } }); st.log = []; clearLog(seed);
  }
  st.answered = st.log.length;
  advance(tail);
}

/** Run to the next pause the player wants to see; other decision points pass with no action. */
function advance(resumed: number[] = []) {
  // letters of one day are gathered and shown together, before the next decision that is shown
  let batch: number[] = [...resumed], batchDay = resumed.length ? Math.floor(st.sim.viewOf("player").now / DAY) : -1;
  for (let guard = 0; guard < 5000; guard++) {
    const r = st.sim.next(END);
    if (r.ended || !r.paused) { st.paused = null; st.over = true; st.batch = []; return render(); }
    const t = triage(r, batch, batchDay);
    if (t === "pass") { answer([]); continue; }
    if (t === "gather") { batchDay = Math.floor(st.sim.viewOf("player").now / DAY); batch.push(r.letterId!); answer([]); continue; }
    {
      st.paused = batch.length && !st.autoPause.has(r.reason!) && r.reason !== "danger" ? "report" : r.reason!;
      st.letter = r.letterId ?? batch[batch.length - 1] ?? null; st.advice = r.adviceId ?? null; st.batch = batch; st.openLetter = st.letter;
      return render();
    }
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
  const a = planOf(v, r.plan.id);
  if (a.kind === "advise_repair") return { action: "repair", target: a.target, followed: r.author };
  if (a.kind === "advise_send_captain") return { action: "advance", target: a.target, followed: r.author };
  if (a.kind === "advise_sortie") { const f = fortNear(v, a.target!); return !f ? null : captainSentTo(v, f) ? { action: "advance", target: f, mission: "attack", raid: a.target, followed: r.author } : { action: "advance", target: f, followed: r.author }; }
  if (a.kind === "advise_levy") return { action: "levy", followed: r.author };
  return null;
}
/** The raiders' site a captain would scout or attack from this fort: the strongest believed raid that fort answers. */
function raidNear(v: View, fort: string): string | undefined {
  const raids = v.world.places.filter((p) => fortNear(v, p.id) === fort)
    .map((p) => ({ id: p.id, b: beliefsAbout(v, p.id, "threat.intensity")[0] })).filter((x) => x.b && (x.b.believedValue as number) > 0);
  return raids.sort((a, b) => (b.b!.believedValue as number) - (a.b!.believedValue as number))[0]?.id;
}
const actionText = (v: View, a: PlayerAction) =>
  a.action === "order" ? `Order ${name(v, a.order!.recipient)}: ${a.order!.intent} ${name(v, a.order!.objective.id)}`
  : a.action === "levy" ? "Raise a levy" : a.action === "travel" ? `Travel to ${name(v, a.target!)}`
  : a.action === "repair" ? `Repair ${name(v, a.target!)}`
  : a.mission === "attack" && a.raid ? `Attack the raiders at ${name(v, a.raid)}` : a.mission === "scout" && a.raid ? `Scout the raiders at ${name(v, a.raid)}` : `Send the captain to ${name(v, a.target!)}`;
const queue = (a: PlayerAction) => {
  if (!st.paused) return;
  // the same action from two advisers (e.g. raiders and captain both mean "send the captain to Northwatch") is queued once
  if (st.queue.some((q) => JSON.stringify(q) === JSON.stringify(a))) { st.error = `${actionText(st.sim.viewOf("player"), a)} is already queued`; return render(); }
  if (!affordable(st.sim.viewOf("player"), a)) { st.error = `${actionText(st.sim.viewOf("player"), a)}: not enough coins`; return render(); }
  st.queue.push(a); st.error = ""; render();
};

/** Two actions are the same action if they send the same captain to the same fort (its mission may differ). */
const matches = (q: PlayerAction, a: PlayerAction) => a.action === "advance" ? q.action === "advance" && q.target === a.target : JSON.stringify(q) === JSON.stringify(a);
const listNames = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
/** Each adviser's latest advice that is not yet settled, as the action it means (parallel choices). */
function latestAdvice(v: View): Recommendation[] {
  const latest = new Map<string, Recommendation>();
  for (const r of v.advice) { const cur = latest.get(r.author); if (!cur || cur.computedAt < r.computedAt) latest.set(r.author, r); }
  return [...latest.values()].filter((r) => !adviceSettled(v, r.id));
}
function choices(v: View): { action: PlayerAction; text: string; by: string[] }[] {
  const out = new Map<string, { action: PlayerAction; text: string; by: string[] }>();
  for (const r of latestAdvice(v)) {
    const act = adviceAction(v, r);
    if (!act) continue;
    const { followed: _f, ...same } = act; // the same action recommended by several advisers is one choice
    const key = JSON.stringify(same);
    if (!out.has(key)) out.set(key, { action: act, text: actionText(v, act), by: [] });
    out.get(key)!.by.push(name(v, r.author));
  }
  return [...out.values()];
}
/** Advisers who want the raiders at a site attacked. */
function attackersOf(v: View, raid: string): string[] {
  return latestAdvice(v).filter((r) => { const a = planOf(v, r.plan.id); return a.kind === "advise_sortie" && a.target === raid; }).map((r) => name(v, r.author));
}
/** Once a send is checked: defend the fort (default), or attack or scout the raiders it answers. */
function missionBlock(v: View, fort: string, q: PlayerAction): string {
  const raid = raidNear(v, fort);
  const opts: { mission: string; label: string; by: string[] }[] = [{ mission: "defend", label: `Defend ${name(v, fort)}`, by: [] }];
  if (raid) opts.push({ mission: "attack", label: `Attack the raiders at ${name(v, raid)}`, by: attackersOf(v, raid) }, { mission: "scout", label: `Scout the raiders at ${name(v, raid)}`, by: [] });
  const cur = q.mission ?? "defend";
  return `<div class="mission">${opts.map((o) => `<button data-mission='${esc(JSON.stringify({ fort, mission: o.mission, raid }))}' class="${cur === o.mission ? "primary" : ""}" aria-pressed="${cur === o.mission}">${esc(o.label)}${o.by.length ? ` (recommended by ${esc(listNames(o.by))})` : ""}</button>`).join("")}</div>`;
}
/** Parallel choices as checkboxes; a checked send shows its mission step beneath. */
function choicesBlock(v: View): string {
  const cs = choices(v);
  if (!cs.length) return "";
  return `<div class="choices">${cs.map((c) => {
    const q = st.queue.find((x) => matches(x, c.action));
    const rec = c.by.length ? ` (recommended by ${esc(listNames(c.by))})` : "";
    const cost = c.action.action === "repair" ? repairCostKnown(v, c.action.target!) : undefined, coins = coinsKnown(v);
    const short = cost !== undefined && coins !== undefined && cost > coins;
    const costNote = cost === undefined ? "" : ` <span class="cost-inline">costs about ${kCoins(cost)}${coins === undefined ? "" : `; you have ${kCoins(coins)}`}</span>${short ? ` <span class="low">Not enough coins. <button data-use-levy>Raise a levy (about ${kCoins(content.scenario.player.levyMilli)})</button></span>` : ""}`;
    return `<label class="check"><input type="checkbox" data-toggle='${esc(JSON.stringify(c.action))}' ${q ? "checked" : ""} ${short ? "disabled" : ""}> ${esc(c.text)}${rec}${costNote}</label>${q && c.action.action === "advance" ? missionBlock(v, c.action.target!, q) : ""}`;
  }).join("")}</div>`;
}
/** The letters of this pause, all together. */
function batchBlock(v: View): string {
  const ids = [...st.batch]; if (st.paused === "report" && st.letter !== null && !ids.includes(st.letter)) ids.push(st.letter);
  const all = ids.map((id) => v.reports.find((x) => x.reportId === id)).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => x.composedAt - y.composedAt);
  // a letter that only repeats what another letter from the same hand says in full is not shown twice
  const keys = (l: (typeof all)[number]) => new Set(l.claims.map((c) => `${c.predicate}|${c.subject.id}|${JSON.stringify(c.believedValue)}`));
  const ls = all.filter((l, i) => !all.some((m, j) => j !== i && m.author === l.author && (() => { const a = keys(l), b = keys(m); return [...a].every((k) => b.has(k)) && (b.size > a.size || j < i); })()));
  const written = (l: (typeof all)[number]) => { const d = Math.floor(v.now / DAY) - Math.floor(l.composedAt / DAY); return d > 0 && Math.floor(l.deliveredAt / DAY) - Math.floor(l.composedAt / DAY) > 0 && all.length > 1 ? ` (written ${d === 1 ? "yesterday" : d + " days ago"})` : ""; };
  return ls.length ? `<div class="batch">${ls.map((l) => `<div class="batch-letter"><span class="what">${tone(`Letter from ${name(v, l.author)}${written(l)}: ${letterSentences(v, l).join(" ")}`)}</span></div>`).join("")}</div>` : "";
}

const areaShort = (a: string) => ({ Military: "MIL", Administration: "ADM", Construction: "CON", Intelligence: "INT" } as Record<string, string>)[a] ?? a.toUpperCase();
/** Status words in green (good outcome), red (bad outcome) or amber (under way, at risk): the text is escaped first. */
/** Age words coloured by how stale the news is: three days or more amber, a week or more red. */
const ageTone = (a: string) => { const n = /(\d+) days? ago/.exec(a)?.[1]; const d = n ? Number(n) : 0; return d >= 7 ? `<span class="bad">${esc(a)}</span>` : d >= 3 ? `<span class="warn">${esc(a)}</span>` : esc(a); };
const tone = (t: string) => esc(t)
  .replace(/\b(\d+) days ago\b/g, (m, n) => (Number(n) >= 7 ? `<span class="bad">${m}</span>` : Number(n) >= 3 ? `<span class="warn">${m}</span>` : m))
  .replace(/\b(completed|succeeded|won|held|repaired|sound|no raiders)\b/gi, '<span class="ok">$1</span>')
  .replace(/\b(abandoned|failed|lost|breached|captured|refused|beaten|not enough coins|dead|fallen|a strong band)\b/gi, '<span class="bad">$1</span>')
  .replace(/\b(a large host)\b/gi, '<span class="bad big">$1</span>')
  .replace(/\b(a small band)\b/gi, '<span class="warn">$1</span>')
  .replace(/(?<!no )\b(raiders)\b/gi, '<span class="bad">$1</span>')
  .replace(/\b(damaged|in progress|under way|low|worn)\b/gi, '<span class="warn">$1</span>');
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
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
    return a ? `${name(v, a.author)}${v.world.areas[a.author] ? ` (${areaShort(v.world.areas[a.author])})` : ""} advises: ${planWords(v, a.plan.id)}` : "Advice";
  }
  if (r === "danger") return "You are in danger";
  if (r === "arrival") { const p = v.self.position; return "at" in p ? `Arrived at ${name(v, p.at)}` : "Arrived"; }
  return REASON_LABEL[r ?? ""] ?? "";
}

function adviceRows(v: View, lines: AdviceLine[]) {
  return lines.map((l) => {
    const r = v.advice.find((x) => x.id === l.id), a = r ? adviceAction(v, r) : null;
    return `<div class="row"><span class="who">${esc(l.adviser)}${l.area ? ` <small class="area">(${esc(l.area)})</small>` : ""}</span><span>${esc(l.plan)}. <em class="${l.fresh ? "" : "old"}">(${esc(l.heard)})</em></span>
      ${a && st.paused && affordable(v, a) ? `<button data-act='${esc(JSON.stringify(a))}'>Do it</button>` : ""}
      <span class="why">${l.supports.length ? `Supports: ${esc(l.supports.join(", "))}. ` : ""}${l.concerns.length ? `Concerns: ${esc(l.concerns.join(", "))}.` : ""}</span></div>`;
  }).join("");
}

/** Everything known about one order Anna gave: who, what, when, and each report of how it stands. */
function orderDetails(v: View, id: string): string {
  const o = v.self.orders.find((x) => String(x.orderId) === id);
  if (!o) return "";
  const verb: Record<string, string> = { repair: "Repair", advance: "Send to", levy: "Raise a levy", travel: "Travel to", investigate: "Scout the raiders at", attack: "Attack the raiders at" };
  const hist = beliefsAbout(v, id, "order.status").sort((a, b) => b.observedAt - a.observedAt)
    .map((b) => `<div>${tone(String(b.believedValue))} · ${esc(sourceOf(v, b))} · ${ageTone(dayAgo(v, b.observedAt))} · ${esc(certainty[b.effectiveBand])}</div>`).filter((x, i, a) => a.indexOf(x) === i).join("");
  return `<div class="ev order-detail"><div><span class="k">To:</span> ${esc(name(v, o.recipient))}</div><div><span class="k">Order:</span> ${esc(verb[o.action] ?? o.action)}${o.action === "levy" ? "" : " " + esc(name(v, o.target))}</div>
    <div><span class="k">Given:</span> day ${Math.floor((o.tick - PRE) / DAY) + 1}</div><div><span class="k">Reports:</span></div>${hist || "<div>none yet</div>"}</div>`;
}
function court(v: View) {
  const c = buildCourt(v);
  // advice already put to her in the decision box above is not listed again; nor is news a letter on top of the page has just given
  const boxed = st.paused ? choices(v).map((x) => x.action) : [];
  const inBox = (l: AdviceLine) => { const r = v.advice.find((x) => x.id === l.id), act = r ? adviceAction(v, r) : null; return !!act && boxed.some((q) => matches(q, act)); };
  const shown = c.issues.map((i) => ({ i, advice: i.advice.filter((l) => !inBox(l)) }))
    .filter(({ i, advice }) => !(st.batch.length && /^(walls|raiders):/.test(i.key) && !advice.length && i.evidence[0]?.age === "today"));
  const issues = shown.map(({ i, advice }) => `<div class="card issue ${i.priority >= 45 ? "p-hi" : i.priority >= 25 ? "p-mid" : ""}"${i.key.startsWith("order:") ? ` data-issue="${esc(i.key)}" role="button" tabindex="0"` : ""}>
    <div class="t">${tone(i.title)}</div>${st.openIssue === i.key ? orderDetails(v, i.key.slice(6)) : ""}
    <div class="ev">${i.evidence.map((e) => `<span><b>${esc(e.text)}</b> · ${esc(e.source)} · ${ageTone(e.age)} · ${esc(e.certainty)}</span>`).join("")}</div>
    ${advice.length ? `<div class="adv">${adviceRows(v, advice)}</div>` : ""}</div>`).join("");
  const rest = c.advice.filter((l) => !inBox(l));
  const general = rest.length ? `<div class="card"><h2>Council</h2><div class="adv">${adviceRows(v, rest)}</div></div>` : "";
  return `<div class="col"><h2>Court · ${esc(c.at)}</h2>${issues || `<div class="card">No pressing matters</div>`}${general}</div>`;
}

function map(v: View) {
  const m = buildMap(v), byId = new Map(m.places.map((p) => [p.id, p]));
  const kinds = new Map(v.world.places.map((p) => [p.id, p.kind])), terrains = new Map(v.world.places.map((p) => [p.id, p.terrain]));
  const s = byId.get(st.selected);
  const line = (k: string, x?: { words: string; source: string; age: string; certainty: string }) => x ? `<div><span class="k">${k}:</span> ${tone(cap1(x.words))} <em class="stat-age">(${ageTone(x.age)}, ${esc(x.source)}, ${esc(x.certainty)})</em></div>` : "";
  const hasNews = !!s && (!!s.wall || !!s.raiders || !!s.troops || s.people.length > 0);
  const dayNo = (d: number) => d - PRE / DAY + 1; // day index from the engine, counted from the first letter day
  const troopParts = s?.troops ? [
    ...(s.troops.fort ? [{ t: `${s.troops.fort.exact ? "" : "~"}${s.troops.fort.count} (garrison)`, day: s.troops.fort.day }] : []),
    ...s.troops.captains.map((c) => ({ t: `${c.exact ? "" : "~"}${c.count} (${esc(c.name)})`, day: c.day })),
  ] : [];
  const troopLine = troopParts.length ? `<div><span class="k">Troops:</span> ${troopParts.map((x) => x.t).join(" + ")} <em class="stat-age">(day ${dayNo(Math.min(...troopParts.map((x) => x.day)))})</em></div>` : "";
  const kind = s ? v.world.places.find((x) => x.id === s.id)?.kind ?? "" : "";
  const detail = s ? `<div class="card detail"><h2>${esc(s.name)}${kind ? ` <small>(${esc(kind)})</small>` : ""}</h2>${hasNews ? "" : `<div class="k">No news</div>`}${line("Walls", s.wall)}${line("Raiders", s.raiders)}${troopLine}
    ${s.people.length ? `<div><span class="k">People</span> ${s.people.map((x) => `${esc(x.name)} (${ageTone(x.age)}, ${esc(x.certainty)})`).join(", ")}</div>` : ""}
    </div>` : "";
  return `<div class="col"><div class="card map">${mapSvg({ model: m, selected: st.selected, kinds, terrains })}</div>${detail}</div>`;
}

function side(v: View) {
  const p = st.paused;
  const forts = v.world.places.filter((x) => x.fortified);
  const opt = (val: string, label: string, cur: string) => `<option value="${esc(val)}"${val === cur ? " selected" : ""}>${esc(label)}</option>`;
  const here = "at" in v.self.position ? v.self.position.at : null;
  const travel = content.scenario.presence.travelTo.filter((t) => t !== here);
  const others = [...new Set(Object.values(v.beliefs).filter((b) => (b.predicate === "character.location" || b.predicate === "character.seat") && b.subject.kind === "character" && b.subject.id !== v.self.id).map((b) => b.subject.id))].sort();
  const known = [...others, v.self.id];
  if (!st.draft.recipient || !known.includes(st.draft.recipient)) st.draft.recipient = known[0] ?? "";
  const places = [...v.world.places].sort((a, b) => (a.name < b.name ? -1 : 1));
  const isPlayer = st.draft.action.startsWith("p:");
  const pAct = st.draft.action.slice(2);
  const fortId = !st.draft.objective.startsWith("@") && content.byId.location.get(st.draft.objective)?.fortification ? st.draft.objective : null;
  // each thing appears once: the four things Anna does herself, then the other orders she can send (repair, levy, advance and travel are the first four)
  const OTHER: Record<string, string> = { hold: "Hold position", withdraw: "Withdraw", screen: "Screen", escort: "Escort", requisition: "Requisition", investigate: "Scout", attack: "Attack raiders", negotiate: "Negotiate", report: "Ask for a report" };
  const ACTIONS: [string, string][] = [["p:repair", "Repair walls"], ["p:advance", "Send captain"], ["p:levy", "Raise a levy"], ["p:travel", "Travel"], ...INTENTS.filter((k) => OTHER[k]).map((k) => [`o:${k}`, OTHER[k]] as [string, string])];
  const aboutPeople = st.draft.action === "o:escort" || st.draft.action === "o:negotiate"; // only these are about a person; everything else is about a place
  const draft = isPlayer ? null : toDraft();
  const problems: string[] = isPlayer ? (
      (pAct === "repair" || pAct === "advance") && !fortId ? ["choose a fort under Where"]
      : pAct === "advance" && st.draft.mission !== "defend" && !raidNear(v, fortId!) ? ["no raiders known to be answered from this fort"]
      : pAct === "travel" && !travel.includes(st.draft.objective) ? ["choose a place to travel to under Where"] : [])
    : draft ? validateDraft(v, draft) : ["no recipient"];
  // A repair is only offered if Anna can pay for it (from what she believes about the walls and her coins).
  const isRepair = st.draft.action === "p:repair" || st.draft.action === "o:repair";
  const repairCost = isRepair && fortId ? repairCostKnown(v, fortId) : undefined;
  const coins = coinsKnown(v);
  if (repairCost !== undefined && coins !== undefined && repairCost > coins) problems.push(`not enough coins: the repair costs about ${kCoins(repairCost)} and you have about ${kCoins(coins)}`);
  const costLine = repairCost === undefined ? "" : `<span></span><span class="cost">Repair costs about ${kCoins(repairCost)}${coins === undefined ? "" : `; you have about ${kCoins(coins)}`}${repairCost > (coins ?? Infinity) ? ` <button data-use-levy>Raise a levy instead (about ${kCoins(content.scenario.player.levyMilli)})</button>` : ""}</span>`;
  const act = `<div class="card"><h2>Act</h2>
    <div class="form">
      <label for="o-to">To</label><select id="o-to">${known.map((k) => opt(k, name(v, k), st.draft.recipient)).join("")}</select>
      <label for="o-action">Action</label><select id="o-action">${ACTIONS.map(([k, l]) => opt(k, l, st.draft.action)).join("")}</select>
      <label for="o-obj">${aboutPeople ? "Who" : "Where"}</label><select id="o-obj">${aboutPeople ? known.map((k) => opt("@" + k, name(v, k), st.draft.objective)).join("") : places.map((x) => opt(x.id, x.name, st.draft.objective)).join("")}</select>
      ${pAct === "advance" ? `<label for="o-mission">Mission</label><select id="o-mission">${[["defend", "Defend the fort"], ["scout", "Scout the raiders"], ["attack", "Attack the raiders"]].map(([k, l]) => opt(k, l, st.draft.mission)).join("")}</select>` : ""}
      ${isPlayer ? "" : `<label for="o-disc">Freedom</label><select id="o-disc">${[["strict", "Exactly as told"], ["bounded", "Some freedom"], ["delegated", "Full freedom"]].map(([k, l]) => opt(k, l, st.draft.discretion)).join("")}</select>`}
      ${costLine}
      <span></span><button id="o-add" ${p && !problems.length ? "" : "disabled"}>Make an order</button>
    </div>
    ${problems.length ? `<div class="err">${esc(problems.join("; "))}</div>` : ""}</div>`;
  const open = v.reports.find((r) => r.reportId === st.openLetter);
  const letters = `<div class="card"><h2>Letters</h2><div class="letters">${[...v.reports].reverse().slice(0, 40).map((r) => {
    const isOpen = r.reportId === st.openLetter;
    const body = isOpen ? `<div class="lr-body"><span class="speaker">${esc(name(v, r.author))}:</span> ${tone(letterSentences(v, r).join(" "))}</div>` : `<div class="c">${tone(letterGist(v, r))}</div>`;
    const tags = isOpen ? `<span class="tags"><span class="tag arrived">arrived ${ageTone(dayAgo(v, r.deliveredAt))}</span><span class="tag written">written ${ageTone(dayAgo(v, r.composedAt))}</span></span>` : `<span class="when">written ${ageTone(dayAgo(v, r.composedAt))}</span>`;
    return `<div class="letter${isOpen ? " open" : ""}" data-letter="${r.reportId}" role="button" tabindex="0"><div class="h"><b>${esc(name(v, r.author))}</b>${tags}</div>${body}</div>`;
  }).join("") || `<div class="c">None</div>`}</div></div>`;
  const orders = v.self.orders.length ? `<div class="card"><h2>Orders given</h2><div class="letters">${[...v.self.orders].reverse().slice(0, 20).map((o) => {
    const b = v.beliefs[Object.keys(v.beliefs).find((k) => v.beliefs[k].predicate === "order.status" && v.beliefs[k].subject.id === String(o.orderId)) ?? ""];
    return `<div class="letter"><div class="h"><b>${esc(name(v, o.recipient))}</b><span>${ageTone(dayAgo(v, o.tick))}</span></div><div class="c">${esc(o.action)} ${esc(name(v, o.target))} · ${esc(b ? String(b.believedValue) : "no word")}</div></div>`;
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
/** What Anna believes the treasury holds (the newest belief), or undefined. */
function coinsKnown(v: View): number | undefined {
  const b = beliefsAbout(v, content.scenario.ruler, "treasury.balance").sort((x, y) => y.observedAt - x.observedAt)[0];
  return b ? (b.believedValue as number) : undefined;
}
/** What a repair of a fort would cost, from what Anna believes about its walls. */
function repairCostKnown(v: View, place: string): number | undefined {
  const b = beliefsAbout(v, place, "fortification.condition").sort((x, y) => y.observedAt - x.observedAt)[0];
  return b ? Math.max(0, content.scenario.player.repairRestoreToMilli - (b.believedValue as number)) * content.scenario.player.repairCostMilliPerMilli : undefined;
}
const kCoins = (n: number) => `${Math.round(n / 1000)}k`;
/** Background income (holdings) minus upkeep, per day: a rough estimate Anna can see. */
const netDailyMilli = content.scenario.economy.holdings.reduce((a, h) => a + h.dailyIncomeMilli, 0) - content.scenario.economy.dailyUpkeepMilli;
const LOW_COINS = 30000;
/** A repair is only possible if Anna can pay for it, as far as she knows. Other actions are always possible. */
function affordable(v: View, a: PlayerAction): boolean {
  if (a.action !== "repair") return true;
  const c = repairCostKnown(v, a.target!), k = coinsKnown(v);
  return c === undefined || k === undefined || c <= k;
}

function coinStatus(v: View): string {
  const bs = beliefsAbout(v, content.scenario.ruler, "treasury.balance");
  const b = bs.sort((x, y) => y.observedAt - x.observedAt)[0];
  if (!b) return `<span class="stat"><span class="emo" aria-hidden="true">🪙</span> Coins: unknown</span>`;
  const n = b.believedValue as number;
  const net = `${netDailyMilli >= 0 ? "+" : "−"}${kCoins(Math.abs(netDailyMilli))} a day`;
  const low = n < LOW_COINS ? ` <span class="low">Low. <button data-use-levy>Raise a levy (about ${kCoins(content.scenario.player.levyMilli)})</button></span>` : "";
  return `<span class="stat${b.effectiveBand === "stale" ? " old" : ""}"><span class="emo" aria-hidden="true">🪙</span> Coins: ${kCoins(n)}</span>
    <span class="stat-net ${netDailyMilli >= 0 ? "ok" : "bad"}">${net}</span> <em class="stat-age">(${ageTone(dayAgo(v, b.observedAt))})</em>${low}`;
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
  const shownChoices = choices(v);
  const isShown = (q: PlayerAction) => shownChoices.some((c) => matches(q, c.action));
  const pauseKey = `${st.paused}:${st.letter}:${st.advice}`;
  const newPause = st.paused !== null && pauseKey !== st.shownPause;
  st.shownPause = st.paused !== null ? pauseKey : null;
  document.getElementById("app")!.innerHTML = `
  <div class="top"><h1>Northern March</h1>
    <div class="meta"><span>Day ${Math.floor((v.now - PRE) / DAY) + 1} / ${__H01__.days}</span><span>${"at" in pos ? esc(name(v, pos.at)) : "on the road to " + esc(name(v, pos.transit.dest))}</span></div>
    <div class="grow"></div>
    ${cont}
    <button id="restart">Restart</button>
    <button id="settings-tab" aria-pressed="${st.tab === "settings"}">${st.tab === "settings" ? "Back" : "Settings"}</button>
  </div>
  <div class="status-row" aria-label="Realm status">${coinStatus(v)}</div>
  ${st.tab === "settings" ? settingsTab() : `
  <div class="pause ${cls}">${batchBlock(v)}${(st.paused === "report" && batchBlock(v)) || (st.paused === "advice" && choices(v).length) ? "" : `<span class="what">${tone(pauseText(v))}</span>`}${why ? `<span class="why-line">${esc(why)}</span>` : ""}
    ${st.paused ? choicesBlock(v) : ""}
    <span class="queue">${st.queue.map((a, i) => ({ a, i })).filter(({ a }) => !isShown(a)).map(({ a, i }) => `<span class="chip">${esc(actionText(v, a))} <button data-unq="${i}" aria-label="Remove">×</button></span>`).join("")}</span>
    ${st.error ? `<span class="err">${esc(st.error)}</span>` : ""}</div>
  <div class="grid">${court(v)}${map(v)}${side(v)}</div>
  ${st.observer ? observer() : ""}`}`;
  void o;
  if (newPause) document.querySelector(".pause")?.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const el = t.closest("[data-act],[data-toggle],[data-mission],[data-place],[data-q],[data-unq],[data-letter],[data-issue],[data-close-letter],[data-use-levy],#go,#restart,#settings-tab,#o-add,#copy-log") as HTMLElement | null;
  if (!el) return;
  if (el.dataset.useLevy !== undefined) { st.draft.action = "p:levy"; return render(); }
  if (el.dataset.letter) { const id = Number(el.dataset.letter); st.openLetter = st.openLetter === id ? null : id; return render(); }
  if (el.dataset.issue) { st.openIssue = st.openIssue === el.dataset.issue ? null : el.dataset.issue; return render(); }
  if (el.dataset.closeLetter !== undefined) { st.openLetter = null; return render(); }
  if (el.dataset.toggle) {
    const a = JSON.parse(el.dataset.toggle) as PlayerAction, i = st.queue.findIndex((q) => matches(q, a));
    if (i >= 0) { st.queue.splice(i, 1); st.error = ""; return render(); }
    return queue(a);
  }
  if (el.dataset.mission) {
    const m = JSON.parse(el.dataset.mission) as { fort: string; mission: "defend" | "attack" | "scout"; raid?: string };
    const a: PlayerAction = { action: "advance", target: m.fort, ...(m.mission !== "defend" ? { mission: m.mission, raid: m.raid } : {}) };
    const i = st.queue.findIndex((q) => matches(q, a));
    if (i >= 0) st.queue[i] = a; else queue(a);
    st.error = ""; return render();
  }
  if (el.dataset.act) {
    const a = JSON.parse(el.dataset.act) as PlayerAction, i = st.queue.findIndex((q) => JSON.stringify(q) === JSON.stringify(a));
    if (i >= 0) { st.queue.splice(i, 1); st.error = ""; return render(); }
    return queue(a);
  }
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
      if (pa === "advance" && st.draft.mission !== "defend") { const raid = raidNear(st.sim.viewOf("player"), st.draft.objective); return queue({ action: "advance", target: st.draft.objective, mission: st.draft.mission as "scout" | "attack", raid }); }
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
  const k = ({ "o-to": "recipient", "o-action": "action", "o-obj": "objective", "o-disc": "discretion", "o-mission": "mission" } as Record<string, keyof typeof st.draft>)[t.id];
  if (t.id === "o-obj" && content.byId.location.get(t.value)?.fortification) st.selected = t.value;
  if (k) {
    st.draft[k] = t.value;
    if (k === "action") { // the list under Where follows the action: places, or people for escort and negotiate
      const people = t.value === "o:escort" || t.value === "o:negotiate";
      if (people && !st.draft.objective.startsWith("@")) st.draft.objective = "@" + (st.draft.recipient || "anna");
      if (!people && st.draft.objective.startsWith("@")) st.draft.objective = st.selected;
    }
    render();
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "O" && e.shiftKey) { st.observer = !st.observer; render(); } });
start(st.seed);
