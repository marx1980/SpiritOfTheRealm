// Frozen v1 contracts (plan section B): StructuredOrder (B2), Recommendation/Reason (B3), BeliefProposition/Report (B5).
// Additions are allowed; removals and renames need a schema version bump and a DECISIONS entry.
import type { BeliefProposition } from "./beliefs.ts";
import type { SubjectRef } from "./events.ts";

export const ORDER_SCHEMA_VERSION = 1;

export const INTENTS = ["hold", "advance", "withdraw", "screen", "escort", "requisition", "investigate", "attack", "negotiate", "report", "repair", "levy", "travel", "relief"] as const;
export type IntentKind = (typeof INTENTS)[number];

export interface Constraint { kind: string; ref?: SubjectRef; textKey: string }
export interface Contingency { when: { kind: string; ref?: SubjectRef; threshold?: number }; then: { intent: IntentKind; objective?: SubjectRef } }
export interface ReportingPolicy { onReceipt: boolean; onCompletion: boolean; onFailure: boolean; everyDays?: number }

export interface StructuredOrder {
  schemaVersion: number;
  id: number;
  issuer: string;
  recipient: string;
  issuedAt: number;
  kind: "strategic" | "standing_policy" | "tactical";
  intent: IntentKind;
  objective: SubjectRef;
  constraints: Constraint[];
  contingencies: Contingency[];
  discretion: "strict" | "bounded" | "delegated";
  reportingPolicy: ReportingPolicy;
  supersedes?: number[];
  sourceTranscriptRef?: string;
  affirmedByPlayerAt?: number;
  parentOrderId?: number; // addition (Phase 4): set on subordinate orders
}

export const ORDER_LIFECYCLE = {
  main: ["OrderIssued", "OrderDispatched", "OrderReceived", "OrderInterpreted", "ObedienceDecided", "LocalPlanFormed",
    "SubordinateOrdersIssued", "ExecutionStarted", "OrderCompleted", "OrderSuperseded", "OrderAbandoned"],
  failures: ["OrderLost", "OrderIntercepted", "OrderUndeliverable", "InterceptedOrderReceived"],
} as const;

/** Allowed next steps for one order. Superseded may follow any step after receipt. */
export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  start: ["OrderIssued"],
  OrderIssued: ["OrderDispatched", "OrderReceived", "OrderUndeliverable"], // Phase 10: no open road to the recipient at all (a closed route), so nothing is sent
  OrderDispatched: ["OrderReceived", "OrderLost", "OrderIntercepted", "OrderUndeliverable"],
  OrderIntercepted: ["InterceptedOrderReceived"],
  OrderReceived: ["OrderInterpreted", "OrderSuperseded"],
  OrderInterpreted: ["ObedienceDecided", "OrderSuperseded"],
  ObedienceDecided: ["LocalPlanFormed", "OrderSuperseded"], // refuse ends here
  LocalPlanFormed: ["SubordinateOrdersIssued", "ExecutionStarted", "OrderSuperseded"],
  SubordinateOrdersIssued: ["SubordinateOrdersIssued", "ExecutionStarted", "OrderSuperseded"],
  ExecutionStarted: ["OrderCompleted", "OrderAbandoned", "OrderSuperseded"],
};

export const QUESTIONS = ["what_would_you_do", "why", "how_sure", "what_worries_you", "alternatives", "what_if"] as const;
export const REASON_KINDS = ["belief", "objective", "order", "trait", "relationship", "capability", "resource", "precedent"] as const;

export interface Reason { kind: (typeof REASON_KINDS)[number]; ref: { kind: string; id: string }; weight: number; textKey: string }
export interface Recommendation {
  id: number; author: string; question: (typeof QUESTIONS)[number]; plan: { kind: "plan"; id: string };
  reasons: Reason[]; uncertainties: { belief: { kind: string; id: string }; why: string }[]; alternatives: { kind: "plan"; id: string }[];
  contingencies: Contingency[]; basedOnBeliefs: { kind: string; id: string }[]; computedAt: number; validUntilEvent?: number;
}

export interface Report {
  id: number; author: string; recipient: string; subject: SubjectRef; claims: BeliefProposition[];
  composedAt: number; dispatchedAt?: number; route: string[]; carrier?: string; deliveredAt?: number; authorBias?: string[];
  purpose?: string; // addition (Phase 3): e.g. "request_reinforcement"
}

