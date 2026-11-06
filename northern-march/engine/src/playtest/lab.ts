// L4: batch execution. Tuples (seed x persona) run in isolated worker threads; records are written in tuple order,
// so the number of workers cannot change the result. Progress is durable: a stopped run resumes where it left off.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { canonicalJson, sha256 } from "../canonical.ts";
import { deriveContent, readContentDir, type Content } from "../content.ts";
import type { SimParams } from "../engine.ts";
import { PLAYTEST_SCHEMA_VERSION, parseManifest, type Persona, type PlaytestRunManifest, type PlaytestRunRecord } from "./contract.ts";
import { knownOf } from "./known.ts";
import { playGame } from "./runner.ts";

export const CONTENT_DIR = new URL("../../content/march/", import.meta.url).pathname;
export interface Patch { path: string; value: unknown }

/** The march content, with a candidate's bounded parameter changes applied (dotted paths into the raw content). */
export function labContent(dir: string, patch: readonly Patch[] = []): Content {
  const raw = readContentDir(dir) as unknown as Record<string, unknown>;
  for (const p of patch) {
    const keys = p.path.split(".");
    let o = raw as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) { if (!(k in o) || typeof o[k] !== "object") throw new Error(`patch ${p.path}: no ${k}`); o = o[k] as Record<string, unknown>; }
    const last = keys[keys.length - 1];
    if (!(last in o)) throw new Error(`patch ${p.path}: no ${last} (patches may change values, not add them)`);
    if (typeof o[last] !== typeof p.value) throw new Error(`patch ${p.path}: ${typeof p.value} for a ${typeof o[last]}`);
    o[last] = p.value;
  }
  return deriveContent(raw as never);
}

export interface Tuple { tupleIndex: number; seed: number; persona: Persona }
export function tuplesOf(m: PlaytestRunManifest): Tuple[] {
  const out: Tuple[] = [];
  for (let s = 0; s < m.seeds.count; s++) for (let p = 0; p < m.personas.length; p++) out.push({ tupleIndex: out.length, seed: m.seeds.first + s, persona: m.personas[p] });
  return out.slice(0, m.budgets.maxGames);
}

/** A compact line per game, kept for every run set (v4 retention). Full records stay in records.jsonl. */
export function summaryOf(r: PlaytestRunRecord) {
  const failures = r.failures.map((f) => ({ f: f.slice(0, 160), known: knownOf(f) }));
  return { i: r.tupleIndex, seed: r.seed, persona: r.persona, status: r.status, logHash: r.logHash, ms: r.wallMs, pauses: r.pauses, ...r.outcome, failures, newFailures: failures.filter((x) => !x.known).length };
}
export type Summary = ReturnType<typeof summaryOf>;

export interface LabHooks {
  /** After each record is written, in order. */
  onRecord?: (r: PlaytestRunRecord, s: Summary, done: number) => void;
  /** Every 1,000 games written (exact counts). Not awaited: workers keep playing. */
  onMilestone?: (done: number) => Promise<void> | void;
  /** A record with a new (not known) invariant failure. */
  onUrgent?: (s: Summary) => Promise<void> | void;
  onFinal?: (done: number, reason: "complete" | "budget" | "interrupted" | "error", detail: string) => Promise<void> | void;
}
export interface LabOptions { outDir: string; workers?: number; hooks?: LabHooks; inline?: boolean; stopAfter?: number }

const manifestHash = (m: PlaytestRunManifest) => sha256(canonicalJson(m)).slice(0, 16);

