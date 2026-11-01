// Planner (ARCHITECTURE §20.5-20.6): generate a few contextual candidates, score them from beliefs through objectives,
// traits, relationships, orders and resources, select deterministically, keep the current intention unless beaten by
// a commitment margin. Pure: the same Situation and beliefs always give the same decision.
import type { Reason } from "../schemas.ts";
import type { ActionRef, Candidate, Perceiver, Situation } from "./model.ts";
import { act, actionKey, avgTrait, dominantTrait } from "./model.ts";
import { expect, picture } from "./terms.ts";

/** How many candidates the agent can think of: better planners consider more (capped). */
export function candidateCap(sit: Situation, domain = "military") {
  const pl = sit.p.agents.planning;
  if (sit.tier === "B") return pl.minCandidates; // locally relevant people plan lightly
  return Math.max(pl.minCandidates, Math.min(pl.maxCandidates, pl.minCandidates + Math.floor((sit.cap[domain] ?? 0) / pl.skillPerExtraCandidate)));
}

const threatened = (sit: Situation, per: Perceiver) => sit.forts.filter((f) => picture(sit, per, f.id).intensity > 0).map((f) => f.id);
const worn = (sit: Situation, per: Perceiver) => sit.forts.filter((f) => { const c = picture(sit, per, f.id).cond; return c !== null && c < sit.p.agents.values.goodConditionMilli; }).map((f) => f.id);
const requested = (sit: Situation, per: Perceiver) => sit.forts.filter((f) => per.get(f.id, "request.reinforce")).map((f) => f.id);

/** Candidate templates, in order of how obvious they are; a weaker planner stops earlier. */
export function generate(sit: Situation, per: Perceiver): ActionRef[] {
  const out: ActionRef[] = [];
  const add = (a: ActionRef) => { if (!out.some((x) => actionKey(x) === actionKey(a))) out.push(a); };
  if (sit.mode === "advise") {
    add(act("advise_wait"));
    // Money first when it cannot cover the repairs the adviser believes are needed (a repair without funds is abandoned).
    const tre = per.get(sit.ruler, "treasury.balance"), w = worn(sit, per);
    const need = w.reduce((n, f) => n + Math.max(0, sit.p.restoreToMilli - (picture(sit, per, f).cond ?? 0)) * sit.p.repairCostPerMilli, 0);
    if (tre && ((tre.value as number) < sit.p.levyMilli || (tre.value as number) < need)) add(act("advise_levy"));
    for (const f of w) add(act("advise_repair", f));
    if (sit.captains.length) for (const f of threatened(sit, per)) add(act("advise_send_captain", f));
    if (sit.captains.length) for (const f of threatened(sit, per)) for (const s of sit.forts.find((x) => x.id === f)!.sites)
      if (((per.get(s, "threat.intensity")?.value as number) ?? 0) > 0) add(act("advise_sortie", s));
    return out.slice(0, candidateCap(sit));
  }
  const fortsHere = sit.at ? sit.forts.find((f) => f.id === sit.at) : undefined;
  if (sit.role === "castellan") {
    if (sit.at !== sit.post) { add(act("return_to_post")); add(act("hold")); }
    else {
      add(act("hold"));
      const p = picture(sit, per, sit.post);
      if (sit.superior && p.cond !== null && p.cond < sit.p.agents.values.goodConditionMilli) add(act("request_repair", sit.post));
      if (p.intensity > 0) for (const c of sit.captains) if (c.id !== sit.agent) add(act("request_reinforcement", c.id));
      if (p.intensity > 0 && (sit.defenceHere ?? 0) > 0) for (const s of p.sites) if (((per.get(s, "threat.intensity")?.value as number) ?? 0) > 0) add(act("sortie", s));
    }
  } else if (sit.role === "captain") {
    add(act("hold"));
    if (sit.at !== sit.post) add(act("return_to_post"));
    for (const f of [...requested(sit, per), ...threatened(sit, per)]) if (f !== sit.at) add(act("march_to", f));
    if (fortsHere && (sit.defenceHere ?? 0) > 0) for (const s of fortsHere.sites) if (((per.get(s, "threat.intensity")?.value as number) ?? 0) > 0) add(act("sortie", s));
  }
  return out.slice(0, candidateCap(sit));
}

const R = (kind: Reason["kind"], id: string, weight: number, textKey: string, refKind = kind): Reason => ({ kind, ref: { kind: refKind, id }, weight, textKey });