export const DECISION_TRACE_SCHEMA_VERSION = 1;
export interface ActionRef { kind: string; target?: string }
/** B4. Additions (Phase 3): kind, subject/predicate/believedValue on consulted beliefs, margin. */
export interface DecisionTrace {
  schemaVersion: number;
  agent: string;
  tick: number;
  trigger: number;
  layer: "strategic" | "operational" | "tactical" | "immediate";
  kind: "plan" | "advise" | "obedience" | "focus" | "regency";
  beliefsConsulted: { ref: { kind: "belief"; id: string }; ageTicks: number; reliability: "certain" | "probable" | "uncertain" | "doubtful";
    subject?: SubjectRef; predicate?: string; believedValue?: unknown }[];
  objectivesActive: { kind: "objective"; id: string }[];
  ordersInForce: number[];
  candidates: { action: ActionRef; score: number; contributions: Reason[] }[];
  selected: ActionRef;
  keptCurrentIntention: boolean;
  margin?: number;
  compressed?: boolean; // Tier B: only the selected option and its top reasons (ARCHITECTURE §20.14)
  outcome?: { eventId: number; failureOrigin?: "belief" | "choice" | "communication" | "execution" };
}

// ---- validators: return a list of problems (empty = valid) ------------------------------------------------
type V = string[];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const int = (v: V, o: Record<string, unknown>, k: string, opt = false) => { if (opt && o[k] === undefined) return; if (!Number.isSafeInteger(o[k])) v.push(`${k} must be an integer`); };
const str = (v: V, o: Record<string, unknown>, k: string, opt = false) => { if (opt && o[k] === undefined) return; if (typeof o[k] !== "string" || !(o[k] as string).length) v.push(`${k} must be a non-empty string`); };
const oneOf = (v: V, o: Record<string, unknown>, k: string, xs: readonly string[]) => { if (!xs.includes(o[k] as string)) v.push(`${k} must be one of ${xs.join("|")}`); };
const arr = (v: V, o: Record<string, unknown>, k: string, each?: (x: unknown, i: number) => void, opt = false) => {
  if (opt && o[k] === undefined) return;
  if (!Array.isArray(o[k])) { v.push(`${k} must be an array`); return; }
  (o[k] as unknown[]).forEach((x, i) => each?.(x, i));
};
const ref = (v: V, x: unknown, where: string) => { if (!isObj(x) || typeof x.kind !== "string" || typeof x.id !== "string") v.push(`${where} must be { kind, id }`); };

export function validateOrder(x: unknown): V {
  const v: V = [];
  if (!isObj(x)) return ["order must be an object"];
  int(v, x, "schemaVersion"); int(v, x, "id"); str(v, x, "issuer"); str(v, x, "recipient"); int(v, x, "issuedAt");
  oneOf(v, x, "kind", ["strategic", "standing_policy", "tactical"]); oneOf(v, x, "intent", INTENTS);
  ref(v, x.objective, "objective");
  arr(v, x, "constraints", (c, i) => { if (!isObj(c) || typeof c.kind !== "string" || typeof c.textKey !== "string") v.push(`constraints[${i}]`); });
  arr(v, x, "contingencies", (c, i) => { if (!isObj(c) || !isObj(c.when) || !isObj(c.then) || !INTENTS.includes((c.then as { intent: never }).intent)) v.push(`contingencies[${i}]`); });
  oneOf(v, x, "discretion", ["strict", "bounded", "delegated"]);
  const rp = x.reportingPolicy;
  if (!isObj(rp) || typeof rp.onReceipt !== "boolean" || typeof rp.onCompletion !== "boolean" || typeof rp.onFailure !== "boolean") v.push("reportingPolicy must have onReceipt/onCompletion/onFailure");
  else int(v, rp, "everyDays", true);
  arr(v, x, "supersedes", (s, i) => { if (!Number.isSafeInteger(s)) v.push(`supersedes[${i}]`); }, true);
  str(v, x, "sourceTranscriptRef", true); int(v, x, "affirmedByPlayerAt", true); int(v, x, "parentOrderId", true);
  return v;
}

