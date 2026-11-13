// Agents system (ARCHITECTURE §20.4-20.9): wake subscription index, coalescing, scheduled reviews of live intentions,
// layered planning (strategic focus, operational plan), execution through people and physical systems, advice.
// This module builds what the planner sees; the planner itself (src/agents/) never touches WorldState.
import type { Band } from "../beliefs.ts";
import type { Content } from "../content.ts";
import type { SimEvent } from "../events.ts";
import { MapGraph } from "../map.ts";
import type { Recommendation, Reason, StructuredOrder } from "../schemas.ts";
import { validateRecommendation, type DecisionTrace } from "../schemas.ts";
import { beliefsAbout, buildView, type View } from "../view.ts";
import type { WorldState } from "../world.ts";
import type { ActionRef, Perceiver, Seen, Situation } from "../agents/model.ts";
import { actionKey } from "../agents/model.ts";
import { byScore, chooseFocus, generateEconomy, plan, score, type PlanResult } from "../agents/planner.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { battleLoss, raiderMen } from "../battle.ts";
import { beginBattle } from "./battle.ts";
import { best, learn, observe, seedKnowledge } from "./knowledge.ts";
import { travel } from "./movement.ts";

// ---- what an agent can know ---------------------------------------------------------------------------------------
export function capability(s: Readonly<WorldState>, c: Content, who: string, domain: string) {
  return Math.min(1000, (c.byId.character.get(who)?.capabilities[domain] ?? 0) + (s.agents[who]?.experience[domain] ?? 0));
}

export function perceiverFromView(view: View): Perceiver {
  const seen = new Map<string, Seen>();
  return {
    get(subjectId, predicate) {
      const b = beliefsAbout(view, subjectId, predicate)[0];
      if (!b) return null;
      const x: Seen = { value: b.believedValue, propId: b.id, ageTicks: b.ageTicks, band: b.effectiveBand as Band, subject: b.subject, predicate };
      seen.set(`${subjectId}|${predicate}`, x);
      return x;
    },
    consulted: () => [...seen.values()].sort((a, b) => a.propId - b.propId),
  };
}

/** The chronicle's oracle: physical facts as they truly were; everything else as the agent believed it. */
export function truthPerceiver(s: Readonly<WorldState>, view: View): Perceiver {
  const fallback = perceiverFromView(view);
  const T = (value: unknown, subjectId: string, predicate: string, kind = "location"): Seen => ({ value, propId: -1, ageTicks: 0, band: "certain", subject: { kind, id: subjectId }, predicate });
  return {
    get(subjectId, predicate) {
      if (predicate === "fortification.condition" && s.fortifications[subjectId]) return T(s.fortifications[subjectId].conditionMilli, subjectId, predicate);
      if (predicate === "threat.intensity") return T(s.threats[subjectId]?.intensityPermille ?? 0, subjectId, predicate);
      if (predicate === "treasury.balance" && s.treasuryMilli[subjectId] !== undefined) return T(s.treasuryMilli[subjectId], subjectId, predicate, "character");
      return fallback.get(subjectId, predicate);
    },
    consulted: () => [],
  };
}

const maps = new WeakMap<Content, { map: MapGraph; travel: Map<string, number> }>();
function staticMap(c: Content) {
  let m = maps.get(c);
  if (!m) { m = { map: new MapGraph(c), travel: new Map() }; maps.set(c, m); }
  return m;
}

export function defenceAt(s: Readonly<WorldState>, where: string) {
  const f = s.fortifications[where];
  if (!f) return null;
  let men = f.garrison;
  for (const [who, p] of Object.entries(s.positions)) if ("at" in p && p.at === where) men += s.troops[who] ?? 0;
  return men;
}

/** Whom an agent could put in charge (adopted decision 5, plan §G): its own retainers, and people recommended by someone
 *  it trusts at least `recommendationTrustMin`. Busy people (an order in force, or travelling) are not available. */
