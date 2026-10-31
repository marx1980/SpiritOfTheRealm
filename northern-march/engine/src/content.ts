// A5: content is data. Loader + validator. Fails on unknown IDs, traits outside the capped vocabulary (B6),
// orphan relationships, unreachable locations, unknown terrain/tier/river, duplicates and non-integers.
import { readFileSync } from "node:fs";
import { hashOf } from "./canonical.ts";

export const CONTENT_SCHEMA_VERSION = 2;
export const TRAIT_VOCABULARY = ["cautious", "aggressive", "proud", "loyal", "ambitious", "pragmatic", "zealous",
  "greedy", "honest", "vengeful", "compassionate", "stubborn", "curious", "patient"] as const;
export const MODES = ["rider", "foot", "army"] as const;
export type Mode = (typeof MODES)[number];
export const TIERS = ["A", "B", "C"] as const;

export interface SubjectRefC { kind: "character" | "location" | "report" | "order"; id: string }
export interface Trait { id: string; riskPermille: number; obedienceWhenDisagreeingPermille: number; houseVsCrownPermille: number;
  lossResponsePermille: number; badNewsReportingPermille: number }
export interface Province { id: string; name: string; seat: string }
export interface River { id: string; name: string }
export interface Location { id: string; name: string; province: string; kind: string; terrain: string; exposurePermille: number; fortification?: { conditionMilli: number } }
export interface Route { id: string; from: string; to: string; km: number; terrain: string; crossing?: { river: string; kind: string } }
export interface Predicate { id: string; subjectKind: SubjectRefC["kind"]; halfLifeTicks: number; domain: string }
export interface Relationship { to: string; kind: string; value: number }
export interface Character { id: string; name: string; role: string; location: string; tier: (typeof TIERS)[number]; traits: string[]; reportsTo?: string;
  capabilities: Record<string, number>; relationships: Relationship[] }
export type Script =
  | { day: number; kind: "travel"; who: string; to: string; mode: Mode; secret?: boolean }
  | { day: number; kind: "order"; from: string; to: string; intent: string; objective: SubjectRefC; supersedesPrevious?: boolean };
export interface Scenario {
  ruler: string; treasuryMilli: number;
  movement: { speedsKmPerDay: Record<Mode, Record<string, number>>; crossingDelayTicks: Record<string, number> };
  knowledge: { beliefCaps: Record<(typeof TIERS)[number], number>; bands: { certain: number; probable: number; uncertain: number };
    stormPenaltyPermille: number; maxErrorMilliPerMissingPermille: number; lowTrustBelow: number };
  economy: { holdings: { location: string; dailyIncomeMilli: number; jitterMilli: number }[]; dailyUpkeepMilli: number };
  weather: { decayMilliPerDay: number; stormDamageMilli: [number, number] };
  threat: { sites: { site: string; target: string }[]; startPermillePerDay: number; intensityPermille: [number, number];
    durationDays: [number, number]; raidDamageMilliAtFullIntensity: number };
  messenger: { reportEveryDays: number; alarmBelowMilli: number; legJitterPermille: [number, number]; lossPermillePerDay: number;
    redirectLimit: number; understateMilli: number };
  interception: { location: string; by: string; permille: number }[];
  player: { repairCostMilliPerMilli: number; repairRestoreToMilli: number; repairDays: number; levyMilli: number };
  scripts: Script[];
  endStates: { fortificationBreachedBelowMilli: number };
}
export interface RawContent {
  manifest: { schemaVersion: number; contentVersion: string };
  traits: Trait[]; provinces: Province[]; rivers: River[]; locations: Location[]; routes: Route[];
  predicates: Predicate[]; characters: Character[]; scenario: Scenario;
}
export interface Content extends RawContent {
  version: string; hash: string;
  byId: { location: Map<string, Location>; character: Map<string, Character>; route: Map<string, Route>; predicate: Map<string, Predicate>; trait: Map<string, Trait> };
}
export interface ContentError { code: string; msg: string }

const FILES = ["manifest", "traits", "provinces", "rivers", "locations", "routes", "predicates", "characters", "scenario"] as const;

export function readContentDir(dir: string): RawContent {
  const out: Record<string, unknown> = {};
  for (const f of FILES) out[f] = JSON.parse(readFileSync(`${dir.replace(/\/?$/, "/")}${f}.json`, "utf8"));
  return out as unknown as RawContent;
}