export function validateProposition(x: unknown): V {
  const v: V = [];
  if (!isObj(x)) return ["proposition must be an object"];
  int(v, x, "id"); ref(v, x.subject, "subject"); str(v, x, "predicate");
  if (!("believedValue" in x)) v.push("believedValue missing");
  arr(v, x, "evidenceRefs", (e, i) => {
    if (!isObj(e) || !["observation", "report", "intercepted", "scenario", "order"].includes(e.kind as string) || !Number.isSafeInteger(e.eventId) || typeof e.source !== "string" || (e.local !== undefined && typeof e.local !== "boolean")) v.push(`evidenceRefs[${i}]`);
  });
  int(v, x, "observedOrLearnedAt"); oneOf(v, x, "reliabilityBand", ["certain", "probable", "uncertain", "doubtful"]);
  return v;
}

export function validateReport(x: unknown): V {
  const v: V = [];
  if (!isObj(x)) return ["report must be an object"];
  int(v, x, "id"); str(v, x, "author"); str(v, x, "recipient"); ref(v, x.subject, "subject");
  arr(v, x, "claims", (c, i) => { for (const p of validateProposition(c)) v.push(`claims[${i}].${p}`); });
  int(v, x, "composedAt"); int(v, x, "dispatchedAt", true); arr(v, x, "route"); str(v, x, "carrier", true); int(v, x, "deliveredAt", true);
  arr(v, x, "authorBias", undefined, true);
  return v;
}

export function validateDecisionTrace(x: unknown): V {
  const v: V = [];
  if (!isObj(x)) return ["trace must be an object"];
  int(v, x, "schemaVersion"); str(v, x, "agent"); int(v, x, "tick"); int(v, x, "trigger");
  oneOf(v, x, "layer", ["strategic", "operational", "tactical", "immediate"]); oneOf(v, x, "kind", ["plan", "advise", "obedience", "focus", "regency"]);
  arr(v, x, "beliefsConsulted", (b, i) => {
    if (!isObj(b) || !Number.isSafeInteger(b.ageTicks) || !["certain", "probable", "uncertain", "doubtful"].includes(b.reliability as string)) v.push(`beliefsConsulted[${i}]`);
    else ref(v, b.ref, `beliefsConsulted[${i}].ref`);
  });
  arr(v, x, "objectivesActive", (o, i) => ref(v, o, `objectivesActive[${i}]`));
  arr(v, x, "ordersInForce", (o, i) => { if (!Number.isSafeInteger(o)) v.push(`ordersInForce[${i}]`); });
  arr(v, x, "candidates", (c, i) => {
    if (!isObj(c) || !isObj(c.action) || typeof (c.action as { kind: unknown }).kind !== "string" || !Number.isSafeInteger(c.score) || !Array.isArray(c.contributions)) { v.push(`candidates[${i}]`); return; }
    (c.contributions as unknown[]).forEach((r, j) => { if (!isObj(r) || !REASON_KINDS.includes(r.kind as never) || !Number.isSafeInteger(r.weight)) v.push(`candidates[${i}].contributions[${j}]`); });
  });
  if (!isObj(x.selected) || typeof x.selected.kind !== "string") v.push("selected must be an action");
  if (typeof x.keptCurrentIntention !== "boolean") v.push("keptCurrentIntention must be boolean");
  if (Array.isArray(x.candidates) && isObj(x.selected) && !(x.candidates as { action: unknown }[]).some((c) => JSON.stringify(c.action) === JSON.stringify(x.selected)))
    v.push("selected is not among the candidates");
  return v;
}

export function validateRecommendation(x: unknown): V {
  const v: V = [];
  if (!isObj(x)) return ["recommendation must be an object"];
  int(v, x, "id"); str(v, x, "author"); oneOf(v, x, "question", QUESTIONS);
  if (!isObj(x.plan) || x.plan.kind !== "plan" || typeof x.plan.id !== "string") v.push("plan must be { kind: 'plan', id }");
  arr(v, x, "reasons", (r, i) => {
    if (!isObj(r) || !REASON_KINDS.includes(r.kind as never) || !Number.isSafeInteger(r.weight) || typeof r.textKey !== "string") v.push(`reasons[${i}]`);
    else ref(v, r.ref, `reasons[${i}].ref`);
  });
  arr(v, x, "uncertainties"); arr(v, x, "alternatives"); arr(v, x, "contingencies");
  arr(v, x, "basedOnBeliefs", (b, i) => ref(v, b, `basedOnBeliefs[${i}]`));
  int(v, x, "computedAt"); int(v, x, "validUntilEvent", true);
  return v;
}