/** Run (or resume) a run set. Returns the number of games written and why it stopped. */
export async function runLab(raw: unknown, o: LabOptions): Promise<{ done: number; reason: "complete" | "budget" | "interrupted" | "error"; detail: string }> {
  const chk = parseManifest(raw);
  if (!chk.ok) throw new Error(`manifest rejected at ${chk.step}: ${chk.reason}`);
  const m = chk.value, dir = o.outDir;
  mkdirSync(dir, { recursive: true });
  const mPath = `${dir}/manifest.json`, recPath = `${dir}/records.jsonl`, sumPath = `${dir}/summaries.jsonl`, statePath = `${dir}/state.json`;
  const mh = manifestHash(m);
  let done = 0;
  if (existsSync(statePath)) {
    const st = JSON.parse(readFileSync(statePath, "utf8")) as { manifestHash: string; done: number };
    if (st.manifestHash !== mh) throw new Error(`${dir} holds a different run set (manifest ${st.manifestHash}); use a new directory`);
    done = st.done;
    // drop any line written after the last durable count (a crash between the append and the state write)
    for (const p of [recPath, sumPath]) if (existsSync(p)) { const lines = readFileSync(p, "utf8").split("\n").filter(Boolean); if (lines.length > done) { truncateSync(p, 0); appendFileSync(p, lines.slice(0, done).map((l) => l + "\n").join("")); } }
  } else writeFileSync(mPath, JSON.stringify({ ...m, manifestHash: mh }, null, 1));
  const save = () => writeFileSync(statePath, JSON.stringify({ schemaVersion: PLAYTEST_SCHEMA_VERSION, manifestHash: mh, done }));
  save();
  const tuples = tuplesOf(m).slice(done), t0 = Date.now(), patch = (m.params.contentPatch ?? []) as Patch[], simParams = (m.params.sim ?? {}) as SimParams;
  const workers = Math.max(1, Math.min(o.workers ?? m.budgets.workers, m.budgets.workers, Math.max(1, availableParallelism() - 1), tuples.length || 1));
  let stop = null as { reason: "budget" | "interrupted" | "error"; detail: string } | null;
  const pending = new Map<number, PlaytestRunRecord>();
  let next = done; // the tuple index the next written record must have
  const write = (r: PlaytestRunRecord) => {
    const s = summaryOf(r);
    appendFileSync(recPath, JSON.stringify(r) + "\n"); appendFileSync(sumPath, JSON.stringify(s) + "\n");
    done++; next++; save();
    o.hooks?.onRecord?.(r, s, done);
    if (s.failures.some((f) => !f.known && /^invariant/.test(f.f))) void o.hooks?.onUrgent?.(s);
    if (done % 1000 === 0) void o.hooks?.onMilestone?.(done);
    if (Date.now() - t0 > m.budgets.wallMs) stop ??= { reason: "budget", detail: `wall time ${m.budgets.wallMs} ms reached` };
    if (statSync(recPath).size > m.budgets.artifactBytes) stop ??= { reason: "budget", detail: `artifact budget ${m.budgets.artifactBytes} bytes reached` };
    if (o.stopAfter !== undefined && done >= o.stopAfter) stop ??= { reason: "interrupted", detail: `stopped after ${done} games (test)` };
  };
  const accept = (r: PlaytestRunRecord) => { pending.set(r.tupleIndex, r); while (pending.has(next) && !stop) { const x = pending.get(next)!; pending.delete(next); write(x); } };
  const onSig = () => { stop ??= { reason: "interrupted", detail: "signal" }; };
  process.once("SIGINT", onSig); process.once("SIGTERM", onSig);
  try {
    if (o.inline) {
      const content = labContent(CONTENT_DIR, patch);
      for (const t of tuples) { if (stop) break; accept(playGame({ content, seed: t.seed, persona: t.persona, days: m.days, runSetId: m.runSetId, tupleIndex: t.tupleIndex, params: simParams }).record); }
    } else {
      await new Promise<void>((resolve) => {
        let q = 0, live = 0;
        const pool = Array.from({ length: workers }, () => new Worker(new URL("./worker.ts", import.meta.url), { workerData: { contentDir: CONTENT_DIR, patch, days: m.days, runSetId: m.runSetId, sim: simParams } }));
        const feed = (w: Worker) => { if (stop || q >= tuples.length) { w.postMessage("stop"); return; } live++; w.postMessage(tuples[q++]); };
        let exited = 0;
        for (const w of pool) {
          w.on("message", (msg: { tupleIndex: number; record?: PlaytestRunRecord; error?: string }) => {
            live--;
            if (msg.error) stop ??= { reason: "error", detail: `tuple ${msg.tupleIndex}: ${msg.error.slice(0, 500)}` };
            else accept(msg.record!);
            feed(w);
          });
          w.on("error", (e) => { stop ??= { reason: "error", detail: String(e).slice(0, 500) }; });
          w.on("exit", () => { if (++exited === pool.length) resolve(); });
          feed(w);
        }
        void live;
      });
    }
  } finally { process.off("SIGINT", onSig); process.off("SIGTERM", onSig); }
  const reason = stop?.reason ?? (done >= tuplesOf(m).length ? "complete" : "budget"), detail = stop?.detail ?? (reason === "complete" ? `${done} games` : "stopped early");
  await o.hooks?.onFinal?.(done, reason, detail);
  return { done, reason, detail };
}

export function readSummaries(dir: string): Summary[] {
  const p = `${dir}/summaries.jsonl`;
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Summary) : [];
}
export function readRecords(dir: string, pick?: (s: Summary) => boolean): PlaytestRunRecord[] {
  const sums = readSummaries(dir), lines = readFileSync(`${dir}/records.jsonl`, "utf8").split("\n").filter(Boolean);
  return lines.map((l, i) => (!pick || pick(sums[i]) ? (JSON.parse(l) as PlaytestRunRecord) : null)).filter((x): x is PlaytestRunRecord => !!x);
}
