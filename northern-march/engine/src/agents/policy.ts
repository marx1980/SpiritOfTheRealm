// Phase 9 (docs/POLICY.md, D-070): how a standing policy and the precedents an official knows enter his weighing. Pure
// functions of the Situation: a policy counts only where no order in force covers the situation; it is judged against
// the official's own estimate of the odds; precedents are past sorties against the same raiders at similar odds.
import type { Reason } from "../schemas.ts";
import type { ActionRef, Situation } from "./model.ts";
import { DAY } from "./model.ts";

const R = (kind: Reason["kind"], refKind: string, id: string, weight: number, textKey: string): Reason => ({ kind, ref: { kind: refKind, id }, weight, textKey });

export function policyReasons(sit: Situation, a: ActionRef, oddsPermille: number): Reason[] {
  const pp = sit.policy, mil = sit.policies?.military;
  if (!pp || !mil || a.kind !== "sortie" || sit.ordersInForce.length) return [];
  const w = Math.floor((pp.policyMilli * sit.loyalty(sit.ruler)) / 1000), id = `military:${mil.rule}`;
  switch (mil.rule) {
    case "hold_walls": return [R("order", "policy", id, -w, "reason.policy_against")];
    case "cautious": return [oddsPermille >= pp.cautiousOddsPermille ? R("order", "policy", id, Math.floor(w / 2), "reason.policy_for") : R("order", "policy", id, -w, "reason.policy_against")];
    case "bold": return [oddsPermille >= pp.boldOddsPermille ? R("order", "policy", id, w, "reason.policy_for") : R("order", "policy", id, 0, "reason.policy_against")];
    default: return [];
  }
}

export function precedentReasons(sit: Situation, a: ActionRef, oddsPermille: number): Reason[] {
  const pp = sit.policy;
  if (!pp || a.kind !== "sortie" || !sit.precedents?.length) return [];
  const near = sit.precedents.filter((p) => p.kind === "sortie" && p.site === a.target && p.tick < sit.now && Math.abs((p.oddsPermille ?? 0) - oddsPermille) <= pp.precedent.oddsWindowPermille)
    .sort((x, y) => y.tick - x.tick).slice(0, pp.precedent.max);
  const out: Reason[] = [];
  for (const p of near) {
    const halves = Math.floor((sit.now - p.tick) / (pp.precedent.halfLifeDays * DAY));
    const w = halves >= 16 ? 0 : Math.floor(pp.precedent.milli / 2 ** halves);
    if (w) out.push(R("precedent", "event", String(p.id), p.outcome === "won" ? w : -w, p.outcome === "won" ? "reason.precedent_won" : "reason.precedent_lost"));
  }
  return out;
}
