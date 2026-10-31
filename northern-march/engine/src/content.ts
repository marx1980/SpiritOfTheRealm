// A5: content is data. Loader + validator. The validator fails on unknown IDs, traits outside the
// capped vocabulary (B6), orphan relationships, unreachable locations, duplicates and non-integers.
import { readFileSync } from "node:fs";
import { hashOf } from "./canonical.ts";

export const CONTENT_SCHEMA_VERSION = 1;
export const TRAIT_VOCABULARY = ["cautious", "aggressive", "proud", "loyal", "ambitious", "pragmatic", "zealous",
  "greedy", "honest", "vengeful", "compassionate", "stubborn", "curious", "patient"] as const;

export interface Trait { id: string; riskPermille: number; obedienceWhenDisagreeingPermille: number; houseVsCrownPermille: number;
  lossResponsePermille: number; badNewsReportingPermille: number }
export interface Location { id: string; name: string; kind: string; exposurePermille: number; fortification?: { conditionMilli: number } }
export interface Route { from: string; to: string; travelTicks: number }
export interface Relationship { to: string; kind: string; value: number }
export interface Character { id: string; name: string; role: string; location: string; traits: string[]; reportsTo?: string; relationships: Relationship[] }
export interface Scenario {
  ruler: string; treasuryMilli: number;
  economy: { holdings: { location: string; dailyIncomeMilli: number; jitterMilli: number }[]; dailyUpkeepMilli: number };
  weather: { decayMilliPerDay: number; stormDamageMilli: [number, number] };
  threat: { sites: { site: string; target: string }[]; startPermillePerDay: number; intensityPermille: [number, number];
    durationDays: [number, number]; raidDamageMilliAtFullIntensity: number };
  messenger: { reportEveryDays: number; alarmBelowMilli: number; delayJitterPermille: [number, number]; lossPermille: number };
  player: { repairCostMilliPerMilli: number; repairRestoreToMilli: number; repairDays: number; levyMilli: number };
  endStates: { fortificationBreachedBelowMilli: number };
}
export interface RawContent {
  manifest: { schemaVersion: number; contentVersion: string };
  traits: Trait[]; locations: Location[]; routes: Route[]; characters: Character[]; scenario: Scenario;
}
export interface Content extends RawContent {
  version: string; hash: string;
  byId: { location: Map<string, Location>; character: Map<string, Character> };
}
export interface ContentError { code: string; msg: string }

const FILES = ["manifest", "traits", "locations", "routes", "characters", "scenario"] as const;

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
    for (const x of list) { if (s.has(x.id)) err("ID_DUPLICATE", `${what} ${x.id}`); s.add(x.id); }
    return s;
  };
  const locs = ids(raw.locations, "location"), chars = ids(raw.characters, "character"), traits = ids(raw.traits, "trait");
  const vocab = new Set<string>(TRAIT_VOCABULARY);
  for (const t of traits) if (!vocab.has(t)) err("TRAIT_UNKNOWN", `trait file defines ${t}, not in vocabulary`);
  for (const t of vocab) if (!traits.has(t)) err("TRAIT_MISSING", `vocabulary trait ${t} has no definition`);

  const needLoc = (id: string, where: string) => { if (!locs.has(id)) err("ID_UNKNOWN", `${where}: location ${id}`); };
  const needChar = (id: string, where: string) => { if (!chars.has(id)) err("ID_UNKNOWN", `${where}: character ${id}`); };

  for (const r of raw.routes) { needLoc(r.from, "route"); needLoc(r.to, "route"); if (r.travelTicks <= 0) err("ROUTE_TIME", `${r.from}-${r.to}`); }
  for (const c of raw.characters) {
    needLoc(c.location, `character ${c.id}`);
    if (c.reportsTo) needChar(c.reportsTo, `character ${c.id} reportsTo`);
    for (const t of c.traits) if (!vocab.has(t)) err("TRAIT_UNKNOWN", `character ${c.id} has trait ${t}`);
    for (const r of c.relationships) if (!chars.has(r.to)) err("RELATIONSHIP_ORPHAN", `character ${c.id} -> ${r.to}`);
  }
  const sc = raw.scenario;
  needChar(sc.ruler, "scenario.ruler");
  for (const h of sc.economy.holdings) needLoc(h.location, "economy holding");
  for (const s of sc.threat.sites) { needLoc(s.site, "threat site"); needLoc(s.target, "threat target"); }

  // reachability from the ruler's location over undirected routes
  const ruler = raw.characters.find((c) => c.id === sc.ruler);
  if (ruler && locs.has(ruler.location)) {
    const adj = new Map<string, string[]>();
    for (const r of raw.routes) { (adj.get(r.from) ?? adj.set(r.from, []).get(r.from)!).push(r.to); (adj.get(r.to) ?? adj.set(r.to, []).get(r.to)!).push(r.from); }
    const seen = new Set([ruler.location]), queue = [ruler.location];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    for (const l of locs) if (!seen.has(l)) err("LOCATION_UNREACHABLE", `${l} cannot be reached from ${ruler.location}`);
  }
  return { errors };
}

export function loadContent(dir: string): Content {
  const raw = readContentDir(dir);
  const { errors } = validateContent(raw);
  if (errors.length) throw new Error("content invalid:\n" + errors.map((e) => `  ${e.code}: ${e.msg}`).join("\n"));
  return {
    ...raw, version: raw.manifest.contentVersion, hash: hashOf(raw),
    byId: { location: new Map(raw.locations.map((l) => [l.id, l])), character: new Map(raw.characters.map((c) => [c.id, c])) },
  };
}
