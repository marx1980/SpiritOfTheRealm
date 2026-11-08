// L3: one game played by a player agent through the real engine, with limits, a run record and exact replay.
// The runner is test-side: it may read the finished log for outcomes and invariants; the agent never sees it.
import type { Content } from "../content.ts";
import { createSim, hashLog, type Sim, type SimParams } from "../engine.ts";
import { checkRun } from "../invariants.ts";
import type { PlayerAction } from "../policies.ts";
import { publicRules } from "../presentation/affordances.ts";
import { STANCES } from "../content.ts";
import { AgentRng, type AgentMemory } from "./agentkit.ts";
import { AGENTS } from "./agents/personas.ts";
import { checkDecision, PLAYTEST_SCHEMA_VERSION, type ActionRecord, type Persona, type PlaytestRunRecord } from "./contract.ts";
import { buildObservation, type ObservationRules } from "./observe.ts";

const DAY = 86400;
export interface GameSpec { content: Content; seed: number; persona: Persona; days: number; runSetId?: string; tupleIndex?: number; params?: SimParams; maxPauses?: number; maxWallMs?: number }

export const observationRules = (c: Content): ObservationRules => ({ ...publicRules(c), objectiveForts: [...c.scenario.objective.forts] });
const toRecord = (a: PlayerAction): ActionRecord => ({
  action: a.action as ActionRecord["action"], ...(a.target ? { target: a.target } : {}), ...(a.mission && a.mission !== "defend" ? { mission: a.mission } : {}),
  ...(a.raid ? { raid: a.raid } : {}), ...(a.repairMode && a.repairMode !== "standard" ? { repairMode: a.repairMode } : {}), ...(a.followed ? { followed: a.followed } : {}),
  ...(a.to ? { to: a.to } : {}), ...(a.good ? { good: a.good } : {}), ...(a.units ? { units: a.units } : {}), ...(a.sell ? { sell: true } : {}), ...(a.muster ? { muster: true } : {}), ...(a.consult ? { consult: true } : {}),
});
const fromRecord = (r: ActionRecord): PlayerAction => ({ ...r } as PlayerAction);
const newSim = (s: { content: Content; seed: number; params?: SimParams }) => createSim({ content: s.content, seed: s.seed, policy: "external", params: { dayEnd: true, ...(s.params ?? {}) } });

/** Play one game. Each pause: observation → agent → contract checks → the engine's own validator → answer. */
export function playGame(spec: GameSpec): { record: PlaytestRunRecord; sim: Sim } {
  const t0 = performance.now(), sim = newSim(spec), rules = observationRules(spec.content), agent = AGENTS[spec.persona];
  const rng = new AgentRng(`agent:${spec.persona}:${spec.seed}`), memory: AgentMemory = {};
  const end = spec.days * DAY, maxPauses = spec.maxPauses ?? 4000, maxWall = spec.maxWallMs ?? 120_000;
  const decisions: PlaytestRunRecord["decisions"] = [], failures: string[] = [];
  let pauses = 0, status: PlaytestRunRecord["status"] = "ok", acting = 0, citing = 0, seenLetters = new Set<number>();
  for (;;) {
    const r = sim.next(end);
    if (!r.paused) break;
    if (pauses >= maxPauses || performance.now() - t0 > maxWall) { status = "budget"; failures.push(`budget: ${pauses} pauses, ${Math.round(performance.now() - t0)} ms`); sim.answer([]); break; }
    const v = r.view!, fresh = v.reports.filter((x) => !seenLetters.has(x.reportId)).map((x) => x.reportId);
    for (const x of fresh) seenLetters.add(x);
    const built = buildObservation(v, rules, { index: pauses, pause: r.reason ?? "report", newLetters: fresh });
    let raw: unknown;
    try { raw = agent.decide(built.obs, rng, memory); } catch (e) { raw = { error: String(e) }; }
    const chk = typeof raw === "object" && raw && "error" in raw ? { ok: false as const, step: "agent-error" as const, reason: String((raw as { error: unknown }).error) } : checkDecision(raw, built.obs);
    let actions: PlayerAction[] = [], rejected: PlaytestRunRecord["decisions"][number]["rejected"];
    if (chk.ok) actions = chk.value.choose.map((c) => built.actions.get(c)).filter((a): a is PlayerAction => !!a);
    else rejected = { step: chk.step, reason: chk.reason };
    try { sim.answer(actions); }
    catch (e) { rejected = { step: "engine", reason: String((e as Error).message).slice(0, 300) }; actions = []; sim.answer([]); }
    const cited = chk.ok ? chk.value.rationale.cites.length : 0;
    if (actions.length) { acting++; if (cited) citing++; }
    if (actions.length || rejected) decisions.push({ i: pauses, tick: v.now, obsHash: built.hash, actions: actions.map(toRecord), cited, ...(rejected ? { rejected } : {}) });
    if (rejected && spec.persona !== "adversarial-probe") failures.push(`decision ${pauses}: rejected at ${rejected.step}: ${rejected.reason}`);
    pauses++;
  }
  const invariants = checkRun(sim).slice(0, 50);
  if (invariants.length) failures.push(...invariants.slice(0, 5).map((x) => `invariant: ${x}`));
  if (failures.length && status === "ok") status = "failed";
  return { record: { schemaVersion: PLAYTEST_SCHEMA_VERSION, runSetId: spec.runSetId ?? "adhoc", tupleIndex: spec.tupleIndex ?? 0, seed: spec.seed, persona: spec.persona, days: spec.days,
    status, logHash: hashLog(sim.log), events: sim.log.length, wallMs: Math.round(performance.now() - t0), pauses, decisions,
    outcome: outcomeOf(sim, spec.content, decisions, acting, citing), invariants, failures: failures.slice(0, 50) }, sim };
}

