import type { Content } from "../content.ts";
import type { SimEvent, SubjectRef, SystemId } from "../events.ts";
import type { MapGraph } from "../map.ts";
import type { Rng } from "../rng.ts";
import type { WorldState } from "../world.ts";

export interface SimParams {
  /** Extra RNG draws per daily step, per system (G-02 isolation test). */
  extraDraws?: Partial<Record<SystemId, number>>;
  /** Interactive play: a daily decision point for the player. */
  checkpoints?: boolean;
  /** Interactive play: a decision point at the end of every day on which a letter reached the ruler, after that day's advice. */
  dayEnd?: boolean;
}

/** What a system sees. State is read-only by convention: it changes only through emit() -> reducer. */
export interface Ctx {
  readonly tick: number;
  readonly seed: number;
  readonly content: Content;
  readonly s: Readonly<WorldState>;
  readonly params: SimParams;
  readonly map: MapGraph;
  emit(type: string, causedBy: number[], subjects: SubjectRef[], payload: Record<string, unknown>, rngStream?: string): SimEvent;
  at(tick: number, handler: string, args: Record<string, unknown>): void;
  rng(stream: string): Rng;
  /** One-off keyed substream: same key, same draws, whatever happened before (A3). */
  keyed(stream: string): Rng;
  enabled(system: SystemId): boolean;
  isOpen(routeId: string): boolean;
  halfLife(predicate: string): number;
  extraDraws(system: SystemId): void;
  /** Per-simulation scratch (wake index, pending wakes). Not world state: rebuilt deterministically on replay. */
  readonly runtime: Record<string, any>;
}

export interface System {
  id: SystemId;
  start(ctx: Ctx): void;
  handlers: Record<string, (ctx: Ctx, args: Record<string, any>) => void>;
  /** Called after every event is applied (used by the wake subscription index). Must not emit. */
  onEvent?: (ctx: Ctx, e: SimEvent) => void;
}

export const DAY = 86400;
export const HOUR = 3600;
export const loc = (id: string) => ({ kind: "location" as const, id });
export const chr = (id: string) => ({ kind: "character" as const, id });
export const sorted = <T>(xs: Iterable<T>, key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
