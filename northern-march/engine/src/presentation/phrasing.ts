// Templated phrasing (A7: the game is playable without a language model). Words, not hidden numbers.
import { areaOf, type BeliefView, type View } from "../view.ts";
import { dayOf } from "./format.ts";

export const certainty: Record<string, string> = { certain: "certain", probable: "probably", uncertain: "perhaps", doubtful: "doubtful", stale: "out of date" };

export function ago(now: number, then: number): string {
  const d = dayOf(now) - dayOf(then);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function wallWords(milli: number): string {
  const p = milli / 1000;
  return p >= 85 ? "sound" : p >= 70 ? "worn" : p >= 55 ? "damaged" : p >= 40 ? "badly damaged" : p >= 30 ? "near collapse" : "breached";
}

export function raiderWords(permille: number): string {
  return permille <= 0 ? "no raiders" : permille < 350 ? "a small band" : permille < 650 ? "a strong band" : "a large host";
}

export const nameOf = (v: View, id: string) => v.world.names[id] ?? id;

export function sourceOf(v: View, b: BeliefView): string {
  const ev = b.evidenceRefs[b.evidenceRefs.length - 1];
  if (!ev) return "unknown";
  if (ev.kind === "observation") return ev.source === v.self.id ? "seen yourself" : `seen by ${nameOf(v, ev.source)}`;
  if (ev.kind === "report") return ev.reportId === undefined ? `told by ${nameOf(v, ev.source)}` : `letter from ${nameOf(v, ev.source)}`;
  if (ev.kind === "order") return `order from ${nameOf(v, ev.source)}`;
  if (ev.kind === "intercepted") return "seized letter";
  return "common knowledge";
}

const REASON: Record<string, string> = {
  "reason.protect_realm": "keeping the realm safe", "reason.crown_standing": "how the crown is seen", "reason.hold_fortification": "holding the fortress",
  "reason.hold_post": "staying at his post", "reason.win_renown": "his reputation", "reason.preserve_forces": "keeping the men alive",
  "reason.preserve_treasury": "the money in the treasury", "reason.sound_works": "keeping the works in good repair", "reason.house_standing": "his family's standing",
  "reason.risk": "the danger involved", "reason.risk_averse": "the danger involved", "reason.own_skill": "his own skill", "reason.trusts": "trust in the people involved",
  "reason.asked_for_help": "a request for help", "reason.as_ordered": "his orders", "reason.against_orders": "his orders", "reason.cost": "what it costs", "reason.duty": "duty",
};
export const reasonWords = (key: string) => REASON[key] ?? key.replace(/^reason\./, "").replace(/_/g, " ");

export function planWords(v: View, planId: string): string {
  const a = JSON.parse(planId) as { kind: string; target?: string };
  const t = a.target ? nameOf(v, a.target) : "";
  switch (a.kind) {
    case "advise_wait": return "Wait for more news";
    case "advise_repair": return `Repair ${t}`;
    case "advise_send_captain": return `Send the captain to ${t}`;
    case "advise_sortie": return `Attack the raiders in ${t}`;
    case "advise_levy": return "Raise a levy";
    default: return a.kind.replace(/_/g, " ") + (t ? ` ${t}` : "");
  }
}

/** A letter's content as plain sentences, in words only: what the writer tells the reader, as the writer believes it. */
export function letterSentences(v: View, r: { author: string; claims: { predicate: string; subject: { id: string }; believedValue: unknown }[] }): string[] {
  const out: string[] = [];
  for (const c of r.claims) {
    const s = nameOf(v, c.subject.id), val = c.believedValue, me = c.subject.id === r.author;
    switch (c.predicate) {
      case "fortification.condition": out.push(`The walls at ${s} are ${wallWords(val as number)}.`); break;
      case "threat.intensity": out.push(`${cap(raiderWords(val as number))} at ${s}.`); break;
      // people speak of themselves in the first person
      case "character.location": out.push(me ? `I am at ${nameOf(v, String(val))}.` : `${s} is at ${nameOf(v, String(val))}.`); break;
      case "treasury.balance": out.push(`The treasury is ${(val as number) < 60000 ? "low" : "adequate"}.`); break;
      case "order.status": out.push(`Your order at ${s} is ${String(val)}.`); break;
      default: out.push(`${s}: ${c.predicate.replace(/\./g, " ")} ${String(val)}.`);
    }
  }
  return out.length ? out : ["Nothing new in this letter."];
}
/** The one sentence that matters most in a letter (for the list): orders, then walls, raiders, treasury, then where someone is. */
export function letterGist(v: View, r: { author: string; claims: { predicate: string; subject: { id: string }; believedValue: unknown }[] }): string {
  const rank: Record<string, number> = { "order.status": 0, "fortification.condition": 1, "threat.intensity": 2, "treasury.balance": 3, "character.location": 4 };
  const claims = [...r.claims].sort((a, b) => (rank[a.predicate] ?? 5) - (rank[b.predicate] ?? 5));
  if (!claims.length) return "Nothing new in this letter.";
  return letterSentences(v, { ...r, claims: [claims[0]] })[0];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