export function leaderCandidates(s: Readonly<WorldState>, c: Content, agent: string) {
  const ch = c.byId.character.get(agent)!;
  const min = c.scenario.agents.recommendationTrustMin;
  const free = (id: string) => id !== agent && !(s.ordersInForce[id] ?? []).length && "at" in s.positions[id];
  const out: { id: string; recommendedBy: string; score: number }[] = [];
  for (const r of ch.relationships) if (r.kind === "retainer" && free(r.to)) out.push({ id: r.to, recommendedBy: agent, score: r.value });
  for (const r of ch.relationships) {
    if (!(r.kind === "trust" || r.kind === "loyalty") || r.value < min) continue;
    for (const rec of c.byId.character.get(r.to)!.relationships)
      if (rec.kind === "recommends" && free(rec.to)) out.push({ id: rec.to, recommendedBy: r.to, score: Math.floor((r.value * rec.value) / 1000) });
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

export function buildSituation(s: Readonly<WorldState>, c: Content, agent: string, now: number, mode: Situation["mode"], view: View, order?: StructuredOrder): Situation {
  const ch = c.byId.character.get(agent)!;
  const pos = s.positions[agent];
  const at = "at" in pos ? pos.at : null;
  const sm = staticMap(c);
  const ruler = c.byId.character.get(c.scenario.ruler)!;
  const rel = (other: string, kind: string) => ch.relationships.find((r) => r.to === other && r.kind === kind)?.value;
  const st = s.agents[agent];
  const cur = st?.operational;
  const caps: Record<string, number> = {};
  for (const d of Object.keys(ch.capabilities)) caps[d] = capability(s, c, agent, d);
  const seatOf = (id: string) => (beliefsAbout(view, id, "character.seat")[0]?.believedValue as string | undefined) ?? c.byId.character.get(id)!.location;
  return {
    adviceKinds: ch.adviceKinds, repairScope: ch.repairScope,
    noise: (key) => { let h = 2166136261; for (const x of `${agent}|${Math.floor(now / DAY)}|${key}`) { h ^= x.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h % 2001) - 1000; },
    now, agent, role: ch.role, house: ch.house, tier: s.tiers[agent], leaderCandidates: leaderCandidates(s, c, agent),
    post: ch.location, at, superior: ch.reportsTo, ruler: ruler.id, rulerSeat: seatOf(ruler.id),
    traits: ch.traits.map((t) => c.byId.trait.get(t)!), cap: caps, objectives: ch.objectives, focus: st?.focus ?? null,
    troops: s.troops[agent] ?? 0, defenceHere: at ? defenceAt(s, at) : null,
    communities: c.communities.communities.map((x) => x.id).sort(),
    ...(at === c.scenario.regency.seat && s.books && c.scenario.goods && c.scenario.manpower ? { goods: { stock: structuredClone(s.books.stock), crownStores: c.scenario.goods.places.filter((p) => (p.house ?? "crown") === "crown" && p.cap.timber !== undefined).map((p) => p.location).sort(),
      unitsPerOrder: c.scenario.goods.buy.timber.units, pointsPerUnit: c.scenario.goods.repair.pointsPerUnit, coverPermille: c.scenario.goods.repair.coverPermille,
      musterMen: c.scenario.manpower.musterMen, ironPerMan: c.scenario.manpower.ironPerMan, serviceDays: c.scenario.manpower.serviceDays, wageMilli: c.scenario.manpower.wageMilli } } : {}),
    forts: sorted(c.locations.filter((l) => l.fortification), (l) => l.id).map((l) => ({ id: l.id, garrison: l.fortification!.garrison,
      sites: c.scenario.threat.sites.filter((x) => x.target === l.id).map((x) => x.site).sort(),
      stormMilliPerDay: Math.floor((l.exposurePermille * (c.scenario.weather.stormDamageMilli[0] + c.scenario.weather.stormDamageMilli[1])) / 2000) })),
    captains: sorted(c.characters.filter((x) => x.role === "captain"), (x) => x.id).map((x) => ({ id: x.id, troops: x.troops ?? 0, seat: x.id === agent ? x.location : seatOf(x.id) })),
    travel: (a, b, m) => {
      const k = `${a}>${b}>${m}`;
      let t = sm.travel.get(k);
      if (t === undefined) { t = sm.map.path(a, b, m, () => true)?.ticks ?? 1e9; sm.travel.set(k, t); }
      return t;
    },
    trust: (o) => rel(o, "trust") ?? 500,
    answerRate: (o) => st?.answerRate[o] ?? rel(o, "trust") ?? rel(o, "loyalty") ?? 500,
    loyalty: (o) => rel(o, "loyalty") ?? rel(o, "trust") ?? 500,
    ordersInForce: [...view.self.ordersInForce],
    current: cur ? { action: cur.action, score: cur.score, adoptedAt: cur.adoptedAt, idle: cur.idle || (ONE_SHOT.has(cur.action.kind) && now - cur.adoptedAt >= 7 * DAY) } : null,
    mode, order,
    p: { agents: c.scenario.agents, battle: c.scenario.battle, raidBaseMilli: c.scenario.threat.raidDamageMilliAtFullIntensity,
      restoreToMilli: c.scenario.player.repairRestoreToMilli, repairCostPerMilli: c.scenario.player.repairCostMilliPerMilli,
      repairDays: c.scenario.player.repairDays, levyMilli: c.scenario.player.levyMilli, reliefMilli: c.communities.params.reliefMilli, breachMilli: c.scenario.endStates.fortificationBreachedBelowMilli,
      partialRestoreToMilli: c.scenario.agents.values.goodConditionMilli, decayMilliPerDay: c.scenario.weather.decayMilliPerDay, retakeMilli: c.scenario.threat.retakeConditionMilli, captainAwayMilli: c.scenario.economy.captainAwayMilli,
      rushCostPermille: c.scenario.player.repairRushCostPermille, labourWorkPermille: c.scenario.player.repairLabourWorkPermille, labourToMilli: c.scenario.player.repairLabourToMilli,
      companyWorkPermille: c.scenario.player.repairCompanyWorkPermille },
  };
}

const ONE_SHOT = new Set(["request_repair", "request_reinforcement", "sortie"]);
const REVIEWED = new Set(["march_to", "return_to_post", "sortie", "send_detachment"]);
export const isIdle = (a: ActionRef, sit: Situation) => (a.kind === "hold" && sit.at === sit.post) || a.kind.startsWith("advise_");
const needsReview = (a: ActionRef, sit: Situation) => REVIEWED.has(a.kind) || (a.kind === "hold" && sit.at !== sit.post);

export function traceOf(sit: Situation, per: Perceiver, res: { candidates: PlanResult["candidates"]; selected: ActionRef; kept: boolean; margin: number | null },
  trigger: number, layer: DecisionTrace["layer"], kind: DecisionTrace["kind"]): DecisionTrace {
  return {
    schemaVersion: 1, agent: sit.agent, tick: sit.now, trigger, layer, kind,
    beliefsConsulted: per.consulted().map((b) => ({ ref: { kind: "belief", id: String(b.propId) }, ageTicks: b.ageTicks, reliability: b.band, subject: b.subject as never, predicate: b.predicate, believedValue: b.value })),
    objectivesActive: sit.objectives.map((o) => ({ kind: "objective", id: o.id })),
    ordersInForce: sit.ordersInForce.map((o) => o.id),
    candidates: res.candidates.map((c) => ({ action: c.action, score: c.score, contributions: c.contributions })),
    selected: res.selected, keptCurrentIntention: res.kept, ...(res.margin !== null ? { margin: res.margin } : {}),
  };
}

// ---- wake subscription index (runtime, rebuilt deterministically on replay) ----------------------------------------
interface Runtime { index: Map<string, Map<string, Set<string>>>; interests: Map<string, Set<string>>; pending: Map<string, { tick: number; triggers: number[]; sig: number }>; awake: string | null }
const rt = (ctx: Ctx): Runtime => (ctx.runtime.agents ??= { index: new Map(), interests: new Map(), pending: new Map(), awake: null });

function interestsOf(ctx: Ctx, agent: string): Set<string> {
  const c = ctx.content, ch = c.byId.character.get(agent)!, s = ctx.s;
  const out = new Set<string>();
  const forts = c.locations.filter((l) => l.fortification).map((l) => l.id);
  const sitesOf = (f: string) => c.scenario.threat.sites.filter((x) => x.target === f).map((x) => x.site);
  const fort = (f: string) => { out.add(`${f}|fortification.condition`); out.add(`${f}|request.reinforce`); for (const x of sitesOf(f)) out.add(`${x}|threat.intensity`); };
  for (const o of ch.objectives) {
    if ((o.objective === "hold_fortification" || o.objective === "hold_post") && o.target && forts.includes(o.target)) fort(o.target);
    if (["protect_realm", "sound_works", "preserve_treasury", "preserve_forces", "win_renown"].includes(o.objective)) forts.forEach(fort);
    if (o.objective === "preserve_treasury") out.add(`${c.scenario.ruler}|treasury.balance`);
    if (o.objective === "protect_community" && o.target) out.add(`${o.target}|*`);
  }
  const cur = s.agents[agent]?.operational;
  if (cur?.action.target && forts.includes(cur.action.target)) fort(cur.action.target);
  for (const id of s.ordersInForce[agent] ?? []) { const t = s.orders[String(id)].order.objective.id; if (forts.includes(t)) fort(t); }
  return out;
}

function rebuild(ctx: Ctx, agent: string) {
  const r = rt(ctx);
  for (const k of r.interests.get(agent) ?? []) r.index.get(k.split("|")[0])?.get(agent)?.clear();
  const ins = interestsOf(ctx, agent);
  r.interests.set(agent, ins);
  for (const k of ins) {
    const [subj, pred] = k.split("|");
    if (!r.index.has(subj)) r.index.set(subj, new Map());
    const m = r.index.get(subj)!;
    if (!m.has(agent)) m.set(agent, new Set());
    m.get(agent)!.add(pred);
  }
}

const isAgent = (ctx: Ctx, who: string) => !!ctx.s.agents[who] && ctx.s.tiers[who] !== "C";
const RANK = { C: 0, B: 1, A: 2 } as const;

/** Promotion (ARCHITECTURE §20.9). The promoted start with what their station would tell them: whom they answer to and
 *  the people they deal with. Nothing about them was simulated before. */
export function promote(ctx: Ctx, who: string, to: "A" | "B", reason: string, cause: number) {
  const from = ctx.s.tiers[who];
  if (RANK[from] >= RANK[to]) return null;
  const ev = ctx.emit("CharacterPromoted", [cause], [chr(who)], { who, from, to, reason });
  seedKnowledge(ctx, who, ev.id);
  rebuild(ctx, who);
  return ev;
}

function queueWake(ctx: Ctx, agent: string, trigger: number, sig: number) {
  const r = rt(ctx);
  if (r.awake === agent) return; // an agent's own thinking does not wake it again
  const p = r.pending.get(agent);
  if (p && p.tick === ctx.tick) { p.triggers.push(trigger); p.sig = Math.max(p.sig, sig); return; }
  r.pending.set(agent, { tick: ctx.tick, triggers: [trigger], sig });
  ctx.at(ctx.tick, "agents:wake", { agent });
}

// ---- thinking ----------------------------------------------------------------------------------------------------
/** Tier B: keep only the selected option and its top reasons (ARCHITECTURE §20.14). */
function compress(t: DecisionTrace): DecisionTrace {
  const sel = t.candidates.find((c) => actionKey(c.action) === actionKey(t.selected))!;
  const top = [...sel.contributions].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3);
  return { ...t, candidates: [{ ...sel, contributions: top }], beliefsConsulted: t.beliefsConsulted.slice(0, 3), compressed: true };
}

function think(ctx: Ctx, agent: string, cause: number, layer: "strategic" | "operational", reason: "triggers" | "review") {
  const c = ctx.content, ch = c.byId.character.get(agent)!;
  const tierB = ctx.s.tiers[agent] === "B";
  if (tierB) layer = "operational"; // locally relevant people do not replan strategically
  const r = rt(ctx);
  r.awake = agent;
  try {
    // the treasury is kept at the seat: whoever is principal and at the seat sees the books (error by their administration)
    const atSeat = "at" in ctx.s.positions[agent] && (ctx.s.positions[agent] as { at: string }).at === c.scenario.regency.seat;
    // the steward keeps the books and tells the ruler when she is at the seat; other principals at the seat just look
    const rulerHere = "at" in ctx.s.positions[c.scenario.ruler] && (ctx.s.positions[c.scenario.ruler] as { at: string }).at === c.scenario.regency.seat;
    if (ch.role === "steward") observe(ctx, agent, chr(c.scenario.ruler), "treasury.balance", cause, rulerHere ? c.scenario.ruler : undefined);
    else if (ch.tier === "A" && atSeat) observe(ctx, agent, chr(c.scenario.ruler), "treasury.balance", cause);
    if (layer === "strategic") {
      const view = buildView(ctx.s, c, agent, ctx.tick), per = perceiverFromView(view);
      const sit = buildSituation(ctx.s, c, agent, ctx.tick, "act", view);
      const f = chooseFocus(sit, per);
      if (f && f.selected.target !== ctx.s.agents[agent].focus)
        ctx.emit("DecisionMade", [cause], [chr(agent)], { trace: traceOf(sit, per, { ...f, kept: false, margin: null }, cause, "strategic", "focus"), score: f.candidates[0].score, idle: true });
    }
    if (ch.role === "castellan" || ch.role === "captain") {
      const view = buildView(ctx.s, c, agent, ctx.tick), per = perceiverFromView(view);
      const sit = buildSituation(ctx.s, c, agent, ctx.tick, "act", view);
      const res = plan(sit, per);
      if (res) {
        const idle = isIdle(res.selected, sit);
        const tr = traceOf(sit, per, res, cause, "operational", "plan");
        const d = ctx.emit("DecisionMade", [cause], [chr(agent), ...(res.selected.target ? [loc(res.selected.target)] : [])],
          { trace: tierB ? compress(tr) : tr, score: res.score, idle });
        if (!res.kept) execute(ctx, agent, res.selected, d.id);
        if (!res.kept && needsReview(res.selected, sit)) ctx.at(ctx.tick + c.scenario.agents.reviewDays.operational * DAY, "agents:review", { agent, decisionEventId: d.id });
      }
    }
    const pos = ctx.s.positions[agent], rp = ctx.s.positions[c.scenario.ruler];
    const rg = c.scenario.regency;
    const rulerAway = !("at" in rp) || rp.at !== rg.seat;
    if (reason === "triggers" && ch.reportsTo === c.scenario.ruler && "at" in pos && "at" in rp && pos.at === rp.at) advise(ctx, agent, cause);
    else if (reason === "triggers" && agent === rg.regent && rulerAway && "at" in pos && pos.at === rg.seat) regency(ctx, agent, cause);
  } finally {
    r.awake = null;
  }
}

/** Advice is worked out at the end of the day, after every letter of that day has arrived, so it takes them all in. */
function advise(ctx: Ctx, agent: string, cause: number) {
  const day = Math.floor(ctx.tick / DAY);
  if (ctx.s.advisePending[agent] === day) return; // already due or given today
  ctx.emit("AdviceScheduled", [cause], [chr(agent)], { agent, day });
  ctx.at(Math.max(ctx.tick, day * DAY + DAY - 2), "agents:advise", { agent, cause });
}

function adviseNow(ctx: Ctx, agent: string, cause: number) {
  const c = ctx.content;
  const view = buildView(ctx.s, c, agent, ctx.tick), per = perceiverFromView(view);
  const sit = buildSituation(ctx.s, c, agent, ctx.tick, "advise", view);
  const res = plan(sit, per);
  if (!res) return;
  // An adviser who would send the captain home does not also rely on his men for the works.
  const sendsHome = res.candidates.filter((x) => x.action.kind === "advise_recall" || x.action.kind === "advise_stay").sort((x, y) => y.score - x.score)[0]?.action.kind === "advise_recall";
  const usesMen = (k: string) => k === "advise_repair_rush" || k === "advise_repair_labour";
  if (sendsHome) {
    res.candidates = res.candidates.filter((x) => !usesMen(x.action.kind));
    if (usesMen(res.selected.kind)) { res.selected = res.candidates[0].action; res.score = res.candidates[0].score; }
  }
  const fortOf = (a: { target?: string }) => !a.target ? undefined : sit.forts.find((f) => f.id === a.target || f.sites.includes(a.target!))?.id;
  // The adviser's word on the whole situation, then a word on each key issue it does not touch: raiders at a fort (defence)
  // and walls in bad shape (works). The best of the adviser's own options on that issue, whatever it is.
  const cat = (a: { kind: string }) => (a.kind.startsWith("advise_repair") ? "works" : a.kind === "advise_wait" || a.kind === "advise_levy" || a.kind === "advise_relief" ? "other" : "defence");
  const groupOf = (a: { kind: string; target?: string }) => a.kind === "advise_recall" || a.kind === "advise_stay" ? "query" : `${fortOf(a) ?? ""}:${cat(a)}`;
  const mainGroup = groupOf(res.selected);
  const extras: typeof res.candidates = [];
  // a captain's question (go home and refill, or stay): every adviser answers it
  const asked = sit.captains.some((x) => per.get(x.id, "captain.query"));
  if (asked && mainGroup !== "query") {
    const best = res.candidates.filter((x) => groupOf(x.action) === "query").sort((x, y) => y.score - x.score)[0];
    if (best) extras.push(best);
  }
  for (const f of sit.forts) {
    const needs = [
      ...(f.sites.some((x) => ((per.get(x, "threat.intensity")?.value as number) ?? 0) > 0) ? [`${f.id}:defence`] : []),
      ...((((per.get(f.id, "fortification.condition")?.value as number) ?? 100000) < 70000) ? [`${f.id}:works`] : []),
    ];
    for (const g of needs) {
      if (g === mainGroup) continue;
      const best = res.candidates.filter((x) => groupOf(x.action) === g).sort((x, y) => y.score - x.score)[0];
      if (best && (res.selected.kind !== "advise_wait" || best.score >= res.score)) extras.push(best); // one who says wait says only that
    }
  }
  const speak = (selected: typeof res.selected, tag: string) => {
    const d = ctx.emit("DecisionMade", [cause], [chr(agent), chr(c.scenario.ruler)], { trace: traceOf(sit, per, { ...res, selected }, cause, "strategic", "advise"), score: res.score, idle: true, ...(tag ? { also: tag } : {}) });
    const sel = res.candidates.find((x) => actionKey(x.action) === actionKey(selected))!;
    const rec: Recommendation = {
      id: d.id, author: agent, question: "what_would_you_do", plan: { kind: "plan", id: actionKey(selected) },
      reasons: [...sel.contributions].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || (a.textKey < b.textKey ? -1 : 1)) as Reason[],
      uncertainties: per.consulted().filter((b) => b.band === "uncertain" || b.band === "doubtful").map((b) => ({ belief: { kind: "belief", id: String(b.propId) }, why: `band:${b.band}` })),
      alternatives: res.candidates.filter((x) => x !== sel).slice(0, 2).map((x) => ({ kind: "plan", id: actionKey(x.action) })),
      contingencies: [], basedOnBeliefs: per.consulted().map((b) => ({ kind: "belief", id: String(b.propId) })), computedAt: ctx.tick,
    };
    const problems = validateRecommendation(rec);
    if (problems.length) throw new Error(`invalid recommendation: ${problems.join("; ")}`);
    const audience = present(ctx.s, (ctx.s.positions[agent] as { at: string }).at).filter((x) => x !== agent);
    const made = ctx.emit("RecommendationMade", [d.id], [chr(agent), chr(c.scenario.ruler)], { recommendation: rec, audience });
    if (audience.includes(c.scenario.ruler)) ctx.at(ctx.tick, "player:decide", { cause: made.id, reason: "advice" });
  };
  speak(res.selected, "");
  for (const x of extras.slice(0, 3)) speak(x.action, "extra");
  // what timber and men could do, said last and only when it pays: it never takes the place of any advice above
  const waits = (res.candidates.find((x) => x.action.kind === "advise_wait") ?? score(sit, per, { kind: "advise_wait" })).score; // advice is worth giving if it beats saying nothing
  const eco = generateEconomy(sit, per).map((a) => score(sit, per, a)).filter((x) => x.score > waits).sort(byScore).slice(0, 2);
  for (const x of eco) { res.candidates.push(x); speak(x.action, "economy"); }
}

