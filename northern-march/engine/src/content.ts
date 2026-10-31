// A5: content is data. Loader + validator. Fails on unknown IDs, traits outside the capped vocabulary (B6),
// orphan relationships, unreachable locations, unknown terrain/tier/river, duplicates and non-integers.
import { readFileSync } from "node:fs";
import { hashOf } from "./canonical.ts";

export const CONTENT_SCHEMA_VERSION = 3;
export const OBJECTIVE_KINDS = ["hold_fortification", "hold_post", "protect_realm", "sound_works", "preserve_treasury", "preserve_forces",
  "win_renown", "crown_standing", "house_standing", "protect_community"] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];
export const TRAIT_VOCABULARY = ["cautious", "aggressive", "proud", "loyal", "ambitious", "pragmatic", "zealous",
  "greedy", "honest", "vengeful", "compassionate", "stubborn", "curious", "patient"] as const;
export const MODES = ["rider", "foot", "army"] as const;
export type Mode = (typeof MODES)[number];
export const TIERS = ["A", "B", "C"] as const;

export interface SubjectRefC { kind: "character" | "location" | "report" | "order"; id: string }
export interface Trait { id: string; riskPermille: number; obedienceWhenDisagreeingPermille: number; houseVsCrownPermille: number;
  lossResponsePermille: number; badNewsReportingPermille: number; commitmentPermille: number }
export interface Province { id: string; name: string; seat: string }
export interface River { id: string; name: string }
export interface Location { id: string; name: string; province: string; kind: string; terrain: string; exposurePermille: number; fortification?: { conditionMilli: number; garrison: number } }
export interface Route { id: string; from: string; to: string; km: number; terrain: string; crossing?: { river: string; kind: string } }
export interface Predicate { id: string; subjectKind: SubjectRefC["kind"]; halfLifeTicks: number; domain: string; wakeSignificance: 0 | 1 | 2 | 3; materialDelta: number }
export interface Relationship { to: string; kind: string; value: number }
export interface ObjectiveDef { id: string; kind: "role" | "personal" | "political" | "situational"; objective: ObjectiveKind; priorityPermille: number; target?: string; reserveMilli?: number }
export interface Character { id: string; name: string; role: string; location: string; tier: (typeof TIERS)[number]; traits: string[]; reportsTo?: string;
  capabilities: Record<string, number>; relationships: Relationship[]; house: string; objectives: ObjectiveDef[]; troops?: number }
export type Script =
  | { day: number; kind: "travel"; who: string; to: string; mode: Mode; secret?: boolean }
  | { day: number; kind: "order"; from: string; to: string; intent: string; objective: SubjectRefC; supersedesPrevious?: boolean }
  | { day: number; kind: "threat"; site: string; intensityPermille: number; durationDays: number };
export interface AgentParams {
  reviewDays: { strategic: number; operational: number };
  commitment: { baseMarginPermille: number; absFloorMilli: number };
  obedience: { adaptMarginMilli: number; refuseMarginMilli: number; changedCircumstancesPermille: number; dutyMilli: number; legitimacyRulerPermille: number };
  planning: { minCandidates: number; maxCandidates: number; skillPerExtraCandidate: number };
  horizonDays: number; quietDaysToEnd: number; requestAssessDays: number; answerLearningPermille: number; wakeBudgetPerDay: Record<(typeof TIERS)[number], number>;
  values: { manMilli: number; renownMilli: number; postMilli: number; breachPenaltyMilli: number; goodConditionMilli: number };
  experience: { perTaskPermille: number; capPermille: number };
}
export interface BattleParams {
  sortie: { skillBasePermille: number; intensityFactorPermille: number; lossOnSuccessPermille: number; lossOnFailurePermille: number; hours: number };
  raidMitigationPerManPermille: number;
}
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
  agents: AgentParams;
  battle: BattleParams;
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
    if (typeof c.house !== "string") err("ID_UNKNOWN", `character ${c.id} has no house`);
    for (const o of c.objectives ?? []) {
      if (!(OBJECTIVE_KINDS as readonly string[]).includes(o.objective)) err("OBJECTIVE_UNKNOWN", `character ${c.id}: ${o.objective}`);
      if (o.target) need(locs, o.target, "location", `character ${c.id} objective ${o.id}`);
      if (!(o.priorityPermille >= 0 && o.priorityPermille <= 1000)) err("RANGE", `character ${c.id} objective ${o.id} priority`);
    }
  }
  for (const t of raw.traits) if (!(t.commitmentPermille >= 0 && t.commitmentPermille <= 1000)) err("RANGE", `trait ${t.id} commitmentPermille`);
  for (const p of raw.predicates) if (![0, 1, 2, 3].includes(p.wakeSignificance) || !(p.materialDelta > 0)) err("RANGE", `predicate ${p.id} wake metadata`);
  for (const l of raw.locations) if (l.fortification && !(l.fortification.garrison >= 0)) err("RANGE", `location ${l.id} garrison`);
  need(chars, sc.ruler, "character", "scenario.ruler");
  for (const h of sc.economy.holdings) need(locs, h.location, "location", "economy holding");
  for (const s of sc.threat.sites) { need(locs, s.site, "location", "threat site"); need(locs, s.target, "location", "threat target"); }
  for (const i of sc.interception) { need(locs, i.location, "location", "interception"); need(chars, i.by, "character", "interception"); }
  for (const s of sc.scripts) {
    if (s.kind === "travel") { need(chars, s.who, "character", "script"); need(locs, s.to, "location", "script"); if (!(MODES as readonly string[]).includes(s.mode)) err("MODE_MISSING", `script mode ${s.mode}`); }
    else if (s.kind === "order") { need(chars, s.from, "character", "script"); need(chars, s.to, "character", "script"); }
    else if (s.kind === "threat") { if (!sc.threat.sites.some((x) => x.site === s.site)) err("ID_UNKNOWN", `script threat site ${s.site}`); }
    else err("SCRIPT_UNKNOWN", `script kind ${(s as { kind: string }).kind}`);
  }
  for (const id of ["fortification.condition", "character.location", "character.seat", "order.status", "order.content", "report.route", "threat.intensity", "treasury.balance", "request.reinforce"]) need(preds, id, "predicate", "engine requires");

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
