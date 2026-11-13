// Building a battle from what the campaign has (D-060): forces split into formations by content, placed on the field,
// commanders with their traits and skill, and the plan made before the fight - the ruler's if she gives one, else the
// senior commander's, from his temperament. Pure: shared by the campaign glue, the tests and the page.
import type { BattleOrder, BattleParams, BattleSetup, CommanderSetup, FieldSpec, FormationSetup, Kind, ObedienceParams, Task, TraitP } from "./core.ts";

export interface ForcesParams {
  garrison: { kind: Kind; sharePermille: number; by: "castellan" | "sergeant" }[];
  company: { kind: Kind; sharePermille: number }[];
  guardMen: number;
  raiders: { minMen: number; parts: { kind: Kind; sharePermille: number }[] }[];
  start: { crownY: number; raidersY: number; spacing: number };
  signals: { id: string; task: Task }[];
  posts: Record<"rear" | "centre" | "forward", string>;
}
export interface Person { id: string; name: string; traits: TraitP[]; skill: number; loyalty: Record<string, number> }

/** A character as a commander: traits, military skill (content plus experience, if given) and loyalty or trust towards others. */
export function personOf(c: import("../content.ts").Content, id: string, skill?: number): Person {
  const ch = c.byId.character.get(id)!;
  const traits = ch.traits.map((t) => c.byId.trait.get(t) as unknown as TraitP);
  const loyalty: Record<string, number> = {};
  for (const r of ch.relationships ?? []) if (r.kind === "loyalty" || r.kind === "trust") loyalty[r.to] = Math.max(loyalty[r.to] ?? 0, r.value);
  return { id, name: ch.name ?? id, traits, skill: skill ?? ch.capabilities.military ?? 0, loyalty };
}
export interface BattleInputs {
  battleId: number; seed: number; site: string; place: string; endT: number; weather: "clear" | "rain";
  field: FieldSpec; params: BattleParams; forces: ForcesParams; obedience: ObedienceParams;
  /** The fort's men; archers and horse, if known, are how many of them are bowmen and riders (D-067), else content shares. */
  garrison: { men: number; archers?: number; horse?: number; castellan?: Person; sergeant?: Person };
  companies: { captain: Person; men: number }[];
  raiderMen: number;
  ruler: Person & { present: boolean; post?: "rear" | "centre" | "forward" };
  /** The ruler's own plan, if she made one (given by voice before the fight). */
  plan?: BattleOrder[];
}

const avg = (ts: TraitP[], k: keyof TraitP) => (ts.length ? Math.floor(ts.reduce((n, t) => n + ((t[k] as number | undefined) ?? 500), 0) / ts.length) : 500);
const LABEL: Record<Kind, string> = { foot: "foot", archers: "archers", horse: "horse", guard: "guard", warband: "warband", bowmen: "bowmen", riders: "riders" };

