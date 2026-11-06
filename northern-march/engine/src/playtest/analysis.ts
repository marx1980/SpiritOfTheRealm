// L5/L6: aggregate a run set into panels with distinct states (never one overall score), failure classes, persona
// distinctness (plan C0.5), the automated H-01 proxy (v4.1 A5) and evidence-linked findings.
import { wilson } from "../gates.ts";
import { KNOWN } from "./known.ts";
import type { Summary } from "./lab.ts";

export type PanelState = "PASS" | "REVIEW" | "FAIL" | "INSUFFICIENT EVIDENCE" | "NOT EVALUATED";
export interface Panel { id: string; title: string; state: PanelState; detail: string; evidence: string[] }
export interface Finding { id: string; certainty: "established" | "likely" | "tentative"; text: string; evidence: string[]; investigate?: string }

const pct = (k: number, n: number) => (n ? Math.round((1000 * k) / n) / 10 : 0);
const mean = (xs: number[]) => (xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100 : 0);
const ref = (s: Summary) => `game ${s.i} (seed ${s.seed}, ${s.persona})`;

export function classify(f: { f: string; known: string | null }): string {
  if (f.known) return `known:${f.known}`;
  const m = /^(invariant|budget|decision \d+: rejected at (\w[\w-]*))/.exec(f.f);
  if (!m) return "other";
  if (m[1] === "invariant") return `invariant:${f.f.replace(/^invariant: /, "").replace(/\d+/g, "N").slice(0, 60)}`;
  if (m[1] === "budget") return "budget";
  return `rejected:${m[2]}`;
}

export function analyse(sums: Summary[], opts: { expected?: number } = {}) {
  const personas = [...new Set(sums.map((s) => s.persona))];
  const per = Object.fromEntries(personas.map((p) => {
    const xs = sums.filter((s) => s.persona === p), n = xs.length, met = xs.filter((s) => s.objectiveMet).length;
    const stances: Record<string, Record<string, number>> = {};
    for (const s of xs) for (const [c, st] of Object.entries(s.topStance)) { stances[c] ??= {}; stances[c][st] = (stances[c][st] ?? 0) + 1; }
    const acting = xs.reduce((a, s) => a + s.actingDecisions, 0), citing = xs.reduce((a, s) => a + s.citingDecisions, 0);
    return [p, {
      games: n, objectiveMet: pct(met, n), objectiveCi: wilson(met, n).map((x) => Math.round(1000 * x) / 10), killedOrCaptured: pct(xs.filter((s) => s.ended).length, n),
      fortsFallen: mean(xs.map((s) => s.fortsFallen)), levies: mean(xs.map((s) => s.levies)), reliefs: mean(xs.map((s) => s.reliefs)), repairs: mean(xs.map((s) => s.repairs)), sends: mean(xs.map((s) => s.sends)),
      petitions: mean(xs.map((s) => s.petitions)), actingDecisions: mean(xs.map((s) => s.actingDecisions)), invalid: mean(xs.map((s) => s.invalid)),
      citeShare: acting ? pct(citing, acting) : null, failedGames: xs.filter((s) => s.status !== "ok").length, newFailureGames: xs.filter((s) => s.newFailures > 0).length,
      supportForVaros: pct(xs.filter((s) => Object.values(s.topStance).includes("support")).length, n), msPerGame: Math.round(mean(xs.map((s) => s.ms))), stances,
    }];
  }));
  // distinctness: for each pair, the share of seeds where both played and their logs differ
  const bySeed = new Map<number, Map<string, string>>();
  for (const s of sums) { if (!bySeed.has(s.seed)) bySeed.set(s.seed, new Map()); bySeed.get(s.seed)!.set(s.persona, s.logHash); }
  const pairs: { a: string; b: string; differ: number; seeds: number }[] = [];
  for (let i = 0; i < personas.length; i++) for (let j = i + 1; j < personas.length; j++) {
    let n = 0, d = 0;
    for (const m of bySeed.values()) if (m.has(personas[i]) && m.has(personas[j])) { n++; if (m.get(personas[i]) !== m.get(personas[j])) d++; }
    pairs.push({ a: personas[i], b: personas[j], differ: pct(d, n), seeds: n });
  }
  // failures by class
  const classes = new Map<string, { n: number; games: Set<number>; first: Summary }>();
  for (const s of sums) for (const f of s.failures) {
    const k = classify(f);
    if (!classes.has(k)) classes.set(k, { n: 0, games: new Set(), first: s });
    const c = classes.get(k)!; c.n++; c.games.add(s.i);
  }
  const failureClasses = [...classes].map(([k, c]) => ({ class: k, failures: c.n, games: c.games.size, firstGame: c.first.i, firstRef: ref(c.first) })).sort((a, b) => b.games - a.games);
  const nonAdv = sums.filter((s) => s.persona !== "adversarial-probe");
  const probe = sums.filter((s) => s.persona === "adversarial-probe");
  const newInv = failureClasses.filter((c) => c.class.startsWith("invariant:"));
  const knownInv = failureClasses.filter((c) => c.class.startsWith("known:"));
  const rejections = nonAdv.filter((s) => s.invalid > 0);
  const n = sums.length, enough = n >= 100;
  const panels: Panel[] = [
    { id: "integrity", title: "Integrity (invariants, replay, lifecycles)", state: newInv.length ? "FAIL" : knownInv.length ? "REVIEW" : enough ? "PASS" : "INSUFFICIENT EVIDENCE",
      detail: newInv.length ? `${newInv.length} new invariant class(es)` : knownInv.length ? `only known issues: ${knownInv.map((k) => `${k.class} in ${k.games} games`).join("; ")}` : `${n} games, no invariant failure`, evidence: [...newInv, ...knownInv].map((c) => c.firstRef) },
    { id: "boundary", title: "Boundary (validation chain)", state: rejections.length ? "FAIL" : probe.length && probe.every((s) => s.invalid > 0 || s.pauses < 20) ? "PASS" : probe.length ? "REVIEW" : "NOT EVALUATED",
      detail: rejections.length ? `${rejections.length} games where a well-formed persona was rejected` : probe.length ? `probe: ${mean(probe.map((s) => s.invalid))} malformed answers per game, all rejected, no crash` : "no adversarial probe in this run set", evidence: rejections.slice(0, 3).map(ref) },
    { id: "distinct", title: "Persona distinctness (C0.5: logs differ on ≥10% of seeds)", state: !pairs.length ? "NOT EVALUATED" : pairs.some((p) => p.differ < 10) ? "REVIEW" : enough ? "PASS" : "INSUFFICIENT EVIDENCE",
      detail: pairs.filter((p) => p.differ < 10).map((p) => `${p.a} ~ ${p.b} (${p.differ}%)`).join("; ") || `all ${pairs.length} pairs differ on ≥10% of seeds`, evidence: [] },
    { id: "h01proxy", title: "H-01 proxy (a): acting decisions citing shown evidence (automated, not a human result)", state: "REVIEW",
      detail: personas.filter((p) => per[p].citeShare !== null).map((p) => `${p} ${per[p].citeShare}%`).join(", "), evidence: [] },
    { id: "g11", title: "G-11 (information ecology)", state: "NOT EVALUATED", detail: "G-11 is a sealed phase gate; this lab does not re-run it (open since D-013)", evidence: [] },
    { id: "performance", title: "Performance (wall time per game)", state: !n ? "NOT EVALUATED" : mean(sums.map((s) => s.ms)) > 10000 ? "REVIEW" : "PASS", detail: `${Math.round(mean(sums.map((s) => s.ms)))} ms per game on this machine`, evidence: [] },
    { id: "coverage", title: "Coverage", state: opts.expected && n < opts.expected ? "INSUFFICIENT EVIDENCE" : "PASS", detail: `${n}${opts.expected ? ` of ${opts.expected}` : ""} games`, evidence: [] },
  ];
  return { games: n, personas: per, pairs, failureClasses, panels, findings: findings(sums, per, failureClasses), known: KNOWN.map((k) => ({ id: k.id, title: k.title, decision: k.decision })) };
}
export type Analysis = ReturnType<typeof analyse>;

