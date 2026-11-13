// Playtest laboratory contract (v4 L1, v4.1). Everything a player agent sees, everything it may answer, and the
// records the laboratory keeps. Zod lives here only: the simulation core stays dependency-free.
// Player agents (src/playtest/agents/**) may import this file and ../agentkit.ts, nothing else (v4.1 A3).
import { z } from "zod";

export const PLAYTEST_SCHEMA_VERSION = 1 as const;
const v1 = z.literal(PLAYTEST_SCHEMA_VERSION);
const int = z.number().int();
const nat = int.nonnegative();
const id = z.string().min(1).max(80);
const text = z.string().max(600);

export const PAUSES = ["report", "advice", "danger", "arrival", "dayend", "checkpoint"] as const;
export const CERTAINTY = ["certain", "probably", "perhaps", "doubtful", "out of date"] as const;

export const EvidenceSchema = z.strictObject({
  id: z.string().regex(/^e\d+$/), text, source: text, age: z.string().max(40), ageDays: nat, certainty: z.enum(CERTAINTY),
});
const affBase = { id: z.string().regex(/^a\d+$/), text, costMilli: nat.nullable(), recommendedBy: z.array(id).max(10), adviceIds: z.array(nat).max(10) };
export const ActionAffordanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("wait"), ...affBase }),
  z.strictObject({ kind: z.literal("levy"), ...affBase }),
  z.strictObject({ kind: z.literal("repair"), target: id, repairMode: z.enum(["standard", "rush", "labour"]), ...affBase }),
  z.strictObject({ kind: z.literal("advance"), target: id, mission: z.enum(["defend", "attack", "scout"]), raid: id.optional(), ...affBase }),
  z.strictObject({ kind: z.literal("relief"), target: id, ...affBase }),
  z.strictObject({ kind: z.literal("travel"), target: id, ...affBase }),
]);
const PlaceSchema = z.strictObject({
  id, name: text, fortified: z.boolean(), you: z.boolean(),
  walls: z.strictObject({ words: text, evidenceId: z.string().regex(/^e\d+$/) }).optional(),
  raiders: z.strictObject({ words: text, evidenceId: z.string().regex(/^e\d+$/) }).optional(),
  people: z.array(text).max(20),
});
export const PlayerObservationSchema = z.strictObject({
  schemaVersion: v1, id: z.string().regex(/^obs:\d+$/), decisionIndex: nat, day: nat, pause: z.enum(PAUSES),
  objective: z.strictObject({ text, forts: z.array(id).max(10) }),
  ruler: z.strictObject({ at: id.nullable(), travellingTo: id.nullable(), coinsMilli: int.nullable(), coinsAgeDays: nat.nullable() }),
  letters: z.array(z.strictObject({ id: nat, from: text, about: text, sentences: z.array(text).max(20), writtenDaysAgo: nat, arrivedDaysAgo: nat, isNew: z.boolean() })).max(60),
  advice: z.array(z.strictObject({ id: nat, adviserId: id, adviser: text, area: text, plan: text, supports: z.array(text).max(10), concerns: z.array(text).max(10), heardDaysAgo: nat, fresh: z.boolean() })).max(20),
  issues: z.array(z.strictObject({ key: z.string().max(80), title: text, priority: int, place: id.optional(), evidenceIds: z.array(z.string().regex(/^e\d+$/)).max(10), adviceIds: z.array(nat).max(10) })).max(40),
  places: z.array(PlaceSchema).max(60),
  evidence: z.array(EvidenceSchema).max(300),
  affordances: z.array(ActionAffordanceSchema).min(1).max(80),
});
export const PlayerAgentDecisionSchema = z.strictObject({
  schemaVersion: v1, observationId: z.string().regex(/^obs:\d+$/), agent: id,
  choose: z.array(z.string().regex(/^a\d+$/)).max(8),
  rationale: z.strictObject({ text: z.string().max(500), cites: z.array(z.string().regex(/^e\d+$/)).max(20) }),
});

export const PERSONAS = ["passive", "random-valid", "cautious-administrator", "impulsive-war-ruler", "adviser-dependent", "community-protector",
  "literal-novice", "miscalibrated-ruler", "delegating-strategist", "adversarial-probe"] as const;
