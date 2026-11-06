// Deterministic player personas (v4.1 A2). Each reads the observation in its own way and states a reason citing the
// evidence it acted on. Imports: the contract and the agent kit only (v4.1 A3, checked by test). None of them uses the
// NPC planner; only adviser-dependent treats advice as a recommendation.
import type { ActionAffordance, Persona, PlayerObservation } from "../contract.ts";
import { decision, ev, left, of, raidersSeen, wait, wallsAtRisk, wallScore, fresh, sure, type AgentMemory, type AgentRng, type PlayerAgent } from "../agentkit.ts";

type Mem = AgentMemory & { last?: Record<string, number>; trust?: Record<string, number>; pending?: { adviser: string; place: string; day: number }[] };
const since = (m: Mem, key: string, day: number) => day - (m.last?.[key] ?? -1e9);
const mark = (m: Mem, key: string, day: number) => { (m.last ??= {})[key] = day; };
/** The fort a captain answers raiders at a site from (from the send-to-attack affordances on offer). */
const fortFor = (o: PlayerObservation, site: string) => of(o, "advance").find((a) => a.raid === site)?.target;
const send = (o: PlayerObservation, fort: string, mission: "defend" | "attack" | "scout" = "defend", raid?: string) =>
  of(o, "advance").find((a) => a.target === fort && a.mission === mission && (mission === "defend" || a.raid === raid));
const repair = (o: PlayerObservation, place: string, mode: "standard" | "rush" | "labour" = "standard") => of(o, "repair").find((a) => a.target === place && a.repairMode === mode);
const levy = (o: PlayerObservation) => of(o, "levy")[0];
const relief = (o: PlayerObservation, place: string) => of(o, "relief").find((a) => a.target === place);
const fits = (o: PlayerObservation, xs: ActionAffordance[], reserve = 0) => { const l = left(o, xs); return l === null || l >= reserve; };

const passive: PlayerAgent = { persona: "passive", note: "never acts: baseline drift", decide: (o) => wait(o, "passive", "I leave the realm to run itself") };

const randomValid: PlayerAgent = {
  persona: "random-valid", note: "uniform over the actions on offer: crashes and invalid states",
  decide: (o, rng) => { const a = rng.pick(o.affordances); return a.kind === "wait" ? wait(o, "random-valid", "Chance says wait") : decision(o, "random-valid", [a.id], `Chance says: ${a.text}`, []); },
};

const cautious: PlayerAgent = {
  persona: "cautious-administrator", note: "keeps a reserve: cost of caution, paralysis on stale news",
  decide: (o, _r, m: Mem) => {
    const picks: ActionAffordance[] = [], cites: string[] = [], why: string[] = [];
    const worst = wallsAtRisk(o, 50)[0], rp = worst && repair(o, worst.place);
    if (rp && since(m, `repair:${worst.place}`, o.day) >= 15 && fits(o, [rp], 30000)) { picks.push(rp); cites.push(worst.evidence.id); why.push(`${rp.text}: ${worst.evidence.text} (${worst.evidence.source}, ${worst.evidence.age}), and the reserve holds`); mark(m, `repair:${worst.place}`, o.day); }
    const threat = raidersSeen(o).find((r) => r.score >= 50 && fresh(r.evidence, 3) && sure(r.evidence));
    const fort = threat && fortFor(o, threat.place), s = fort && send(o, fort);
    if (s && since(m, `send:${fort}`, o.day) >= 20) { picks.push(s); cites.push(threat!.evidence.id); why.push(`${s.text}: ${threat!.evidence.text}, fresh and from ${threat!.evidence.source}`); mark(m, `send:${fort}`, o.day); }
    const lv = levy(o);
    if (!picks.length && lv && o.anna.coinsMilli !== null && o.anna.coinsMilli < 20000 && since(m, "levy", o.day) >= 30) { mark(m, "levy", o.day); return decision(o, "cautious-administrator", [lv.id], "Coins are under 20k: a levy before anything else", []); }
    return picks.length ? decision(o, "cautious-administrator", picks.map((p) => p.id), why.join("; "), cites) : wait(o, "cautious-administrator", "Nothing is bad enough to spend the reserve on");
  },
};

