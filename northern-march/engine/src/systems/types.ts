import type { Content } from "../content.ts";
import type { SimEvent, SubjectRef, SystemId } from "../events.ts";
import type { Rng } from "../rng.ts";
import type { WorldState } from "../world.ts";

export interface SimParams {
  /** Extra RNG draws per daily step, per system (G-02 isolation test). */
  extraDraws?: Partial<Record<SystemId, number>>;
}

/** What a system sees. State is read-only by convention: it changes only through emit() -> reducer. */
export interface Ctx {
  readonly tick: number;
  readonly seed: number;
  readonly content: Content;
  readonly s: Readonly<WorldState>;
  readonly params: SimParams;
  emit(type: string, causedBy: number[], subjects: SubjectRef[], payload: Record<string, unknown>, rngStream?: string): SimEvent;
  at(tick: number, handler: string, args: Record<string, unknown>): void;
  rng(stream: string): Rng;
  /** One-off keyed substream: same key, same draws, whatever happened before (A3). */
  keyed(stream: string): Rng;
  enabled(system: SystemId): boolean;
  travelTicks(from: string, to: string): number;
  observe(kind: string, data: Record<string, number | boolean | string>): void;
  extraDraws(system: SystemId): void;
}

export interface System {
  id: SystemId;
  start(ctx: Ctx): void;
  handlers: Record<string, (ctx: Ctx, args: Record<string, any>) => void>;
}

export const DAY = 86400;
export const HOUR = 3600;
