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
export interface Location { id: string; name: string; province: string; kind: string; terrain: string; exposurePermille: number; fortification?: { conditionMilli: number; garrison: number; archers?: number; horse?: number }; pos: [number, number] }
export interface Route { id: string; from: string; to: string; km: number; terrain: string; crossing?: { river: string; kind: string } }
export interface Predicate { id: string; subjectKind: SubjectRefC["kind"]; halfLifeTicks: number; domain: string; wakeSignificance: 0 | 1 | 2 | 3; materialDelta: number }
export interface Relationship { to: string; kind: string; value: number }
export interface ObjectiveDef { id: string; kind: "role" | "personal" | "political" | "situational"; objective: ObjectiveKind; priorityPermille: number; target?: string; reserveMilli?: number }
export interface Character { id: string; name: string; role: string; location: string; tier: (typeof TIERS)[number]; traits: string[]; reportsTo?: string;
  capabilities: Record<string, number>; relationships: Relationship[]; house: string; objectives: ObjectiveDef[]; troops?: number;
  household?: string; occupation?: string; adviceKinds?: string[]; repairScope?: "all" | "endangered" | "critical" }
export type Script =
  | { day: number; kind: "travel"; who: string; to: string; mode: Mode; secret?: boolean }
  | { day: number; kind: "order"; from: string; to: string; intent: string; objective: SubjectRefC; supersedesPrevious?: boolean; discretion?: "strict" | "bounded" | "delegated"; constraints?: { kind: string; textKey: string }[] }
  | { day: number; kind: "threat"; site: string; intensityPermille: number; durationDays: number };
