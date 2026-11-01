// Map (P0.06): places from static knowledge; walls, raiders, troops and people as the player believes them, with age,
// source and certainty. No hidden truth; troop figures are the believed count, exact only where the belief is certain.
import { beliefsAbout, type View } from "../view.ts";
import { ago, certainty, nameOf, raiderWords, sourceOf, wallWords } from "./phrasing.ts";

export interface MapPlace {
  id: string; name: string; x: number; y: number; fortified: boolean;
  wall?: { words: string; age: string; source: string; certainty: string };
  troops?: { count: number; exact: boolean; observedAt: number };
  raiders?: { words: string; age: string; source: string; certainty: string };
  people: { name: string; age: string; certainty: string }[];
  you: boolean;
}
export interface MapModel { places: MapPlace[]; routes: { from: string; to: string; crossing?: string }[]; orders: { to: string; what: string; where: string; sent: string }[] }

export function buildMap(v: View): MapModel {
  const pos = v.self.position;
  const here = "at" in pos ? pos.at : null;
  const people = new Map<string, MapPlace["people"]>();
  for (const b of Object.values(v.beliefs).filter((x) => x.predicate === "character.location")) {
    const at = b.believedValue as string;
    if (!people.has(at)) people.set(at, []);
    people.get(at)!.push({ name: nameOf(v, b.subject.id), age: ago(v.now, b.observedAt), certainty: certainty[b.effectiveBand] });
  }
  const places = v.world.places.map((p) => {
    const w = beliefsAbout(v, p.id, "fortification.condition")[0], r = beliefsAbout(v, p.id, "threat.intensity")[0];
    const g = beliefsAbout(v, p.id, "fortification.garrison")[0];
    return {
      id: p.id, name: p.name, x: p.pos[0], y: p.pos[1], fortified: p.fortified, you: here === p.id,
      ...(g ? { troops: { count: g.believedValue as number, exact: g.effectiveBand === "certain", observedAt: g.observedAt } } : {}),
      ...(w ? { wall: { words: wallWords(w.believedValue as number), age: ago(v.now, w.observedAt), source: sourceOf(v, w), certainty: certainty[w.effectiveBand] } } : {}),
      ...(r ? { raiders: { words: raiderWords(r.believedValue as number), age: ago(v.now, r.observedAt), source: sourceOf(v, r), certainty: certainty[r.effectiveBand] } } : {}),
      people: (people.get(p.id) ?? []).sort((a, b) => (a.name < b.name ? -1 : 1)),
    };
  });
  return {
    places, routes: v.world.routes.map((r) => ({ ...r })),
    orders: v.self.orders.map((o) => ({ to: nameOf(v, o.recipient), what: o.action, where: nameOf(v, o.target), sent: ago(v.now, o.tick) })),
  };
}
