// Phase 8 battle slice (D-060, BATTLEFIELD §2A-§24). A battle is a pure, deterministic sub-simulation: the same setup and
// the same battle orders give the same battle. It steps every `params.step` game seconds (one tactical replan per
// commander per step). Reality (formations as they are) and beliefs (sightings held by headquarters and by each
// commander) are kept apart; orders travel physically; receipt, interpretation and obedience are separate, traced steps;
// chance is drawn only for fighting in contact, for runners in danger, for missed signals and for harm to the ruler.
// Integer metres and seconds throughout; only +, -, *, / and Math.sqrt, which every JavaScript engine computes alike.
import { Rng } from "../rng.ts";
import { decideObedience } from "../agents/obedience.ts";
import type { Reason } from "../schemas.ts";

export const BATTLE_SCHEMA_VERSION = 1;
export const BEHAVIOURS = ["good_order", "yielding", "disorganised", "rallying", "withdrawing", "retreat", "rout"] as const;
export type Behaviour = (typeof BEHAVIOURS)[number] | "gone";
export type Side = "crown" | "raiders";
export type Kind = "foot" | "archers" | "horse" | "guard" | "warband" | "bowmen" | "riders";
export type TaskKind = "hold" | "advance" | "attack" | "withdraw" | "give_ground" | "protect";

/** An instruction a formation carries out until another is received and accepted (§8). `when` is checked against the
 *  commander's beliefs, not reality. `limit` names a line not to be crossed (e.g. "do not pursue beyond the stream"). */
export interface Task {
  kind: TaskKind; place?: string; target?: string; limit?: string;
  when?: { kind: "enemy_engaged" | "enemy_horse_seen"; then: Omit<Task, "when"> };
}
/** A battle order (new contract, schema 1). `to` is a commander, or the ruler herself (her own id) to move her command post. */
export interface BattleOrder { schemaVersion: 1; id: number; t: number; from: string; to: string; task: Task; via: "runner" | "signal" | "voice"; signal?: string }

export interface TraitP { riskPermille: number; obedienceWhenDisagreeingPermille: number; lossResponsePermille: number; commitmentPermille: number; badNewsReportingPermille?: number }
export interface Rect { id: string; x0: number; y0: number; x1: number; y1: number }
export interface FieldSpec {
  width: number; height: number;
  places: { id: string; name: string; x: number; y: number }[];
  woods: Rect[]; ridges: Rect[];
  lines: { id: string; name: string; y: number }[];
  /** y of each side's own edge: a formation that reaches it in flight has left the field. */
  edge: Record<Side, number>;
}
export interface KindP { speed: number; meleeRange: number; missileRange: number; meleeRate: number; missileRate: number; discipline: number; mounted: boolean }
export interface BattleParams {
  step: number; frameEvery: number; staleAfter: number; capSeconds: number;
  sight: { clear: number; rain: number; wood: number; ridgeBonusPermille: number; dustRange: number; dustPermille: number };
  runner: { speed: number; dangerRange: number; dangerPermille: number; findRadius: number; searchSeconds: number };
  signal: { range: number; missPermille: { base: number; rain: number; dust: number } };
  voiceRange: number; reportEvery: number; reportLossPermille: number;
  /** Ground a formation takes up: the least distance kept from a friendly formation, and from an enemy it is fighting. */
  spacing: { friends: number; enemies: number };
  cohesion: { start: number; rout: number; retreat: number; disorganised: number; rallied: number; perLossPercent: number; losing: number; winning: number; underFire: number; outnumbered: number;
    neighbourRout: number; neighbourRetreat: number; unannouncedWithdrawal: number; commanderBase: number; rulerNear: number; recover: number; tired: number };
  rates: { routTarget: number; retreatTarget: number; disorganisedTarget: number; ridgeDefence: number; woodCover: number; mountedVsDisordered: number; noise: [number, number] };
  kinds: Record<Kind, KindP>;
  clarity: { base: number; named: number; limit: number; condition: number; signal: number; literalBelow: number };
  raiders: { withdrawLossPermille: number; replanEvery: number };
  ruler: { dangerNear: number; formsUpAt: number; meleePermille: number; missilePermille: number; deathPermille: number; repeatEvery: number; wallsRange: number };
  goneBelowPermille: number;
}
export interface FormationSetup { id: string; side: Side; kind: Kind; label: string; men: number; commander: string; x: number; y: number }
export interface CommanderSetup { id: string; name: string; side: Side; formations: string[]; traits: TraitP[]; skill: number; loyalty: Record<string, number>; superior?: string }
export interface ObedienceParams { adaptMarginMilli: number; refuseMarginMilli: number; changedCircumstancesPermille: number; dutyMilli: number; legitimacyRulerPermille: number }
export interface BattleSetup {
  schemaVersion: 1; battleId: number; seed: number; site: string; place: string;
  /** Seconds until the battle must stop (nightfall, or the cap). */
  endT: number; weather: "clear" | "rain";
  field: FieldSpec; params: BattleParams; obedience: ObedienceParams;
  formations: FormationSetup[]; commanders: CommanderSetup[];
  ruler: { id: string; present: boolean; guard?: string };
  /** Who keeps headquarters' picture: the ruler if present, else the senior commander. */
  hq: string;
  /** Orders given before the fight (by the ruler, or by the senior commander when she is absent), delivered by voice at t = 0. */
  plan: BattleOrder[];
  signals: { id: string; task: Task }[];
}

// ---- record ---------------------------------------------------------------------------------------------------------
export interface FrameFormation { id: string; side: Side; kind: Kind; label: string; commander: string; men: number; x: number; y: number; behaviour: Behaviour; task: Task }
export interface Frame { t: number; formations: FrameFormation[]; ruler?: { x: number; y: number } }
export interface Mark { id: string; side: Side; kind: Kind; label: string; x: number; y: number; behaviour: Behaviour; menBand: "few" | "some" | "many"; category: "observed" | "reported" | "inferred"; source: string; age: number; stale: boolean }
export interface NetworkRow { commander: string; task: Task | null; status: "none" | "dispatched" | "presumed delivered" | "confirmed" | "lost"; lastContact: number }
export interface HqFrame { t: number; x: number; y: number; marks: Mark[]; network: NetworkRow[] }
export interface Note {
  t: number; kind: "order_sent" | "order_received" | "order_decided" | "runner_lost" | "runner_searching" | "signal_missed" | "report_sent" | "report_received" | "danger" | "contact" | "behaviour" | "contingency" | "end";
  orderId?: number; commander?: string; formation?: string; via?: string; towards?: { x: number; y: number }; why?: string; decision?: string; from?: string; to?: string; text?: string;
}
export interface BattleTrace {
  schemaVersion: 1; commander: string; orderId: number; t: number; issuer: string; via: string;
  clarity: number; comprehension: number; literal: boolean; understood: Task; current: Task;
  candidates: { kind: "obey" | "adapt" | "keep"; task: Task; score: number; contributions: Reason[] }[];
  decision: "obey" | "adapt" | "keep"; by: number; margins: { adaptMargin: number; refuseMargin: number };
  beliefs: { believedOdds: number; lossesPermille: number; cohesion: number; changed: boolean };
  draws: number;
}
export interface Debrief { author: string; result: "won" | "lost" | "drawn"; ownLosses: number; enemyLosses: number; conduct: { orderId: number; decision: string; reason: string }[] }
export interface BattleResult {
  winner: Side | "none"; reason: string; endT: number;
  lost: Record<Side, number>; lostBy: Record<string, number>; lostByFormation: Record<string, number>;
  ruler: "absent" | "safe" | "killed" | "captured";
  /** How each commander answered each order (for prestige and the record of obedience). */
  conduct: { commander: string; orderId: number; issuer: string; decision: "obey" | "adapt" | "keep" }[];
}
export interface BattleRecord { schemaVersion: 1; frames: Frame[]; hq: HqFrame[]; notes: Note[]; traces: BattleTrace[]; result: BattleResult; debrief: Debrief[] }