/** Outcomes, read from the finished log (post-run, test-side). */
export function outcomeOf(sim: Sim, content: Content, decisions: PlaytestRunRecord["decisions"], acting: number, citing: number): PlaytestRunRecord["outcome"] {
  const o = sim.objectiveStatus(), n = (t: string) => sim.log.filter((e) => e.type === t).length;
  const inputs = sim.log.filter((e) => e.type === "PlayerInput").map((e) => String(e.payload.action));
  const top: Record<string, string> = Object.fromEntries(content.communities.communities.map((c) => [c.id, "cooperate"]));
  for (const e of sim.log) if (e.type === "CommunityStanceChanged") {
    const c = String(e.payload.community), to = String(e.payload.to);
    if (STANCES.indexOf(to as never) > STANCES.indexOf(top[c] as never)) top[c] = to;
  }
  return { objectiveMet: o.met, ended: o.ended, fortsFallen: n("FortFell"), levies: inputs.filter((x) => x === "levy").length, reliefs: inputs.filter((x) => x === "relief").length,
    repairs: inputs.filter((x) => x === "repair").length, sends: inputs.filter((x) => x === "advance").length, travels: inputs.filter((x) => x === "travel").length, petitions: n("PetitionMade"),
    topStance: top, invalid: decisions.filter((d) => d.rejected).length, actingDecisions: acting, citingDecisions: citing };
}

/** Exact replay (v4.1 A8): feed the recorded actions back at the same pauses, with no agent; the log hash must match. */
export function replayRecord(rec: Pick<PlaytestRunRecord, "seed" | "days" | "decisions" | "logHash" | "pauses" | "status">, content: Content, params?: SimParams): { ok: boolean; logHash: string; sim: Sim } {
  const sim = newSim({ content, seed: rec.seed, params }), byI = new Map(rec.decisions.map((d) => [d.i, d]));
  for (let i = 0; ; i++) {
    const r = sim.next(rec.days * DAY);
    if (!r.paused) break;
    const d = byI.get(i);
    if (d && r.view!.now !== d.tick) return { ok: false, logHash: `diverged at decision ${i}`, sim };
    sim.answer(d ? d.actions.map(fromRecord) : []);
    if (rec.status === "budget" && i >= rec.pauses) break; // the run stopped at its budget right after this pause
  }
  const h = hashLog(sim.log);
  return { ok: h === rec.logHash, logHash: h, sim };
}