export interface AgentParams {
  reviewDays: { strategic: number; operational: number };
  commitment: { baseMarginPermille: number; absFloorMilli: number };
  obedience: { adaptMarginMilli: number; refuseMarginMilli: number; changedCircumstancesPermille: number; dutyMilli: number; legitimacyRulerPermille: number };
  planning: { minCandidates: number; maxCandidates: number; skillPerExtraCandidate: number };
  horizonDays: number; quietDaysToEnd: number; requestAssessDays: number; answerLearningPermille: number; wakeBudgetPerDay: Record<(typeof TIERS)[number], number>;
  values: { manMilli: number; renownMilli: number; postMilli: number; breachPenaltyMilli: number; goodConditionMilli: number; communityMilli: number; communityFreshDays: number };
  experience: { perTaskPermille: number; capPermille: number };
  demoteAfterDays: number; recommendationTrustMin: number;
}
export interface BattleParams {
  sortie: { skillBasePermille: number; intensityFactorPermille: number; lossOnSuccessPermille: number; lossOnFailurePermille: number; hours: number; raiderMenAtFull: number; ambushPermilleAtFull: number; ambushFactorPermille: number;
    /** How commanders judge their chances when a sortie means a battle (D-068), fitted to battle results on TUNE seeds. */
    estimate?: { sharpness: number; skillBasePermille: number; raiderWeightPermille: number; lossOnWinPermille: number; lossOnDefeatPermille: number } };
  raidMitigationPerManPermille: number;
  /** Phase 8 battles (D-060): with these, a sortie that meets raiders fights a battle; without them, the single roll above. */
  field?: import("./battlefield/core.ts").FieldSpec;
  tactics?: import("./battlefield/core.ts").BattleParams;
  forces?: import("./battlefield/setup.ts").ForcesParams;
  nightfallHour?: number; dawnHour?: number;
}
export interface GrainPlace { location: string; store: number; production: number; need: number; cap: number }
/** Phase 7A grain: whole sacks, whole days. Raid damage at a place cuts its harvest for a while (the shortage is caused by the raids). */
/** Wider economy (D-039): goods held in stores at named places, priced by the realm's stock, moved by orders and convoys. */
export interface GoodsParams {
  kinds: string[];
  places: { location: string; house?: string; store: Record<string, number>; production: Record<string, number>; everyDays?: Record<string, number>; cap: Record<string, number> }[];
  houses: string[];
  /** Selling in a town glut it for that good (permille off the price per unit sold, up to a cap, wearing off daily); a House spends `permille` of what it holds every `everyDays` on refilling its store at the usual price (D-045). */
  market: { houseMarkupPermille: number; towns: { location: string; house: string; spreadPermille: number; cutPermille: number }[]; glutPermillePerUnit: number; glutMaxPermille: number; glutRecoverPermillePerDay: number; restock: { everyDays: number; permille: number } };
  price: Record<string, { baseMilli: number; target: number; slope: number }>;
  buy: Record<string, { units: number; reserveUnits: number }>;
  repair: { pointsPerUnit: number; coverPermille: number };
  convoy: { lossPermillePerDay: number; seizurePermilleAtFull: number; /** A caravan may be held up by weather or flooded roads: chance per day on the road, and how many days it loses (D-050). */ delayPermillePerDay?: number; delayDays?: [number, number] };
}
/** Wider economy, stage 2 (D-040): men called from a community's hands, armed from a fort's iron, paid for a season. */
export type Arm = "foot" | "archers" | "horse";
/** What it takes to arm one man of each kind (D-067): iron for blades and mail, timber for bows, a horse for a rider. */
export type ArmCost = { iron: number; timber: number; horses: number };
export interface ManpowerParams { arms?: Record<Arm, ArmCost>; musterMen: number; ironPerMan: number; mountedPermille: number; serviceDays: number; wageMilli: number; handsReservePermille: number; harvestPermille: number; grievanceAtFullPermille: number }
export interface GrainParams {
  places: GrainPlace[];
  harvestHitPermille: number; harvestHitDays: number;
  /** A bad harvest year (Phase 14B stage 4): on `checkDay` of each year a draw at `chancePermille` cuts every place's harvest by `cutPermille` for `days`. */
  blight?: { checkDay: number; chancePermille: number; cutPermille: number; days: number };
  /** Days of cover at which a place moves to the next scarcity band: plenty, adequate, tight, short (below that: famine). */
  bandDays: [number, number, number, number];
  /** The crown takes grain: `sacks` asked, the place keeps `reserveDays` of its own need; consulting first adds `consultDays` and softens the grievance. */
  requisition: { sacks: number; reserveDays: number; consultDays: number; grievance: number; consultedPermille: number; material: number; trustConsulted: number; trustTaken: number;
    /** A people may refuse to give: chance (permille) = (their grievance against the crown - gFloor) x chancePerG / 1000, capped; consulting first scales it by consultedPermille. */
    refuse?: { gFloor: number; chancePerG: number; consultedPermille: number; standDays?: number } };
  /** The crown buys: limited by coin and by the seller's surplus (it keeps `reserveDays` of its own need). */
  purchase: { sacks: number; reserveDays: number; priceMilliPerSack: number };
  /** Carts walk. A convoy can be lost on the road, or seized by raiders in proportion to the threat at either end. */
  convoy: { lossPermillePerDay: number; seizurePermilleAtFull: number; delayPermillePerDay?: number; delayDays?: [number, number] };
  /** The grain price at a market (D-050): the base, dearer with a shortage across the realm and at the nearest granary, after a spoiled harvest there, and with raiders about; clamped. */
  market?: { baseMilli: number; minMilli: number; maxMilli: number; targetDays: number; stockSlopePermille: number; bandPermille: number; harvestPermille: number; raidPermille: number };
  /** A fort with an empty store loses this share of its men a day (they leave or fall sick). */
  hungerPermille: number;
  /** A castellan who believes his own store would feed his place for fewer than `cover` days sends for grain himself (no one told him to, and he does not stop to consult); not again within `cooldownDays`. */
  official: { cover: number; cooldownDays: number; consultCover?: number };
  /** A castellan who dislikes bringing bad news writes a low store as this much higher (the same temperament that understates damage to walls). */
  understatePermille: number;
  /** Where the crisis lies, whose people are asked, and who may act on their grievance (read by the log classifier, not by the world). */
  crisis: { place: string; community: string; actor: string };
}
export type PolicyArea = "military" | "emergency" | "communities";
/** Standing policy and precedent (Phase 9, docs/POLICY.md). */
export interface PolicyParams {
  rules: Record<PolicyArea, string[]>;
  initial?: Partial<Record<PolicyArea, string>>; // in force from the start, known to everyone
  policyMilli: number; cautiousOddsPermille: number; boldOddsPermille: number; repairLimitMilli: number;
  officials: string[]; // the roles the proclamation is written to
  parley: { remitMilli: number; remedyPermille: number; trust: number };
  punish: { minMen: number; seizeMilli: number; grievancePermille: number; trust: number };
  precedent: { milli: number; halfLifeDays: number; oddsWindowPermille: number; max: number; watchDays: number };
}
/** Phase 10 (docs/ENVIRONMENT.md): the seasons, weather, ground, snow, river, stress and what they do to routes, harvests, walls and battles. All integers. */
export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];
export interface EnvRain { start: number; stay: number; heavy: number; storm: number } // permille: a dry day turns wet, a wet day stays wet, a wet day is heavy, a heavy day is a storm
export interface EnvRiver {
  base: number; recessPermille: number; gainPerMm: number; floodStage: number; floodedBelowPermille: number;
  basin: Record<string, number>; freezeBelowC10: number; freezeDays: number; thawAboveC10: number; thawDays: number;
}
export interface EnvironmentParams {
  yearDays: number; startDay: number;
  seasons: { id: Season; from: number }[];
  monthlyMeanC10: number[];
  anomalyC10: number; anomalyKeepPermille: number;
  regions: Record<string, { tempOffsetC10: number; wetOffsetPermille: number; stressPerDay: number }>;
  rain: Record<Season, EnvRain>;
  mm: { light: number; heavy: number };
  snowBelowC10: number; meltPerC10Permille: number;
  ground: { wetPerMm: number; evapPermille: Record<Season, number>; minEvap: number; mudAt: number; waterloggedAt: number; waterloggedOpen: number; runoffBase: number };
  snow: { slowAtCm: number; closeAtCm: number; openBelowCm: number; settlePermille: number; closes: string[]; waterloggedCloses: string[] };
  slow: { mud: Record<string, number>; snow: Record<string, number> };
  rivers: Record<string, EnvRiver>;
  crossings: Record<string, { closeAbove: number; openBelow: number; frozenClosed?: boolean }>;
  growthPermille: Record<Season, number>;
  harvest: {
    flood: { atLevel: number; permille: number; days: number; terrains: string[] };
    frost: { belowC10: number; fromDays: number; windowDays: number; permille: number; days: number };
    drought: { dryDays: number; permille: number; days: number };
    materialPermille: number; // a damaged harvest costs the people at that place this much of their means (community material), once
  };
  storm: { hitScale: number };
  fire: { dryDays: number; seasons: Season[]; maxPermille: number };
  quake: { scale: number; releasePermille: [number, number]; neighbourPermille: number; landslidePermilleAtFull: number; landslideTerrains: string[]; clearDays: [number, number] };
  battle: { mudSlowPermille: number };
  /** Starting values that differ from the defaults (tests and scenarios). */
  initial?: { regions?: Record<string, Partial<{ snow: number; wet: number; dry: number; anom: number }>>; rivers?: Record<string, Partial<{ level: number; ice: number }>>; stress?: Record<string, number> };
}
/** Phase 14B (docs/FRONTIER.md): the court across the border, its actors, instructions and the host that marches. */
export type FrontierStance = "settle" | "trade" | "press" | "strike";
export const FRONTIER_STANCES: readonly FrontierStance[] = ["settle", "trade", "press", "strike"];
export interface FrontierParams {
  /** The gate: a place across the border, the host's raid site. */
  site: string;
  /** Where the court sits. */
  market: string;
  /** The fort the host marches against. */
  target: string;
  actors: { ambassador: string; commander: string; merchant: string; representative: string };
  court: { reviewDays: [number, number]; holdDays: number; startStance: FrontierStance; informantNoise: number; thresholds: { tradeFrom: number; pressFrom: number; strikeFrom: number }; fallenBonus: number };
  delayDays: { ambassador: [number, number]; commander: [number, number]; merchant: [number, number] };
  strike: { cooldownDays: number; declinePermille: number; traitShift: Record<string, number>; intensityPermille: [number, number]; durationDays: [number, number] };
  /** Terms offered to the crown (open `openDays`), what accepting costs and buys, and what a refusal does to the court's reading. */
  treaty: { cooldownDays: number; openDays: number; truceDays: number; tributeMilli: number; refusePermille: number; refuseDays: number };
  /** The merchant's grain for the March while his stance is `trade` or `settle` and no host stands at the gate. */
  trade: { everyDays: number; dest: string; sacks: [number, number] };
  report: { everyDays: number; blurPermille: number };
}