// ---- obedience (pure, no dice) --------------------------------------------------------------------------------------
export interface ObedienceInput {
  order: BattleOrder; current: Task; traits: TraitP[]; skill: number; loyalty: number; issuerIsRuler: boolean;
  believedOdds: number; lossesPermille: number; cohesion: number; changed: boolean; params: ObedienceParams;
  clarityPenalty?: number; clarityParams?: BattleParams["clarity"];
}
const avg = (ts: TraitP[], k: keyof TraitP, d = 500) => (ts.length ? Math.floor(ts.reduce((n, t) => n + ((t[k] as number | undefined) ?? d), 0) / ts.length) : d);
const DEFAULT_CLARITY: BattleParams["clarity"] = { base: 600, named: 100, limit: 100, condition: 100, signal: 100, literalBelow: 450 };

/** Clarity from what the order states; comprehension = clarity x the commander's military skill. Below the threshold
 *  the order is read literally: its limit and its condition are lost (§5 execution interpretation). */
export function interpretBattleOrder(o: BattleOrder, skill: number, cp: BattleParams["clarity"] = DEFAULT_CLARITY, penalty = 0) {
  const clarity = Math.max(0, Math.min(1000, cp.base + (o.task.place || o.task.target ? cp.named : 0) + (o.task.limit ? cp.limit : 0) + (o.task.when ? cp.condition : 0) + (o.via === "signal" ? cp.signal : 0) - penalty));
  const comprehension = Math.floor((clarity * (500 + Math.floor(skill / 2))) / 1000);
  const literal = comprehension < cp.literalBelow;
  const understood: Task = literal ? { kind: o.task.kind, ...(o.task.place ? { place: o.task.place } : {}), ...(o.task.target ? { target: o.task.target } : {}) } : { ...o.task };
  return { clarity, comprehension, literal, understood };
}

/** A way of carrying out part of an order's purpose (adapting). */
function adaptOf(t: Task): Task {
  switch (t.kind) {
    case "attack": return { kind: "hold" };
    case "withdraw": return { kind: "give_ground" };
    case "advance": case "hold": case "protect": return { kind: "hold" };
    case "give_ground": return { kind: "hold" };
  }
}

/** What a task is worth to this commander, from what he believes and who he is, as reasons. */
function taskValue(t: Task, x: ObedienceInput): Reason[] {
  const risk = avg(x.traits, "riskPermille"), lossR = avg(x.traits, "lossResponsePermille"), stub = avg(x.traits, "obedienceWhenDisagreeingPermille");
  const r = (kind: Reason["kind"], id: string, weight: number, textKey: string): Reason => ({ kind, ref: { kind: kind === "trait" ? "trait" : "belief", id }, weight: Math.trunc(weight), textKey });
  const odds = x.believedOdds - 500;
  const shaken = Math.max(0, 500 - x.cohesion);
  switch (t.kind) {
    case "attack": return [r("belief", "odds", (odds * 12 * risk) / 500, "reason.odds"), ...(shaken ? [r("belief", "cohesion", -shaken * 6, "reason.cohesion")] : [])];
    case "advance": return [r("belief", "odds", (odds * 6 * risk) / 500 + 500, "reason.odds")];
    case "withdraw": return [
      r("belief", "odds", (-odds * 12 * (1000 - risk)) / 500, "reason.odds"),
      r("belief", "losses", (x.lossesPermille * 10 * lossR) / 500, "reason.losses"),
      ...(shaken ? [r("belief", "cohesion", shaken * 6, "reason.cohesion")] : []),
      ...(stub <= 300 ? [r("trait", "pride", -2000, "reason.pride")] : []),
    ];
    case "give_ground": return [r("belief", "odds", 500 + odds * 4 - 500, "reason.odds"), r("belief", "losses", -x.lossesPermille * 4, "reason.losses"), ...(shaken ? [r("belief", "cohesion", shaken * 3, "reason.cohesion")] : [])];
    case "hold": case "protect": return [r("belief", "odds", 1000 + odds * 4, "reason.odds"), r("belief", "losses", -x.lossesPermille * 4, "reason.losses")];
  }
}
const same = (a: Task, b: Task) => a.kind === b.kind && a.place === b.place && a.target === b.target;

/** Obey, adapt or keep his current task: scored from his beliefs and traits, decided with the campaign's margins
 *  (`decideObedience`). Traceable and never rolled. */
export function decideBattleObedience(x: ObedienceInput) {
  const it = interpretBattleOrder(x.order, x.skill, x.clarityParams ?? DEFAULT_CLARITY, x.clarityPenalty ?? 0);
  const p = x.params, temperament = avg(x.traits, "obedienceWhenDisagreeingPermille"), commit = avg(x.traits, "commitmentPermille");
  const duty: Reason = { kind: "order", ref: { kind: "order", id: String(x.order.id) }, weight: Math.floor((p.dutyMilli * x.loyalty) / 1000), textKey: "reason.duty" };
  const keepR: Reason = { kind: "trait", ref: { kind: "trait", id: "commitment" }, weight: commit * 3, textKey: "reason.commitment" };
  const mk = (kind: "obey" | "adapt" | "keep", task: Task, extra: Reason[]) => { const contributions = [...taskValue(task, x), ...extra]; return { kind, task, score: contributions.reduce((n, c) => n + c.weight, 0), contributions }; };
  const obey = mk("obey", it.understood, [duty]);
  const adapt = mk("adapt", adaptOf(it.understood), [{ ...duty, weight: Math.floor(duty.weight / 2), textKey: "reason.duty_in_part" }]);
  const keep = mk("keep", x.current, [keepR]);
  const candidates = same(x.current, it.understood) ? [obey, adapt] : [obey, adapt, keep];
  const legit = x.issuerIsRuler ? p.legitimacyRulerPermille : 500, bond = 200 + x.loyalty;
  const f = (v: number) => Math.floor((((v * temperament) / 500) * bond * legit) / 1_000_000);
  const margins = { adaptMargin: Math.floor((f(p.adaptMarginMilli) * 1000 * (x.changed ? p.changedCircumstancesPermille : 1000)) / 1_000_000), refuseMargin: f(p.refuseMarginMilli) };
  const d = decideObedience({ obey: obey.score, bestServing: adapt.score, bestOther: candidates.includes(keep) ? keep.score : -1e12, ...margins });
  const decision = d.decision === "refuse" ? "keep" as const : d.decision;
  return { ...it, candidates, decision, by: d.by, margins, chosen: decision === "obey" ? obey.task : decision === "adapt" ? adapt.task : keep.task };
}