export const PARTITIONS = ["dev", "validation", "sealed", "regression"] as const;
/** Seed ranges per partition. Sealed lab blocks start at 200,000, clear of every phase-gate block (plan C0.1). */
export const PARTITION_SEEDS: Record<(typeof PARTITIONS)[number], [number, number]> = { dev: [1, 4999], validation: [5000, 9999], regression: [1, 9999], sealed: [200000, 999999] };
export const PlaytestRunManifestSchema = z.strictObject({
  schemaVersion: v1, runSetId: z.string().regex(/^[a-z0-9-]{3,60}$/), mode: z.enum(["quick", "full", "adversarial", "paired"]), partition: z.enum(PARTITIONS),
  commit: z.string().max(40), engineHash: z.string().max(40), contentVersion: z.string().max(40), contentHash: z.string().length(64),
  scenario: z.literal("march"), days: int.min(1).max(400), seeds: z.strictObject({ first: nat, count: int.min(1).max(1_000_000) }), personas: z.array(z.enum(PERSONAS)).min(1),
  params: z.record(z.string(), z.unknown()),
  budgets: z.strictObject({ maxGames: int.min(1), workers: int.min(1).max(64), wallMs: int.min(1000), artifactBytes: int.min(1024), llmCalls: z.literal(0) }),
});
const ActionRecordSchema = z.strictObject({
  action: z.enum(["repair", "levy", "advance", "travel", "relief", "requisition", "purchase", "policy"]), policy: z.object({ area: z.enum(["military", "emergency", "communities"]), rule: z.string() }).optional(), target: id.optional(), to: id.optional(), good: z.string().optional(), units: z.number().int().positive().optional(), market: z.boolean().optional(), sell: z.boolean().optional(), muster: z.boolean().optional(), arm: z.enum(["foot", "archers", "horse"]).optional(), consult: z.boolean().optional(), mission: z.enum(["defend", "attack", "scout"]).optional(), raid: id.optional(),
  repairMode: z.enum(["rush", "labour"]).optional(), followed: id.optional(),
});
export const REJECT_STEPS = ["schema", "crossref", "context", "allowlist", "engine", "agent-error"] as const;
export const PlaytestRunRecordSchema = z.strictObject({
  schemaVersion: v1, runSetId: z.string(), tupleIndex: nat, seed: nat, persona: z.enum(PERSONAS), days: int.min(1),
  status: z.enum(["ok", "failed", "budget"]), logHash: z.string().length(64), events: nat, wallMs: nat, pauses: nat,
  /** Only decision points where the agent acted or was rejected; every other pause was a wait. */
  decisions: z.array(z.strictObject({ i: nat, tick: nat, obsHash: z.string().length(16), actions: z.array(ActionRecordSchema), cited: nat, rejected: z.strictObject({ step: z.enum(REJECT_STEPS), reason: z.string().max(300) }).optional() })),
  outcome: z.strictObject({
    objectiveMet: z.boolean(), ended: z.string().nullable(), fortsFallen: nat, levies: nat, reliefs: nat, repairs: nat, sends: nat, travels: nat, petitions: nat,
    topStance: z.record(z.string(), z.string()), invalid: nat, actingDecisions: nat, citingDecisions: nat,
  }),
  invariants: z.array(z.string()).max(50), failures: z.array(z.string()).max(50),
});
export const NOTIFICATION_KINDS = ["progress-1k", "deep-10k", "urgent", "final"] as const;
export const NotificationRecordSchema = z.strictObject({
  schemaVersion: v1, key: z.string().max(120), kind: z.enum(NOTIFICATION_KINDS), runSetId: z.string(), games: nat, subject: z.string().max(200), body: z.string().max(200_000),
  email: z.boolean(), status: z.enum(["pending", "sent", "failed", "dashboard-only"]), attempts: nat, nextAttemptAt: nat, lastError: z.string().max(500).optional(), sentAt: nat.optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type ActionAffordance = z.infer<typeof ActionAffordanceSchema>;
export type PlayerObservation = z.infer<typeof PlayerObservationSchema>;
export type PlayerAgentDecision = z.infer<typeof PlayerAgentDecisionSchema>;
export type PlaytestRunManifest = z.infer<typeof PlaytestRunManifestSchema>;
export type PlaytestRunRecord = z.infer<typeof PlaytestRunRecordSchema>;
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
export type ActionRecord = z.infer<typeof ActionRecordSchema>;
export type Persona = (typeof PERSONAS)[number];

export type Checked<T> = { ok: true; value: T } | { ok: false; step: (typeof REJECT_STEPS)[number]; reason: string };
const fail = <T>(step: (typeof REJECT_STEPS)[number], reason: string): Checked<T> => ({ ok: false, step, reason: reason.slice(0, 300) });
const dupes = (xs: readonly (string | number)[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
const zodReason = (e: z.ZodError) => e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

/** An observation from outside (a file, another process): strict schema, then every reference inside it must resolve. */
export function parseObservation(raw: unknown): Checked<PlayerObservation> {
  const r = PlayerObservationSchema.safeParse(raw);
  if (!r.success) return fail("schema", zodReason(r.error));
  const o = r.data, ev = new Set(o.evidence.map((e) => e.id)), adv = new Set(o.advice.map((a) => a.id));
  const d = [...dupes(o.evidence.map((e) => e.id)), ...dupes(o.affordances.map((a) => a.id)), ...dupes(o.advice.map((a) => a.id)), ...dupes(o.letters.map((l) => l.id)), ...dupes(o.places.map((p) => p.id))];
  if (d.length) return fail("crossref", `duplicate ids: ${[...new Set(d)].join(", ")}`);
  for (const i of o.issues) {
    for (const e of i.evidenceIds) if (!ev.has(e)) return fail("crossref", `issue ${i.key}: unknown evidence ${e}`);
    for (const a of i.adviceIds) if (!adv.has(a)) return fail("crossref", `issue ${i.key}: unknown advice ${a}`);
  }
  for (const p of o.places) for (const e of [p.walls?.evidenceId, p.raiders?.evidenceId]) if (e && !ev.has(e)) return fail("crossref", `place ${p.id}: unknown evidence ${e}`);
  for (const a of o.affordances) for (const x of a.adviceIds) if (!adv.has(x)) return fail("crossref", `affordance ${a.id}: unknown advice ${x}`);
  if (o.affordances.filter((a) => a.kind === "wait").length !== 1) return fail("crossref", "exactly one wait affordance");
  return { ok: true, value: o };
}

/** A decision from an agent, checked against the observation it answers (v4 validation chain, before the engine). */
export function checkDecision(raw: unknown, obs: PlayerObservation): Checked<PlayerAgentDecision> {
  const r = PlayerAgentDecisionSchema.safeParse(raw);
  if (!r.success) return fail("schema", zodReason(r.error));
  const d = r.data;
  const dc = dupes(d.choose), de = dupes(d.rationale.cites);
  if (dc.length) return fail("crossref", `affordance chosen twice: ${dc.join(", ")}`);
  if (de.length) return fail("crossref", `evidence cited twice: ${de.join(", ")}`);
  if (d.observationId !== obs.id) return fail("context", `answers ${d.observationId}, not ${obs.id}`);
  const aff = new Map(obs.affordances.map((a) => [a.id, a])), ev = new Set(obs.evidence.map((e) => e.id));
  for (const c of d.choose) if (!aff.has(c)) return fail("allowlist", `no affordance ${c} in ${obs.id}`);
  for (const c of d.rationale.cites) if (!ev.has(c)) return fail("allowlist", `no evidence ${c} in ${obs.id}`);
  const chosen = d.choose.map((c) => aff.get(c)!);
  if (chosen.some((a) => a.kind === "wait") && chosen.length > 1) return fail("allowlist", "wait cannot be combined with an action");
  const sends = chosen.filter((a) => a.kind === "advance").map((a) => (a as { target: string }).target);
  if (dupes(sends).length) return fail("allowlist", `two missions for the captain at ${dupes(sends)[0]}`);
  if (chosen.filter((a) => a.kind === "levy").length > 1) return fail("allowlist", "one levy at a time");
  const coins = obs.ruler.coinsMilli, spend = chosen.reduce((s, a) => s + (a.costMilli ?? 0), 0);
  if (coins !== null && spend > 0 && spend > coins) return fail("allowlist", `costs ${spend} together; the ruler believes she has ${coins}`);
  return { ok: true, value: d };
}

export function parseManifest(raw: unknown): Checked<PlaytestRunManifest> {
  const r = PlaytestRunManifestSchema.safeParse(raw);
  if (!r.success) return fail("schema", zodReason(r.error));
  if (dupes(r.data.personas).length) return fail("crossref", "persona listed twice");
  const [lo, hi] = PARTITION_SEEDS[r.data.partition], last = r.data.seeds.first + r.data.seeds.count - 1;
  if (r.data.seeds.first < lo || last > hi) return fail("context", `${r.data.partition} seeds are ${lo}..${hi}; got ${r.data.seeds.first}..${last}`);
  return { ok: true, value: r.data };
}
export function parseRunRecord(raw: unknown): Checked<PlaytestRunRecord> {
  const r = PlaytestRunRecordSchema.safeParse(raw);
  if (!r.success) return fail("schema", zodReason(r.error));
  const is = r.data.decisions.map((d) => d.i);
  if (is.some((x, k) => (k > 0 && x <= is[k - 1]) || x >= r.data.pauses)) return fail("crossref", "decision indices must increase and stay below the pause count");
  return { ok: true, value: r.data };
}
export function parseNotification(raw: unknown): Checked<NotificationRecord> {
  const r = NotificationRecordSchema.safeParse(raw);
  if (!r.success) return fail("schema", zodReason(r.error));
  if (!r.data.key.startsWith(`${r.data.runSetId}:${r.data.kind}:`)) return fail("crossref", "key must be <runSetId>:<kind>:<n>");
  return { ok: true, value: r.data };
}
