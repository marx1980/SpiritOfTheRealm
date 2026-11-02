// B1: event envelope and the registry of event types. Every type belongs to one system (for ablation),
// one domain and a significance layer, and is either a root (exogenous / player input / test script) or not.

export const EVENT_SCHEMA_VERSION = 3; // v3 (Phase 3): agents, DecisionTrace, obedience payloads; v2 (Phase 2): B2/B5 payloads

export type Domain = "military" | "economic" | "political" | "social" | "environment" | "magic" | "info";
export type SystemId = "core" | "economy" | "weather" | "threat" | "movement" | "knowledge" | "messenger" | "orders" | "player" | "advice" | "agents" | "battle";
export const ABLATABLE: readonly SystemId[] = ["economy", "weather", "threat", "messenger"];

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
  RouteClosed: T("movement", "environment", 2, true),
  RouteOpened: T("movement", "environment", 2, true),
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
  DetachmentSent: T("agents", "military", 1),
  DetachmentArrived: T("agents", "military", 1),
});
