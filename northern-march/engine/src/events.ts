// B1: event envelope and the registry of event types. Every type belongs to one system (for ablation),
// one domain and a significance layer, and is either a root (exogenous / player input / test script) or not.

export const EVENT_SCHEMA_VERSION = 3; // v3 (Phase 3): agents, DecisionTrace, obedience payloads; v2 (Phase 2): B2/B5 payloads

export type Domain = "military" | "economic" | "political" | "social" | "environment" | "magic" | "info";
export type SystemId = "core" | "economy" | "weather" | "threat" | "movement" | "knowledge" | "messenger" | "orders" | "player" | "advice" | "agents" | "battle" | "communities" | "grain" | "goods" | "manpower" | "policy" | "environment" | "exploration" | "frontier";
export const ABLATABLE: readonly SystemId[] = ["economy", "weather", "threat", "messenger", "communities", "environment", "exploration", "frontier"];

export interface SubjectRef {
  kind: "character" | "location" | "report" | "order";
  id: string;
}

export interface SimEvent {
  schemaVersion: number;
  id: number;
  tick: number;
  type: string;
  domain: Domain;
  significance: 0 | 1 | 2 | 3;
  causedBy: number[];
  subjects: SubjectRef[];
  payload: Record<string, unknown>;
  rngStream?: string;
}

export interface EventTypeDef {
  system: SystemId;
  domain: Domain;
  significance: 0 | 1 | 2 | 3;
  root: boolean;
}

const T = (system: SystemId, domain: Domain, significance: 0 | 1 | 2 | 3, root = false): EventTypeDef => ({ system, domain, significance, root });

