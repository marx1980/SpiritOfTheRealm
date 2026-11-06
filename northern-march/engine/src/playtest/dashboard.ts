// L6: static Control Center page for one run set (or a paired comparison): status panels, personas, failures with
// replay commands, findings, distinctness, and a causal explorer for pinned games (objective chain, what Anna knew,
// what the acting characters decided). Objective truth appears here only after the run (debug view).
import { existsSync, readFileSync } from "node:fs";
import type { SimEvent } from "../events.ts";
import { letterSentences } from "../presentation/phrasing.ts";
import { analyse, type Analysis } from "./analysis.ts";
import type { compare } from "./paired.ts";
import { CONTENT_DIR, labContent, readRecords, readSummaries, type Patch, type Summary } from "./lab.ts";
import { replayRecord } from "./runner.ts";

const DAY = 86400;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const STATE_CLASS: Record<string, string> = { PASS: "pass", REVIEW: "review", FAIL: "fail", "INSUFFICIENT EVIDENCE": "insufficient", "NOT EVALUATED": "na" };

function brief(e: SimEvent): string {
  const p = e.payload as Record<string, unknown>;
  const pick = ["location", "site", "community", "to", "recipient", "orderId", "action", "decision", "author", "intent", "reason", "ending"].filter((k) => p[k] !== undefined && typeof p[k] !== "object").map((k) => `${k} ${p[k]}`);
  if (p.action && typeof p.action === "object") pick.push(`action ${(p.action as { kind: string; target?: string }).kind} ${(p.action as { target?: string }).target ?? ""}`);
  return pick.slice(0, 4).join(", ");
}

interface Explored { key: string; label: string; replay: string; objective: string[]; anna: string[]; actors: string[] }
function explore(dir: string, sums: Summary[]): Explored[] {
  const pins: Summary[] = [];
  const seen = new Set<string>();
  for (const s of sums) for (const f of s.failures) { const k = f.known ?? f.f.slice(0, 40); if (!seen.has(k) && pins.length < 6) { seen.add(k); pins.push(s); } }
  for (const p of [...new Set(sums.map((s) => s.persona))]) { const s = sums.find((x) => x.persona === p && x.fortsFallen > 0); if (s && pins.length < 12 && !pins.includes(s)) pins.push(s); }
  if (!pins.length || !existsSync(`${dir}/records.jsonl`)) return [];
  const content = labContent(CONTENT_DIR), want = new Set(pins.map((s) => s.i));
  return readRecords(dir, (s) => want.has(s.i)).map((rec) => {
    const s = sums.find((x) => x.i === rec.tupleIndex)!, { sim } = replayRecord(rec, content), log = sim.log, byId = new Map(log.map((e) => [e.id, e]));
    const lifecycle = s.failures.find((f) => /order (\d+)/.test(f.f));
    const oid = lifecycle ? Number(/order (\d+)/.exec(lifecycle.f)![1]) : null;
    const target = (oid !== null ? log.find((e) => e.type === "ExecutionStarted" && (e.payload as { orderId?: number }).orderId === oid) : undefined)
      ?? log.find((e) => e.type === "FortFell") ?? log.find((e) => e.type === "CampaignEnded") ?? log[log.length - 1];
    const anc = new Set<number>(), stack = [target.id];
    while (stack.length && anc.size < 400) { const id = stack.pop()!; if (anc.has(id)) continue; anc.add(id); for (const c of byId.get(id)?.causedBy ?? []) stack.push(c); }
    const chain = [...anc].sort((a, b) => a - b).map((id) => byId.get(id)!).filter((e) => !["BeliefUpdated", "AgentWoke", "Observed", "BeliefEvicted"].includes(e.type));
    const objective = chain.slice(-24).map((e) => `day ${Math.floor(e.tick / DAY)} · #${e.id} ${e.type}${brief(e) ? ` · ${brief(e)}` : ""}`);
    const v = sim.viewOf("player");
    const letters = v.reports.filter((r) => r.deliveredAt <= target.tick).slice(-8).map((r) => ({ t: r.deliveredAt, line: `day ${Math.floor(r.deliveredAt / DAY)} · letter from ${v.world.names[r.author] ?? r.author} (written day ${Math.floor(r.composedAt / DAY)}): ${letterSentences(v, r).join(" ").slice(0, 220)}` }));
    const orders = rec.decisions.filter((d) => d.tick <= target.tick && d.actions.length).slice(-8).map((d) => ({ t: d.tick, line: `day ${Math.floor(d.tick / DAY)} · Anna orders: ${d.actions.map((a) => `${a.action} ${a.target ?? ""}${a.mission ? ` (${a.mission})` : ""}`).join("; ")}` }));
    const anna = [...letters, ...orders].sort((a, b) => a.t - b.t).map((x) => x.line);
    const actors = chain.filter((e) => e.type === "ObedienceDecided" || e.type === "DecisionMade" || e.type === "OrderInterpreted").slice(-8).map((e) => {
      const p = e.payload as Record<string, any>;
      return e.type === "DecisionMade" ? `day ${Math.floor(e.tick / DAY)} · ${p.trace?.agent ?? "?"} decides: ${p.trace?.selected?.kind ?? "?"} ${p.trace?.selected?.target ?? ""}` : `day ${Math.floor(e.tick / DAY)} · ${e.type}: ${brief(e)}`;
    });
    if (!actors.length) actors.push(`No interpretation or obedience step in this chain${oid !== null ? ` (order ${oid} went straight from received to execution)` : ""}`);
    return { key: String(s.i), label: `Game ${s.i} · seed ${s.seed} · ${s.persona} · ${target.type}`, replay: `npm run playtest:replay -- ${dir} ${s.i}`, objective, anna: anna.length ? anna : ["No letters or orders before this event"], actors };
  });
}

