// L2: the player's View as a semantic PlayerObservation, and the affordance table the bridge resolves decisions against.
// Built only from View and PublicRules, through the same presentation code the debug page uses (Court, Map, letters,
// affordances). This file may not import the engine, world, systems, content or RNG (checked by test).
import { createHash } from "node:crypto";
import type { View } from "../view.ts";
import type { PlayerAction } from "../policies.ts";
import { buildCourt } from "../presentation/court.ts";
import { buildMap } from "../presentation/map.ts";
import { letterSentences, nameOf } from "../presentation/phrasing.ts";
import { actionText, adviceChoices, affordable, coinsKnown, costKnown, playerActions, type PublicRules } from "../presentation/affordances.ts";
import { beliefsAbout } from "../view.ts";
import { PLAYTEST_SCHEMA_VERSION, type ActionAffordance, type Evidence, type PlayerObservation } from "./contract.ts";

const DAY = 86400;
const daysAgo = (now: number, t: number) => Math.max(0, Math.floor(now / DAY) - Math.floor(t / DAY));
const ageDays = (age: string) => (age === "today" ? 0 : age === "yesterday" ? 1 : Number(/^(\d+) days ago$/.exec(age)?.[1] ?? 0));
const CERT = new Set(["certain", "probably", "perhaps", "doubtful", "out of date"]);

export interface ObservationRules extends PublicRules { objectiveForts: readonly string[] }
export interface Built { obs: PlayerObservation; actions: Map<string, PlayerAction | null>; hash: string }

/** The key that makes two actions the same choice: a send keeps its mission; who recommended it does not count. */
export function actionKey(a: PlayerAction): string {
  return JSON.stringify([a.action, a.target ?? null, a.action === "advance" ? (a.mission && a.mission !== "defend" ? a.mission : "defend") : null, a.raid ?? null, a.repairMode && a.repairMode !== "standard" ? a.repairMode : null]);
}

