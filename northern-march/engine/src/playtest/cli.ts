// Playtest laboratory commands (npm run playtest:<command>). Deterministic local agents only; no paid model calls.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { engineHash } from "../batch.ts";
import { analyse } from "./analysis.ts";
import { PERSONAS, PLAYTEST_SCHEMA_VERSION, type Persona, type PlaytestRunManifest } from "./contract.ts";
import { buildDashboard } from "./dashboard.ts";
import { knownOf } from "./known.ts";
import { CONTENT_DIR, labContent, readRecords, readSummaries, runLab, type Patch } from "./lab.ts";
import { pairedExperiment, sealPackage } from "./paired.ts";
import { CommandAdapter, FakeAdapter, Reporter } from "./reporting.ts";
import { replayRecord } from "./runner.ts";
import { shrink } from "./shrink.ts";

const ENGINE = new URL("../../", import.meta.url).pathname;
const [cmd, ...args] = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k: string) => args.includes(`--${k}`);
const commit = () => { try { return execSync("git rev-parse --short HEAD", { cwd: ENGINE }).toString().trim(); } catch { return "unknown"; } };

function manifest(mode: PlaytestRunManifest["mode"], runSetId: string, first: number, count: number, personas: readonly Persona[], days: number): PlaytestRunManifest {
  const c = labContent(CONTENT_DIR);
  return { schemaVersion: PLAYTEST_SCHEMA_VERSION, runSetId, mode, partition: first >= 5000 ? "validation" : "dev", commit: commit(), engineHash: engineHash(), contentVersion: c.version, contentHash: c.hash,
    scenario: "march", days, seeds: { first, count }, personas: [...personas], params: {},
    budgets: { maxGames: count * personas.length, workers: Number(flag("workers", "4")), wallMs: Number(flag("wall-min", "240")) * 60_000, artifactBytes: Number(flag("max-mb", "400")) * 1_048_576, llmCalls: 0 } };
}