// ---- the battle -----------------------------------------------------------------------------------------------------
interface Sighting { id: string; x: number; y: number; behaviour: Behaviour; men: number; t: number; source: string; how: "observed" | "reported" }
interface F extends FormationSetup { start: number; cohesion: number; fatigue: number; behaviour: Behaviour; task: Task; acc: number; lostSteps: number[]; doneSteps: number[]; engaged: boolean; underFire: boolean; risingFrom: number; slot: number }
interface C extends CommanderSetup { x: number; y: number; task: Task; sight: Map<string, Sighting>; lastReport: number; menAtReport: number; contact: boolean; orderIds: number[]; reportedDecisions: number[] }
interface Runner { id: number; kind: "order" | "report"; orderId?: number; from: string; to: string; x: number; y: number; tx: number; ty: number; searching: number; done: boolean; payload?: Sighting[]; decisions?: { orderId: number; decision: string; task: Task }[] }

const dist = (ax: number, ay: number, bx: number, by: number) => Math.floor(Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)));
const inside = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
/** Does the segment a-b pass through the rectangle (beyond its end points' own cover)? Liang-Barsky clip. */
function crosses(r: Rect, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 0.02;
}
const band = (men: number): Mark["menBand"] => (men < 60 ? "few" : men < 140 ? "some" : "many");

