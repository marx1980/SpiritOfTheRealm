// L7: milestone reports, a durable outbox with exactly-once keys, bounded exponential retry and a provider-neutral
// adapter. The recipient address is never written to a file: it is read from PLAYTEST_REPORT_EMAIL_TO when sending.
// Cadence (v4.1 A7): 1,000-game progress goes to the dashboard and outbox only unless PLAYTEST_EMAIL_EVERY_1K=1;
// every 10,000 games a deep report (instead of that 1,000 one); urgent alerts and the final report by email.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { PLAYTEST_SCHEMA_VERSION, parseNotification, type NotificationRecord } from "./contract.ts";
import { analyse, type Analysis } from "./analysis.ts";
import { readSummaries, type Summary } from "./lab.ts";

export interface Message { subject: string; body: string }
export interface NotificationAdapter { readonly name: string; send(m: Message): Promise<void> }

/** Test provider: writes what it would send to a file; can be told to fail the first n attempts. */
export class FakeAdapter implements NotificationAdapter {
  readonly name = "fake";
  private path: string;
  private failFirst: number;
  constructor(path: string, failFirst = 0) { this.path = path; this.failFirst = failFirst; }
  async send(m: Message) {
    if (this.failFirst > 0) { this.failFirst--; throw new Error("fake provider: injected failure"); }
    appendFileSync(this.path, JSON.stringify({ to: "env:PLAYTEST_REPORT_EMAIL_TO", ...m }) + "\n");
  }
}
/** Real provider: pipes an RFC 822 message to a mail command (e.g. `msmtp -t`, `sendmail -t`) named in
 *  PLAYTEST_MAIL_COMMAND. Refuses to run unless PLAYTEST_REAL_EMAIL_APPROVED=1 (v4 L7: one approved real test). */