/** Phase 11 (docs/EXPLORATION.md): the wood creature, expeditions, reputation and the Stone of Vey. */
export type ExpeditionKind = "scholarly" | "military";
export interface WildsParams {
  site: string;
  /** Whom a scripted ruler sends to look into the talk. */
  envoy: string;
  /** Places the creature hunts, with weights. */
  range: Record<string, number>;
  creature: { firstHuntDays: [number, number]; intervalDays: [number, number]; livestock: [number, number]; personPermille: number; materialPerHead: number };
  rumour: { perHunt: number; exaggeratePermille: [number, number]; radiusHours: number };
  stone: { foundPermillePerDay: number; actualLegitimacy: number; believedLegitimacy: number; examineDays: number; trustPerLegitimacy: number };
  expedition: {
    searchDays: number; signsPermille: number; hollowPermille: number; encounterPermille: number;
    /** Odds of each outcome of meeting the creature, by kind of party (permille, sum 1000); skill moves odds from "mauled" and "fell" to "killed". */
    encounter: Record<ExpeditionKind, { killed: number; fled: number; mauled: number; fell: number }>;
    skillShift: number;
    /** Which capability makes a good leader of each kind. */
    fitness: Record<ExpeditionKind, string>;
  };
  leader: { reputationWeight: number; fitnessFloor: number; sharpen: number };
  reputation: { signs: number; hollow: number; stone: number; survived: number; fled: number; mauled: number; fell: number; killed: number; activeAt: number };
  custody: { deliverLoyalty: number; deliverTrait: number; keepBase: number; keepTrait: number; keepOtherHouse: number; believedWorth: number };
}