export const EVENT_TYPES: Readonly<Record<string, EventTypeDef>> = Object.freeze({
  ScenarioStarted: T("core", "info", 3, true),
  // physical processes
  TreasuryCollected: T("economy", "economic", 2, true),
  UpkeepPaid: T("economy", "economic", 2, true),
  FortificationsWeathered: T("weather", "environment", 1, true),
  GarrisonRecovered: T("economy", "military", 1, true),
  CompanyRecovered: T("economy", "military", 1, true),
  Storm: T("weather", "environment", 2, true),
  ThreatBegan: T("threat", "military", 3, true),
  RaidDamage: T("threat", "military", 2),
  ThreatEnded: T("threat", "military", 2),
  ThreatGrew: T("threat", "military", 2),
  FortFell: T("threat", "military", 3),
  FortAssaulted: T("battle", "military", 3),
  FortRetaken: T("battle", "military", 3),
  ThreatScripted: T("threat", "military", 3, true), // test/scenario script only
  // movement
  TravelScripted: T("movement", "info", 1, true), // test/scenario script only
  Departed: T("movement", "info", 1),
  Arrived: T("movement", "info", 1),
  RouteClosed: T("environment", "environment", 2),
  RouteOpened: T("environment", "environment", 2),
  // environment (Phase 10, docs/ENVIRONMENT.md)
  EnvironmentDay: T("environment", "environment", 1, true), // the daily step: a clock-driven snapshot
  Hazard: T("environment", "environment", 2), // a storm, fire or earthquake striking a place (the legacy weather system's Storm, from the state of the environment)
  RiverFlooded: T("environment", "environment", 2),
  RiverReceded: T("environment", "environment", 1),
  RiverFroze: T("environment", "environment", 1),
  RiverThawed: T("environment", "environment", 1),
  StressReleased: T("environment", "environment", 3), // an earthquake: the stress it let go
  CropDamaged: T("environment", "environment", 2),
  SupplyBlocked: T("grain", "economic", 2), // an official could not send for grain because the roads were shut
  // frontier (Phase 14B, docs/FRONTIER.md)
  FrontierReview: T("frontier", "political", 2, true), // the court reads the March through its informants: a clock-driven step
  FrontierInstruction: T("frontier", "political", 2),
  FrontierInstructionArrived: T("frontier", "political", 2),
  FrontierContradiction: T("frontier", "political", 3),
  FrontierStrike: T("frontier", "military", 3),
  FrontierDeclined: T("frontier", "military", 2),
  FrontierObserved: T("frontier", "info", 1), // the crown's representative looks at the commander
  TreatyProposed: T("frontier", "political", 3),
  TreatyAnswered: T("frontier", "political", 3), // the ruler's answer leaves her hands
  TreatySigned: T("frontier", "political", 3), // her acceptance reaches the court: the tribute, and a truce
  TreatyRefused: T("frontier", "political", 3), // her refusal reaches the court
  FrontierTrade: T("frontier", "economic", 2), // the merchant's grain reaches the March
  // exploration (Phase 11, docs/EXPLORATION.md)
  CreatureHunt: T("exploration", "social", 2, true), // the creature takes livestock, sometimes a person: a clock-driven step
  ExpeditionStarted: T("exploration", "military", 2),
  SiteSearched: T("exploration", "info", 1),
  CreatureEncountered: T("exploration", "military", 3),
  ExpeditionEnded: T("exploration", "military", 3),
  LeaderFell: T("exploration", "military", 3),
  ReputationChanged: T("exploration", "political", 2),
  CharacterEmerged: T("exploration", "political", 3),
  StoneFound: T("exploration", "political", 3),
  StoneTaken: T("exploration", "political", 3),
  StoneKept: T("exploration", "political", 3),
  StoneSent: T("exploration", "political", 3),
  StoneDelivered: T("exploration", "political", 3),
  StoneLost: T("exploration", "political", 3),
  StoneExamined: T("exploration", "political", 2),
  // knowledge (B5)
  Observed: T("knowledge", "info", 0),
  BeliefUpdated: T("knowledge", "info", 1),
  BeliefResolved: T("knowledge", "info", 0),
  BeliefEvicted: T("knowledge", "info", 0),
  // transmission
  ReportComposed: T("messenger", "info", 1),
  ReportDispatched: T("messenger", "info", 1),
  ReportDelivered: T("messenger", "info", 2),
  ReportLost: T("messenger", "info", 1),
  ReportIntercepted: T("messenger", "info", 2),
  InterceptedReportReceived: T("messenger", "info", 2),
  ReportUndeliverable: T("messenger", "info", 1),
  ReportShared: T("messenger", "info", 1), // read out to the councillors present
  MessengerRedirected: T("messenger", "info", 0),
  OrderDispatched: T("messenger", "political", 1),
  OrderLost: T("messenger", "political", 2),
  OrderIntercepted: T("messenger", "political", 2),
  InterceptedOrderReceived: T("messenger", "political", 2),
  OrderUndeliverable: T("messenger", "political", 2),
  // orders (B2 lifecycle)
  OrderScripted: T("orders", "political", 2, true), // test/scenario script only
  OrderIssued: T("orders", "political", 2),
  OrderReceived: T("orders", "political", 2),
  OrderInterpreted: T("orders", "political", 1),
  ObedienceDecided: T("orders", "political", 2),
  LocalPlanFormed: T("orders", "political", 1),
  SubordinateOrdersIssued: T("orders", "political", 1),
  ExecutionStarted: T("orders", "political", 1),
  OrderCompleted: T("orders", "political", 2),
  OrderSuperseded: T("orders", "political", 1),
  OrderAbandoned: T("orders", "political", 2),
  RepairStarted: T("orders", "military", 1),
  RepairCompleted: T("orders", "military", 1),
  RepairResynced: T("orders", "military", 1),
  AdviceScheduled: T("agents", "political", 0),
  DayEndScheduled: T("player", "info", 0),
  AdviceSettled: T("agents", "political", 0),
  LevyRaised: T("orders", "economic", 2),
  ReliefSent: T("orders", "economic", 2),
  // communities (Phase 6)
  CommunityHeard: T("communities", "social", 1),
  CommunitiesDrifted: T("communities", "social", 0, true), // a clock-driven review: time passing is its cause
  NarratorVisited: T("communities", "social", 1), // a day among them: the visitor's standing grows
  TroopMisconduct: T("communities", "social", 2),
  ReliefDelivered: T("communities", "social", 2),
  PetitionMade: T("communities", "political", 2),
  CommunityStanceChanged: T("communities", "political", 3),
  // grain (Phase 7A)
  GrainDay: T("grain", "economic", 1, true), // the daily tally: a clock-driven step
  HarvestDamaged: T("grain", "economic", 2), // raids cut a place's harvest
  GarrisonStarved: T("grain", "military", 2),
  GrainConsulted: T("grain", "political", 2),
  GrainShipped: T("grain", "economic", 2),
  GrainDelivered: T("grain", "economic", 2),
  GrainLost: T("grain", "economic", 2),
  GoodsDay: T("goods", "economic", 1, true), // the daily tally and the day's prices: a clock-driven step
  GoodsShipped: T("goods", "economic", 2),
  GoodsDelivered: T("goods", "economic", 2),
  GoodsLost: T("goods", "economic", 2),
  GoodsSold: T("goods", "economic", 2),
  HouseRestocked: T("goods", "economic", 1), // a House spends what the crown paid it on refilling its store (D-045)
  MusterCalled: T("manpower", "military", 2),
  MusterArrived: T("manpower", "military", 2),
  MusterEnded: T("manpower", "military", 2),
  GrainRefused: T("grain", "political", 2), // the people whose grain it is say no
  GrainAsked: T("grain", "economic", 1), // a castellan decides to send for grain himself
  ScarcityChanged: T("grain", "economic", 2),
  // player and advice
  PlayerInput: T("player", "political", 3, true),
  DangerSignalled: T("core", "military", 3), // the ruler is warned before danger can be lethal
  CampaignEnded: T("core", "political", 3),
  RecommendationMade: T("advice", "political", 1), // B3: advisers prepare advice when court business arrives
  // agents (Phase 3)
  AgentWoke: T("agents", "info", 0),
  DecisionMade: T("agents", "political", 1),
  ExperienceGained: T("agents", "info", 0),
  ResponseAssessed: T("agents", "info", 0), // was a request answered? (agents learn whom they can count on)
  // tiers (Phase 4)
  CharacterPromoted: T("agents", "political", 2),
  CharacterDemoted: T("agents", "political", 1, true), // a clock-driven review: time passing is its cause
  LeaderAppointed: T("agents", "political", 2),
  SortieLaunched: T("battle", "military", 2),
  SortieResolved: T("battle", "military", 3),
  LossesTaken: T("battle", "military", 2),
  // Phase 8 battles (D-060)
  BattleBegan: T("battle", "military", 3),
  BattleOrderGiven: T("battle", "military", 2),
  BattleEnded: T("battle", "military", 3),
  ThreatWeakened: T("battle", "military", 2),
  PrestigeChanged: T("battle", "political", 2),
  BattleConduct: T("battle", "military", 1),
  // Phase 12: a commander fell in battle (docs/COMMAND.md §7)
  CommanderFell: T("battle", "military", 2),
  // Phase 9: standing policy and precedent (D-070)
  PolicyProclaimed: T("policy", "political", 3),
  PolicyLearned: T("policy", "political", 1),
  PolicyApplied: T("policy", "political", 2),
  CommunityParley: T("policy", "social", 2),
  CommunityPunished: T("policy", "social", 2),
  PrecedentRecorded: T("policy", "political", 1),
  DetachmentSent: T("agents", "military", 1),
  DetachmentArrived: T("agents", "military", 1),
});