/** Regency (adopted decision 3): with the ruler away, the regent acts on her own advice within delegated authority and
 *  writes to the ruler; reserved matters she puts to the ruler by letter instead. */
function regency(ctx: Ctx, agent: string, cause: number) {
  const c = ctx.content, rg = c.scenario.regency, ruler = c.scenario.ruler;
  const view = buildView(ctx.s, c, agent, ctx.tick), per = perceiverFromView(view);
  const sit = buildSituation(ctx.s, c, agent, ctx.tick, "advise", view);
  const res = plan(sit, per);
  if (!res || res.selected.kind === "advise_wait") return;
  const a = res.selected;
  const recent = (ctx.s.issued[agent] ?? []).some((r) => r.target === a.target && ctx.tick - r.tick < 20 * DAY);
  const cond = a.target ? (per.get(a.target, "fortification.condition")?.value as number | undefined) : undefined;
  const cost = a.kind === "advise_repair" && cond !== undefined ? Math.max(0, c.scenario.player.repairRestoreToMilli - cond) * c.scenario.player.repairCostMilliPerMilli : 0;
  const within = (a.kind === "advise_repair" && cost <= rg.maxRepairCostMilli) || (a.kind === "advise_levy" && rg.mayLevy) || ((a.kind === "advise_send_captain" || a.kind === "advise_retake") && rg.maySendCaptain);
  const d = ctx.emit("DecisionMade", [cause], [chr(agent), chr(ruler)], {
    trace: { ...traceOf(sit, per, res, cause, "strategic", "regency") }, score: res.score, idle: true, authority: within ? "within" : "reserved", recent });
  if (recent) return;
  const fort = a.target && ctx.s.fortifications[a.target] ? a.target : null;
  const claims = fort ? claimsFor(ctx, agent, fort) : [];
  if (within && a.kind === "advise_repair") {
    const to = sorted(c.characters.filter((x) => x.location === a.target && x.reportsTo === ruler), (x) => x.id)[0]?.id;
    if (!to) return;
    ctx.at(ctx.tick, "orders:regentOrder", { regent: agent, recipient: to, intent: "repair", objective: loc(a.target!), cause: d.id, claims });
  } else if (claims.length) {
    ctx.at(ctx.tick, "messenger:compose", { author: agent, recipient: ruler, claims, cause: d.id, purpose: `regency:${a.kind}${a.target ? ":" + a.target : ""}` });
  }
}