export interface Scenario {
  environment?: EnvironmentParams;
  wilds?: WildsParams;
  frontier?: FrontierParams;
  policy?: PolicyParams;
  ruler: string; treasuryMilli: number;
  movement: { speedsKmPerDay: Record<Mode, Record<string, number>>; crossingDelayTicks: Record<string, number> };
  knowledge: { beliefCaps: Record<(typeof TIERS)[number], number>; bands: { certain: number; probable: number; uncertain: number };
    stormPenaltyPermille: number; maxErrorMilliPerMissingPermille: number; lowTrustBelow: number };
  economy: { holdings: { location: string; dailyIncomeMilli: number; jitterMilli: number }[]; dailyUpkeepMilli: number; captainAwayMilli: number };
  weather: { decayMilliPerDay: number; stormDamageMilli: [number, number]; fireDailyPermille: number; fireDamageMilli: [number, number]; quakeDailyPermille: number; quakeDamageMilli: [number, number] };
  threat: { sites: { site: string; target: string }[]; startPermillePerDay: number; intensityPermille: [number, number];
    durationDays: [number, number]; raidDamageMilliAtFullIntensity: number; retakeConditionMilli: number; retakeGarrisonPermille: number; growthPermille: number; growthEveryDays: number; awayStartMultiplier: number };
  messenger: { reportEveryDays: number; alarmBelowMilli: number; legJitterPermille: [number, number]; lossPermillePerDay: number;
    redirectLimit: number; understateMilli: number };
  interception: { location: string; by: string; permille: number }[];
  player: { repairCostMilliPerMilli: number; repairRestoreToMilli: number; repairDays: number; levyMilli: number; repairRushCostPermille: number; repairLabourWorkPermille: number; repairLabourToMilli: number; repairCompanyWorkPermille: number };
  grain?: GrainParams;
  goods?: GoodsParams;
  manpower?: ManpowerParams;
  scripts: Script[];
  endStates: { fortificationBreachedBelowMilli: number };
  /** Phase 14: when each ending is read from the log (docs/CONTENT.md). Read-only: nothing here changes the world. */
  endings: { horizonDays: number; fractureCommunities: number; fractureDays: number; lostForts: number; settlementDays: number; victoryHosts: number };
  agents: AgentParams;
  battle: BattleParams;
  regency: { regent: string; seat: string; maxRepairCostMilli: number; mayLevy: boolean; maySendCaptain: boolean };
  presence: { dangerBelowMilli: number; deathPermille: number; travelTo: string[] };
  objective: { forts: string[] };
}
export const STANCES = ["cooperate", "petition", "delay", "withhold", "refuse", "support"] as const;
export type Stance = (typeof STANCES)[number];
export const GRIEVANCE_KINDS = ["unprotected", "levy", "broken_promise", "misconduct"] as const;
export type GrievanceKind = (typeof GRIEVANCE_KINDS)[number];
export interface CommunityDef {
  id: string; name: string; cohorts: { id: string; sharePermille: number; weights: Record<GrievanceKind, number> }[];
  material: number; cohesion: number; resources: number; expectedBase: number;
  /** Weight of grievance at which this community would rally to a named actor, where it differs from the ladder's. */
  supportAt?: number;
  /** Men of fighting age who can be called to a muster. */
  hands?: number;
  leader: { id: string; trust: number } | null; reporter: string; exposedTo: string[]; levySharePermille: number; incomeFrom?: string; recruitsFor?: string;
  trust: Record<string, number>; memories: { kind: string; actor: string; about?: string; weight: number }[];
}
export interface CommunityParams {
  rumourDays: number; triggerDays: number; memoryCap: number; materialRecoveryPerDay: number; raidMaterialAtFull: number; levyMaterial: number;
  reliefMaterial: number; reliefMilli: number; misconductMaterial: number;
  grievance: { raidAtFull: number; levy: number; brokenPromise: number; misconduct: number; decayPermillePerDay: number; dropBelow: number };
  context: { underThreatPermille: number; poorBelow: number; poorPermille: number; calmPermille: number };
  remedy: { sortieWonPermille: number; fortRetakenPermille: number; reliefPermille: number; reliefPromisePermille: number; companyGoneDecayPermille: number };
  protectedDays: number;
  narrative: { ratePermillePerDay: number; accessHours: number; trustFloor: number; courtHours: number; trustPerDay: number; stayDays: number };
  trust: { reliefCrown: number; protectedCrown: number; brokenPromiseCrown: number; misconductCrown: number; levyCrown: number };
  weakness: { fortFell: number; unanswered: number; noCompany: number; lowGarrison: number; windowDays: number };
  misconduct: { dailyPermille: number; traitPermille: number; afterDays: number };
  ladder: { petition: number; gMin: number; nMin: number; lMin: number; delay: number; withhold: number; refuse: number; support: number; downPermille: number; supportTrust: number; repetitionDays: number; regrowth: number; reminderDays: number };
  effects: { income: Record<Stance, number>; recruits: Record<Stance, number>; levy: Record<Stance, number> };
}
export interface CommunitiesFile { params: CommunityParams; communities: CommunityDef[]; narrators: { who: string; story: "crown" | "others" }[] }
export interface RawContent {
  manifest: { schemaVersion: number; contentVersion: string };
  traits: Trait[]; provinces: Province[]; rivers: River[]; locations: Location[]; routes: Route[];
  predicates: Predicate[]; characters: Character[]; scenario: Scenario; communities: CommunitiesFile;
}
export interface Content extends RawContent {
  version: string; hash: string;
  /** Every place raiders come from and the fort each answers: the old threat sites, then the frontier's gate (Phase 14B). Only the old ones are drawn for by the daily threat stream. */
  raidSites: { site: string; target: string }[];
  byId: { location: Map<string, Location>; character: Map<string, Character>; route: Map<string, Route>; predicate: Map<string, Predicate>; trait: Map<string, Trait> };
}
export interface ContentError { code: string; msg: string }