/** Evidence-linked findings, each with its certainty and the games behind it. Deterministic, no model calls. */
function findings(sums: Summary[], per: Record<string, { games: number; objectiveMet: number; levies: number; supportForVaros: number; citeShare: number | null; reliefs: number }>, classes: { class: string; games: number; firstRef: string }[]): Finding[] {
  const out: Finding[] = [];
  const cert = (n: number) => (n >= 300 ? "established" : n >= 60 ? "likely" : "tentative") as Finding["certainty"];
  for (const c of classes.filter((x) => x.class.startsWith("known:") || x.class.startsWith("invariant:")))
    out.push({ id: `F-${c.class}`, certainty: "established", text: `${c.class} occurs in ${c.games} games`, evidence: [c.firstRef] });
  const ps = Object.entries(per).filter(([p]) => p !== "adversarial-probe" && p !== "random-valid");
  if (ps.length >= 2) {
    const best = ps.sort((a, b) => b[1].objectiveMet - a[1].objectiveMet)[0], worst = ps[ps.length - 1];
    out.push({ id: "F-spread", certainty: cert(Math.min(best[1].games, worst[1].games)), text: `Objective met: ${best[0]} ${best[1].objectiveMet}% vs ${worst[0]} ${worst[1].objectiveMet}% (spread ${Math.round(10 * (best[1].objectiveMet - worst[1].objectiveMet)) / 10} points). A small spread means play style matters little.`, evidence: [best[0], worst[0]] });
    const lev = ps.filter(([, v]) => v.levies > 0).sort((a, b) => b[1].levies - a[1].levies)[0];
    if (lev) out.push({ id: "F-levy", certainty: cert(lev[1].games), text: `${lev[0]} raises ${lev[1].levies} levies a game; ${lev[1].supportForVaros}% of its games end with a community declaring for Varos.`, evidence: [lev[0]], investigate: "communities.params.grievance.levy" });
    const prot = per["community-protector"];
    if (prot) out.push({ id: "F-relief", certainty: cert(prot.games), text: `community-protector sends ${prot.reliefs} reliefs a game; Varos gains a following in ${prot.supportForVaros}% of its games (passive: ${per.passive?.supportForVaros ?? "n/a"}%).`, evidence: ["community-protector", "passive"], investigate: "communities.params.reliefMilli" });
  }
  const slow = [...sums].sort((a, b) => b.ms - a.ms)[0];
  if (slow) out.push({ id: "F-slowest", certainty: "established", text: `Slowest game ${slow.ms} ms`, evidence: [ref(slow)] });
  return out;
}