const impulsive: PlayerAgent = {
  persona: "impulsive-war-ruler", note: "strikes at once: levy backlash, captain-away cost",
  decide: (o, _r, m: Mem) => {
    const picks: ActionAffordance[] = [], cites: string[] = [], why: string[] = [];
    const t = raidersSeen(o)[0];
    if (t) {
      const fort = fortFor(o, t.place);
      const atk = fort && send(o, fort, "attack", t.place), def = fort && send(o, fort);
      if (fort && atk && since(m, `send:${fort}`, o.day) >= 3 && since(m, `send:${fort}`, o.day) < 30 && since(m, `attack:${t.place}`, o.day) >= 10) { picks.push(atk); mark(m, `attack:${t.place}`, o.day); why.push(`${atk.text}: ${t.evidence.text}`); cites.push(t.evidence.id); }
      else if (fort && def && since(m, `send:${fort}`, o.day) >= 10) { picks.push(def); mark(m, `send:${fort}`, o.day); why.push(`${def.text} at once: ${t.evidence.text}`); cites.push(t.evidence.id); }
    }
    for (const w of wallsAtRisk(o, 70)) {
      const rp = repair(o, w.place, "rush") ?? repair(o, w.place);
      if (rp && since(m, `repair:${w.place}`, o.day) >= 10 && fits(o, [...picks, rp])) { picks.push(rp); mark(m, `repair:${w.place}`, o.day); why.push(`${rp.text}: ${w.evidence.text}`); cites.push(w.evidence.id); }
    }
    const lv = levy(o);
    if (lv && (o.anna.coinsMilli ?? 0) < 30000 && since(m, "levy", o.day) >= 15) { picks.push(lv); mark(m, "levy", o.day); why.push("Raise a levy: war needs coin"); }
    return picks.length ? decision(o, "impulsive-war-ruler", picks.map((p) => p.id), why.join("; "), cites) : wait(o, "impulsive-war-ruler", "No enemy in sight");
  },
};

const adviserDependent: PlayerAgent = {
  persona: "adviser-dependent", note: "does what the council says: adviser quality by another route",
  decide: (o, _r, m: Mem) => {
    const trust = (m.trust ??= {});
    // learn: advice followed on a place, judged ten days later by what is known of that place
    for (const p of (m.pending ??= []).filter((x) => o.day - x.day >= 10)) {
      const place = o.places.find((x) => x.id === p.place), fallen = o.issues.some((i) => i.key === `fallen:${p.place}`);
      trust[p.adviser] = (trust[p.adviser] ?? 0) + (fallen ? -2 : place?.walls && wallScore(place.walls.words) >= 77 ? 1 : place?.raiders && /no raiders/.test(place.raiders.words) ? 1 : 0);
    }
    m.pending = m.pending.filter((x) => o.day - x.day < 10);
    const recs = o.affordances.filter((a) => a.kind !== "wait" && a.recommendedBy.length)
      .sort((a, b) => b.recommendedBy.length - a.recommendedBy.length || Math.max(...b.recommendedBy.map((x) => trust[x] ?? 0)) - Math.max(...a.recommendedBy.map((x) => trust[x] ?? 0)) || (a.id < b.id ? -1 : 1));
    const picks: ActionAffordance[] = [];
    for (const a of recs) if (fits(o, [...picks, a]) && !(a.kind === "advance" && picks.some((p) => p.kind === "advance" && p.target === a.target))) picks.push(a);
    if (!picks.length) return wait(o, "adviser-dependent", "The council advises no order");
    for (const p of picks) if ("target" in p) m.pending.push({ adviser: p.recommendedBy[0], place: p.target, day: o.day });
    const cites = picks.flatMap((p) => o.issues.filter((i) => i.adviceIds.some((x) => p.adviceIds.includes(x))).flatMap((i) => i.evidenceIds.slice(0, 1)));
    return decision(o, "adviser-dependent", picks.map((p) => p.id), picks.map((p) => `${p.text}, as ${p.recommendedBy.join(" and ")} advise`).join("; "), cites);
  },
};