async function run(m: PlaytestRunManifest) {
  const dir = flag("out", `${ENGINE}results/playtest/${m.runSetId}`)!;
  mkdirSync(dir, { recursive: true });
  let done = 0;
  const expected = m.budgets.maxGames;
  const rep = new Reporter({ dir, runSetId: m.runSetId, expected, progress: () => done });
  const fake = new FakeAdapter(`${dir}/fake-sent.jsonl`), adapter = has("real-email") ? new CommandAdapter() : fake;
  const t0 = Date.now();
  const res = await runLab(m, { outDir: dir, inline: has("inline"), hooks: {
    onRecord: (_r, s, n) => { done = n; if (n % 50 === 0 || s.newFailures) process.stdout.write(`\r${n}/${expected} games, ${Math.round((Date.now() - t0) / 1000)} s   `); },
    onMilestone: async (n) => { const r = await rep.milestone(n); console.log(`\nmilestone ${n}: queued ${r.queued}, ${r.gamesWritten} games written while the report was built`); await rep.deliver(adapter); },
    onUrgent: async (s) => { if (rep.urgent(s)) await rep.deliver(adapter); },
    onFinal: async (n, reason, detail) => { rep.final(n, reason, detail); await rep.deliver(adapter); },
  } });
  const a = analyse(readSummaries(dir), { expected });
  writeFileSync(`${dir}/analysis.json`, JSON.stringify(a, null, 1));
  writeFileSync(`${dir}/dashboard.html`, buildDashboard(dir, { title: m.runSetId }));
  // retention (v4): summaries for every game; full records for failures and one example per persona in retained.jsonl
  const keep = new Set<number>(), firstOf = new Set<string>();
  for (const s of readSummaries(dir)) if (s.status !== "ok" || !firstOf.has(s.persona)) { keep.add(s.i); firstOf.add(s.persona); }
  writeFileSync(`${dir}/retained.jsonl`, readRecords(dir, (s) => keep.has(s.i)).slice(0, 500).map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (res.reason === "complete") sealPackage(dir, { analysis: "analysis.json", retained: "retained.jsonl" });
  console.log(`\n${m.runSetId}: ${res.done} games, ${res.reason} (${res.detail}); ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const p of a.panels) console.log(`  ${p.state.padEnd(22)} ${p.title}: ${p.detail}`);
  console.log(`dashboard: ${dir}/dashboard.html`);
}

const cmds: Record<string, () => Promise<void> | void> = {
  quick: () => run(manifest("quick", flag("id", "quick-" + commit())!, Number(flag("first", "1")), Number(flag("seeds", "10")), PERSONAS, Number(flag("days", "150")))),
  full: () => run(manifest("full", flag("id", "full-" + commit())!, Number(flag("first", "1")), Number(flag("seeds", "100")), PERSONAS, Number(flag("days", "150")))),
  adversarial: () => run(manifest("adversarial", flag("id", "adv-" + commit())!, Number(flag("first", "1000")), Number(flag("seeds", "250")), ["random-valid", "adversarial-probe", "literal-novice", "miscalibrated-ruler"], Number(flag("days", "150")))),
  paired: async () => {
    const patch: Patch[] = (flag("patch", "") ?? "").split(",").filter(Boolean).map((kv) => { const [path, v] = kv.split("="); return { path, value: JSON.parse(v) }; });
    if (!patch.length) throw new Error("--patch path=value[,path=value]");
    const m = manifest("paired", flag("id", "paired-" + commit())!, Number(flag("first", "5000")), Number(flag("seeds", "20")), PERSONAS, Number(flag("days", "150")));
    const dir = flag("out", `${ENGINE}results/playtest/${m.runSetId}`)!;
    const r = await pairedExperiment(m, patch, dir, { inline: has("inline") });
    console.log(JSON.stringify(r.comparison.all, null, 1));
    writeFileSync(`${dir}/dashboard.html`, buildDashboard(`${dir}/cand`, { title: m.runSetId, comparison: r.comparison, patch }));
  },
  dashboard: () => { const dir = args[0]; writeFileSync(`${dir}/dashboard.html`, buildDashboard(dir, { title: dir.split("/").filter(Boolean).pop()! })); console.log(`${dir}/dashboard.html`); },
  replay: () => {
    const [dir, i] = args, rec = readRecords(dir, (s) => s.i === Number(i))[0];
    if (!rec) throw new Error(`no game ${i} in ${dir}`);
    const r = replayRecord(rec, labContent(CONTENT_DIR));
    console.log(`game ${i} (seed ${rec.seed}, ${rec.persona}): replay ${r.ok ? "matches" : "DIFFERS"} (${r.logHash})`);
    if (!r.ok) process.exitCode = 1;
  },
  shrink: () => {
    const [dir, i] = args, rec = readRecords(dir, (s) => s.i === Number(i))[0];
    if (!rec) throw new Error(`no game ${i} in ${dir}`);
    const inv = rec.failures.find((f) => f.startsWith("invariant: "));
    const match = flag("match", inv ? inv.replace(/^invariant: /, "").replace(/\d+/g, "\\d+").replace(/[()]/g, "\\$&") : undefined);
    if (!match) throw new Error("no invariant failure in that game: give --match <regex>");
    const known = knownOf(inv ?? match), id = flag("case-id", `${known ?? "case"}-seed${rec.seed}`)!;
    const c = shrink(labContent(CONTENT_DIR), rec, { kind: "invariant", match }, { id, title: inv ?? match, knownIssue: known });
    mkdirSync(`${ENGINE}test/regression`, { recursive: true });
    writeFileSync(`${ENGINE}test/regression/${id}.json`, JSON.stringify(c, null, 1));
    console.log(`${id}: ${c.original.days} days / ${c.original.inputs} orders / ${c.original.actions} actions -> ${c.days} days / ${c.inputs.length} orders / ${c.inputs.reduce((a, x) => a + x.actions.length, 0)} actions (${c.shrinkSteps} replays)`);
  },
  query: () => {
    const [dir, what, x] = args, sums = readSummaries(dir);
    const rows = what === "failures" ? sums.filter((s) => s.failures.length) : what === "persona" ? sums.filter((s) => s.persona === x) : what === "game" ? sums.filter((s) => s.i === Number(x)) : what === "new" ? sums.filter((s) => s.newFailures) : [];
    for (const s of rows.slice(0, Number(flag("limit", "20")))) console.log(JSON.stringify(s));
    console.log(`${rows.length} rows`);
  },
  investigate: () => {
    const [dir, id] = args, a = JSON.parse(readFileSync(`${dir}/analysis.json`, "utf8")) as ReturnType<typeof analyse>;
    const f = a.findings.find((x) => x.id === id);
    if (!f?.investigate) throw new Error(`finding ${id} has no proposed investigation (${a.findings.filter((x) => x.investigate).map((x) => x.id).join(", ")})`);
    const out = `${dir}/investigations/${id}.json`;
    mkdirSync(`${dir}/investigations`, { recursive: true });
    writeFileSync(out, JSON.stringify({ finding: f, status: "proposed: needs review before running", run: `npm run playtest:paired -- --patch ${f.investigate}=<value> --first 5000 --seeds 50`, partition: "validation" }, null, 1));
    console.log(out);
  },
  outbox: async () => {
    const [dir] = args, m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as PlaytestRunManifest;
    const rep = new Reporter({ dir, runSetId: m.runSetId, expected: m.budgets.maxGames });
    const r = await rep.deliver(has("real-email") ? new CommandAdapter() : new FakeAdapter(`${dir}/fake-sent.jsonl`));
    console.log(JSON.stringify(r), [...rep.state().values()].map((x) => `${x.key} ${x.status} (${x.attempts})`).join("\n"));
  },
};
if (!cmd || !cmds[cmd]) { console.log(`commands: ${Object.keys(cmds).join(", ")}`); process.exitCode = 1; }
else await cmds[cmd]();