export function buildSetup(x: BattleInputs): BattleSetup {
  const F = x.forces, field = x.field, formations: FormationSetup[] = [], commanders: CommanderSetup[] = [];
  const centre = Math.floor(field.width / 2);
  const add = (side: FormationSetup["side"], kind: Kind, men: number, commander: string, label: string) => {
    if (men <= 0) return undefined;
    const id = `${side === "crown" ? "c" : "r"}${formations.length + 1}`;
    formations.push({ id, side, kind, label, men, commander, x: 0, y: 0 });
    return id;
  };
  const cmd = (p: Person, side: FormationSetup["side"], ids: (string | undefined)[], superior?: string) => {
    const fs = ids.filter((i): i is string => !!i);
    if (fs.length) commanders.push({ id: p.id, name: p.name, side, formations: fs, traits: p.traits, skill: p.skill, loyalty: p.loyalty, ...(superior ? { superior } : {}) });
  };
  // the captains' companies first (the senior commander is the first captain present), then the garrison
  for (const co of x.companies) {
    let left = co.men;
    const ids = F.company.map((part, i) => { const n = i === F.company.length - 1 ? left : Math.floor((co.men * part.sharePermille) / 1000); left -= n; return add("crown", part.kind, n, co.captain.id, `${co.captain.name}'s ${LABEL[part.kind]}`); });
    cmd(co.captain, "crown", ids);
  }
  const gIds: Record<string, (string | undefined)[]> = { castellan: [], sergeant: [] };
  // the garrison by kind: from the fort's roster when the campaign gives it, else split by content shares (the last share
  // above nothing takes what is left)
  const typed = x.garrison.archers !== undefined || x.garrison.horse !== undefined;
  const archers = Math.min(x.garrison.men, x.garrison.archers ?? 0), horse = Math.min(x.garrison.men - archers, x.garrison.horse ?? 0);
  const lastShared = F.garrison.reduce((k, p, i) => (p.sharePermille > 0 ? i : k), -1);
  let gLeft = x.garrison.men;
  F.garrison.forEach((part, i) => {
    const who = (part.by === "sergeant" && x.garrison.sergeant) || x.garrison.castellan || x.garrison.sergeant;
    const n = typed ? (part.kind === "archers" ? archers : part.kind === "horse" ? horse : part.kind === "foot" ? x.garrison.men - archers - horse : 0)
      : i === lastShared ? gLeft : i > lastShared ? 0 : Math.floor((x.garrison.men * part.sharePermille) / 1000);
    gLeft -= n;
    if (!who) return;
    gIds[who === x.garrison.sergeant && part.by === "sergeant" ? "sergeant" : "castellan"].push(add("crown", part.kind, n, who.id, `${x.place} ${LABEL[part.kind]}`));
  });
  const senior = x.companies[0]?.captain ?? x.garrison.castellan ?? x.garrison.sergeant;
  if (x.garrison.castellan) cmd(x.garrison.castellan, "crown", gIds.castellan, senior && senior.id !== x.garrison.castellan.id ? senior.id : undefined);
  if (x.garrison.sergeant) cmd(x.garrison.sergeant, "crown", gIds.sergeant, x.garrison.castellan?.id ?? senior?.id);
  // the ruler and her guard, only if she is with the army
  let guard: string | undefined;
  if (x.ruler.present) {
    guard = add("crown", "guard", F.guardMen, x.ruler.id, "the queen's guard");
    commanders.push({ id: x.ruler.id, name: x.ruler.name, side: "crown", formations: [guard!], traits: x.ruler.traits, skill: x.ruler.skill, loyalty: {} });
  }
  // the raiders, split by their numbers
  const shape = [...F.raiders].sort((a, b) => b.minMen - a.minMen).find((s) => x.raiderMen >= s.minMen) ?? F.raiders[F.raiders.length - 1];
  let rLeft = x.raiderMen;
  const rIds = shape.parts.map((part, i) => { const n = i === shape.parts.length - 1 ? rLeft : Math.floor((x.raiderMen * part.sharePermille) / 1000); rLeft -= n; return add("raiders", part.kind, n, "chief", `${LABEL[part.kind]} ${i + 1}`); });
  commanders.push({ id: "chief", name: "the raiders' chief", side: "raiders", formations: rIds.filter((i): i is string => !!i), traits: [{ riskPermille: 800, obedienceWhenDisagreeingPermille: 500, lossResponsePermille: 600, commitmentPermille: 500 }], skill: 500, loyalty: {} });
  // starting positions: each side in a line across the field, archers and bowmen a little behind, the guard at the rear
  const place = (side: FormationSetup["side"]) => {
    const list = formations.filter((f) => f.side === side && f.kind !== "guard");
    const y0 = side === "crown" ? F.start.crownY : F.start.raidersY;
    list.forEach((f, i) => {
      f.x = centre + Math.floor((i - (list.length - 1) / 2) * F.start.spacing);
      f.y = y0 + (f.kind === "archers" || f.kind === "bowmen" ? (side === "crown" ? 50 : -50) : 0);
    });
  };
  place("crown"); place("raiders");
  if (guard) { const g = formations.find((f) => f.id === guard)!; const p = field.places.find((q) => q.id === F.posts[x.ruler.post ?? "rear"]) ?? field.places[0]; g.x = p.x; g.y = Math.min(field.height - 10, p.y + 40); }

  // the plan before the fight
  const plan: BattleOrder[] = [];
  let id = 1;
  const order = (from: string, to: string, task: Task): BattleOrder => ({ schemaVersion: 1, id: id++, t: 0, from, to, task, via: "voice" });
  if (x.plan && x.plan.length) for (const o of x.plan) plan.push({ ...o, id: id++, t: 0, via: "voice" });
  else if (senior) {
    const bold = avg(senior.traits, "riskPermille") >= 600;
    for (const c of commanders.filter((c) => c.side === "crown" && c.id !== x.ruler.id)) {
      const task: Task = c.id === senior.id
        ? (bold ? { kind: "attack", place: "ford" } : { kind: "hold", place: "ridge", when: { kind: "enemy_engaged", then: { kind: "attack" } } })
        : c.formations.every((f) => formations.find((g) => g.id === f)!.kind === "archers") ? { kind: "hold", place: "ridge" }
        : bold ? { kind: "advance", place: "ridge" } : { kind: "give_ground", place: "ridge" };
      plan.push(order(senior.id, c.id, task));
    }
  }
  if (guard) plan.push(order(x.ruler.id, x.ruler.id, { kind: "hold", place: F.posts[x.ruler.post ?? "rear"] }));

  return {
    schemaVersion: 1, battleId: x.battleId, seed: x.seed, site: x.site, place: x.place, endT: Math.min(x.endT, x.params.capSeconds), weather: x.weather,
    field, params: x.params, obedience: x.obedience, formations, commanders,
    ruler: { id: x.ruler.id, present: x.ruler.present, ...(guard ? { guard } : {}) },
    hq: x.ruler.present ? x.ruler.id : senior?.id ?? x.ruler.id,
    plan, signals: F.signals,
  };
}