const protector: PlayerAgent = {
  persona: "community-protector", note: "keeps the people content: relief economics, petitions",
  decide: (o, _r, m: Mem) => {
    const picks: ActionAffordance[] = [], cites: string[] = [], why: string[] = [];
    for (const i of o.issues.filter((x) => x.key.startsWith("people:") && x.place)) {
      const rl = relief(o, i.place!);
      if (rl && since(m, `relief:${i.place}`, o.day) >= 20 && fits(o, [...picks, rl])) { picks.push(rl); mark(m, `relief:${i.place}`, o.day); why.push(`${rl.text}: ${i.title}`); cites.push(...i.evidenceIds.slice(0, 2)); break; }
    }
    const worst = wallsAtRisk(o, 50)[0], rp = worst && repair(o, worst.place);
    if (rp && since(m, `repair:${worst.place}`, o.day) >= 15 && fits(o, [...picks, rp], 15000)) { picks.push(rp); mark(m, `repair:${worst.place}`, o.day); why.push(`${rp.text}: ${worst.evidence.text}`); cites.push(worst.evidence.id); }
    const lv = levy(o);
    if (!picks.length && lv && o.anna.coinsMilli !== null && o.anna.coinsMilli < 5000 && since(m, "levy", o.day) >= 45) { mark(m, "levy", o.day); return decision(o, "community-protector", [lv.id], "The treasury is empty; a levy, much as the people will resent it", []); }
    return picks.length ? decision(o, "community-protector", picks.map((p) => p.id), why.join("; "), cites) : wait(o, "community-protector", "The people are quiet");
  },
};

const novice: PlayerAgent = {
  persona: "literal-novice", note: "answers the top issue, whatever its age: stale-letter traps",
  decide: (o, _r, m: Mem) => {
    const i = o.issues[0];
    if (!i || since(m, `issue:${i.key}`, o.day) < 5) return wait(o, "literal-novice", i ? "I already dealt with that" : "No issues");
    const place = i.place ?? "", cite = i.evidenceIds.slice(0, 1);
    const a = i.key.startsWith("walls:") ? repair(o, place)
      : i.key.startsWith("raiders:") ? (() => { const f = fortFor(o, place); return f ? send(o, f) : undefined; })()
      : i.key.startsWith("fallen:") ? send(o, place)
      : i.key.startsWith("people:") ? relief(o, place) : undefined;
    mark(m, `issue:${i.key}`, o.day);
    return a ? decision(o, "literal-novice", [a.id], `${a.text}, because the first thing on my desk says: ${ev(o, cite[0])?.text ?? i.title}`, cite) : wait(o, "literal-novice", `Not sure what to do about: ${i.title}`);
  },
};

const miscalibrated: PlayerAgent = {
  persona: "miscalibrated-ruler", note: "treats rumour and old news as fact: certainty and age wording",
  decide: (o, _r, m: Mem) => {
    // every alarm counts the same; the oldest one is acted on first, as if it were today's
    const alarms = [...raidersSeen(o).map((r) => ({ kind: "raid" as const, ...r })), ...wallsAtRisk(o, 77).map((w) => ({ kind: "wall" as const, ...w }))]
      .sort((a, b) => b.evidence.ageDays - a.evidence.ageDays || (a.place < b.place ? -1 : 1));
    for (const al of alarms) {
      if (since(m, `${al.kind}:${al.place}`, o.day) < 7) continue;
      const f = al.kind === "raid" ? fortFor(o, al.place) : al.place, a = al.kind === "raid" ? (f ? send(o, f) : undefined) : repair(o, al.place);
      if (a && fits(o, [a])) { mark(m, `${al.kind}:${al.place}`, o.day); return decision(o, "miscalibrated-ruler", [a.id], `${a.text}: ${al.evidence.text}, ${al.evidence.source} says so`, [al.evidence.id]); }
    }
    const lv = levy(o);
    if (lv && (o.anna.coinsMilli ?? 0) < 60000 && since(m, "levy", o.day) >= 20) { mark(m, "levy", o.day); return decision(o, "miscalibrated-ruler", [lv.id], "Coins feel short", []); }
    return wait(o, "miscalibrated-ruler", "All seems well");
  },
};