// ---- execution through people and physical systems -------------------------------------------------------------------
function claimsFor(ctx: Ctx, agent: string, fort: string) {
  const out = [];
  const b = best(ctx, agent, fort, "fortification.condition");
  if (b) out.push(b);
  for (const site of ctx.content.scenario.threat.sites.filter((x) => x.target === fort).map((x) => x.site).sort()) {
    const t = best(ctx, agent, site, "threat.intensity");
    if (t) out.push(t);
  }
  return out.map(({ band, ...p }) => ({ ...p, reliabilityBand: band as Band }));
}

export function execute(ctx: Ctx, agent: string, a: ActionRef, decisionId: number) {
  const c = ctx.content, ch = c.byId.character.get(agent)!;
  switch (a.kind) {
    case "hold": return;
    case "request_repair":
      if (!ch.reportsTo) return;
      ctx.at(ctx.tick, "messenger:compose", { author: agent, recipient: ch.reportsTo, claims: claimsFor(ctx, agent, ch.location), cause: decisionId, purpose: "request_repair" });
      ctx.at(ctx.tick + c.scenario.agents.requestAssessDays * DAY, "agents:assess", { agent, of: ch.reportsTo, fort: ch.location, kind: "repair", sentAt: ctx.tick, decisionEventId: decisionId });
      return;
    case "request_reinforcement": {
      const cap = c.byId.character.get(a.target!)!;
      const req = { id: 0, subject: loc(ch.location), predicate: "request.reinforce", believedValue: cap.troops ?? 0,
        evidenceRefs: [{ kind: "observation" as const, eventId: decisionId, source: agent }], observedOrLearnedAt: ctx.tick, observedAt: ctx.tick, learnedAt: ctx.tick, reliabilityBand: "certain" as const };
      ctx.at(ctx.tick, "messenger:compose", { author: agent, recipient: a.target!, claims: [...claimsFor(ctx, agent, ch.location), req], cause: decisionId, purpose: "request_reinforcement" });
      ctx.at(ctx.tick + c.scenario.agents.requestAssessDays * DAY, "agents:assess", { agent, of: a.target, fort: ch.location, kind: "reinforce", sentAt: ctx.tick, decisionEventId: decisionId });
      return;
    }
    case "sortie": {
      const pos = ctx.s.positions[agent];
      if (!("at" in pos) || ctx.s.sortieOpen[agent] !== undefined) return; // one fight at a time
      const men = defenceAt(ctx.s, pos.at) ?? 0;
      const ev = ctx.emit("SortieLaunched", [decisionId], [chr(agent), loc(pos.at), loc(a.target!)], { commander: agent, from: pos.at, site: a.target, men, decisionEventId: decisionId });
      ctx.at(ctx.tick + c.scenario.battle.sortie.hours * HOUR, "agents:resolveSortie", { commander: agent, from: pos.at, site: a.target, launchedEventId: ev.id });
      return;
    }
    case "march_to": travel(ctx, agent, a.target!, "army", false, decisionId); return;
    case "return_to_post": travel(ctx, agent, ch.location, "army", false, decisionId); return;
    case "send_detachment": {
      const men = Math.floor((ctx.s.troops[agent] ?? 0) / 2);
      const pos = ctx.s.positions[agent];
      if (!men || !("at" in pos)) return;
      const ev = ctx.emit("DetachmentSent", [decisionId], [chr(agent), loc(a.target!)], { commander: agent, from: pos.at, to: a.target, men });
      const path = ctx.map.path(pos.at, a.target!, "army", (r) => ctx.isOpen(r));
      ctx.at(ctx.tick + (path?.ticks ?? DAY), "agents:detachmentArrive", { commander: agent, to: a.target, men, sentEventId: ev.id });
      return;
    }
    default: return; // order-specific actions (repairs, levies) are executed by the order pipeline
  }
}