export function buildDashboard(dir: string, o: { title: string; comparison?: ReturnType<typeof compare>; patch?: Patch[] }): string {
  const sums = readSummaries(dir);
  const manifest = existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as Record<string, any> : {};
  const a: Analysis = analyse(sums, { expected: manifest.budgets?.maxGames });
  const explored = explore(dir, sums);
  const ps = Object.entries(a.personas);
  const pill = (s: string) => `<span class="pill ${STATE_CLASS[s] ?? "na"}">${esc(s)}</span>`;
  const panels = a.panels.map((p) => `<div class="panel"><div class="ph">${pill(p.state)}<h3>${esc(p.title)}</h3></div><p>${esc(p.detail)}</p>${p.evidence.length ? `<p class="ev">${p.evidence.map(esc).join(" · ")}</p>` : ""}</div>`).join("");
  const num = (x: number | null, suf = "") => (x === null ? "–" : `${x}${suf}`);
  const personaRows = ps.map(([p, v]) => `<tr><th>${esc(p)}</th><td>${v.games}</td><td>${v.objectiveMet}%<small> ${v.objectiveCi[0]}–${v.objectiveCi[1]}</small></td><td>${v.fortsFallen}</td><td>${v.levies}</td><td>${v.reliefs}</td><td>${v.repairs}</td><td>${v.sends}</td><td>${v.petitions}</td><td>${v.supportForVaros}%</td><td>${num(v.citeShare, "%")}</td><td>${v.invalid}</td><td>${v.msPerGame}</td></tr>`).join("");
  const failRows = a.failureClasses.map((c) => `<tr><th>${esc(c.class)}</th><td>${c.games}</td><td>${c.failures}</td><td><code>npm run playtest:replay -- ${esc(dir)} ${c.firstGame}</code></td></tr>`).join("") || `<tr><td colspan="4">None</td></tr>`;
  const known = a.known.map((k) => `<div class="known"><b>${esc(k.id)}</b> ${esc(k.title)}<div class="dec">${esc(k.decision)}</div></div>`).join("");
  const findings = a.findings.map((f) => `<li><span class="cert ${f.certainty}">${esc(f.certainty)}</span> ${esc(f.text)}${f.evidence.length ? ` <small>${f.evidence.map(esc).join(" · ")}</small>` : ""}</li>`).join("");
  const names = [...new Set(a.pairs.flatMap((p) => [p.a, p.b]))];
  const cell = (x: string, y: string) => { if (x === y) return `<td class="self"></td>`; const p = a.pairs.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x)); const d = p?.differ ?? 0; return `<td class="hm" style="--d:${d / 100}" title="${esc(x)} / ${esc(y)}: ${d}%">${Math.round(d)}</td>`; };
  const heat = names.length > 1 ? `<div class="scroll"><table class="heat"><tr><th></th>${names.map((n) => `<th class="rot"><span>${esc(n)}</span></th>`).join("")}</tr>${names.map((y) => `<tr><th>${esc(y)}</th>${names.map((x) => cell(x, y)).join("")}</tr>`).join("")}</table></div>` : "";
  const cmp = o.comparison ? `<section><h2>Candidate vs baseline</h2><p class="mono">${(o.patch ?? []).map((p) => `${esc(p.path)} = ${esc(JSON.stringify(p.value))}`).join("<br>")}</p><div class="scroll"><table><tr><th></th><th>Games</th><th>Diverged</th><th>Objective met</th><th>Δ 95%</th><th>Varos following</th><th>Δ 95%</th><th>New failures</th></tr>${[["All", o.comparison.all], ...Object.entries(o.comparison.perPersona)].map(([k, r]) => { const x = r as typeof o.comparison.all; return `<tr><th>${esc(k)}</th><td>${x.games}</td><td>${x.diverged}</td><td>${x.objectiveMet.base}% → ${x.objectiveMet.cand}%</td><td>${x.objectiveMet.diffCi.join(" … ")}</td><td>${x.varosFollowing.base}% → ${x.varosFollowing.cand}%</td><td>${x.varosFollowing.diffCi.join(" … ")}</td><td>${x.newFailures.base} → ${x.newFailures.cand}</td></tr>`; }).join("")}</table></div></section>` : "";
  const explorer = explored.length ? `<section><h2>Causal explorer</h2><label for="game-pick" class="lab">Game</label> <select id="game-pick">${explored.map((e) => `<option value="${esc(e.key)}">${esc(e.label)}</option>`).join("")}</select>
    ${explored.map((e, i) => `<div class="explore" data-game="${esc(e.key)}"${i ? " hidden" : ""}><p class="mono">${esc(e.replay)}</p><div class="cols">
      <div><h3>Objective chain</h3><ol>${e.objective.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
      <div><h3>What Anna knew</h3><ol>${e.anna.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
      <div><h3>Acting characters</h3><ol>${e.actors.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div></div></div>`).join("")}</section>` : "";
  return `<title>Playtest Lab · ${esc(o.title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+Sans+SC:wght@500;700&family=Alegreya+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: a bench ledger. Status strip first, then personas, failures, findings, explorer; one column on phones. */
:root { --bg: #f1f4f2; --surface: #fbfcfb; --ink: #1d2a2b; --muted: #5b6b6a; --rule: #cfd9d6; --accent: #2c5a7e;
  --pass: #2f7a4b; --review: #a86a12; --fail: #b3352b; --insufficient: #6b5a8e; --na: #7a8786;
  --display: "Alegreya Sans SC", "Gill Sans", "Trebuchet MS", sans-serif; --body: "Alegreya Sans", "Gill Sans", "Trebuchet MS", sans-serif; --mono: "JetBrains Mono", ui-monospace, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #141b1c; --surface: #1b2425; --ink: #e2ebe8; --muted: #9aaba8; --rule: #2e3c3d; --accent: #7fb0d6;
  --pass: #6fc08c; --review: #e0a24a; --fail: #ef7a6e; --insufficient: #ad9bd6; --na: #93a19f; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #141b1c; --surface: #1b2425; --ink: #e2ebe8; --muted: #9aaba8; --rule: #2e3c3d; --accent: #7fb0d6;
  --pass: #6fc08c; --review: #e0a24a; --fail: #ef7a6e; --insufficient: #ad9bd6; --na: #93a19f; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 16px/1.5 var(--body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 20px 48px; }
main { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
main > * { min-width: 0; }
h1, h2, h3 { font-family: var(--display); font-weight: 700; letter-spacing: .03em; text-wrap: balance; margin: 0; }
h1 { font-size: 1.9rem; } h2 { font-size: 1.25rem; color: var(--accent); margin-bottom: 10px; } h3 { font-size: 1rem; }
header { display: grid; gap: 6px; border-bottom: 2px solid var(--ink); padding-bottom: 12px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font: 13px var(--mono); }
.panels { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.panel p { margin: 0; overflow-wrap: anywhere; } .panel .ev { color: var(--muted); font-size: 13px; }
.ph { display: grid; gap: 6px; }
.pill { justify-self: start; font: 600 11px var(--mono); letter-spacing: .06em; padding: 2px 8px; border-radius: 999px; color: var(--surface); }
.pill.pass { background: var(--pass); } .pill.review { background: var(--review); } .pill.fail { background: var(--fail); } .pill.insufficient { background: var(--insufficient); } .pill.na { background: var(--na); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 14px; width: 100%; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
tr th:first-child { font-weight: 500; } thead th, tr:first-child th { font-family: var(--display); color: var(--muted); font-weight: 500; }
td small { color: var(--muted); }
code, .mono { font: 12px var(--mono); overflow-wrap: anywhere; }
.known { background: var(--surface); border: 1px solid var(--rule); border-left: 4px solid var(--review); padding: 10px 14px; border-radius: 4px; }
.known .dec { color: var(--muted); margin-top: 4px; }
ul.findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.cert { font: 600 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; margin-right: 6px; }
.cert.established { color: var(--pass); } .cert.likely { color: var(--review); } .cert.tentative { color: var(--muted); }
ul.findings small { color: var(--muted); }
.heat td.hm { text-align: center; background: color-mix(in srgb, var(--accent) calc(var(--d) * 70%), transparent); min-width: 34px; }
.heat td.self { background: var(--rule); }
.heat th.rot { height: 150px; vertical-align: bottom; white-space: nowrap; } .heat th.rot span { writing-mode: vertical-rl; transform: rotate(180deg); }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.cols > div { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; min-width: 0; }
.cols ol { margin: 8px 0 0; padding-left: 18px; font-size: 13px; display: grid; gap: 4px; overflow-wrap: anywhere; }
.lab { font-family: var(--display); color: var(--muted); }
select { font: inherit; padding: 4px 8px; max-width: 100%; background: var(--surface); color: var(--ink); border: 1px solid var(--rule); border-radius: 4px; }
select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<main>
<header><h1>Playtest Lab · ${esc(o.title)}</h1>
<div class="meta"><span>${a.games}${manifest.budgets ? ` / ${manifest.budgets.maxGames}` : ""} games</span><span>${esc(manifest.days ?? "")} days</span><span>seeds ${esc(manifest.seeds?.first ?? "")}+${esc(manifest.seeds?.count ?? "")}</span><span>${esc(manifest.partition ?? "")}</span><span>commit ${esc(manifest.commit ?? "")}</span><span>engine ${esc(manifest.engineHash ?? "")}</span><span>content ${esc(manifest.contentVersion ?? "")}</span></div></header>
<section><h2>Status</h2><div class="panels">${panels}</div></section>
${cmp}
<section><h2>Personas · per game</h2><div class="scroll"><table><tr><th></th><th>Games</th><th>Objective met</th><th>Forts fallen</th><th>Levies</th><th>Reliefs</th><th>Repairs</th><th>Sends</th><th>Petitions</th><th>Varos following</th><th>Cites evidence</th><th>Rejected</th><th>ms</th></tr>${personaRows}</table></div></section>
<section><h2>Failures</h2><div class="scroll"><table><tr><th>Class</th><th>Games</th><th>Count</th><th>Replay first</th></tr>${failRows}</table></div></section>
${known ? `<section><h2>Known issues</h2>${known}</section>` : ""}
<section><h2>Findings</h2><ul class="findings">${findings}</ul></section>
${heat ? `<section><h2>Persona distinctness</h2>${heat}</section>` : ""}
${explorer}
</main>
<script>
const pick = document.getElementById("game-pick");
if (pick) pick.addEventListener("change", () => { for (const d of document.querySelectorAll(".explore")) d.hidden = d.dataset.game !== pick.value; });
</script>`;
}
