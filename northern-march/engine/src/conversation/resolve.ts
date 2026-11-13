// From an Understanding to what the rules allow: the one action it means, or what is still unsettled. The search space is
// exactly the list of things she could do now (`playerActions`) and the advice she has been given (`adviceChoices`), so
// whatever comes out is valid against what she knows by construction.
import { adviceChoices, actionText, playerActions, type PublicRules } from "../presentation/affordances.ts";
import { nameOf } from "../presentation/phrasing.ts";
import type { BattleOrder, PlayerAction, Task, View } from "../view.ts";
import { validateBattleDraft } from "../view.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Mention, Understanding } from "./layer.ts";

export type Slot = "place" | "from" | "to" | "market" | "good" | "arm" | "adviser" | "advice" | "recipient";
export type CourtResolution =
  | { kind: "action"; action: PlayerAction; text: string }
  | { kind: "ambiguous"; slot: Slot; options: { id: string; name: string }[]; verb: string }
  | { kind: "none"; why: string };

const VERB_MATCH: Record<string, (a: PlayerAction) => boolean> = {
  repair: (a) => a.action === "repair",
  advance: (a) => a.action === "advance" && !a.mission,
  attack: (a) => a.action === "advance" && a.mission === "attack",
  scout: (a) => a.action === "advance" && a.mission === "scout",
  levy: (a) => a.action === "levy" && !a.muster,
  relief: (a) => a.action === "relief",
  travel: (a) => a.action === "travel",
  buy: (a) => a.action === "purchase",
  sell: (a) => a.action === "requisition" && !!a.sell,
  send: (a) => a.action === "requisition" && !a.sell,
  muster: (a) => a.action === "levy" && !!a.muster,
};
/** Which of an action's places a mention (with its role, if any) can be: buying names the market `at` and the store it is `for`; moving names a place `from` and `to`. */
function slotsOf(verb: string, a: PlayerAction): { role: "from" | "at" | "to" | null; id: string | undefined; slot: Slot }[] {
  if (verb === "buy") return [{ role: "at", id: a.target, slot: "market" }, { role: "to", id: a.to, slot: "to" }];
  if (verb === "sell") return [{ role: "from", id: a.target, slot: "from" }, { role: "to", id: a.to, slot: "market" }];
  if (verb === "send" || verb === "muster") return [{ role: "from", id: a.target, slot: "from" }, { role: "to", id: a.to, slot: "to" }];
  if (verb === "attack" || verb === "scout") return [{ role: null, id: a.raid, slot: "place" }, { role: null, id: a.target, slot: "place" }];
  return [{ role: null, id: a.target, slot: "place" }];
}
const fits = (m: Mention, s: { role: Mention["role"]; id: string | undefined }) => s.id === m.id && (m.role === null || s.role === null || m.role === s.role || (m.role === "at" && s.role === "to") || (m.role === "to" && s.role === "at"));

/** Each place she names takes a place of its own in the order ("buy iron at Greybridge for Greybridge" names the market and the store). */
function assignable(ms: Mention[], slots: ReturnType<typeof slotsOf>, used = new Set<number>(), i = 0): boolean {
  if (i === ms.length) return true;
  return slots.some((s, k) => !used.has(k) && fits(ms[i], s) && assignable(ms, slots, new Set([...used, k]), i + 1));
}

export function resolveCourt(u: Understanding, v: View, rules: PublicRules, L: Lexicon): CourtResolution {
  void L;
  const verb = u.verb ?? "";
  if (verb === "follow") {
    const who = u.mentions.find((m) => m.kind === "person");
    const choices = adviceChoices(v).filter((c) => !c.wait);
    const pick = who ? choices.filter((c) => c.byIds.includes(who.id)) : choices;
    if (who && !pick.length) return { kind: "none", why: `${who.name} has no advice for you to follow` };
    if (!pick.length) return { kind: "none", why: "no one has advice for you to follow" };
    if (who && pick.length > 1) return { kind: "ambiguous", slot: "advice", options: pick.map((c) => ({ id: JSON.stringify(c.action), name: c.text })), verb };
    if (pick.length > 1) return { kind: "ambiguous", slot: "adviser", options: [...new Map(pick.flatMap((c) => c.byIds.map((id) => [id, { id, name: nameOf(v, id) }] as const))).values()], verb };
    const c = pick[0], by = who?.id ?? c.byIds[0];
    return { kind: "action", action: { ...c.action, followed: by }, text: c.text };
  }
  const match = VERB_MATCH[verb];
  if (!match) return { kind: "none", why: "I do not know what that order is" };
  let cands = playerActions(v, rules).filter(match);
  // goods: "grain" is the absence of a good; with none said, every good stays possible
  if (u.goods.length) cands = cands.filter((a) => u.goods.includes(a.good ?? "grain"));
  if (u.arms.length) cands = cands.filter((a) => !a.arm || u.arms.includes(a.arm));
  if (verb === "repair") {
    const wanted = u.modes.includes("rush") ? "rush" : u.modes.includes("labour") ? "labour" : "standard";
    const exact = cands.filter((a) => (a.repairMode ?? "standard") === wanted);
    cands = exact.length ? exact : cands;
  }
  const placed: Mention[] = [];
  for (const m of u.mentions.filter((x) => x.kind === "place")) {
    placed.push(m);
    const next = cands.filter((a) => assignable(placed, slotsOf(verb, a)));
    if (!next.length) return { kind: "none", why: `${m.name} does not fit that order, as far as you know` };
    cands = next;
  }
  if (!cands.length) return { kind: "none", why: "you cannot do that now, as far as you know" };
  const uniq = new Map(cands.map((a) => [JSON.stringify({ ...a, followed: undefined }), a]));
  if (uniq.size === 1) {
    let a = [...uniq.values()][0];
    if (u.modes.includes("consult") && a.action === "requisition" && !a.good) a = { ...a, consult: true };
    return { kind: "action", action: a, text: actionText(v, a) };
  }
  // what still differs between the candidates, in the order people think of it
  const slotOf = (a: PlayerAction): [Slot, string | undefined][] => [["place", verb === "attack" || verb === "scout" ? a.raid : verb === "buy" || verb === "sell" || verb === "send" || verb === "muster" ? undefined : a.target], ["market", verb === "buy" ? a.target : verb === "sell" ? a.to : undefined], ["from", verb === "send" || verb === "sell" || verb === "muster" ? a.target : undefined], ["to", verb === "buy" || verb === "send" || verb === "muster" ? a.to : undefined], ["good", a.good], ["arm", a.arm]];
  const all = [...uniq.values()];
  for (const [slot] of slotOf(all[0])) {
    const vals = [...new Set(all.map((a) => slotOf(a).find(([s]) => s === slot)![1]).filter((x): x is string => !!x))];
    if (vals.length > 1) return { kind: "ambiguous", slot, verb, options: vals.map((id) => ({ id, name: slot === "good" || slot === "arm" ? id : nameOf(v, id) })) };
  }
  const a = all[0];
  return { kind: "action", action: a, text: actionText(v, a) };
}

