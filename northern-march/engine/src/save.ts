// A4: save files carry schemaVersion; migrations are explicit functions; unknown versions fail loudly.
import type { PolicyId } from "./policies.ts";
import type { RngState } from "./rng.ts";
import type { SimParams } from "./systems/types.ts";
import type { SystemId } from "./events.ts";

export const SAVE_SCHEMA_VERSION = 1;

export interface InputRecord { decision: number; tick: number; action: "repair" | "levy" | "advance"; target: string | null }
export interface SaveFile {
  schemaVersion: number; contentVersion: string; contentHash: string;
  seed: number; policy: PolicyId; params: SimParams; ablate: SystemId[];
  tick: number; decisions: number; inputs: InputRecord[];
  rngStates: Record<string, { state: RngState; draws: number }>;
  logHash: string; eventCount: number;
}

const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  // v0 called the input list "playerInputs".
  0: (s) => { const { playerInputs, ...rest } = s; return { ...rest, inputs: playerInputs, schemaVersion: 1 }; },
};

export function migrateSave(raw: Record<string, unknown>): SaveFile {
  let s = raw;
  for (;;) {
    const v = s.schemaVersion as number;
    if (v === SAVE_SCHEMA_VERSION) return s as unknown as SaveFile;
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`unsupported save schemaVersion ${v}`);
    s = m(s);
  }
}