export function validateContent(raw: RawContent): { errors: ContentError[] } {
  const errors: ContentError[] = [];
  const err = (code: string, msg: string) => errors.push({ code, msg });
  if (raw.manifest?.schemaVersion !== CONTENT_SCHEMA_VERSION) err("SCHEMA_VERSION", `content schemaVersion ${raw.manifest?.schemaVersion}, engine expects ${CONTENT_SCHEMA_VERSION}`);
  if (typeof raw.manifest?.contentVersion !== "string") err("SCHEMA_VERSION", "manifest.contentVersion missing");

  const walk = (v: unknown, path: string) => {
    if (typeof v === "number" && !Number.isSafeInteger(v)) err("NOT_INTEGER", `${path} = ${v}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(raw, "content");

  const ids = (list: { id: string }[], what: string) => {
    const s = new Set<string>();
    for (const x of list ?? []) { if (s.has(x.id)) err("ID_DUPLICATE", `${what} ${x.id}`); s.add(x.id); }
    return s;
  };
  const locs = ids(raw.locations, "location"), chars = ids(raw.characters, "character"), traits = ids(raw.traits, "trait");
  const provs = ids(raw.provinces, "province"), rivers = ids(raw.rivers, "river"), preds = ids(raw.predicates, "predicate");
  ids(raw.routes, "route");
  const vocab = new Set<string>(TRAIT_VOCABULARY);
  for (const t of traits) if (!vocab.has(t)) err("TRAIT_UNKNOWN", `trait file defines ${t}, not in vocabulary`);
  for (const t of vocab) if (!traits.has(t)) err("TRAIT_MISSING", `vocabulary trait ${t} has no definition`);

  const need = (set: Set<string>, id: string, what: string, where: string) => { if (!set.has(id)) err("ID_UNKNOWN", `${where}: ${what} ${id}`); };
  const sc = raw.scenario;
  const terrains = new Set(Object.keys(sc.movement.speedsKmPerDay.rider ?? {}));
  for (const m of MODES) {
    const sp = sc.movement.speedsKmPerDay[m];
    if (!sp) { err("MODE_MISSING", `no speeds for ${m}`); continue; }
    for (const t of terrains) if (!(sp[t] > 0)) err("MODE_MISSING", `${m} has no speed on ${t}`);
  }
  for (const p of raw.provinces) need(locs, p.seat, "location", `province ${p.id} seat`);
  for (const l of raw.locations) {
    need(provs, l.province, "province", `location ${l.id}`);
    if (!terrains.has(l.terrain)) err("TERRAIN_UNKNOWN", `location ${l.id}: ${l.terrain}`);
  }
  for (const r of raw.routes) {
    need(locs, r.from, "location", `route ${r.id}`); need(locs, r.to, "location", `route ${r.id}`);
    if (!(r.km > 0)) err("ROUTE_LENGTH", `route ${r.id}`);
    if (!terrains.has(r.terrain)) err("TERRAIN_UNKNOWN", `route ${r.id}: ${r.terrain}`);
    if (r.crossing) {
      need(rivers, r.crossing.river, "river", `route ${r.id}`);
      if (!(r.crossing.kind in sc.movement.crossingDelayTicks)) err("CROSSING_UNKNOWN", `route ${r.id}: ${r.crossing.kind}`);
    }
  }
  for (const c of raw.characters) {
    need(locs, c.location, "location", `character ${c.id}`);
    if (!(TIERS as readonly string[]).includes(c.tier)) err("TIER_UNKNOWN", `character ${c.id}: ${c.tier}`);
    if (c.reportsTo) need(chars, c.reportsTo, "character", `character ${c.id} reportsTo`);
    for (const t of c.traits) if (!vocab.has(t)) err("TRAIT_UNKNOWN", `character ${c.id} has trait ${t}`);
    for (const r of c.relationships) if (!chars.has(r.to)) err("RELATIONSHIP_ORPHAN", `character ${c.id} -> ${r.to}`);
    for (const [k, v] of Object.entries(c.capabilities ?? {})) if (v < 0 || v > 1000) err("RANGE", `character ${c.id} capability ${k}=${v}`);
  }
  need(chars, sc.ruler, "character", "scenario.ruler");
  for (const h of sc.economy.holdings) need(locs, h.location, "location", "economy holding");
  for (const s of sc.threat.sites) { need(locs, s.site, "location", "threat site"); need(locs, s.target, "location", "threat target"); }
  for (const i of sc.interception) { need(locs, i.location, "location", "interception"); need(chars, i.by, "character", "interception"); }
  for (const s of sc.scripts) {
    if (s.kind === "travel") { need(chars, s.who, "character", "script"); need(locs, s.to, "location", "script"); if (!(MODES as readonly string[]).includes(s.mode)) err("MODE_MISSING", `script mode ${s.mode}`); }
    else { need(chars, s.from, "character", "script"); need(chars, s.to, "character", "script"); }
  }
  for (const id of ["fortification.condition", "character.location", "character.seat", "order.status", "order.content", "report.route"]) need(preds, id, "predicate", "engine requires");

  const ruler = raw.characters.find((c) => c.id === sc.ruler);
  if (ruler && locs.has(ruler.location)) {
    const adj = new Map<string, string[]>();
    const add = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, []); adj.get(a)!.push(b); };
    for (const r of raw.routes) { add(r.from, r.to); add(r.to, r.from); }
    const seen = new Set([ruler.location]), queue = [ruler.location];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    for (const l of locs) if (!seen.has(l)) err("LOCATION_UNREACHABLE", `${l} cannot be reached from ${ruler.location}`);
  }
  return { errors };
}

export function deriveContent(raw: RawContent): Content {
  const { errors } = validateContent(raw);
  if (errors.length) throw new Error("content invalid:\n" + errors.map((e) => `  ${e.code}: ${e.msg}`).join("\n"));
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  return {
    ...raw, version: raw.manifest.contentVersion, hash: hashOf(raw),
    byId: { location: m(raw.locations), character: m(raw.characters), route: m(raw.routes), predicate: m(raw.predicates), trait: m(raw.traits) },
  };
}

export function loadContent(dir: string): Content {
  return deriveContent(readContentDir(dir));
}