export function runBattle(setup: BattleSetup, orders: BattleOrder[], opts: { until?: number } = {}): BattleRecord {
  const P = setup.params, field = setup.field, step = P.step;
  const until = Math.min(setup.endT, opts.until ?? setup.endT);
  let draws = 0;
  const roll = (key: string, lo = 0, hi = 999) => { draws++; return Rng.fromSeed(setup.seed, `battle:${key}`).int(lo, hi); };
  const place = (id?: string) => field.places.find((p) => p.id === id);
  const line = (id?: string) => field.lines.find((l) => l.id === id);

  const fs = new Map<string, F>(), order: string[] = [];
  for (const s of setup.formations) {
    const k = P.kinds[s.kind];
    fs.set(s.id, { ...s, start: s.men, cohesion: Math.min(P.cohesion.start, 400 + k.discipline / 2), fatigue: 0, behaviour: "good_order", task: { kind: "hold" }, acc: 0, lostSteps: [], doneSteps: [], engaged: false, underFire: false, risingFrom: 0, slot: 0 });
    order.push(s.id);
  }
  const cs = new Map<string, C>();
  for (const c of setup.commanders) {
    const main = fs.get(c.formations[0]);
    cs.set(c.id, { ...c, x: main?.x ?? 0, y: main?.y ?? 0, task: { kind: "hold" }, sight: new Map(), lastReport: 0, menAtReport: c.formations.reduce((n, f) => n + (fs.get(f)?.men ?? 0), 0), contact: false, orderIds: [], reportedDecisions: [] });
  }
  const crown = () => order.map((id) => fs.get(id)!).filter((f) => f.side === "crown");
  const live = (f: F) => f.behaviour !== "gone";
  const guard = setup.ruler.present && setup.ruler.guard ? fs.get(setup.ruler.guard) : undefined;
  const hqPos = () => {
    if (guard && live(guard)) return { x: guard.x, y: guard.y };
    const c = cs.get(setup.hq);
    return c ? { x: c.x, y: c.y } : { x: field.width / 2, y: field.edge.crown };
  };
  // headquarters' picture: sightings (observed or reported) plus inferences from orders believed delivered
  const hqSight = new Map<string, Sighting>();
  const hqOrders = new Map<string, { orderId: number; task: Task; sentT: number; eta: number; status: NetworkRow["status"]; lastContact: number }>();
  for (const f of crown()) hqSight.set(f.id, { id: f.id, x: f.x, y: f.y, behaviour: f.behaviour, men: f.men, t: 0, source: setup.hq, how: "observed" });

  const notes: Note[] = [], traces: BattleTrace[] = [], frames: Frame[] = [], hqFrames: HqFrame[] = [];
  const runners: Runner[] = [];
  let runnerId = 0, dangerFirst = -1, rulerFate: BattleResult["ruler"] = setup.ruler.present ? "safe" : "absent";
  const lastDanger: Record<string, number> = {};
  let rulerOrderedAt = -1e9, warnedAt: number | undefined;
  let raidersWithdrawing = false, lastRaiderPlan = -1e9, withdrawSignalAt = -1e9;
  const lostByFormation: Record<string, number> = {};
  const conduct: BattleResult["conduct"] = [];

  // ---- perception ----
  const sightRange = (ox: number, oy: number, tx: number, ty: number) => {
    let r = setup.weather === "rain" ? P.sight.rain : P.sight.clear;
    if (field.ridges.some((g) => inside(g, ox, oy))) r = Math.floor((r * (1000 + P.sight.ridgeBonusPermille)) / 1000);
    if (field.woods.some((w) => inside(w, ox, oy) || inside(w, tx, ty))) r = Math.min(r, P.sight.wood);
    // dust of melee near the target
    if (order.some((id) => { const f = fs.get(id)!; return f.engaged && live(f) && dist(f.x, f.y, tx, ty) < P.sight.dustRange; })) r = Math.floor((r * P.sight.dustPermille) / 1000);
    return r;
  };
  const sees = (ox: number, oy: number, tx: number, ty: number) => {
    if (dist(ox, oy, tx, ty) > sightRange(ox, oy, tx, ty)) return false;
    return !field.woods.some((w) => !inside(w, ox, oy) && !inside(w, tx, ty) && crosses(w, ox, oy, tx, ty));
  };
  const observeAll = (t: number) => {
    for (const c of cs.values()) for (const id of order) {
      const f = fs.get(id)!;
      if (!live(f) && !c.sight.has(id)) continue;
      if (live(f) && sees(c.x, c.y, f.x, f.y)) c.sight.set(id, { id, x: f.x, y: f.y, behaviour: f.behaviour, men: f.men, t, source: c.id, how: "observed" });
    }
    const h = hqPos();
    for (const id of order) {
      const f = fs.get(id)!;
      if (live(f) && sees(h.x, h.y, f.x, f.y)) hqSight.set(id, { id, x: f.x, y: f.y, behaviour: f.behaviour, men: f.men, t, source: setup.hq, how: "observed" });
      else if (!live(f) && f.side === "crown" && hqSight.has(id) && guard && f.id === guard.id) hqSight.set(id, { ...hqSight.get(id)!, behaviour: "gone", t });
    }
  };

  // ---- the commander's view of the odds where he stands ----
  const odds = (c: C) => {
    let own = 0, enemy = 0;
    for (const id of c.formations) { const f = fs.get(id)!; if (live(f)) own += f.men; }
    for (const s of c.sight.values()) { const f = fs.get(s.id)!; if (f.side !== c.side && s.behaviour !== "gone" && s.behaviour !== "rout" && dist(s.x, s.y, c.x, c.y) < 900) enemy += s.men; }
    return own + enemy === 0 ? 500 : Math.floor((1000 * own) / (own + enemy));
  };
  const lossesP = (c: C) => { let start = 0, now = 0; for (const id of c.formations) { const f = fs.get(id)!; start += f.start; now += live(f) ? f.men : 0; } return start ? Math.floor((1000 * (start - now)) / start) : 0; };
  const cohesionOf = (c: C) => { const l = c.formations.map((id) => fs.get(id)!).filter(live); return l.length ? Math.floor(l.reduce((n, f) => n + f.cohesion, 0) / l.length) : 0; };

  // ---- receiving an order: interpretation, obedience, local plan ----
  const receive = (c: C, o: BattleOrder, t: number, via: string) => {
    notes.push({ t, kind: "order_received", orderId: o.id, commander: c.id, via });
    const before = draws;
    const d = decideBattleObedience({
      order: o, current: c.task, traits: c.traits, skill: c.skill, loyalty: c.loyalty[o.from] ?? 400, issuerIsRuler: o.from === setup.ruler.id,
      believedOdds: odds(c), lossesPermille: lossesP(c), cohesion: cohesionOf(c), changed: t - o.t > 300, params: setup.obedience, clarityParams: P.clarity,
    });
    traces.push({ schemaVersion: 1, commander: c.id, orderId: o.id, t, issuer: o.from, via, clarity: d.clarity, comprehension: d.comprehension, literal: d.literal, understood: d.understood, current: c.task,
      candidates: d.candidates, decision: d.decision, by: d.by, margins: d.margins, beliefs: { believedOdds: odds(c), lossesPermille: lossesP(c), cohesion: cohesionOf(c), changed: t - o.t > 300 }, draws: draws - before });
    notes.push({ t, kind: "order_decided", orderId: o.id, commander: c.id, decision: d.decision });
    conduct.push({ commander: c.id, orderId: o.id, issuer: o.from, decision: d.decision });
    c.orderIds.push(o.id);
    if (d.decision !== "keep") assign(c, d.chosen, t);
    // he lets headquarters know what he is doing (a report goes back with the decision)
    if (o.from === setup.ruler.id || o.from === setup.hq) sendReport(c, t, [{ orderId: o.id, decision: d.decision, task: d.decision === "keep" ? c.task : d.chosen }]);
  };
  // the commander's own formations take the task: by voice if near him, by his own runner (a short delay) if not
  const pendingAssign: { at: number; formation: string; task: Task }[] = [];
  const assign = (c: C, task: Task, t: number) => {
    c.task = task;
    for (const id of c.formations) {
      const f = fs.get(id)!;
      if (!live(f)) continue;
      const d = dist(c.x, c.y, f.x, f.y);
      if (d <= P.voiceRange) f.task = { ...task };
      else pendingAssign.push({ at: t + Math.floor(d / P.runner.speed), formation: id, task: { ...task } });
    }
  };

  // ---- runners ----
  const dispatchOrder = (o: BattleOrder, t: number) => {
    if (o.to === setup.ruler.id) { if (guard) { guard.task = { ...o.task }; rulerOrderedAt = t; } return; } // the queen moves her own command post
    const c = cs.get(o.to);
    if (!c) return;
    if (o.from === o.to) { assign(c, { ...o.task }, t); return; } // his own plan for his own men
    const h = hqPos();
    if (o.via === "voice" || (o.from !== setup.ruler.id && o.from !== setup.hq && dist(cs.get(o.from)?.x ?? h.x, cs.get(o.from)?.y ?? h.y, c.x, c.y) <= P.voiceRange)) { receive(c, o, t, "voice"); return; }
    if (o.via === "signal") {
      notes.push({ t, kind: "order_sent", orderId: o.id, commander: c.id, via: "signal" });
      if (o.task.kind === "withdraw") withdrawSignalAt = t;
      for (const x of [c]) {
        if (!sees(h.x, h.y, x.x, x.y) || dist(h.x, h.y, x.x, x.y) > P.signal.range) { notes.push({ t, kind: "signal_missed", orderId: o.id, commander: x.id, why: "out of sight" }); continue; }
        const dusty = order.some((id) => { const f = fs.get(id)!; return f.engaged && dist(f.x, f.y, x.x, x.y) < P.sight.dustRange; });
        const miss = P.signal.missPermille.base + (setup.weather === "rain" ? P.signal.missPermille.rain : 0) + (dusty ? P.signal.missPermille.dust : 0);
        if (roll(`signal:${o.id}:${x.id}`) < miss) { notes.push({ t, kind: "signal_missed", orderId: o.id, commander: x.id, why: dusty ? "dust" : setup.weather === "rain" ? "rain" : "not seen" }); continue; }
        receive(x, o, t + step, "signal");
      }
      hqOrders.set(c.id, { orderId: o.id, task: o.task, sentT: t, eta: t + step, status: "presumed delivered", lastContact: hqOrders.get(c.id)?.lastContact ?? 0 });
      return;
    }
    // the runner sets off for where headquarters believes the commander is: his main formation's last mark
    const mark = hqSight.get(c.formations.find((id) => hqSight.has(id)) ?? "") ?? { x: c.x, y: c.y };
    const r: Runner = { id: ++runnerId, kind: "order", orderId: o.id, from: o.from, to: c.id, x: h.x, y: h.y, tx: mark.x, ty: mark.y, searching: 0, done: false };
    runners.push(r);
    pendingOrders.set(r.id, o);
    notes.push({ t, kind: "order_sent", orderId: o.id, commander: c.id, via: "runner", towards: { x: mark.x, y: mark.y } });
    hqOrders.set(c.id, { orderId: o.id, task: o.task, sentT: t, eta: t + Math.floor(dist(h.x, h.y, mark.x, mark.y) / P.runner.speed) + 60, status: "dispatched", lastContact: hqOrders.get(c.id)?.lastContact ?? 0 });
  };
  const pendingOrders = new Map<number, BattleOrder>();
  const sendReport = (c: C, t: number, decisions?: Runner["decisions"]) => {
    if (setup.hq === c.id) return;
    const h = hqPos();
    // what he tells headquarters: his own formations and the enemy he has seen; a commander who dislikes bad news makes his men look steadier
    const bad = avg(c.traits, "badNewsReportingPermille") < 450;
    const soften = (b: Behaviour): Behaviour => (!bad ? b : b === "rout" || b === "retreat" ? "yielding" : b === "disorganised" || b === "rallying" ? "good_order" : b);
    const payload = [...c.sight.values()].filter((s) => t - s.t <= P.staleAfter).map((s) => ({ ...s, behaviour: fs.get(s.id)!.side === c.side ? soften(s.behaviour) : s.behaviour, source: c.id, how: "reported" as const }));
    runners.push({ id: ++runnerId, kind: "report", from: c.id, to: setup.hq, x: c.x, y: c.y, tx: h.x, ty: h.y, searching: 0, done: false, payload, ...(decisions ? { decisions } : {}) });
    notes.push({ t, kind: "report_sent", from: c.id });
    c.lastReport = t;
    c.menAtReport = c.formations.reduce((n, id) => n + (live(fs.get(id)!) ? fs.get(id)!.men : 0), 0);
  };
  const moveRunners = (t: number) => {
    for (const r of runners) {
      if (r.done) continue;
      // in danger near the enemy: drawn only while it is so
      const threat = order.map((id) => fs.get(id)!).find((f) => live(f) && f.side === "raiders" && f.behaviour !== "rout" && dist(f.x, f.y, r.x, r.y) < P.runner.dangerRange);
      if (threat && roll(`runner:${r.id}:${t}`) < P.runner.dangerPermille) {
        r.done = true;
        notes.push({ t, kind: "runner_lost", orderId: r.orderId, commander: r.kind === "order" ? r.to : r.from, why: "taken by the enemy" });
        if (r.kind === "order") { const e = hqOrders.get(r.to); if (e && e.orderId === r.orderId) e.status = "dispatched"; }
        continue;
      }
      const d = dist(r.x, r.y, r.tx, r.ty), go = P.runner.speed * step;
      if (d > go) { r.x += Math.trunc(((r.tx - r.x) * go) / d); r.y += Math.trunc(((r.ty - r.y) * go) / d); continue; }
      r.x = r.tx; r.y = r.ty;
      // arrived where he was told to go: is the addressee here?
      const who = r.kind === "order" ? cs.get(r.to)! : null;
      const at = who ? { x: who.x, y: who.y } : hqPos();
      if (dist(r.x, r.y, at.x, at.y) <= P.runner.findRadius) {
        r.done = true;
        if (r.kind === "order") { const o = pendingOrders.get(r.id)!; receive(who!, o, t, "runner"); }
        else deliverReport(r, t);
        continue;
      }
      // not here: if he can be seen from here, go to him; otherwise search, and give up in the end
      if (sees(r.x, r.y, at.x, at.y)) {
        if (r.searching === 0) notes.push({ t, kind: "runner_searching", orderId: r.orderId, commander: who?.id ?? setup.hq });
        r.tx = at.x; r.ty = at.y; r.searching += step;
      } else {
        if (r.searching === 0) notes.push({ t, kind: "runner_searching", orderId: r.orderId, commander: who?.id ?? setup.hq });
        r.searching += step;
        if (r.searching > P.runner.searchSeconds) { r.done = true; notes.push({ t, kind: "runner_lost", orderId: r.orderId, commander: who?.id ?? r.from, why: "could not find him" }); if (r.kind === "order") { const e = hqOrders.get(r.to); if (e && e.orderId === r.orderId) e.status = "lost"; } }
      }
    }
  };
  const deliverReport = (r: Runner, t: number) => {
    notes.push({ t, kind: "report_received", from: r.from });
    for (const s of r.payload ?? []) { const cur = hqSight.get(s.id); if (!cur || cur.t < s.t) hqSight.set(s.id, { ...s, how: "reported", source: r.from }); }
    const e = hqOrders.get(r.from);
    if (e) {
      e.lastContact = t;
      const dec = (r.decisions ?? []).find((x) => x.orderId === e.orderId);
      if (dec) { e.status = "confirmed"; e.task = dec.task; }
    } else hqOrders.set(r.from, { orderId: 0, task: cs.get(r.from)!.task, sentT: 0, eta: 0, status: "none", lastContact: t });
  };

  // ---- movement ----
  const slotOf = (f: F, p: { x: number; y: number }) => {
    const peers = order.map((id) => fs.get(id)!).filter((g) => live(g) && g.side === f.side && (g.task.place === f.task.place) && g.task.kind === f.task.kind);
    const i = peers.findIndex((g) => g.id === f.id), n = peers.length;
    return { x: p.x + (i - (n - 1) / 2) * 110, y: p.y + (f.kind === "archers" || f.kind === "bowmen" ? (f.side === "crown" ? 60 : -60) : 0) };
  };
  const enemiesOf = (f: F) => order.map((id) => fs.get(id)!).filter((g) => live(g) && g.side !== f.side);
  const nearestEnemy = (f: F) => enemiesOf(f).sort((a, b) => dist(f.x, f.y, a.x, a.y) - dist(f.x, f.y, b.x, b.y) || (a.id < b.id ? -1 : 1))[0];
  const sightOf = (f: F) => cs.get(f.commander)?.sight;
  const moveToward = (f: F, tx: number, ty: number, speed: number, stopAt = 0) => {
    const d = dist(f.x, f.y, tx, ty);
    if (d <= stopAt + 2) return false;
    let v = speed * step;
    if (field.woods.some((w) => inside(w, f.x, f.y))) v = Math.floor(v / 2);
    if (field.lines.some((l) => Math.abs(f.y - l.y) < 25)) v = Math.floor(v / 2);
    v = Math.floor((v * (1000 - Math.floor(f.fatigue / 3))) / 1000);
    const go = Math.min(v, d - stopAt);
    f.x += Math.trunc(((tx - f.x) * go) / d); f.y += Math.trunc(((ty - f.y) * go) / d);
    f.x = Math.max(0, Math.min(field.width, f.x)); f.y = Math.max(0, Math.min(field.height, f.y));
    return true;
  };
  const move = (f: F) => {
    const k = P.kinds[f.kind], edge = field.edge[f.side];
    let moved = false;
    switch (f.behaviour) {
      case "gone": case "disorganised": case "rallying": return;
      case "rout": moved = moveToward(f, f.x, edge, Math.floor(k.speed * 18 / 10)); break;
      case "retreat": moved = moveToward(f, f.x, edge, Math.floor(k.speed * 13 / 10)); break;
      case "withdrawing": { const p = place(f.task.place) ?? { x: f.x, y: edge }; moved = moveToward(f, slotOf(f, p).x, slotOf(f, p).y, Math.max(1, Math.floor(k.speed * 8 / 10))); break; }
      case "yielding": { const e = nearestEnemy(f); if (e) { const d = Math.max(1, dist(f.x, f.y, e.x, e.y)); moved = moveToward(f, f.x + Math.trunc(((f.x - e.x) * 40) / d), f.y + Math.trunc(((f.y - e.y) * 40) / d), 1); } break; }
      case "good_order": {
        const t = f.task;
        if (t.kind === "hold" || t.kind === "advance" || t.kind === "give_ground") { const p = place(t.place); if (p) { const s = slotOf(f, p); moved = moveToward(f, s.x, s.y, k.speed); } break; }
        if (t.kind === "withdraw") { const p = place(t.place) ?? { x: f.x, y: edge }; const s = slotOf(f, p); moved = moveToward(f, s.x, s.y, k.speed); break; }
        if (t.kind === "protect") { const g = fs.get(t.target ?? ""); if (g && live(g)) moved = moveToward(f, g.x, g.y + (f.side === "crown" ? 90 : -90), k.speed, 30); break; }
        if (t.kind === "attack") {
          // the target as his commander believes it to be, or as the men see it; nearest seen enemy if none named
          const sight = sightOf(f);
          let tgt = t.target ? fs.get(t.target) : undefined;
          if (!tgt || !live(tgt) || tgt.behaviour === "gone") tgt = enemiesOf(f).filter((e) => sees(f.x, f.y, e.x, e.y) || sight?.has(e.id)).sort((a, b) => dist(f.x, f.y, a.x, a.y) - dist(f.x, f.y, b.x, b.y) || (a.id < b.id ? -1 : 1))[0];
          const p = place(t.place);
          if (!tgt && p) { moved = moveToward(f, p.x, p.y, k.speed); break; }
          if (!tgt) break;
          const seen = sees(f.x, f.y, tgt.x, tgt.y) ? { x: tgt.x, y: tgt.y } : sight?.get(tgt.id) ?? { x: tgt.x, y: tgt.y };
          let ty = seen.y;
          const lim = line(t.limit);
          if (lim) ty = f.side === "crown" ? Math.max(ty, lim.y + 20) : Math.min(ty, lim.y - 20);
          const reach = k.missileRange > 0 && (f.kind === "archers" || f.kind === "bowmen") ? k.missileRange - 30 : k.meleeRange - 5;
          moved = moveToward(f, seen.x, ty, k.speed, ty === seen.y ? reach : 0);
          break;
        }
      }
    }
    f.fatigue = Math.max(0, Math.min(1000, f.fatigue + (moved ? 2 : f.engaged ? 3 : -2)));
  };

  // ---- formations take up ground: friends keep their intervals, enemies meet face to face rather than inside each other ----
  const separate = () => {
    const ls = order.map((id) => fs.get(id)!).filter(live);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      const want = a.side === b.side ? P.spacing.friends : P.spacing.enemies;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d >= want) continue;
      if (d === 0) { dx = a.id < b.id ? 1 : -1; dy = 0; }
      const push = Math.ceil((want - d) / 2), n = Math.max(1, d);
      const ux = Math.trunc((dx * push) / n) || (d === 0 ? dx * push : 0), uy = Math.trunc((dy * push) / n);
      a.x = Math.max(0, Math.min(field.width, a.x - ux)); a.y = Math.max(0, Math.min(field.height, a.y - uy));
      b.x = Math.max(0, Math.min(field.width, b.x + ux)); b.y = Math.max(0, Math.min(field.height, b.y + uy));
    }
  };

  // ---- fighting ----
  const fight = (t: number) => {
    const losses = new Map<string, number>(), dealt = new Map<string, number>();
    for (const id of order) { const f = fs.get(id)!; f.engaged = false; f.underFire = false; }
    for (const id of order) {
      const a = fs.get(id)!;
      if (!live(a) || a.behaviour === "rout" || a.men <= 0) continue;
      const ka = P.kinds[a.kind];
      const foes = enemiesOf(a).map((e) => ({ e, d: dist(a.x, a.y, e.x, e.y) })).sort((x, y) => x.d - y.d || (x.e.id < y.e.id ? -1 : 1));
      const melee = foes.find((x) => x.d <= ka.meleeRange);
      let tgt: F | undefined, rate = 0;
      if (melee) { tgt = melee.e; rate = ka.meleeRate; a.engaged = true; tgt.engaged = true; }
      else if (ka.missileRange > 0 && a.behaviour !== "retreat") { const m = foes.find((x) => x.d <= ka.missileRange && sees(a.x, a.y, x.e.x, x.e.y)); if (m) { tgt = m.e; rate = ka.missileRate; tgt.underFire = true; } }
      if (!tgt || rate === 0) continue;
      if (melee && !notes.some((n) => n.kind === "contact" && n.formation === a.id && n.to === tgt!.id && t - n.t < 600)) notes.push({ t, kind: "contact", formation: a.id, to: tgt.id });
      // men lost by the target this step, in thousandths of a man
      let v = a.men * rate * step; // rate: per million men-seconds -> thousandths
      v = Math.floor(v / 1000);
      v = Math.floor((v * (400 + Math.floor((a.cohesion * 6) / 10))) / 1000);
      v = Math.floor((v * (1000 - Math.floor(a.fatigue / 2))) / 1000);
      const r = P.rates;
      if (tgt.behaviour === "rout") v = Math.floor((v * r.routTarget) / 1000);
      else if (tgt.behaviour === "retreat") v = Math.floor((v * r.retreatTarget) / 1000);
      else if (tgt.behaviour === "disorganised" || tgt.behaviour === "rallying") v = Math.floor((v * r.disorganisedTarget) / 1000);
      if (ka.mounted && melee && tgt.behaviour !== "good_order" && tgt.behaviour !== "withdrawing") v = Math.floor((v * r.mountedVsDisordered) / 1000);
      if (field.ridges.some((g) => inside(g, tgt!.x, tgt!.y)) && !field.ridges.some((g) => inside(g, a.x, a.y))) v = Math.floor((v * r.ridgeDefence) / 1000);
      if (!melee && field.woods.some((w) => inside(w, tgt!.x, tgt!.y))) v = Math.floor((v * r.woodCover) / 1000);
      v = Math.floor((v * roll(`hit:${t}:${a.id}:${tgt.id}`, r.noise[0], r.noise[1])) / 1000);
      losses.set(tgt.id, (losses.get(tgt.id) ?? 0) + v);
      dealt.set(a.id, (dealt.get(a.id) ?? 0) + v);
    }
    for (const id of order) {
      const f = fs.get(id)!;
      const v = (losses.get(id) ?? 0) + f.acc;
      const n = Math.min(f.men, Math.floor(v / 1000));
      f.acc = v - n * 1000;
      f.men -= n;
      if (n) lostByFormation[f.id] = (lostByFormation[f.id] ?? 0) + n;
      f.lostSteps.push(n); if (f.lostSteps.length > 6) f.lostSteps.shift();
      f.doneSteps.push(Math.floor((dealt.get(id) ?? 0) / 1000)); if (f.doneSteps.length > 6) f.doneSteps.shift();
    }
  };

  // ---- cohesion and behaviour (one model, §13) ----
  const behave = (t: number) => {
    const C = P.cohesion;
    const prev = new Map(order.map((id) => [id, fs.get(id)!.behaviour]));
    for (const id of order) {
      const f = fs.get(id)!;
      if (!live(f)) continue;
      let d = 0;
      const lost = f.lostSteps[f.lostSteps.length - 1] ?? 0;
      d -= Math.floor((lost * 100 * C.perLossPercent) / Math.max(1, f.start));
      const lostR = f.lostSteps.reduce((n, x) => n + x, 0), doneR = f.doneSteps.reduce((n, x) => n + x, 0);
      if (f.engaged) { if (lostR * 10 > doneR * 12) d -= C.losing; else if (doneR * 10 > lostR * 15) d += C.winning; }
      if (f.underFire && !f.engaged) d -= C.underFire;
      let ownNear = 0, enemyNear = 0;
      for (const g of order.map((x) => fs.get(x)!)) if (live(g) && g.behaviour !== "rout" && dist(f.x, f.y, g.x, g.y) < 300) { if (g.side === f.side) ownNear += g.men; else enemyNear += g.men; }
      // outnumbered where they stand: the worse the odds, the faster their nerve goes
      if (enemyNear * 10 > ownNear * 15) d -= C.outnumbered * Math.min(5, Math.floor(enemyNear / Math.max(1, ownNear)));
      // what neighbours appear to be doing (§14)
      for (const g of order.map((x) => fs.get(x)!)) {
        if (g.id === f.id || g.side !== f.side || !live(g) || dist(f.x, f.y, g.x, g.y) > 400) continue;
        const b = prev.get(g.id);
        if (b === "rout") d -= C.neighbourRout;
        else if (b === "retreat") d -= C.neighbourRetreat;
        else if (b === "withdrawing" && g.commander !== f.commander && t - withdrawSignalAt > 300) d -= C.unannouncedWithdrawal;
      }
      const c = cs.get(f.commander);
      // each raider band follows its own war leader; the crown's formations depend on their commander being near
      const near = f.side === "raiders" || (!!c && dist(c.x, c.y, f.x, f.y) <= P.voiceRange);
      if (near) d += C.commanderBase + (f.side === "crown" && c ? Math.floor(c.skill / 250) : 0);
      if (f.side === "crown" && guard && live(guard) && guard.id !== f.id && dist(guard.x, guard.y, f.x, f.y) < 600) d += C.rulerNear;
      if (!f.engaged && !f.underFire && f.cohesion < P.kinds[f.kind].discipline) d += C.recover;
      if (f.fatigue > 700) d -= C.tired;
      if (f.task.kind === "give_ground" && d < 0) d = Math.trunc(d / 2);
      const before = f.cohesion;
      f.cohesion = Math.max(0, Math.min(1000, f.cohesion + d));
      const rising = f.cohesion > before;
      // the behaviour that shows, with hysteresis
      const p = f.behaviour, k = f.cohesion;
      let b: Behaviour;
      if (f.men * 1000 < f.start * P.goneBelowPermille || ((f.behaviour === "rout" || f.behaviour === "retreat" || f.behaviour === "withdrawing") && Math.abs(f.y - field.edge[f.side]) < 15)) b = "gone";
      else if (k < C.rout || (p === "rout" && k < C.retreat)) b = "rout";
      else if (k < C.retreat) b = p === "rout" && near && rising ? "rallying" : "retreat";
      else if (k < C.disorganised) b = near && rising ? "rallying" : p === "rout" || p === "retreat" ? (near ? "rallying" : "retreat") : "disorganised";
      else if ((p === "rallying" || p === "disorganised" || p === "retreat" || p === "rout") && k < C.rallied) b = near ? "rallying" : "disorganised";
      else if (f.task.kind === "withdraw") b = "withdrawing";
      else if (f.engaged && lostR * 10 > doneR * 12 && (f.task.kind === "hold" || f.task.kind === "give_ground" || f.task.kind === "protect") && k < 700) b = "yielding";
      else b = "good_order";
      if (b !== p) {
        f.behaviour = b;
        if (b === "gone" && f.id === guard?.id && rulerFate === "safe") {/* the guard is gone: the ruler is alone */}
        notes.push({ t, kind: "behaviour", formation: f.id, from: p, to: b });
      }
    }
  };

  // ---- commanders: move with their men, check conditions, report ----
  const commanders = (t: number) => {
    for (const c of cs.values()) {
      const main = c.formations.map((id) => fs.get(id)!).find((f) => live(f) && f.behaviour !== "rout") ?? c.formations.map((id) => fs.get(id)!).find(live);
      if (main) { c.x = main.x; c.y = main.y + (c.side === "crown" ? 30 : -30); }
      if (c.side !== "crown") continue;
      // a condition in his task, judged on what he believes
      const w = c.task.when;
      if (w) {
        const seen = [...c.sight.values()].filter((s) => fs.get(s.id)!.side !== c.side && t - s.t < 120);
        const hit = w.kind === "enemy_horse_seen" ? seen.some((s) => P.kinds[fs.get(s.id)!.kind].mounted) : seen.some((s) => dist(s.x, s.y, c.x, c.y) < 400) || c.formations.some((id) => fs.get(id)!.engaged);
        if (hit) { notes.push({ t, kind: "contingency", commander: c.id, text: w.kind }); assign(c, { ...w.then }, t); }
      }
      // reporting policy: on first contact, on heavy losses, and every so often
      const engaged = c.formations.some((id) => fs.get(id)!.engaged);
      const menNow = c.formations.reduce((n, id) => n + (live(fs.get(id)!) ? fs.get(id)!.men : 0), 0);
      const bad = avg(c.traits, "badNewsReportingPermille") < 450;
      if (engaged && !c.contact) { c.contact = true; sendReport(c, t); }
      else if (!bad && c.menAtReport - menNow > Math.floor((c.menAtReport * P.reportLossPermille) / 1000)) sendReport(c, t);
      else if (t - c.lastReport >= P.reportEvery * (bad ? 2 : 1)) sendReport(c, t);
    }
  };

  // ---- the raiders' chief: simple doctrine, no obedience modelling (they are not the player's men) ----
  const raiders = (t: number) => {
    const rs = order.map((id) => fs.get(id)!).filter((f) => f.side === "raiders");
    const start = rs.reduce((n, f) => n + f.start, 0), now = rs.reduce((n, f) => n + (live(f) ? f.men : 0), 0);
    const broken = rs.filter((f) => !live(f) || f.behaviour === "rout" || f.behaviour === "retreat").length * 2 > rs.length;
    if (!raidersWithdrawing && (start - now) * 1000 > start * P.raiders.withdrawLossPermille || (!raidersWithdrawing && broken)) {
      raidersWithdrawing = true;
      for (const f of rs) if (live(f)) f.task = { kind: "withdraw" }; // they draw off the field the way they came
    }
    if (raidersWithdrawing || t - lastRaiderPlan < P.raiders.replanEvery) return;
    lastRaiderPlan = t;
    const crownLive = crown().filter((f) => live(f) && f.behaviour !== "gone");
    for (const f of rs) {
      if (!live(f)) continue;
      // riders look for a soft target (archers, the shaken, the guard); the rest go for the nearest
      const pool = crownLive.filter((g) => sees(f.x, f.y, g.x, g.y) || dist(f.x, f.y, g.x, g.y) < 1600);
      const soft = P.kinds[f.kind].mounted ? pool.filter((g) => g.kind === "archers" || (g.behaviour !== "good_order" && g.kind !== "guard")) : [];
      const pick = (soft.length ? soft : pool).sort((a, b) => dist(f.x, f.y, a.x, a.y) - dist(f.x, f.y, b.x, b.y) || (a.id < b.id ? -1 : 1))[0];
      f.task = pick ? { kind: "attack", target: pick.id } : { kind: "advance", place: "gate" };
    }
  };

  // ---- the ruler's danger (§2A): signalled first, lethal only in contact ----
  const danger = (t: number) => {
    if (!guard || rulerFate !== "safe") return false;
    const say = (what: string, text: string) => {
      if (t - (lastDanger[what] ?? -1e9) < setup.params.ruler.repeatEvery) return;
      lastDanger[what] = t;
      if (dangerFirst < 0) dangerFirst = t;
      notes.push({ t, kind: "danger", why: what, text });
    };
    const R = P.ruler;
    const foes = order.map((id) => fs.get(id)!).filter((f) => live(f) && f.side === "raiders" && f.behaviour !== "rout");
    const nearest = foes.map((f) => ({ f, d: dist(f.x, f.y, guard.x, guard.y) })).sort((a, b) => a.d - b.d)[0];
    if (foes.some((f) => P.kinds[f.kind].missileRange > 0 && dist(f.x, f.y, guard.x, guard.y) <= P.kinds[f.kind].missileRange + 80)) say("arrows", "arrows are falling near the command post");
    if (nearest && nearest.d < R.dangerNear) { say("aides", "her aides urge her to withdraw"); warnedAt ??= t; } else if (!nearest || nearest.d > R.dangerNear * 2) warnedAt = undefined;
    if (nearest && nearest.d < R.formsUpAt) say("guard", "the guard captain forms up the guard");
    // unless she chose where to stand after her aides warned her, the guard closes round her and falls back towards the gate
    if (nearest && nearest.d < R.dangerNear && rulerOrderedAt < (warnedAt ?? t) && guard.task.kind !== "withdraw" && t > 0) { guard.task = { kind: "withdraw", place: "gate" }; notes.push({ t, kind: "danger", why: "guard_falls_back", text: "the guard closes round the queen and falls back" }); }
    const front = crown().filter((f) => live(f) && f.id !== guard.id && dist(f.x, f.y, guard.x, guard.y) < 400);
    if (front.some((f) => f.behaviour === "disorganised" || f.behaviour === "retreat" || f.behaviour === "rout")) say("wavering", "the line before her wavers");
    // harm only once a real threat is in contact with her guard, and never before she was warned; under the walls at the
    // gate she is in the fort, where the campaign's own rules for a raided fort apply, not the field's
    if (dangerFirst < 0 || dangerFirst >= t) return false;
    const gate = place("gate");
    if (gate && dist(guard.x, guard.y, gate.x, gate.y) <= R.wallsRange) return false;
    const inMelee = foes.some((f) => dist(f.x, f.y, guard.x, guard.y) <= P.kinds[f.kind].meleeRange);
    const shot = foes.some((f) => P.kinds[f.kind].missileRange > 0 && dist(f.x, f.y, guard.x, guard.y) <= P.kinds[f.kind].missileRange);
    const exposed = !live(guard) || guard.behaviour === "rout";
    const p = inMelee ? Math.floor((R.meleePermille * (1000 - guard.cohesion + (exposed ? 500 : 0))) / 1000) : shot ? R.missilePermille : 0;
    if (p > 0 && roll(`ruler:${t}`) < p) {
      rulerFate = roll(`ruler:fate:${t}`) < R.deathPermille ? "killed" : "captured";
      notes.push({ t, kind: "end", why: rulerFate, text: rulerFate === "killed" ? "the queen has fallen" : "the queen is taken" });
      return true;
    }
    return false;
  };

  // ---- the end (§22) ----
  const ended = (t: number): { winner: Side | "none"; reason: string } | null => {
    const fighting = (s: Side) => order.map((id) => fs.get(id)!).filter((f) => f.side === s && live(f) && f.behaviour !== "rout" && f.behaviour !== "retreat" && f.id !== guard?.id);
    const cr = fighting("crown"), ra = fighting("raiders");
    if (!ra.length) return { winner: "crown", reason: "the raiders broke" };
    if (raidersWithdrawing && ra.every((f) => f.behaviour === "withdrawing" || f.task.kind === "withdraw") && ra.every((f) => cr.every((g) => dist(f.x, f.y, g.x, g.y) > 500))) return { winner: "crown", reason: "the raiders drew off" };
    if (!cr.length) return { winner: "raiders", reason: "the crown's men broke" };
    const gate = place("gate");
    if (gate && cr.every((f) => f.task.kind === "withdraw" && dist(f.x, f.y, gate.x, gate.y) < 220 && !f.engaged)) return { winner: "raiders", reason: "the crown's men withdrew to the gate" };
    if (t >= until) return { winner: "none", reason: t >= setup.endT ? "night fell" : "stopped" };
    return null;
  };

  // ---- recording ----
  const frame = (t: number) => {
    frames.push({ t, formations: order.map((id) => { const f = fs.get(id)!; return { id, side: f.side, kind: f.kind, label: f.label, commander: f.commander, men: f.men, x: f.x, y: f.y, behaviour: f.behaviour, task: { ...f.task } }; }), ...(guard ? { ruler: { x: guard.x, y: guard.y } } : {}) });
    const h = hqPos(), marks: Mark[] = [];
    for (const id of order) {
      const f = fs.get(id)!, s = hqSight.get(id);
      if (!s) continue;
      const age = t - s.t, observed = s.how === "observed" && age === 0;
      let x = s.x, y = s.y, category: Mark["category"] = observed ? "observed" : "reported";
      // a friendly formation out of sight whose new order is believed delivered: headquarters assumes it is being carried out
      const e = f.side === "crown" ? hqOrders.get(f.commander) : undefined;
      if (!observed && e && e.eta > s.t && t >= e.eta && (e.status === "presumed delivered" || e.status === "dispatched" || e.status === "confirmed")) {
        const p = place(e.task.place);
        if (p) { const d = dist(x, y, p.x, p.y), go = Math.min(d, P.kinds[f.kind].speed * (t - e.eta)); if (d > 0) { x += Math.trunc(((p.x - x) * go) / d); y += Math.trunc(((p.y - y) * go) / d); } category = "inferred"; if (e.status === "dispatched") e.status = "presumed delivered"; }
      }
      marks.push({ id, side: f.side, kind: f.kind, label: f.label, x, y, behaviour: s.behaviour, menBand: band(s.men), category, source: s.source, age, stale: age > P.staleAfter });
    }
    const network: NetworkRow[] = [...cs.values()].filter((c) => c.side === "crown" && c.id !== setup.hq).map((c) => { const e = hqOrders.get(c.id); return { commander: c.id, task: e ? e.task : null, status: e ? e.status : "none", lastContact: e?.lastContact ? t - e.lastContact : t }; });
    hqFrames.push({ t, x: h.x, y: h.y, marks, network });
  };

  // ---- the run ----
  const all = [...setup.plan.map((o) => ({ ...o, t: 0, via: "voice" as const })), ...orders.filter((o) => o.t <= until)].sort((a, b) => a.t - b.t || a.id - b.id);
  for (const f of fs.values()) if (f.side === "raiders") f.task = { kind: "hold", place: "camp" };
  observeAll(0);
  for (const o of all.filter((o) => o.t === 0)) dispatchOrder(o, 0);
  raiders(0);
  frame(0);
  let t = 0, end: { winner: Side | "none"; reason: string } | null = null;
  while (!end) {
    t += step;
    for (const o of all.filter((o) => o.t > t - step && o.t <= t)) dispatchOrder(o, t);
    for (const pa of pendingAssign.filter((x) => x.at <= t)) { const f = fs.get(pa.formation)!; if (live(f)) f.task = pa.task; }
    for (let i = pendingAssign.length - 1; i >= 0; i--) if (pendingAssign[i].at <= t) pendingAssign.splice(i, 1);
    raiders(t);
    for (const id of order) move(fs.get(id)!);
    separate();
    fight(t);
    behave(t);
    observeAll(t);
    commanders(t);
    moveRunners(t);
    if (danger(t)) end = { winner: "raiders", reason: (rulerFate as BattleResult["ruler"]) === "killed" ? "the queen fell" : "the queen was taken" };
    end = end ?? ended(t);
    if (t % P.frameEvery === 0 || end) frame(t);
  }
  notes.push({ t, kind: "end", why: end.reason });

  // ---- result and debrief ----
  const lost: Record<Side, number> = { crown: 0, raiders: 0 }, lostBy: Record<string, number> = {};
  for (const f of fs.values()) { const n = f.start - f.men; lost[f.side] += n; lostBy[f.commander] = (lostBy[f.commander] ?? 0) + n; }
  const result: BattleResult = { winner: end.winner, reason: end.reason, endT: t, lost, lostBy, lostByFormation, ruler: rulerFate, conduct };
  const debrief: Debrief[] = [...cs.values()].filter((c) => c.side === "crown").map((c) => {
    const truth = lostBy[c.id] ?? 0, frank = avg(c.traits, "badNewsReportingPermille"), risk = avg(c.traits, "riskPermille");
    const own = Math.floor((truth * Math.min(1000, 400 + frank)) / 1000);
    const enemy = Math.floor((lost.raiders * (700 + Math.floor((risk * 6) / 10))) / 1000);
    const view = end!.winner === "crown" ? "won" : end!.winner === "raiders" ? "lost" : frank < 450 ? "won" : "drawn";
    const conductOf = traces.filter((x) => x.commander === c.id).map((x) => {
      const top = (x.candidates.find((k) => k.kind === x.decision)?.contributions ?? []).slice().sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0];
      return { orderId: x.orderId, decision: x.decision, reason: top?.textKey ?? "reason.duty" };
    });
    return { author: c.id, result: view as Debrief["result"], ownLosses: own, enemyLosses: enemy, conduct: conductOf };
  });
  return { schemaVersion: 1, frames, hq: hqFrames, notes, traces, result, debrief };
}
