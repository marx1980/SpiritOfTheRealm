// L5: shrink a failing game to a minimal reproducible case (fewest days, fewest orders, fewest actions), then export it
// as a permanent regression case. Orders are keyed by time: each is given at the first decision point at or after
// its tick, so removing one does not shift the rest.
import type { Content } from "../content.ts";
import { createSim, hashLog, type Sim, type SimParams } from "../engine.ts";
import { checkRun } from "../invariants.ts";
import type { PlayerAction } from "../policies.ts";
import type { ActionRecord, PlaytestRunRecord } from "./contract.ts";

const DAY = 86400;
export interface TimedInput { tick: number; actions: ActionRecord[] }
export interface Predicate { kind: "invariant"; match: string }
export interface RegressionCase {
  schemaVersion: 1; id: string; title: string; knownIssue: string | null; /** "fails" while a known issue is open; "passes" once fixed (permanent guard). */ expect: "fails" | "passes"; fixedIn?: string; seed: number; days: number; params: SimParams; inputs: TimedInput[];
  predicate: Predicate; from: string; shrinkSteps: number; original: { days: number; inputs: number; actions: number }; logHash: string;
}

export function playInputs(content: Content, seed: number, days: number, inputs: readonly TimedInput[], params: SimParams = {}): Sim {
  const sim = createSim({ content, seed, policy: "external", params: { dayEnd: true, ...params } });
  let k = 0;
  for (;;) {
    const r = sim.next(days * DAY);
    if (!r.paused) break;
    const acts: PlayerAction[] = [];
    while (k < inputs.length && inputs[k].tick <= r.view!.now) acts.push(...inputs[k++].actions.map((a) => ({ ...a }) as PlayerAction));
    try { sim.answer(acts); } catch { sim.answer([]); } // an order that no longer makes sense here is dropped
  }
  return sim;
}
export const holds = (sim: Sim, p: Predicate) => checkRun(sim).some((v) => new RegExp(p.match).test(v));

/** ddmin over a list: the smallest sub-list (1-minimal) for which `test` still holds, within a budget of tests. */
function ddmin<T>(xs: T[], test: (ys: T[]) => boolean, budget: { left: number }): T[] {
  let n = 2, cur = xs;
  while (cur.length >= 2 && budget.left > 0) {
    const size = Math.ceil(cur.length / n);
    let reduced = false;
    for (let i = 0; i < n && budget.left > 0; i++) {
      const comp = [...cur.slice(0, i * size), ...cur.slice((i + 1) * size)];
      if (comp.length === cur.length) continue;
      budget.left--;
      if (test(comp)) { cur = comp; n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= cur.length) break; n = Math.min(n * 2, cur.length); }
  }
  if (cur.length === 1 && budget.left > 0) { budget.left--; if (test([])) cur = []; }
  return cur;
}

export function shrink(content: Content, rec: Pick<PlaytestRunRecord, "seed" | "days" | "decisions" | "tupleIndex" | "persona">, p: Predicate, o: { params?: SimParams; maxTests?: number; id: string; title: string; knownIssue: string | null }): RegressionCase {
  const all: TimedInput[] = rec.decisions.filter((d) => d.actions.length).map((d) => ({ tick: d.tick, actions: d.actions }));
  const budget = { left: o.maxTests ?? 150 };
  let steps = 0;
  const test = (days: number, ins: TimedInput[]) => { steps++; return holds(playInputs(content, rec.seed, days, ins, o.params), p); };
  if (!test(rec.days, all)) throw new Error("the failure does not reproduce from the record");
  // 1. fewest days (binary search on the day the failure first holds)
  let lo = 1, hi = rec.days;
  while (lo < hi && budget.left > 0) { const mid = Math.floor((lo + hi) / 2); budget.left--; if (test(mid, all.filter((x) => x.tick < mid * DAY))) hi = mid; else lo = mid + 1; }
  let days = hi;
  let ins = all.filter((x) => x.tick < days * DAY);
  // 2. fewest orders, 3. fewest actions within each order
  ins = ddmin(ins, (ys) => test(days, ys), budget);
  for (let i = 0; i < ins.length && budget.left > 0; i++) {
    if (ins[i].actions.length < 2) continue;
    const kept = ddmin(ins[i].actions, (as) => as.length > 0 && test(days, ins.map((x, j) => (j === i ? { ...x, actions: as } : x))), budget);
    if (kept.length) ins = ins.map((x, j) => (j === i ? { ...x, actions: kept } : x));
  }
  // 4. fewest days again: with fewer orders the failure may come sooner (no earlier than the last order kept)
  lo = Math.max(1, ...ins.map((x) => Math.floor(x.tick / DAY) + 1)); hi = days;
  while (lo < hi && budget.left > 0) { const mid = Math.floor((lo + hi) / 2); budget.left--; if (test(mid, ins)) hi = mid; else lo = mid + 1; }
  days = hi;
  const sim = playInputs(content, rec.seed, days, ins, o.params);
  return { schemaVersion: 1, id: o.id, title: o.title, knownIssue: o.knownIssue, expect: "fails", seed: rec.seed, days, params: o.params ?? {}, inputs: ins, predicate: p,
    from: `game ${rec.tupleIndex} (seed ${rec.seed}, ${rec.persona})`, shrinkSteps: steps,
    original: { days: rec.days, inputs: all.length, actions: all.reduce((a, x) => a + x.actions.length, 0) }, logHash: hashLog(sim.log) };
}