const delegating: PlayerAgent = {
  persona: "delegating-strategist", note: "sets a standing plan, then lets the captain run it: delegation",
  decide: (o, _r, m: Mem) => {
    if (since(m, "plan", o.day) < 20) return wait(o, "delegating-strategist", "The standing plan holds");
    const picks: ActionAffordance[] = [], cites: string[] = [], why: string[] = [];
    const t = raidersSeen(o)[0], f = t && fortFor(o, t.place), s = f && send(o, f);
    if (s) { picks.push(s); cites.push(t!.evidence.id); why.push(`${s.text} to hold the most threatened fort: ${t!.evidence.text}`); }
    for (const w of wallsAtRisk(o, 62)) { const rp = repair(o, w.place); if (rp && fits(o, [...picks, rp], 10000)) { picks.push(rp); cites.push(w.evidence.id); why.push(`${rp.text}: ${w.evidence.text}`); } }
    if (!picks.length) return wait(o, "delegating-strategist", "No plan needed yet");
    mark(m, "plan", o.day);
    return decision(o, "delegating-strategist", picks.map((p) => p.id), why.join("; "), cites);
  },
};

/** Deliberately malformed answers, to prove the validation chain rejects them and the run survives. */
const BAD: ((o: PlayerObservation) => unknown)[] = [
  (o) => ({ ...wait(o, "adversarial-probe"), choose: ["a999"] }),
  (o) => ({ ...wait(o, "adversarial-probe"), observationId: `obs:${o.decisionIndex + 1}` }),
  (o) => ({ ...wait(o, "adversarial-probe"), choose: ["a0", "a0"] }),
  (o) => ({ ...wait(o, "adversarial-probe"), peek: "world" }),
  (o) => ({ ...wait(o, "adversarial-probe"), schemaVersion: "1" }),
  (o) => ({ ...wait(o, "adversarial-probe"), rationale: { text: "x", cites: ["e9999"] } }),
  (o) => decision(o, "adversarial-probe", o.affordances.filter((a) => a.kind !== "wait").map((a) => a.id).slice(0, 8), "Everything at once", []),
];
const probe: PlayerAgent = {
  persona: "adversarial-probe", note: "levy and travel spam plus malformed answers: validation chain, exploits",
  decide: (o, rng) => {
    if (rng.chance(100)) return rng.pick(BAD)(o);
    const lv = levy(o), tr = of(o, "travel");
    if (lv && rng.chance(300)) return decision(o, "adversarial-probe", [lv.id], "Levy again", []);
    if (tr.length && rng.chance(200)) return decision(o, "adversarial-probe", [rng.pick(tr).id], "Move again", []);
    const a = rng.pick(o.affordances);
    return a.kind === "wait" ? wait(o, "adversarial-probe") : decision(o, "adversarial-probe", [a.id], a.text, []);
  },
};

export const AGENTS: Record<Persona, PlayerAgent> = {
  passive, "random-valid": randomValid, "cautious-administrator": cautious, "impulsive-war-ruler": impulsive, "adviser-dependent": adviserDependent,
  "community-protector": protector, "literal-novice": novice, "miscalibrated-ruler": miscalibrated, "delegating-strategist": delegating, "adversarial-probe": probe,
};
export type { AgentRng };