/** Score = sum of contributions; each contribution is a Reason (kind, what it refers to, weight, text key). */
export function score(sit: Situation, per: Perceiver, a: ActionRef): Candidate {
  const e = expect(sit, per, a);
  const v = sit.p.agents.values;
  const c: Reason[] = [];
  const pr = (p: number, x: number) => Math.floor((x * p) / 1000);
  const fortValue = (fort: string) => {
    const pic = picture(sit, per, fort);
    const net = (e.restore[fort] ?? 0) - e.loss[fort];
    const breach = pic.cond !== null && pic.cond + net < sit.p.breachMilli ? -v.breachPenaltyMilli : 0;
    return net + breach;
  };
  for (const o of sit.objectives) {
    const boost = sit.focus === o.id ? 1250 : 1000;
    const P = Math.floor((o.priorityPermille * boost) / 1000);
    let x = 0;
    switch (o.objective) {
      case "hold_fortification": case "hold_post":
        if (o.objective === "hold_post" && e.leavesPost) x -= v.postMilli;
        if (sit.forts.some((f) => f.id === o.target)) x += o.objective === "hold_fortification" ? fortValue(o.target!) : 0;
        break;
      case "protect_realm": case "crown_standing": for (const f of sit.forts) if (picture(sit, per, f.id).cond !== null) x += fortValue(f.id); break;
      case "sound_works": for (const f of sit.forts) x += (e.restore[f.id] ?? 0); break;
      case "preserve_forces": x -= e.menLost * v.manMilli; break;
      case "win_renown": x += Math.floor((e.renownPermille * v.renownMilli) / 1000); break;
      case "preserve_treasury": {
        const t = per.get(sit.ruler, "treasury.balance");
        const low = t && (t.value as number) < (o.reserveMilli ?? 0) ? 2 : 1;
        x += low * (e.gainMilli - e.costMilli);
        break;
      }
      case "house_standing":
        if (sit.house !== "crown" && (a.kind === "request_repair" || a.kind === "request_reinforcement")) x -= 1500; // asking the crown for help costs standing
        break;
      default: break; // protect_community: no effect on these actions yet
    }
    if (x) c.push(R("objective", o.id, pr(P, x), `reason.${o.objective}`));
  }
  // traits: appetite for risk weighs the chance of failure
  if (e.successP < 1000 || e.leavesPost) {
    const appetite = avgTrait(sit.traits, "riskPermille");
    const fail = 1000 - e.successP + (e.leavesPost ? 200 : 0);
    const w = -Math.floor((fail * 10000 * (1000 - appetite)) / (1000 * 500));
    c.push(R("trait", dominantTrait(sit.traits, "riskPermille"), w, w < 0 ? "reason.risk_averse" : "reason.risk"));
  }
  if (a.kind === "sortie" || a.kind === "advise_sortie") c.push(R("capability", "military", Math.floor(((sit.cap.military ?? 0) - 500) * 4), "reason.own_skill"));
  // relationships
  if (e.helps) c.push(R("relationship", e.helps, Math.floor((2000 * sit.trust(e.helps)) / 1000), "reason.trusts"));
  if (a.kind === "march_to") {
    const req = per.get(a.target!, "request.reinforce");
    if (req) c.push(R("belief", String(req.propId), 3000, "reason.asked_for_help"));
  }
  // orders in force
  for (const o of sit.ordersInForce) {
    const duty = Math.floor((sit.p.agents.obedience.dutyMilli * sit.loyalty(o.issuer)) / 1000);
    const at = o.objective.id;
    const consistent = (o.intent === "hold" && (a.kind === "hold" ? (sit.at === at) : a.kind === "march_to" ? a.target === at : false)) ||
      (o.intent === "advance" && ((a.kind === "march_to" && a.target === at) || (a.kind === "hold" && sit.at === at)));
    const contrary = (o.intent === "hold" && (a.kind === "march_to" || a.kind === "return_to_post") && a.target !== at && sit.at === at) ||
      (o.intent === "advance" && sit.at === at && (a.kind === "return_to_post" || (a.kind === "march_to" && a.target !== at)));
    if (consistent) c.push(R("order", String(o.id), duty, "reason.as_ordered"));
    if (contrary) c.push(R("order", String(o.id), -duty, "reason.against_orders"));
  }
  if (e.costMilli && !c.some((r) => r.ref.id.startsWith("preserve_treasury"))) c.push(R("resource", "treasury", -Math.floor(e.costMilli / 4), "reason.cost"));
  const total = c.reduce((s, r) => s + r.weight, 0);
  return { action: a, score: total, contributions: c };
}

