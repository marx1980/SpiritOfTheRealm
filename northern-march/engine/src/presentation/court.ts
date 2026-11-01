// Court (P0.06): prioritised issues, each with its evidence (age, source, certainty) and each adviser's advice shown
// separately. Built from the player's view only (A7).
import { beliefsAbout, type View } from "../view.ts";
import { dayOf, pct } from "./format.ts";
import { ago, certainty, nameOf, nearestFort, planOf, planWords, raiderWords, reasonWords, sourceOf, wallWords } from "./phrasing.ts";

export interface Evidence { text: string; age: string; source: string; certainty: string }
/** Short area labels for the council list. */
const SHORT_AREA: Record<string, string> = { Military: "MIL", Administration: "ADM", Construction: "CON", Intelligence: "INT" };

export interface AdviceLine { id: number; adviser: string; area: string; plan: string; supports: string[]; concerns: string[]; unsure: number; heard: string; fresh: boolean }
export interface Issue { key: string; title: string; priority: number; evidence: Evidence[]; advice: AdviceLine[]; place?: string }
export interface Court { day: number; at: string; issues: Issue[]; advice: AdviceLine[]; letters: { from: string; about: string; written: string; arrived: string; route: number }[] }

/** Whether a piece of advice is already carried out, or being carried out, so it is no longer put to the ruler. */
export function settledCheck(v: View): (r: { plan: { id: string } }) => boolean {
  // the order each kind of advice turns into: attacking the raiders is sending the captain to the nearest fort
  const orderOf = (a: { kind: string; target?: string }): { action: string; target: string } | undefined => {
    if (a.kind === "advise_levy") return { action: "levy", target: v.self.id };
    if (!a.target) return undefined;
    if (a.kind === "advise_repair") return { action: "repair", target: a.target };
    if (a.kind === "advise_send_captain") return { action: "advance", target: a.target };
    if (a.kind === "advise_sortie") { const f = nearestFort(v, a.target); return f ? { action: "advance", target: f } : undefined; }
    return undefined;
  };
  // Orders in place: issued by you and not yet reported finished in a letter (for up to 60 days).
  const finished = new Set(Object.values(v.beliefs).filter((b) => b.predicate === "order.status" && ["completed", "abandoned", "superseded"].includes(String(b.believedValue))).map((b) => b.subject.id));
  // An order in progress: its advice is set aside until it is finished.
  const inProgress = v.self.orders.filter((o) => v.now - o.tick < 60 * 86400 && !finished.has(String(o.orderId)));
  // A completed order: its advice stays set aside until the ruler learns something new about that place (a letter or an
  // observation dated after the completion), since until then the situation she knows is the one the order changed.
  const doneAt = new Map<string, number>();
  for (const b of Object.values(v.beliefs)) if (b.predicate === "order.status" && String(b.believedValue) === "completed") doneAt.set(b.subject.id, b.observedAt);
  const doneOrders = v.self.orders.filter((o) => doneAt.has(String(o.orderId))).map((o) => ({ ...o, doneAt: doneAt.get(String(o.orderId))! }));
  const captains = new Set(Object.values(v.beliefs).filter((b) => b.predicate === "character.troops").map((b) => b.subject.id));
  const captainBelievedAt = (place: string) => Object.values(v.beliefs).some((b) => b.predicate === "character.location" && captains.has(b.subject.id) && b.believedValue === place);
  const learnedSince = (place: string, t: number) => Object.values(v.beliefs).some((b) => b.subject.id === place && b.observedAt > t);
  // an order sent for a mission (investigate or advance on a site) also covers the fort nearest that site
  const covers = (o: { action: string; target: string }, want: { action: string; target: string }) =>
    (o.action === want.action && o.target === want.target) || (want.action === "advance" && (o.action === "advance" || o.action === "investigate" || o.action === "attack") && nearestFort(v, o.target) === want.target);
  // an order to send a captain, once reported done, stands until she gives him another order: his own letters
  // are about where he is, not about where the company she sent is
  const captainStillThere = (o: { recipient: string; tick: number; doneAt?: number }, place: string) => {
    if (v.self.orders.some((x) => x.recipient === o.recipient && x.tick > o.tick)) return false;
    // unless a later word on where he is says he is somewhere else (he went home, or on)
    const where = Object.values(v.beliefs).find((b) => b.predicate === "character.location" && b.subject.id === o.recipient);
    return !(where && where.believedValue !== place && where.observedAt >= (o.doneAt ?? o.tick));
  };
  const superseded = (r: { plan: { id: string } }) => {
    const want = orderOf(planOf(v, r.plan.id));
    if (!want) return false;
    const plan = planOf(v, r.plan.id);
    if (plan.kind === "advise_sortie" && plan.target) {
      // attack advice: set aside while a captain is on his way to the fort or already sent against that site; a captain who has
      // arrived (or was sent to scout) is exactly when the advice to attack makes sense
      const site = plan.target;
      if (inProgress.some((o) => o.target === site || covers(o, want))) return true;
      return doneOrders.some((o) => o.target === site && (o.action === "advance" || o.action === "attack") && !learnedSince(site, o.doneAt));
    }
    if (inProgress.some((o) => covers(o, want))) return true;
    const a = planOf(v, r.plan.id);
    // an attack on raiders is set aside while any order is under way for that place or its fort
    if (a.kind === "advise_sortie" && a.target && inProgress.some((o) => o.target === a.target || o.target === want.target)) return true;
    // a captain (one with a company) is already believed to be at the place: sending one there is settled
    if (a.kind === "advise_send_captain" && captainBelievedAt(want.target)) return true;
    return doneOrders.some((o) => covers(o, want) && (want.action === "advance" ? captainStillThere(o, want.target) : !learnedSince(want.target, o.doneAt)));
  };
  return superseded;
}

/** True when the advice with this id is settled (the pause should not put it to the ruler). */
export function adviceSettled(v: View, id: number): boolean {
  const r = v.advice.find((x) => x.id === id);
  return !r || settledCheck(v)(r);
}

/** Advice about one place (each adviser's standing advice on it), or, with no place, each adviser's latest advice. */
function adviceLines(v: View, target?: string): AdviceLine[] {
  const latest = new Map<string, number>();
  for (const r of v.advice) if (!latest.has(r.author) || v.advice.find((x) => x.id === latest.get(r.author))!.computedAt < r.computedAt) latest.set(r.author, r.id);
  const superseded = settledCheck(v);
  return v.advice.filter((r) => (target ? (r.plan.id.includes(`"${target}"`) || planOf(v, r.plan.id).target === target) : latest.get(r.author) === r.id) && !superseded(r)).map((r) => ({
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
