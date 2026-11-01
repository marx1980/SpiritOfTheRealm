// Court (P0.06): prioritised issues, each with its evidence (age, source, certainty) and each adviser's advice shown
// separately. Built from the player's view only (A7).
import { beliefsAbout, type View } from "../view.ts";
import { dayOf, pct } from "./format.ts";
import { ago, certainty, nameOf, planWords, raiderWords, reasonWords, sourceOf, wallWords } from "./phrasing.ts";

export interface Evidence { text: string; age: string; source: string; certainty: string }
/** Short area labels for the council list. */
const SHORT_AREA: Record<string, string> = { Military: "Mil", Administration: "Adm", Works: "Con", Intelligence: "Int" };

export interface AdviceLine { id: number; adviser: string; area: string; plan: string; supports: string[]; concerns: string[]; unsure: number; heard: string; fresh: boolean }
export interface Issue { key: string; title: string; priority: number; evidence: Evidence[]; advice: AdviceLine[]; place?: string }
export interface Court { day: number; at: string; issues: Issue[]; advice: AdviceLine[]; letters: { from: string; about: string; written: string; arrived: string; route: number }[] }

/** Advice about one place (each adviser's standing advice on it), or, with no place, each adviser's latest advice. */
function adviceLines(v: View, target?: string): AdviceLine[] {
  const latest = new Map<string, number>();
  for (const r of v.advice) if (!latest.has(r.author) || v.advice.find((x) => x.id === latest.get(r.author))!.computedAt < r.computedAt) latest.set(r.author, r.id);
  // Advice about a place is set aside while an order you gave for that place is still in force.
  const superseded = (r: { plan: { id: string } }) => v.self.ordersInForce.some((o) => r.plan.id.includes(`"${o.objective.id}"`));
  return v.advice.filter((r) => (target ? r.plan.id.includes(`"${target}"`) : latest.get(r.author) === r.id) && !superseded(r)).map((r) => ({
    id: r.id, adviser: nameOf(v, r.author), area: SHORT_AREA[v.world.areas[r.author] ?? ""] ?? v.world.areas[r.author] ?? "", plan: planWords(v, r.plan.id),
    supports: r.reasons.filter((x) => x.weight > 0).slice(0, 3).map((x) => reasonWords(x.textKey)),
    concerns: r.reasons.filter((x) => x.weight < 0).slice(0, 3).map((x) => reasonWords(x.textKey)),
    unsure: r.uncertainties.length, heard: ago(v.now, r.computedAt), fresh: v.now - r.computedAt < 2 * 86400,
  }));
}

export function buildCourt(v: View): Court {
  const issues: Issue[] = [];
  const forts = v.world.places.filter((p) => p.fortified);
  for (const f of forts) {
    const b = beliefsAbout(v, f.id, "fortification.condition")[0];
    if (!b) continue;
    const cond = b.believedValue as number;
    const ev: Evidence[] = beliefsAbout(v, f.id, "fortification.condition").slice(0, 3).map((x) => ({
      text: `The walls are ${wallWords(x.believedValue as number)}`, age: ago(v.now, x.observedAt), source: sourceOf(v, x), certainty: certainty[x.effectiveBand] }));
    const urgency = Math.max(0, 85 - Math.round(cond / 1000));
    if (urgency > 15) issues.push({ key: `walls:${f.id}`, title: `${f.name}: walls ${wallWords(cond)}`, priority: urgency, evidence: ev, advice: adviceLines(v, f.id), place: f.id });
  }
  for (const site of v.world.places.filter((p) => beliefsAbout(v, p.id, "threat.intensity").length)) {
    const b = beliefsAbout(v, site.id, "threat.intensity")[0];
    const s = b.believedValue as number;
    if (s <= 0) continue;
    issues.push({ key: `raiders:${site.id}`, title: `${site.name}: ${raiderWords(s)}`, priority: 40 + Math.round(s / 20),
      evidence: beliefsAbout(v, site.id, "threat.intensity").slice(0, 3).map((x) => ({ text: raiderWords(x.believedValue as number), age: ago(v.now, x.observedAt), source: sourceOf(v, x), certainty: certainty[x.effectiveBand] })),
      advice: adviceLines(v, site.id), place: site.id });
  }
  for (const b of Object.values(v.beliefs).filter((x) => x.predicate === "order.status")) {
    const o = v.self.orders.find((x) => String(x.orderId) === b.subject.id);
    if (!o) continue;
    issues.push({ key: `order:${o.orderId}`, title: `Your order to ${nameOf(v, o.recipient)} (${o.action} ${nameOf(v, o.target)}): ${String(b.believedValue)}`, priority: 10,
      evidence: [{ text: String(b.believedValue), age: ago(v.now, b.observedAt), source: sourceOf(v, b), certainty: certainty[b.effectiveBand] }], advice: [] });
  }
  issues.sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : 1));
  const pos = v.self.position;
  return {
    day: dayOf(v.now), at: "at" in pos ? nameOf(v, pos.at) : `on the road to ${nameOf(v, pos.transit.dest)}`, issues, advice: adviceLines(v).filter((a) => !issues.some((i) => i.advice.some((x) => x.id === a.id))),
    letters: [...v.reports].reverse().map((r) => ({ from: nameOf(v, r.author), about: nameOf(v, r.subject.id), written: ago(v.now, r.composedAt), arrived: ago(v.now, r.deliveredAt), route: r.route.length })),
  };
}

/** Plain-text court for logs and tests. */
export function renderCourtSummary(v: View): string {
  const c = buildCourt(v);
  const lines = [`Court, day ${c.day}, ${c.at}`];
  for (const i of c.issues) lines.push(`- ${i.title}`, ...i.evidence.map((e) => `    ${e.text} (${e.source}, ${e.age}, ${e.certainty})`), ...i.advice.map((a) => `    ${a.adviser}: ${a.plan}`));
  lines.push(`reports received: ${v.reports.length}; orders given: ${v.self.orders.length}`);
  void pct;
  return lines.join("\n");
}
