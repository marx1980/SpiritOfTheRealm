// B1: event envelope and the registry of event types. Every type belongs to one system (for ablation),
// one domain, a significance layer, and is either a root (exogenous / player input: may have no cause) or not.

export const EVENT_SCHEMA_VERSION = 1;

export type Domain = "military" | "economic" | "political" | "social" | "environment" | "magic" | "info";
export type SystemId = "core" | "economy" | "weather" | "threat" | "messenger" | "player";
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
  root: boolean; // may have an empty causedBy (exogenous process or player input)
}

const T = (system: SystemId, domain: Domain, significance: 0 | 1 | 2 | 3, root = false): EventTypeDef => ({ system, domain, significance, root });

export const EVENT_TYPES: Readonly<Record<string, EventTypeDef>> = Object.freeze({
  ScenarioStarted: T("core", "info", 3, true),
  TreasuryCollected: T("economy", "economic", 2, true),
  UpkeepPaid: T("economy", "economic", 2, true),
  FortificationsWeathered: T("weather", "environment", 1, true),
  Storm: T("weather", "environment", 2, true),
  ThreatBegan: T("threat", "military", 3, true),
  RaidDamage: T("threat", "military", 2),
  ThreatEnded: T("threat", "military", 2),
  ReportComposed: T("messenger", "info", 1),
  ReportLost: T("messenger", "info", 1),
  ReportDelivered: T("messenger", "info", 2),
  BeliefUpdated: T("messenger", "info", 1),
  OrderDelivered: T("messenger", "info", 1),
  OrderLost: T("messenger", "info", 1),
  PlayerInput: T("player", "political", 3, true),
  RepairStarted: T("player", "military", 1),
  RepairCompleted: T("player", "military", 1),
  RepairRefused: T("player", "economic", 1),
  LevyRaised: T("player", "economic", 2),
});