/** What a commander tells his superior after a fight: how it went, what the fort and his company now count, and what he sees of the raiders. */
export function battleClaims(ctx: Ctx, who: string, from: string, site: string, cause: number) {
  observe(ctx, who, loc(from), "fortification.garrison", cause);
  if ((ctx.s.troops[who] ?? 0) > 0) observe(ctx, who, chr(who), "character.troops", cause);
  // a captain away from home with his company below strength asks whether to go home and refill it or stay and help the fort
  const ch = ctx.content.byId.character.get(who);
  const at = ctx.s.positions[who];
  if (ch?.troops && ch.location !== from && (ctx.s.troops[who] ?? 0) < ch.troops && ctx.s.fortifications[from] && "at" in at && at.at === from)
    learn(ctx, who, { subject: chr(who), predicate: "captain.query", value: from, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: cause, source: who }, [cause]);
  // word that the fort is lost is not told again by the captain; and a fort the raiders hold has no garrison to count
  const holder = best(ctx, who, site, "fortification.holder"), lost = holder?.believedValue === "raiders";
  return [best(ctx, who, who, "captain.query"), best(ctx, who, who, "captain.heading"), best(ctx, who, site, "battle.result"), best(ctx, who, who, "battle.ownLosses"), best(ctx, who, site, "battle.enemyLosses"), lost ? null : holder, lost ? null : best(ctx, who, from, "fortification.garrison"), best(ctx, who, who, "character.troops"), best(ctx, who, site, "threat.intensity")]
    .filter((x): x is NonNullable<typeof x> => !!x).map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as "certain" }));
}