// ---- battle ------------------------------------------------------------------------------------------------------------
export type BattleResolution =
  | { kind: "draft"; to: string; task: Task; via: "runner" | "signal" | "voice"; signal?: string }
  | { kind: "ambiguous"; slot: Slot; asker: string | null; verb: string }
  | { kind: "none"; why: string };

const NEEDS_PLACE = new Set(["hold", "advance", "attack", "withdraw", "give_ground"]);
const KIND_OF: Record<string, Task["kind"]> = { hold: "hold", advance: "advance", attack: "attack", withdraw: "withdraw", give_ground: "give_ground", protect: "protect" };

export function resolveBattle(u: Understanding, v: View, L: Lexicon): BattleResolution {
  const b = v.battle;
  if (!b || b.ended) return { kind: "none", why: "there is no battle in progress here" };
  const verb = u.verb ?? "";
  const kind = KIND_OF[verb];
  if (!kind) return { kind: "none", why: "I do not know what that order is" };
  const who = u.mentions.find((m) => m.kind === "person");
  if (!who) return { kind: "none", why: "to whom is the order given" };
  if (who.id !== v.self.id && !b.commanders.some((c) => c.id === who.id)) return { kind: "none", why: `${who.name} is not in this battle` };
  const place = u.mentions.find((m) => m.kind === "place");
  if (NEEDS_PLACE.has(verb) && !place && !u.signal && !u.modes.includes("signal")) return { kind: "ambiguous", slot: "place", asker: who.id === v.self.id ? null : who.id, verb };
  const task: Task = { kind, ...(place ? { place: place.id } : {}) };
  if (u.limitLine) task.limit = u.limitLine;
  if (u.when) task.when = { kind: u.when.kind, then: { kind: KIND_OF[u.when.then ?? ""] ?? "attack", ...(u.limitLine ? { limit: u.limitLine } : {}) } };
  if (u.command.length) task.command = u.command.filter((id) => id !== who.id);
  const signalAsked = u.modes.includes("signal");
  if (signalAsked && !(u.signal && b.signals.some((s) => s.id === u.signal))) return { kind: "none", why: "no signal was agreed for that" };
  const t0 = b.t === 0;
  const via: "runner" | "signal" | "voice" = signalAsked ? "signal" : u.modes.includes("runner") ? "runner" : t0 ? "voice" : "runner";
  const d = { to: who.id, task, via, ...(signalAsked ? { signal: u.signal } : {}) };
  const problems = validateBattleDraft(v, d);
  if (problems.length) return { kind: "none", why: problems[0] };
  void L;
  return { kind: "draft", ...d };
}

const WORDS: Record<string, string> = { hold: "hold", advance: "advance", attack: "attack", withdraw: "withdraw", give_ground: "give ground", protect: "protect" };
/** A task in words, with the field's names. */
export function taskWords(v: View, t: Task): string {
  const field = v.battle?.field, at = (id?: string) => (id ? field?.places.find((p) => p.id === id)?.name ?? field?.lines.find((l) => l.id === id)?.name ?? id : "");
  let s = WORDS[t.kind] ?? t.kind;
  if (t.place) s += ` ${at(t.place)}`;
  if (t.limit) s += `, but not beyond ${at(t.limit)}`;
  if (t.when) s += `, and when ${t.when.kind === "enemy_engaged" ? "the enemy is engaged" : "their horse is seen"}, ${WORDS[t.when.then.kind] ?? t.when.then.kind}${t.when.then.limit ? ` (not beyond ${at(t.when.then.limit)})` : ""}`;
  if (t.command?.length) s += `, and command ${t.command.map((id) => nameOf(v, id)).join(" and ")}`;
  return s;
}
export type { BattleOrder };