/** Commitment and hysteresis: a challenger replaces the current intention only if it beats it by the margin. */
export function keepOrSwitch(o: { current: number; best: number; commitmentPermille: number; baseMarginPermille: number; absFloorMilli: number }) {
  const margin = Math.max(o.absFloorMilli, Math.floor((Math.abs(o.current) * o.baseMarginPermille * o.commitmentPermille) / (500 * 1000)));
  return { keep: o.best - o.current <= margin, margin };
}

export const byScore = (a: Candidate, b: Candidate) => b.score - a.score || (actionKey(a.action) < actionKey(b.action) ? -1 : actionKey(a.action) > actionKey(b.action) ? 1 : 0);

export interface PlanResult { candidates: Candidate[]; selected: ActionRef; kept: boolean; margin: number | null; score: number }

/** Is a (current) intention still possible at all? Viability, not attractiveness (ARCHITECTURE §20.5). */
export function feasible(sit: Situation, per: Perceiver, a: ActionRef): boolean {
  switch (a.kind) {
    case "march_to": case "send_detachment": return sit.at !== a.target && sit.troops > 0;
    case "return_to_post": return sit.at !== sit.post;
    case "sortie": return sit.at !== null && (sit.defenceHere ?? 0) > 0 && ((per.get(a.target!, "threat.intensity")?.value as number) ?? 0) > 0;
    case "request_repair": return !!sit.superior && sit.at === sit.post;
    case "request_reinforcement": return sit.at === sit.post && sit.captains.some((c) => c.id === a.target);
    case "hold": return true;
    case "investigate": return sit.at !== a.target;
    case "delegate_investigation": return sit.leaderCandidates.length > 0;
    default: return false;
  }
}

export function plan(sit: Situation, per: Perceiver, extra: ActionRef[] = []): PlanResult | null {
  const actions = [...generate(sit, per)];
  // the current intention stays on the table while it is still feasible, even if it would not be proposed afresh:
  // otherwise a threshold in candidate generation becomes a way to dither
  if (sit.mode === "act" && sit.current && !sit.current.idle && feasible(sit, per, sit.current.action)) extra = [...extra, sit.current.action];
  for (const a of extra) if (!actions.some((x) => actionKey(x) === actionKey(a))) actions.push(a);
  if (!actions.length) return null;
  const cands = actions.map((a) => score(sit, per, a)).sort(byScore);
  let selected = cands[0], kept = false, margin: number | null = null;
  const cur = sit.current && !sit.current.idle && sit.mode === "act" ? cands.find((c) => actionKey(c.action) === actionKey(sit.current!.action)) : undefined;
  if (cur && cur !== selected) {
    const k = keepOrSwitch({ current: cur.score, best: selected.score, commitmentPermille: avgTrait(sit.traits, "commitmentPermille"),
      baseMarginPermille: sit.p.agents.commitment.baseMarginPermille, absFloorMilli: sit.p.agents.commitment.absFloorMilli });
    margin = k.margin;
    if (k.keep) { selected = cur; kept = true; }
  } else if (cur) kept = true;
  return { candidates: cands, selected: selected.action, kept, margin, score: selected.score };
}

/** Strategic layer: which objective deserves attention now (largest perceived stake x priority). */
export function chooseFocus(sit: Situation, per: Perceiver): { candidates: Candidate[]; selected: ActionRef } | null {
  if (!sit.objectives.length) return null;
  const v = sit.p.agents.values;
  const cands: Candidate[] = sit.objectives.map((o) => {
    let stake = 0;
    if (o.target && sit.forts.some((f) => f.id === o.target)) {
      const p = picture(sit, per, o.target);
      stake = (p.cond !== null ? Math.max(0, v.goodConditionMilli - p.cond) : 0) + p.intensity * 20;
    } else if (o.objective === "protect_realm" || o.objective === "win_renown" || o.objective === "preserve_forces") {
      for (const f of sit.forts) stake = Math.max(stake, picture(sit, per, f.id).intensity * 20);
    } else if (o.objective === "preserve_treasury") {
      const t = per.get(sit.ruler, "treasury.balance");
      stake = t ? Math.max(0, (o.reserveMilli ?? 0) - (t.value as number)) : 0;
    } else if (o.objective === "sound_works") {
      for (const f of sit.forts) { const c = picture(sit, per, f.id).cond; if (c !== null) stake = Math.max(stake, v.goodConditionMilli - c); }
    }
    const w = Math.floor((Math.max(0, stake) * o.priorityPermille) / 1000);
    return { action: act("focus", o.id), score: w, contributions: [R("objective", o.id, w, `reason.focus.${o.objective}`)] };
  }).sort(byScore);
  return { candidates: cands, selected: cands[0].action };
}