export function buildObservation(v: View, rules: ObservationRules, at: { index: number; pause: string; newLetters: readonly number[] }): Built {
  const court = buildCourt(v), map = buildMap(v);
  const evidence: Evidence[] = [];
  const evKey = new Map<string, string>();
  const addEv = (e: { text: string; source: string; age: string; certainty: string }) => {
    const k = `${e.text}|${e.source}|${e.age}|${e.certainty}`;
    if (!evKey.has(k)) {
      const idv = `e${evidence.length}`;
      evKey.set(k, idv);
      evidence.push({ id: idv, text: e.text.slice(0, 600), source: e.source.slice(0, 600), age: e.age, ageDays: ageDays(e.age), certainty: (CERT.has(e.certainty) ? e.certainty : "out of date") as Evidence["certainty"] });
    }
    return evKey.get(k)!;
  };
  const issues = court.issues.map((i) => ({ key: i.key, title: i.title, priority: i.priority, ...(i.place ? { place: i.place } : {}), evidenceIds: i.evidence.slice(0, 10).map(addEv), adviceIds: i.advice.map((a) => a.id).slice(0, 10) }));
  const places = map.places.map((p) => ({
    id: p.id, name: p.name, fortified: p.fortified, you: p.you,
    ...(p.wall ? { walls: { words: p.wall.words, evidenceId: addEv({ text: `The walls are ${p.wall.words}`, source: p.wall.source, age: p.wall.age, certainty: p.wall.certainty }) } } : {}),
    ...(p.raiders ? { raiders: { words: p.raiders.words, evidenceId: addEv({ text: p.raiders.words, source: p.raiders.source, age: p.raiders.age, certainty: p.raiders.certainty }) } } : {}),
    people: p.people.map((x) => x.name),
  }));
  const lines = [...court.issues.flatMap((i) => i.advice), ...court.advice];
  const advice = [...new Map(lines.map((l) => [l.id, l])).values()].sort((a, b) => a.id - b.id).map((l) => {
    const r = v.advice.find((x) => x.id === l.id)!;
    return { id: l.id, adviserId: r.author, adviser: l.adviser, area: l.area, plan: l.plan, supports: l.supports.slice(0, 10), concerns: l.concerns.slice(0, 10), heardDaysAgo: daysAgo(v.now, r.computedAt), fresh: l.fresh };
  });
  const adviceIds = new Set(advice.map((a) => a.id));
  const newSet = new Set(at.newLetters);
  const letters = [...v.reports].reverse().slice(0, 60).map((r) => ({
    id: r.reportId, from: nameOf(v, r.author), about: nameOf(v, r.subject.id), sentences: letterSentences(v, r).slice(0, 20).map((s) => s.slice(0, 600)),
    writtenDaysAgo: daysAgo(v.now, r.composedAt), arrivedDaysAgo: daysAgo(v.now, r.deliveredAt), isNew: newSet.has(r.reportId),
  }));
  // affordances: wait, then each piece of advice as an action, then every other action the rules allow and she can pay for
  const affs: ActionAffordance[] = [], actions = new Map<string, PlayerAction | null>();
  const seen = new Map<string, ActionAffordance>();
  const push = (a: PlayerAction | null, by: string[], ids: number[]) => {
    const idv = `a${affs.length}`, cost = a ? costKnown(v, rules, a) ?? null : null;
    const base = { id: idv, text: a ? actionText(v, a) : "Wait", costMilli: cost === null ? null : Math.max(0, cost), recommendedBy: by.slice(0, 10), adviceIds: ids.filter((x) => adviceIds.has(x)).slice(0, 10) };
    const aff: ActionAffordance = !a ? { kind: "wait", ...base }
      : a.action === "levy" ? { kind: "levy", ...base }
      : a.action === "repair" ? { kind: "repair", target: a.target!, repairMode: a.repairMode ?? "standard", ...base }
      : a.action === "advance" ? { kind: "advance", target: a.target!, mission: a.mission ?? "defend", ...(a.raid ? { raid: a.raid } : {}), ...base }
      : a.action === "relief" ? { kind: "relief", target: a.target!, ...base }
      : { kind: "travel", target: a.target!, ...base };
    affs.push(aff); actions.set(idv, a);
    if (a) seen.set(actionKey(a), aff);
  };
  const wait = adviceChoices(v).filter((c) => c.wait);
  push(null, wait.flatMap((c) => c.byIds), wait.flatMap((c) => c.adviceIds));
  // advice she cannot pay for is shown (in advice) but not offered, as the page disables it
  for (const c of adviceChoices(v)) if (!c.wait && !seen.has(actionKey(c.action)) && affordable(v, rules, c.action)) push(c.action, c.byIds, c.adviceIds);
  for (const a of playerActions(v, rules)) if (!seen.has(actionKey(a))) push(a, [], []);
  const pos = v.self.position, coins = beliefsAbout(v, rules.ruler, "treasury.balance").sort((x, y) => y.observedAt - x.observedAt)[0];
  const obs: PlayerObservation = {
    schemaVersion: PLAYTEST_SCHEMA_VERSION, id: `obs:${at.index}`, decisionIndex: at.index, day: Math.floor(v.now / DAY), pause: (["report", "advice", "danger", "arrival", "dayend", "checkpoint"].includes(at.pause) ? at.pause : "report") as PlayerObservation["pause"],
    objective: { text: `Stay alive and free; keep ${rules.objectiveForts.map((f) => nameOf(v, f)).join(", ")} above the breach`, forts: [...rules.objectiveForts] },
    anna: { at: "at" in pos ? pos.at : null, travellingTo: "at" in pos ? null : pos.transit.dest, coinsMilli: coinsKnown(v, rules) ?? null, coinsAgeDays: coins ? daysAgo(v.now, coins.observedAt) : null },
    letters, advice, issues, places, evidence: evidence.slice(0, 300), affordances: affs.slice(0, 80),
  };
  return { obs, actions, hash: createHash("sha256").update(JSON.stringify(obs)).digest("hex").slice(0, 16) };
}