/** The end of a sortie, rolled or fought (D-060): the outcome event, losses, the raiders ended if beaten, experience, what
 *  those present now know, and the letters home. A fought battle also sends each commander's debrief to his superior. */
export function concludeSortie(ctx: Ctx, o: { commander: string; from: string; site: string; launchedEventId: number; cause: number; found: boolean; success: boolean; pPermille: number;
  men: number; ambushed: boolean; enemy: number; garrisonLost: number; garrisonKinds?: { archers: number; horse: number }; troopsLost: Record<string, number>; battleId?: number; debriefs?: string[] }) {
  const { commander, from, site } = o;
  const res = ctx.emit("SortieResolved", [o.cause], [chr(commander), loc(site)], { commander, site, from, found: o.found, success: o.success, pPermille: o.pPermille, men: o.men, ambushed: o.ambushed, enemy: o.enemy, ...(o.battleId !== undefined ? { battleId: o.battleId } : {}) });
  if (o.found) {
    if (o.garrisonLost || Object.keys(o.troopsLost).length) ctx.emit("LossesTaken", [res.id], [loc(from)], { location: from, garrisonLost: o.garrisonLost, ...(o.garrisonKinds && o.garrisonLost ? { garrisonKinds: o.garrisonKinds } : {}), troopsLost: o.troopsLost, cause: o.battleId !== undefined ? "battle" : "sortie" });
    if (o.success && ctx.s.threats[site]) ctx.emit("ThreatEnded", [res.id], [loc(site)], { site, endedBy: o.battleId !== undefined ? "battle" : "sortie" });
  }
  const exp = ctx.content.scenario.agents.experience;
  if (ctx.s.agents[commander]) ctx.emit("ExperienceGained", [res.id], [chr(commander)], { agent: commander, domain: "military", amount: exp.perTaskPermille, cap: exp.capPermille });
  for (const who of present(ctx.s, from).filter((x) => ctx.s.tiers[x] !== "C")) {
    if (!o.found || o.success) learn(ctx, who, { subject: loc(site), predicate: "threat.intensity", value: 0, observedAt: ctx.tick, band: "certain" },
      { kind: "observation", eventId: res.id, source: who }, [res.id]);
    else observe(ctx, who, loc(site), "threat.intensity", res.id);
  }
  // what happened, as the commander knows it (a battle's commanders already hold their own account), and a letter to his superior
  if (o.battleId === undefined) learn(ctx, commander, { subject: loc(site), predicate: "battle.result", value: !o.found ? "nobody" : o.success ? "won" : "lost", observedAt: ctx.tick, band: "certain" },
    { kind: "observation", eventId: res.id, source: commander }, [res.id]);
  const superior = ctx.content.byId.character.get(commander)?.reportsTo;
  const ordered = (ctx.s.ordersInForce[commander] ?? []).some((id) => { const x = ctx.s.orders[String(id)]; return x.status === "executing" && x.order.intent === "attack" && x.order.objective.id === site; });
  if (superior && !ordered) ctx.at(ctx.tick, "messenger:compose", { author: commander, recipient: superior, claims: battleClaims(ctx, commander, from, site, res.id), cause: res.id, purpose: `battle:${site}` });
  // the other commanders' debriefs: each writes to his own superior what he believes happened (§22)
  for (const who of (o.debriefs ?? []).filter((x) => x !== commander)) {
    const up = ctx.content.byId.character.get(who)?.reportsTo;
    if (!up) continue;
    const claims = [best(ctx, who, site, "battle.result"), best(ctx, who, who, "battle.ownLosses"), best(ctx, who, site, "battle.enemyLosses")]
      .filter((x): x is NonNullable<typeof x> => !!x).map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as "certain" }));
    if (claims.length) ctx.at(ctx.tick, "messenger:compose", { author: who, recipient: up, claims, cause: res.id, purpose: `debrief:${o.battleId}` });
  }
  ctx.at(ctx.tick, "orders:sortieDone", { commander, site, resolvedEventId: res.id });
}