const FILES = ["manifest", "traits", "provinces", "rivers", "locations", "routes", "predicates", "characters", "scenario", "communities"] as const;

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
  for (const g of sc.grain?.places ?? []) {
    need(locs, g.location, "location", "grain place");
    for (const k of ["store", "production", "need", "cap"] as const) if (!Number.isInteger(g[k]) || g[k] < 0) err("RANGE", `grain ${g.location} ${k}`);
    if (g.store > g.cap) err("RANGE", `grain ${g.location} store above cap`);
  }
  if (sc.grain && !(sc.grain.harvestHitPermille >= 0 && sc.grain.harvestHitPermille <= 1000)) err("RANGE", "grain harvestHitPermille");
  { const b = sc.grain?.blight; if (b && !(b.checkDay >= 1 && b.days >= 1 && b.chancePermille >= 0 && b.chancePermille <= 1000 && b.cutPermille >= 0 && b.cutPermille <= 1000)) err("RANGE", "grain.blight"); }
  const env = sc.environment;
  if (env) {
    const seasonIds = new Set<string>(SEASONS);
    if (!(env.yearDays > 0 && Number.isInteger(env.yearDays)) || !(env.startDay >= 0 && env.startDay < env.yearDays)) err("RANGE", "environment yearDays/startDay");
    if (env.monthlyMeanC10.length !== 12) err("RANGE", "environment monthlyMeanC10 needs 12 values");
    const froms = env.seasons.map((x) => x.from);
    if (env.seasons.length !== 4 || new Set(env.seasons.map((x) => x.id)).size !== 4 || env.seasons.some((x) => !seasonIds.has(x.id) || !(x.from >= 0 && x.from < env.yearDays))) err("RANGE", "environment seasons: the four seasons once each, starting inside the year");
    void froms;
    for (const p of provs) if (!env.regions[p]) err("ID_UNKNOWN", `environment.regions has no province ${p}`);
    for (const p of Object.keys(env.regions)) need(provs, p, "province", "environment.regions");
    for (const s of SEASONS) for (const k of ["rain", "growthPermille"] as const) if (!env[k][s]) err("RANGE", `environment.${k}.${s}`);
    for (const [id, r] of Object.entries(env.rivers)) {
      need(rivers, id, "river", "environment.rivers");
      for (const p of Object.keys(r.basin)) need(provs, p, "province", `environment river ${id} basin`);
      if (Object.values(r.basin).reduce((a, x) => a + x, 0) !== 1000) err("RANGE", `environment river ${id}: basin shares must sum to 1000`);
    }
    for (const rt of raw.routes) if (rt.crossing) {
      if (!env.rivers[rt.crossing.river]) err("ID_UNKNOWN", `environment.rivers has no ${rt.crossing.river} (route ${rt.id})`);
      if (!env.crossings[rt.crossing.kind]) err("ID_UNKNOWN", `environment.crossings has no ${rt.crossing.kind} (route ${rt.id})`);
    }
    for (const [k, c] of Object.entries(env.crossings)) if (!(c.openBelow < c.closeAbove)) err("RANGE", `environment crossing ${k}: reopens below it closes`);
    for (const t of [...Object.keys(env.slow.mud), ...Object.keys(env.slow.snow), ...env.snow.closes, ...env.quake.landslideTerrains]) if (!terrains.has(t)) err("TERRAIN_UNKNOWN", `environment: ${t}`);
    for (const [p, d] of Object.entries(env.initial?.regions ?? {})) { need(provs, p, "province", "environment.initial"); void d; }
  }
  for (const s of sc.threat.sites) { need(locs, s.site, "location", "threat site"); need(locs, s.target, "location", "threat target"); }
  for (const i of sc.interception) { need(locs, i.location, "location", "interception"); need(chars, i.by, "character", "interception"); }
  need(chars, sc.regency.regent, "character", "regency.regent"); need(locs, sc.regency.seat, "location", "regency.seat");
  for (const l of sc.presence.travelTo) need(locs, l, "location", "presence.travelTo");
  for (const f of sc.objective.forts) if (!raw.locations.find((l) => l.id === f)?.fortification) err("ID_UNKNOWN", `objective fort ${f} is not fortified`);
  const en = sc.endings;
  if (!en || ![en.horizonDays, en.fractureCommunities, en.fractureDays, en.lostForts, en.settlementDays, en.victoryHosts].every((n) => Number.isInteger(n) && n >= 1)) err("RANGE", "scenario.endings needs whole numbers of at least 1");
  else if (en.lostForts > sc.objective.forts.length) err("RANGE", "scenario.endings.lostForts is more than the objective forts");
  for (const l of raw.locations) if (!Array.isArray(l.pos) || l.pos.length !== 2) err("POSITION", `location ${l.id} has no map position`);
  for (const s of sc.scripts) {
    if (s.kind === "travel") { need(chars, s.who, "character", "script"); need(locs, s.to, "location", "script"); if (!(MODES as readonly string[]).includes(s.mode)) err("MODE_MISSING", `script mode ${s.mode}`); }
    else if (s.kind === "order") { need(chars, s.from, "character", "script"); need(chars, s.to, "character", "script"); }
    else if (s.kind === "threat") { if (!sc.threat.sites.some((x) => x.site === s.site)) err("ID_UNKNOWN", `script threat site ${s.site}`); }
    else err("SCRIPT_UNKNOWN", `script kind ${(s as { kind: string }).kind}`);
  }
  const cm = raw.communities;
  if (!cm?.communities) err("COMMUNITIES_MISSING", "communities.json");
  else {
    const cids = ids(cm.communities, "community");
    for (const c of cm.communities) {
      need(locs, c.id, "location", `community ${c.id} (a community lives at the place of its id)`);
      need(chars, c.reporter, "character", `community ${c.id} reporter`);
      if (c.leader) need(chars, c.leader.id, "character", `community ${c.id} leader`);
      for (const x of c.exposedTo) if (!sc.threat.sites.some((t) => t.site === x)) err("ID_UNKNOWN", `community ${c.id} exposed to ${x}: not a threat site`);
      if (c.cohorts.reduce((a, x) => a + x.sharePermille, 0) !== 1000) err("RANGE", `community ${c.id} cohort shares must sum to 1000`);
      if (c.supportAt !== undefined && !(c.supportAt >= 0 && c.supportAt <= 1000)) err("RANGE", `community ${c.id} supportAt`);
      for (const k of ["material", "cohesion", "resources", "expectedBase"] as const) if (!(c[k] >= 0 && c[k] <= 1000)) err("RANGE", `community ${c.id} ${k}`);
      if (c.incomeFrom && !sc.economy.holdings.some((h) => h.location === c.incomeFrom)) err("ID_UNKNOWN", `community ${c.id} income from ${c.incomeFrom}: no holding`);
      if (c.recruitsFor && !raw.locations.find((l) => l.id === c.recruitsFor)?.fortification) err("ID_UNKNOWN", `community ${c.id} recruits for ${c.recruitsFor}: not a fort`);
    }
    if (cm.communities.reduce((a, c) => a + c.levySharePermille, 0) > 1000) err("RANGE", "community levy shares exceed 1000");
    for (const n of cm.narrators) need(chars, n.who, "character", "narrator");
    void cids;
  }
  for (const id of ["fortification.condition", "character.location", "character.seat", "order.status", "order.content", "report.route", "threat.intensity", "treasury.balance", "request.reinforce"]) need(preds, id, "predicate", "engine requires");

  if (sc.environment) need(preds, "road.closed", "predicate", "the environment needs it (news of shut roads)");
  const bw = sc.wilds;
  if (bw) {
    for (const id of ["site.rumour", "site.signs", "creature.nature", "stone.found", "stone.properties"]) need(preds, id, "predicate", "the wood expeditions need it");
    need(locs, bw.site, "location", "wilds.site");
    need(chars, bw.envoy, "character", "wilds.envoy");
    for (const p of Object.keys(bw.range)) need(locs, p, "location", "wilds.range");
    for (const k of ["scholarly", "military"] as const) {
      const e = bw.expedition.encounter[k];
      if (!e || e.killed + e.fled + e.mauled + e.fell !== 1000) err("RANGE", `wilds.expedition.encounter.${k} must sum to 1000`);
    }
    if (!(bw.creature.intervalDays[0] > 0 && bw.creature.intervalDays[0] <= bw.creature.intervalDays[1])) err("RANGE", "wilds.creature.intervalDays");
  }
  const fr = sc.frontier;
  if (fr) {
    need(preds, "frontier.posture", "predicate", "the frontier's representative writes it");
    need(preds, "frontier.treaty", "predicate", "the ambassador writes it");
    need(locs, fr.trade.dest, "location", "frontier.trade.dest");
    if (!(fr.trade.everyDays >= 1 && fr.trade.sacks[0] >= 0 && fr.trade.sacks[0] <= fr.trade.sacks[1])) err("RANGE", "frontier.trade");
    if (!(fr.treaty.openDays >= 1 && fr.treaty.truceDays >= 1 && fr.treaty.tributeMilli >= 0 && fr.treaty.refuseDays >= 0)) err("RANGE", "frontier.treaty");
    for (const l of [fr.site, fr.market, fr.target]) need(locs, l, "location", "frontier");
    for (const [k, id] of Object.entries(fr.actors)) need(chars, id, "character", `frontier.actors.${k}`);
    if (!sc.objective.forts.includes(fr.target)) err("ID_UNKNOWN", `frontier.target ${fr.target} is not an objective fort`);
    if (!FRONTIER_STANCES.includes(fr.court.startStance)) err("RANGE", "frontier.court.startStance");
    const t = fr.court.thresholds;
    for (const [k, [a, b]] of Object.entries({ ...fr.delayDays, review: fr.court.reviewDays, duration: fr.strike.durationDays, intensity: fr.strike.intensityPermille }) as [string, [number, number]][]) if (!(a >= 0 && a <= b)) err("RANGE", `frontier ${k} range`);
    if (!(fr.court.reviewDays[0] >= 1)) err("RANGE", "frontier.court.reviewDays");
    if (!(t.tradeFrom <= t.pressFrom && t.pressFrom <= t.strikeFrom)) err("RANGE", "frontier.court.thresholds must not fall");
    if (!(fr.strike.declinePermille >= 0 && fr.strike.declinePermille <= 1000)) err("RANGE", "frontier.strike.declinePermille");
  }
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
    raidSites: [...raw.scenario.threat.sites.map((x) => ({ site: x.site, target: x.target })), ...(raw.scenario.frontier ? [{ site: raw.scenario.frontier.site, target: raw.scenario.frontier.target }] : [])],
    byId: { location: m(raw.locations), character: m(raw.characters), route: m(raw.routes), predicate: m(raw.predicates), trait: m(raw.traits) },
  };
}

/** Strip the derived fields of a Content back to its raw files. */
export function rawOf(c: Content): RawContent {
  const { version: _v, hash: _h, byId: _b, raidSites: _r, ...raw } = c;
  return structuredClone(raw) as RawContent;
}

/** A variant with the background cast (Tier C) multiplied, for scaling tests (G-14). Copies live where the originals do. */
export function withExtraBackground(c: Content, factor: number): Content {
  const raw = rawOf(c);
  const bg = raw.characters.filter((x) => x.tier === "C");
  for (let k = 2; k <= factor; k++)
    for (const x of bg) raw.characters.push({ ...structuredClone(x), id: `${x.id}_${k}`, name: `${x.name} (${k})`,
      relationships: x.relationships.filter((r) => r.kind !== "recommends") });
  raw.manifest = { ...raw.manifest, contentVersion: `${raw.manifest.contentVersion}+bg${factor}` };
  return deriveContent(raw);
}

export function loadContent(dir: string): Content {
  return deriveContent(readContentDir(dir));
}
