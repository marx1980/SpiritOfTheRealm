// Order interpretation and obedience (ARCHITECTURE §20.8). Receipt, comprehension, willingness and execution are
// separate steps. No random disobedience: the same state gives the same decision.
import type { StructuredOrder } from "../schemas.ts";
import type { ActionRef, Situation } from "./model.ts";
import { act, avgTrait } from "./model.ts";

/** Clarity from what the order states; comprehension = clarity x the recipient's skill in the order's domain. */
export function interpret(order: StructuredOrder, sit: Situation) {
  const clarity = Math.min(1000, 500 + 100 * Math.min(2, order.constraints.length) + 100 * Math.min(2, order.contingencies.length) + (order.discretion !== "bounded" ? 100 : 0));
  const domain = order.intent === "repair" ? "engineering" : order.intent === "levy" ? "administration" : "military";
  const comprehension = Math.floor((clarity * (500 + Math.floor((sit.cap[domain] ?? 0) / 2))) / 1000);
  const understood = understoodAction(order);
  return { clarity, comprehension, understood, domain, ambiguity: comprehension < 400 ? "read literally: nothing beyond the intent and objective was understood" : null };
}

/** The action that carries out an order as written. */
export function understoodAction(o: StructuredOrder): ActionRef {
  switch (o.intent) {
    case "repair": return act("repair_works", o.objective.id);
    case "levy": return act("levy");
    case "advance": return act("march_to", o.objective.id);
    default: return act("hold");
  }
}

/** Ways to carry out the order's purpose in part (adaptations). */
export function adaptations(o: StructuredOrder): ActionRef[] {
  switch (o.intent) {
    case "repair": return [act("partial_repair", o.objective.id)];
    case "levy": return [act("half_levy")];
    case "advance": return [act("send_detachment", o.objective.id)];
    default: return [];
  }
}

/** Margins: obedient temperament, loyalty to the issuer and the issuer's legitimacy all raise them;
 *  delegated discretion and changed circumstances lower the margin for adapting, not for refusing. */
export function margins(sit: Situation, o: StructuredOrder, changed: boolean) {
  const ob = sit.p.agents.obedience;
  const temperament = avgTrait(sit.traits, "obedienceWhenDisagreeingPermille");
  const legit = o.issuer === sit.ruler ? ob.legitimacyRulerPermille : 500;
  const bond = 200 + sit.loyalty(o.issuer);
  const f = (x: number) => Math.floor((((x * temperament) / 500) * bond * legit) / 1_000_000);
  const disc = o.discretion === "delegated" ? 500 : o.discretion === "strict" ? 1500 : 1000;
  return {
    adaptMargin: Math.floor((f(ob.adaptMarginMilli) * disc * (changed ? ob.changedCircumstancesPermille : 1000)) / 1_000_000),
    refuseMargin: f(ob.refuseMarginMilli),
  };
}

export function decideObedience(x: { obey: number; bestServing: number; bestOther: number; adaptMargin: number; refuseMargin: number }) {
  if (x.bestOther - x.obey > x.refuseMargin) return { decision: "refuse" as const, by: x.bestOther - x.obey };
  if (x.bestServing - x.obey > x.adaptMargin) return { decision: "adapt" as const, by: x.bestServing - x.obey };
  return { decision: "obey" as const, by: Math.max(x.bestOther, x.bestServing) - x.obey };
}