export class CommandAdapter implements NotificationAdapter {
  readonly name = "command";
  async send(m: Message) {
    const to = process.env.PLAYTEST_REPORT_EMAIL_TO, cmd = process.env.PLAYTEST_MAIL_COMMAND;
    if (process.env.PLAYTEST_REAL_EMAIL_APPROVED !== "1") throw new Error("real email not approved (set PLAYTEST_REAL_EMAIL_APPROVED=1 after approval)");
    if (!to || !cmd) throw new Error("PLAYTEST_REPORT_EMAIL_TO and PLAYTEST_MAIL_COMMAND must be set");
    const msg = `To: ${to}\nSubject: ${m.subject.replace(/[\r\n]/g, " ")}\nContent-Type: text/plain; charset=utf-8\n\n${m.body}\n`;
    await new Promise<void>((ok, bad) => {
      const p = spawn("sh", ["-c", cmd], { stdio: ["pipe", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => (err += d));
      p.on("exit", (code) => (code === 0 ? ok() : bad(new Error(`mail command exited ${code}: ${err.slice(0, 200).replace(to, "<recipient>")}`))));
      p.stdin.end(msg);
    });
  }
}

export interface ReporterOptions { dir: string; runSetId: string; expected: number; every1kEmail?: boolean; maxAttempts?: number; baseDelayMs?: number; now?: () => number; progress?: () => number }

export class Reporter {
  private o: Required<Omit<ReporterOptions, "progress">> & { progress?: () => number };
  private path: string;
  private previous: Analysis | null = null;
  constructor(o: ReporterOptions) {
    this.o = { every1kEmail: process.env.PLAYTEST_EMAIL_EVERY_1K === "1", maxAttempts: 6, baseDelayMs: 60_000, now: () => Date.now(), ...o };
    this.path = `${o.dir}/outbox.jsonl`;
  }
  /** Current state per key: the last line written for it. */
  state(): Map<string, NotificationRecord> {
    const m = new Map<string, NotificationRecord>();
    if (!existsSync(this.path)) return m;
    for (const l of readFileSync(this.path, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l) as NotificationRecord; m.set(r.key, r); }
    return m;
  }
  private put(r: NotificationRecord) {
    const c = parseNotification(r);
    if (!c.ok) throw new Error(`notification rejected at ${c.step}: ${c.reason}`);
    appendFileSync(this.path, JSON.stringify(r) + "\n");
  }
  /** Queue a notification once. Returns false if that key was already queued (restart, duplicate milestone). */
  enqueue(kind: NotificationRecord["kind"], games: number, m: Message, email: boolean): boolean {
    const key = `${this.o.runSetId}:${kind}:${games}`;
    if (this.state().has(key)) return false;
    this.put({ schemaVersion: PLAYTEST_SCHEMA_VERSION, key, kind, runSetId: this.o.runSetId, games, subject: m.subject.slice(0, 200), body: m.body.slice(0, 200_000), email,
      status: email ? "pending" : "dashboard-only", attempts: 0, nextAttemptAt: 0 });
    return true;
  }
  /** Exact milestones: a 10,000 deep report replaces that 1,000 progress report. Yields between steps so the main
   *  thread keeps writing results from the workers while the report is built. */
  async milestone(games: number): Promise<{ queued: boolean; gamesWritten: number }> {
    const before = this.o.progress?.() ?? games;
    const tick = () => new Promise((r) => setImmediate(r));
    await tick();
    const sums = readSummaries(this.o.dir).slice(0, games);
    await tick();
    const a = analyse(sums, { expected: this.o.expected });
    await tick();
    const deep = games % 10000 === 0;
    const msg = deep ? deepReport(this.o.runSetId, sums, a, this.previous) : progressReport(this.o.runSetId, sums, a, this.previous, this.o.expected);
    this.previous = a;
    const queued = this.enqueue(deep ? "deep-10k" : "progress-1k", games, msg, deep || this.o.every1kEmail);
    return { queued, gamesWritten: (this.o.progress?.() ?? games) - before };
  }
  urgent(s: Summary) {
    return this.enqueue("urgent", s.i, { subject: `[Northern March lab] URGENT ${this.o.runSetId}: new invariant failure, game ${s.i}`,
      body: `Game ${s.i}, seed ${s.seed}, persona ${s.persona}\n${s.failures.filter((f) => !f.known).map((f) => `- ${f.f}`).join("\n")}\n\nReplay: npm run playtest:replay -- ${this.o.dir} ${s.i}\nShrink: npm run playtest:shrink -- ${this.o.dir} ${s.i}` }, true);
  }
  final(games: number, reason: string, detail: string) {
    const sums = readSummaries(this.o.dir), a = analyse(sums, { expected: this.o.expected });
    const m = progressReport(this.o.runSetId, sums, a, this.previous, this.o.expected);
    return this.enqueue("final", games, { subject: `[Northern March lab] ${this.o.runSetId} ${reason}: ${games} of ${this.o.expected} games`, body: `Stopped: ${reason} (${detail})${games < this.o.expected ? "\nCOVERAGE INCOMPLETE" : ""}\n\n${m.body}` }, true);
  }
  /** Send what is due. Failures back off exponentially (base x 2^attempts) up to maxAttempts, then stay failed. */
  async deliver(adapter: NotificationAdapter): Promise<{ sent: number; failed: number; waiting: number }> {
    let sent = 0, failed = 0, waiting = 0;
    for (const r of this.state().values()) {
      if (r.status !== "pending") continue;
      const now = this.o.now();
      if (r.nextAttemptAt > now) { waiting++; continue; }
      try {
        await adapter.send({ subject: r.subject, body: r.body });
        this.put({ ...r, status: "sent", attempts: r.attempts + 1, sentAt: now }); sent++;
      } catch (e) {
        const attempts = r.attempts + 1, dead = attempts >= this.o.maxAttempts;
        this.put({ ...r, status: dead ? "failed" : "pending", attempts, nextAttemptAt: now + this.o.baseDelayMs * 2 ** (attempts - 1), lastError: String((e as Error).message).slice(0, 500) });
        if (dead) failed++; else waiting++;
      }
    }
    return { sent, failed, waiting };
  }
}

const line = (s: string) => `${s}\n`;
function header(runSetId: string, sums: Summary[], expected: number) {
  const ms = sums.reduce((a, s) => a + s.ms, 0), perGame = sums.length ? Math.round(ms / sums.length) : 0;
  return line(`Run set ${runSetId}: ${sums.length} of ${expected} games (${Math.round((100 * sums.length) / Math.max(1, expected))}%)`) +
    line(`Throughput: ${perGame} ms per game per worker; remaining about ${Math.round(((expected - sums.length) * perGame) / 60000)} worker-minutes`);
}
function progressReport(runSetId: string, sums: Summary[], a: Analysis, prev: Analysis | null, expected: number): Message {
  const newClasses = a.failureClasses.filter((c) => !prev?.failureClasses.some((p) => p.class === c.class));
  let b = header(runSetId, sums, expected) + "\n";
  b += line("Status:") + a.panels.map((p) => line(`  ${p.state.padEnd(22)} ${p.title}: ${p.detail}`)).join("");
  b += "\n" + line("Failures by class:") + (a.failureClasses.map((c) => line(`  ${c.class}: ${c.games} games (first: ${c.firstRef})`)).join("") || line("  none"));
  b += line(`New since last report: ${newClasses.map((c) => c.class).join(", ") || "none"}`);
  b += "\n" + line("Personas (objective met %, levies, reliefs, the rival gains a following %):");
  for (const [p, v] of Object.entries(a.personas)) b += line(`  ${p.padEnd(24)} ${String(v.objectiveMet).padStart(5)}%  levies ${v.levies}  reliefs ${v.reliefs}  the rival ${v.supportForRival}%  cites ${v.citeShare ?? "-"}%`);
  b += "\n" + line("G-11: not evaluated by the lab (sealed phase gate, open since D-013)");
  const top = a.findings[0];
  if (top) b += line(`Top finding (${top.certainty}): ${top.text} [${top.evidence.join("; ")}]`);
  b += line(`Next milestone: ${Math.min(expected, (Math.floor(sums.length / 1000) + 1) * 1000)} games`);
  const hard = a.panels.find((p) => p.id === "integrity")!.state;
  return { subject: `[Northern March lab] ${runSetId}: ${sums.length} games, integrity ${hard}`, body: b };
}
function deepReport(runSetId: string, sums: Summary[], a: Analysis, prev: Analysis | null): Message {
  const base = progressReport(runSetId, sums, a, prev, sums.length);
  let b = base.body + "\n" + line("Deep report") + line("Objective met with 95% intervals:");
  for (const [p, v] of Object.entries(a.personas)) b += line(`  ${p.padEnd(24)} ${v.objectiveMet}% [${v.objectiveCi.join(", ")}]`);
  b += line("Distinctness (logs differ, % of shared seeds):") + a.pairs.map((p) => line(`  ${p.a} / ${p.b}: ${p.differ}%`)).join("");
  b += line("Conclusions:") + a.findings.slice(0, 5).map((f, i) => line(`  ${i + 1}. (${f.certainty}) ${f.text}`)).join("");
  b += line("Proposed investigations (paired experiments; manifests via npm run playtest:investigate):") + a.findings.filter((f) => f.investigate).map((f) => line(`  ${f.id}: vary ${f.investigate}`)).join("");
  return { subject: base.subject.replace(":", ": DEEP"), body: b };
}
