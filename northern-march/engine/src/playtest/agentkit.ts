// What a player agent may use besides the contract (v4.1 A3): its own deterministic RNG, independent of every
// simulation stream, and small helpers over the observation. Nothing here reads the simulation.
import type { ActionAffordance, Evidence, Persona, PlayerAgentDecision, PlayerObservation } from "./contract.ts";
import { PLAYTEST_SCHEMA_VERSION } from "./contract.ts";

/** xoshiro128** seeded by FNV-1a of a string: the agent's own stream. */
export class AgentRng {
  private s: [number, number, number, number];
  constructor(key: string) {
    let h = 0x811c9dc5;
    const next = () => { for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; return h || 1; };
    this.s = [next(), next(), next(), next()];
  }
  u32(): number {
    const s = this.s, r = Math.imul(((Math.imul(s[1], 5) << 7) | (Math.imul(s[1], 5) >>> 25)), 9) >>> 0, t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = (s[3] << 11) | (s[3] >>> 21);
    return r;
  }
  int(lo: number, hi: number): number { return lo + (this.u32() % (hi - lo + 1)); }
  chance(permille: number): boolean { return this.u32() % 1000 < permille; }
  pick<T>(xs: readonly T[]): T { return xs[this.int(0, xs.length - 1)]; }
}

/** Per-run memory an agent keeps between decisions (test-side only, never fed back into the simulation). */
export type AgentMemory = Record<string, unknown>;
export interface PlayerAgent {
  readonly persona: Persona;
  /** What the agent is meant to expose (v4.1 A2), shown in reports. */
  readonly note: string;
  decide(obs: PlayerObservation, rng: AgentRng, memory: AgentMemory): PlayerAgentDecision | unknown;
}

export const decision = (obs: PlayerObservation, persona: Persona, choose: string[], text: string, cites: string[]): PlayerAgentDecision =>
  ({ schemaVersion: PLAYTEST_SCHEMA_VERSION, observationId: obs.id, agent: persona, choose: [...new Set(choose)], rationale: { text: text.slice(0, 500), cites: [...new Set(cites)].slice(0, 20) } });
export const wait = (obs: PlayerObservation, persona: Persona, text = "Nothing calls for an order"): PlayerAgentDecision =>
  decision(obs, persona, [], text, []);

export const of = <K extends ActionAffordance["kind"]>(obs: PlayerObservation, kind: K) => obs.affordances.filter((a): a is Extract<ActionAffordance, { kind: K }> => a.kind === kind);
export const ev = (obs: PlayerObservation, idv: string | undefined): Evidence | undefined => obs.evidence.find((e) => e.id === idv);
/** Wall condition in words, as a rough number (the agent reads words, like a person). */
export function wallScore(words: string): number {
  const w = words.toLowerCase();
  return /breached/.test(w) ? 20 : /near collapse/.test(w) ? 35 : /badly damaged/.test(w) ? 47 : /damaged/.test(w) ? 62 : /worn/.test(w) ? 77 : /sound/.test(w) ? 90 : 60;
}
export function raiderScore(words: string): number {
  const w = words.toLowerCase();
  return /no raiders/.test(w) ? 0 : /large host/.test(w) ? 80 : /strong band/.test(w) ? 50 : /small band/.test(w) ? 20 : 30;
}
export const fresh = (e: Evidence | undefined, days: number) => !!e && e.ageDays <= days;
export const sure = (e: Evidence | undefined) => !!e && (e.certainty === "certain" || e.certainty === "probably");
/** Coins after paying for the given affordances (null if unknown). */
export const left = (obs: PlayerObservation, xs: readonly ActionAffordance[]) => obs.ruler.coinsMilli === null ? null : obs.ruler.coinsMilli - xs.reduce((s, a) => s + (a.costMilli ?? 0), 0);
/** Places the agent believes are walls at risk, worst first, with the evidence behind each. */
export function wallsAtRisk(obs: PlayerObservation, below: number) {
  return obs.places.filter((p) => p.fortified && p.walls && wallScore(p.walls.words) < below)
    .map((p) => ({ place: p.id, score: wallScore(p.walls!.words), evidence: ev(obs, p.walls!.evidenceId)! })).sort((a, b) => a.score - b.score || (a.place < b.place ? -1 : 1));
}
export function raidersSeen(obs: PlayerObservation) {
  return obs.places.filter((p) => p.raiders && raiderScore(p.raiders.words) > 0)
    .map((p) => ({ place: p.id, score: raiderScore(p.raiders!.words), evidence: ev(obs, p.raiders!.evidenceId)! })).sort((a, b) => b.score - a.score || (a.place < b.place ? -1 : 1));
}
