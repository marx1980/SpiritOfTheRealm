// Agent model (ARCHITECTURE §20.2). Pure data: what a planner is given. Built from ViewOf(agent), the agent's own
// physical surroundings and static content knowledge (the map, the roster). Never from WorldState.
import type { Band } from "../beliefs.ts";
import type { AgentParams, BattleParams, ObjectiveDef, Trait } from "../content.ts";
import type { ActionRef, Reason, StructuredOrder } from "../schemas.ts";

export type { ActionRef };
export type Mode = "act" | "advise" | "obey";

export interface Seen { value: unknown; propId: number; ageTicks: number; band: Band; subject: { kind: string; id: string }; predicate: string }

/** A belief accessor. The runtime one reads the agent's view; the chronicle's oracle reads the truth. */
export interface Perceiver {
  get(subjectId: string, predicate: string): Seen | null;
  consulted(): Seen[];
}

export interface FortInfo { id: string; garrison: number; sites: string[]; stormMilliPerDay: number }
export interface CaptainInfo { id: string; troops: number; seat: string }

export interface Situation {
  now: number;
  agent: string;
  role: string;
  house: string;
  post: string;                          // where the agent belongs
  at: string | null;                     // null while travelling
  superior?: string;
  ruler: string;
  rulerSeat: string;
  traits: Trait[];
  cap: Record<string, number>;           // effective capability (base + experience)
  objectives: ObjectiveDef[];
  focus: string | null;
  troops: number;                        // the agent's own company
  defenceHere: number | null;            // men at the fort where the agent stands (physical surroundings)
  forts: FortInfo[];                     // static: fortified places and the threat sites near each
  captains: CaptainInfo[];               // known captains (roster + believed seat)
  travel: (from: string, to: string, mode: "rider" | "army") => number; // static map knowledge, ticks
  trust: (other: string) => number;
  /** How often this agent's requests to someone have been answered, from its own experience (prior: trust). */
  answerRate: (other: string) => number;
  loyalty: (other: string) => number;
  ordersInForce: StructuredOrder[];
  current: { action: ActionRef; score: number; adoptedAt: number; idle: boolean } | null;
  mode: Mode;
  order?: StructuredOrder;               // in "obey" mode
  p: { agents: AgentParams; battle: BattleParams; raidBaseMilli: number; restoreToMilli: number; repairCostPerMilli: number;
       repairDays: number; levyMilli: number; breachMilli: number; partialRestoreToMilli: number; decayMilliPerDay: number };
}

export interface Candidate { action: ActionRef; score: number; contributions: Reason[]; serves?: boolean; obey?: boolean }

export const actionKey = (a: ActionRef) => JSON.stringify(a);
export const DAY = 86400;
export const act = (kind: string, target?: string): ActionRef => (target === undefined ? { kind } : { kind, target });

export const avgTrait = (traits: Trait[], k: keyof Trait, dflt = 500) =>
  traits.length ? Math.floor(traits.reduce((a, t) => a + (t[k] as number), 0) / traits.length) : dflt;
/** The trait that pushes hardest on a dimension (furthest from 500), for naming in a Reason. */
export const dominantTrait = (traits: Trait[], k: keyof Trait) =>
  [...traits].sort((a, b) => Math.abs((b[k] as number) - 500) - Math.abs((a[k] as number) - 500) || (a.id < b.id ? -1 : 1))[0]?.id ?? "none";