function present(s: Readonly<WorldState>, where: string) {
  return sorted(Object.entries(s.positions).filter(([, p]) => "at" in p && p.at === where).map(([id]) => id), (x) => x);
}

export const agents: System = {
  id: "agents",
  start: (ctx) => {
    for (const id of Object.keys(ctx.s.agents).sort()) if (isAgent(ctx, id)) rebuild(ctx, id);
    ctx.at(DAY + 23 * HOUR, "agents:tiers", {});
  },
  onEvent: (ctx, e: SimEvent) => {
    if (e.type === "BeliefUpdated" && e.payload.material) {
      const holder = e.payload.holder as string, prop = e.payload.prop as { subject: { id: string }; predicate: string };
      if (!isAgent(ctx, holder)) return;
      const preds = rt(ctx).index.get(prop.subject.id)?.get(holder);
      if (preds && (preds.has(prop.predicate) || preds.has("*")))
        queueWake(ctx, holder, e.id, ctx.content.byId.predicate.get(prop.predicate)!.wakeSignificance);
    } else if (e.type === "DecisionMade" || e.type === "OrderReceived" || e.type === "OrderCompleted" || e.type === "OrderSuperseded" || e.type === "OrderAbandoned") {
      const who = (e.type === "DecisionMade" ? (e.payload.trace as DecisionTrace).agent : (e.payload.recipient as string)) ?? null;
      if (who && isAgent(ctx, who)) rebuild(ctx, who);
    } else if (e.type === "Arrived") {
      ctx.at(ctx.tick, "orders:arrived", { who: e.payload.who, at: e.payload.at, arrivedEventId: e.id });
      if (e.payload.who === ctx.content.scenario.ruler) ctx.at(ctx.tick, "player:decide", { cause: e.id, reason: "arrival" });
    } else if (e.type === "ReportDelivered") {
      ctx.at(ctx.tick, "orders:reportArrived", { reportId: e.payload.reportId, recipient: e.payload.recipient, deliveredEventId: e.id });
    }
    // Relevance: background people caught up in a significant military event where they stand become locally relevant.
    const where = e.type === "RaidDamage" || e.type === "LossesTaken" ? (e.payload.location as string) : e.type === "SortieResolved" ? (e.payload.from as string) : null;
    if (where) for (const [who, p] of Object.entries(ctx.s.positions))
      if (ctx.s.tiers[who] === "C" && "at" in p && p.at === where) ctx.at(ctx.tick, "agents:implicate", { who, cause: e.id, why: e.type });
  },
  handlers: {
    "agents:wake": (ctx, { agent }) => {
      const r = rt(ctx), p = r.pending.get(agent);
      if (!p || p.tick !== ctx.tick) return;
      r.pending.delete(agent);
      const layer = p.sig >= 3 ? "strategic" : "operational";
      const w = ctx.emit("AgentWoke", p.triggers, [chr(agent)], { agent, triggers: p.triggers, layer, reason: "triggers", tier: ctx.s.tiers[agent] });
      think(ctx, agent, w.id, layer, "triggers");
    },
    "agents:advise": (ctx, { agent, cause }) => {
      // marks today's advice as given, so nothing scheduled while it is worked out re-triggers it
      ctx.emit("AdviceSettled", [cause], [chr(agent)], { agent, day: Math.floor(ctx.tick / DAY) });
      const pos = ctx.s.positions[agent], rp = ctx.s.positions[ctx.content.scenario.ruler];
      // advice is only given while the adviser is with the ruler
      if ("at" in pos && "at" in rp && pos.at === rp.at) adviseNow(ctx, agent, cause);
    },
    "agents:review": (ctx, { agent, decisionEventId }) => {
      if (ctx.s.agents[agent]?.operational?.decisionEventId !== decisionEventId) return; // the intention has changed since
      const r = rt(ctx), p = r.pending.get(agent);
      const triggers = p && p.tick === ctx.tick ? p.triggers : [];
      if (p && p.tick === ctx.tick) r.pending.delete(agent);
      const w = ctx.emit("AgentWoke", [decisionEventId, ...triggers], [chr(agent)], { agent, triggers, layer: "operational", reason: "review", tier: ctx.s.tiers[agent] });
      think(ctx, agent, w.id, "operational", triggers.length ? "triggers" : "review");
      if (ctx.s.agents[agent]?.operational?.decisionEventId === decisionEventId)
        ctx.at(ctx.tick + ctx.content.scenario.agents.reviewDays.operational * DAY, "agents:review", { agent, decisionEventId });
    },
    "agents:resolveSortie": (ctx, { commander, from, site, launchedEventId }) => {
      const sp = ctx.content.scenario.battle.sortie;
      const threat = ctx.s.threats[site];
      const men = defenceAt(ctx.s, from) ?? 0;
      const skill = capability(ctx.s, ctx.content, commander, "military");
      const r = ctx.keyed(`battle:sortie:${launchedEventId}`);
      // going after raiders in their own ground can meet a second band: the fight is then against a larger force
      const ambushed = !!threat && r.int(0, 999) < Math.floor((threat.intensityPermille * sp.ambushPermilleAtFull) / 1000);
      const enemy = threat ? Math.floor((raiderMen(ctx.content.scenario.battle, threat.intensityPermille) * (ambushed ? sp.ambushFactorPermille : 1000)) / 1000) : 0;
      // Phase 8 (D-060): with a battlefield in content, meeting raiders who are there is a battle, not a roll
      if (threat && enemy > 0 && ctx.content.scenario.battle.field) { beginBattle(ctx, { commander, from, site, launchedEventId, enemy, ambushed, men }); return; }
      const S = Math.floor((men * (sp.skillBasePermille + skill)) / 1000), I = threat ? Math.floor((Math.floor((threat.intensityPermille * sp.intensityFactorPermille) / 1000) * (ambushed ? sp.ambushFactorPermille : 1000)) / 1000) : 0;
      const p = threat ? Math.floor((1000 * S) / Math.max(1, S + I)) : 1000;
      const success = threat ? r.int(0, 999) < p : false;
      const troopsLost: Record<string, number> = {};
      let garrisonLost = 0;
      if (threat) {
        const lost = battleLoss(ctx.content.scenario.battle, men, enemy, success);
        let left = lost;
        for (const who of present(ctx.s, from)) {
          const t = ctx.s.troops[who] ?? 0;
          if (!t) continue;
          const n = Math.min(t, Math.floor((lost * t) / Math.max(1, men)));
          if (n) { troopsLost[who] = n; left -= n; }
        }
        garrisonLost = Math.min(ctx.s.fortifications[from]?.garrison ?? 0, left);
      }
      concludeSortie(ctx, { commander, from, site, launchedEventId, cause: launchedEventId, found: !!threat, success, pPermille: p, men, ambushed, enemy, garrisonLost, troopsLost });
    },
    // Was a request answered? The asker sees it for themselves: work started on the wall, or the help arrived.
    "agents:assess": (ctx, { agent, of, fort, kind, sentAt, decisionEventId }) => {
      const answered = kind === "repair" ? (ctx.s.lastRepairStart[fort] ?? -1) >= sentAt : (ctx.s.lastArrival[fort]?.[of] ?? -1) >= sentAt;
      const st = ctx.s.agents[agent], ch = ctx.content.byId.character.get(agent)!;
      const prior = st.answerRate[of] ?? ch.relationships.find((r) => r.to === of && r.kind === "trust")?.value ?? ch.relationships.find((r) => r.to === of)?.value ?? 500;
      const k = ctx.content.scenario.agents.answerLearningPermille;
      const rate = Math.floor((prior * (1000 - k) + (answered ? 1000 : 0) * k) / 1000);
      ctx.emit("ResponseAssessed", [decisionEventId], [chr(agent), chr(of), loc(fort)], { agent, of, fort, kind, answered, rate });
    },
    "agents:implicate": (ctx, { who, cause, why }) => { promote(ctx, who, "B", `implicated: ${why}`, cause); },
    // Demotion (ARCHITECTURE §20.9): the role has ended and nothing has stirred them for a while. One step at a time.
    "agents:tiers": (ctx) => {
      const quiet = ctx.content.scenario.agents.demoteAfterDays * DAY;
      for (const id of Object.keys(ctx.s.tiers).sort()) {
        const tier = ctx.s.tiers[id], base = ctx.content.byId.character.get(id)!.tier, a = ctx.s.agents[id];
        if (!a || RANK[tier] <= RANK[base]) continue;
        const busy = (ctx.s.ordersInForce[id] ?? []).length > 0 || !("at" in ctx.s.positions[id]) || (a.operational && !a.operational.idle);
        if (busy || ctx.tick - a.lastActive < quiet) continue;
        const to = tier === "A" ? "B" : "C";
        ctx.emit("CharacterDemoted", [], [chr(id)], { who: id, from: tier, to, reason: `role ended; quiet for ${ctx.content.scenario.agents.demoteAfterDays} days` });
        rebuild(ctx, id);
      }
      ctx.at(ctx.tick + DAY, "agents:tiers", {});
    },
    "agents:detachmentArrive": (ctx, { commander, to, men, sentEventId }) => {
      const ev = ctx.emit("DetachmentArrived", [sentEventId], [chr(commander), loc(to)], { commander, to, men });
      ctx.at(ctx.tick, "orders:detachmentArrived", { commander, to, arrivedEventId: ev.id });
    },
  },
};

