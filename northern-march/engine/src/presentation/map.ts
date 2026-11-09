// Map (P0.06): places from static knowledge; walls, raiders, troops and people as the player believes them, with age,
// source and certainty. No hidden truth; troop figures are the believed count, exact only where the belief is certain.
import { beliefsAbout, type View } from "../view.ts";
import { ago, certainty, nameOf, raiderWords, sourceOf, wallWords } from "./phrasing.ts";
import { dayOf } from "./format.ts";

export interface MapPlace {
  id: string; name: string; x: number; y: number; fortified: boolean;
  wall?: { words: string; age: string; source: string; certainty: string };
  troops?: { fort?: { count: number; exact: boolean; day: number }; captains: { name: string; count: number; exact: boolean; day: number }[] };
  raiders?: { words: string; age: string; source: string; certainty: string; strength: number };
  people: { name: string; age: string; certainty: string }[];
  you: boolean;
}
/** A captain's company as the player believes it: where, how many, and how fresh the word is (strength 1 on the day the news arrived, 0 after FADE_DAYS). */
export interface MapCaptain { id: string; name: string; at: string; count: number; exact: boolean; strength: number;
  /** What his last order says he is doing, as far as the player knows; `projected` when the order is newer than the news of where he is. */
  heading?: { words: string; to: string; projected: boolean } }
export interface MapModel { captains: MapCaptain[]; places: MapPlace[]; routes: { from: string; to: string; crossing?: string }[]; orders: { to: string; what: string; where: string; sent: string }[] }

/** Days over which the ring round a believed position fades from full to nothing. */
export const FADE_DAYS = 12;
/** The tick the news behind a belief reached the player: the latest report carrying that very claim, else when it was seen. */
function arrivedAt(v: View, subject: string, predicate: string, observedAt: number): number {
  let at = observedAt;
  for (const r of v.reports) if (r.claims.some((c) => c.subject.id === subject && c.predicate === predicate && c.observedAt === observedAt)) at = Math.max(at, r.deliveredAt);
  return at;
}
const strengthOf = (now: number, arrived: number) => Math.round(Math.max(0, Math.min(1, 1 - (dayOf(now) - dayOf(arrived)) / FADE_DAYS)) * 100) / 100;

export function buildMap(v: View): MapModel {
  const pos = v.self.position;
  const here = "at" in pos ? pos.at : null;
  const people = new Map<string, MapPlace["people"]>();
  for (const b of Object.values(v.beliefs).filter((x) => x.predicate === "character.location")) {
    const at = b.believedValue as string;
    if (!people.has(at)) people.set(at, []);
    people.get(at)!.push({ name: nameOf(v, b.subject.id), age: ago(v.now, b.observedAt), certainty: certainty[b.effectiveBand] });
  }
  // captains' companies, placed where the player believes each captain is
  const companies = new Map<string, (NonNullable<MapPlace["troops"]>["captains"][number] & { id: string })[]>();
  for (const id of [...new Set(Object.values(v.beliefs).filter((b) => b.predicate === "character.troops").map((b) => b.subject.id))].sort()) {
    const t = beliefsAbout(v, id, "character.troops")[0], at = beliefsAbout(v, id, "character.location")[0]?.believedValue as string | undefined;
    if (!t || !at) continue;
    if (!companies.has(at)) companies.set(at, []);
    companies.get(at)!.push({ id, name: nameOf(v, id), count: t.believedValue as number, exact: t.effectiveBand === "certain", day: dayOf(t.observedAt) });
  }
  // captains with a company: placed where the news last put them; gone from the map once the word is that no men are left
  const captains: MapCaptain[] = [];
  for (const [at, list] of companies) for (const c of list) {
    const loc = beliefsAbout(v, c.id, "character.location")[0];
    if (c.count <= 0 || !loc) continue;
    const locNews = arrivedAt(v, c.id, "character.location", loc.observedAt);
    // His latest order of movement or fight, while the player has no word that it is over; from the day after it was given it counts as being carried out.
    const o = v.self.orders.filter((x) => x.recipient === c.id && (x.action === "advance" || x.action === "attack" || x.action === "investigate")).sort((a, b) => b.tick - a.tick || b.orderId - a.orderId)[0];
    const status = o ? beliefsAbout(v, String(o.orderId), "order.status").sort((a, b) => b.observedAt - a.observedAt)[0]?.believedValue : undefined;
    const running = !!o && (status === undefined || status === "issued") && dayOf(v.now) > dayOf(o.tick) && !(o.action === "advance" && o.target === at);
    const heading = running ? { words: o!.action === "advance" ? `En route to ${nameOf(v, o!.target)}` : o!.action === "attack" ? `Attacking the raiders at ${nameOf(v, o!.target)}` : `Scouting the raiders at ${nameOf(v, o!.target)}`, to: o!.target, projected: o!.tick > locNews } : undefined;
    captains.push({ id: c.id, name: c.name, at, count: c.count, exact: c.exact, strength: strengthOf(v.now, locNews), ...(heading ? { heading } : {}) });
  }
  const places = v.world.places.map((p) => {
    const w = beliefsAbout(v, p.id, "fortification.condition")[0], r = beliefsAbout(v, p.id, "threat.intensity")[0];
    const g = beliefsAbout(v, p.id, "fortification.garrison")[0];
    const captains = companies.get(p.id) ?? [];
    const troops = g || captains.length ? { ...(g ? { fort: { count: g.believedValue as number, exact: g.effectiveBand === "certain", day: dayOf(g.observedAt) } } : {}), captains } : undefined;
    return {
      id: p.id, name: p.name, x: p.pos[0], y: p.pos[1], fortified: p.fortified, you: here === p.id,
      ...(troops ? { troops } : {}),
      ...(w ? { wall: { words: wallWords(w.believedValue as number), age: ago(v.now, w.observedAt), source: sourceOf(v, w), certainty: certainty[w.effectiveBand] } } : {}),
      ...(r ? { raiders: { words: raiderWords(r.believedValue as number), age: ago(v.now, r.observedAt), source: sourceOf(v, r), certainty: certainty[r.effectiveBand], strength: strengthOf(v.now, arrivedAt(v, p.id, "threat.intensity", r.observedAt)) } } : {}),
      people: (people.get(p.id) ?? []).sort((a, b) => (a.name < b.name ? -1 : 1)),
    };
  });
  return {
    captains, places, routes: v.world.routes.map((r) => ({ ...r })),
    orders: v.self.orders.map((o) => ({ to: nameOf(v, o.recipient), what: o.action, where: nameOf(v, o.target), sent: ago(v.now, o.tick) })),
  };
}
