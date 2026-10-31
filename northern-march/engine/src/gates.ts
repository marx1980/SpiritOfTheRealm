// C0: gate evaluator. Paired arms, bootstrap intervals, three-state verdicts, policy rule, sealed-block gate log.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Rng } from "./rng.ts";

export type Verdict = "PASS" | "AMBER" | "FAIL";

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

/** PASS: interval inside the band. AMBER: point inside, interval crosses an edge. FAIL: point outside. */
export function bandVerdict(point: number, ci: [number, number], lo: number, hi: number): Verdict {
  if (lo <= ci[0] && ci[1] <= hi) return "PASS";
  if (lo <= point && point <= hi) return "AMBER";
  return "FAIL";
}

export function pairedBootstrap(on: boolean[], off: boolean[], B = 2000, seed = 0) {
  if (on.length !== off.length) throw new Error("arms must be paired seed by seed");
  const n = on.length, r = Rng.fromSeed(seed, "gate:bootstrap");
  const diffs: number[] = [], ratios: number[] = [];
  for (let b = 0; b < B; b++) {
    let a = 0, c = 0;
    for (let i = 0; i < n; i++) { const j = r.int(0, n - 1); a += +on[j]; c += +off[j]; }
    diffs.push((a - c) / n);
    ratios.push(c > 0 ? a / c : Infinity);
  }
  diffs.sort((x, y) => x - y); ratios.sort((x, y) => x - y);
  const q = (xs: number[], f: number) => xs[Math.floor(f * B)];
  return { diffCi: [q(diffs, 0.025), q(diffs, 0.975)] as [number, number], ratioCi: [q(ratios, 0.025), q(ratios, 0.975)] as [number, number] };
}

export interface CausalGateResult {
  n: number; rOn: number; rOff: number; A: number; A_ci: [number, number]; lift: number; liftCiLow: number;
  G03: Verdict; G04: Verdict;
}

/** G-03 (attributable rate in band) and G-04 (lift) for one policy. */
export function evaluateCausalGate(on: boolean[], off: boolean[], o: { lo?: number; hi?: number; liftMin?: number; B?: number } = {}): CausalGateResult {
  const lo = o.lo ?? 0.05, hi = o.hi ?? 0.40, liftMin = o.liftMin ?? 1.5;
  const n = on.length, rOn = on.filter(Boolean).length / n, rOff = off.filter(Boolean).length / n;
  const A = rOn - rOff, lift = rOff > 0 ? rOn / rOff : Infinity;
  const { diffCi, ratioCi } = pairedBootstrap(on, off, o.B ?? 2000);
  const G04: Verdict = lift >= liftMin && ratioCi[0] > 1 ? "PASS" : lift >= liftMin ? "AMBER" : "FAIL";
  return { n, rOn, rOff, A, A_ci: diffCi, lift, liftCiLow: ratioCi[0], G03: bandVerdict(A, diffCi, lo, hi), G04 };
}

const RANK: Record<Verdict, number> = { PASS: 0, AMBER: 1, FAIL: 2 };

/** C0.5: policies whose logs do not differ count once (worst verdict of the group). No group may FAIL;
 *  at least min(2, groups) groups must PASS. */
export function policyRuleDetail(per: Record<string, object>, key: string, logsDiffer: (a: string, b: string) => boolean) {
  const names = Object.keys(per).sort();
  const group = new Map(names.map((n) => [n, n]));
  const find = (x: string): string => (group.get(x) === x ? x : find(group.get(x)!));
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    if (!logsDiffer(names[i], names[j])) group.set(find(names[j]), find(names[i]));
  const worst = new Map<string, Verdict>();
  for (const n of names) {
    const v = (per[n] as Record<string, unknown>)[key] as Verdict, g = find(n), w = worst.get(g);
    if (!w || RANK[v] > RANK[w]) worst.set(g, v);
  }
  const verdicts = [...worst.values()];
  const passes = verdicts.filter((v) => v === "PASS").length;
  const verdict: Verdict = verdicts.includes("FAIL") ? "FAIL" : passes >= Math.min(2, verdicts.length) ? "PASS" : "AMBER";
  return { verdict, distinctPolicies: verdicts.length, groups: Object.fromEntries(names.map((n) => [n, find(n)])) };
}
export function policyRule(per: Record<string, object>, key: string, logsDiffer: (a: string, b: string) => boolean): Verdict {
  return policyRuleDetail(per, key, logsDiffer).verdict;
}

/** C0.1: TUNE seeds 1-9,999; GATE blocks start at multiples of 10,000; one verdict per (block, calibration). */
export class GateLog {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  rows(): Record<string, unknown>[] {
    return existsSync(this.path) ? readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  }
  claim(blockStart: number, calibrationHash: string): void {
    if (blockStart < 10000) throw new Error(`seeds below 10,000 are TUNE seeds and cannot give a gate verdict`);
    if (blockStart % 10000 !== 0) throw new Error(`GATE block start must be a multiple of 10,000 (got ${blockStart})`);
    if (this.rows().some((r) => r.seedBlock === blockStart && r.calibrationHash === calibrationHash))
      throw new Error(`block ${blockStart} already used for calibration ${calibrationHash}`);
  }
  record(row: Record<string, unknown>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(row) + "\n");
  }
}

/** G-11(b): ratio of two rates (bad after wrong beliefs / bad after correct beliefs), bootstrapped over seeds
 *  (decisions within a seed are not independent, so seeds are the resampling unit). */
export function clusteredRateRatio(perSeed: { badWrong: number; wrong: number; badRight: number; right: number }[], B = 2000, seed = 0) {
  const ratio = (xs: typeof perSeed) => {
    const s = xs.reduce((a, x) => ({ bw: a.bw + x.badWrong, w: a.w + x.wrong, br: a.br + x.badRight, r: a.r + x.right }), { bw: 0, w: 0, br: 0, r: 0 });
    const pw = s.w ? s.bw / s.w : 0, pr = s.r ? s.br / s.r : 0;
    return pr > 0 ? pw / pr : pw > 0 ? Infinity : 1;
  };
  const r = Rng.fromSeed(seed, "gate:cluster-bootstrap");
  const xs: number[] = [];
  for (let b = 0; b < B; b++) xs.push(ratio(Array.from({ length: perSeed.length }, () => perSeed[r.int(0, perSeed.length - 1)])));
  xs.sort((a, b) => a - b);
  return { ratio: ratio(perSeed), ci: [xs[Math.floor(0.025 * B)], xs[Math.floor(0.975 * B)]] as [number, number] };
}
