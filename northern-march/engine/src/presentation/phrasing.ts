// Templated phrasing (A7: the game is playable without a language model). Words, not hidden numbers.
import { areaOf, beliefsAbout, type BeliefView, type View } from "../view.ts";
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
  "reason.asked_for_help": "a request for help", "reason.as_ordered": "his orders", "reason.against_orders": "his orders", "reason.cost": "what it costs", "reason.fort_lost": "the fort that has been lost", "reason.duty": "duty",
};
export const reasonWords = (key: string) => REASON[key] ?? key.replace(/^reason\./, "").replace(/_/g, " ");

/** The fortified place nearest to a site (as the page and the engine's policies both use it). */
export function nearestFort(v: View, site: string): string | undefined {
  const s = v.world.places.find((p) => p.id === site);
  if (!s) return undefined;
  const d = (p: { pos: [number, number] }) => (p.pos[0] - s.pos[0]) ** 2 + (p.pos[1] - s.pos[1]) ** 2;
  return v.world.places.filter((p) => p.fortified).sort((a, b) => d(a) - d(b))[0]?.id;
}
/** A captain she sent to this fort (or on a mission from it) whose order is reported done, with no later order to him. */
export function captainSentTo(v: View, fort: string): boolean {
  const done = new Set(Object.values(v.beliefs).filter((b) => b.predicate === "order.status" && String(b.believedValue) === "completed").map((b) => b.subject.id));
  return v.self.orders.some((o) => (o.action === "advance" || o.action === "investigate") && done.has(String(o.orderId)) && (o.target === fort || nearestFort(v, o.target) === fort)
    && !v.self.orders.some((x) => x.recipient === o.recipient && x.tick > o.tick));
}
const seatOf = (v: View, who: string) => { const b = beliefsAbout(v, who, "character.seat")[0]; return b ? nameOf(v, String(b.believedValue)) : "my post"; };
/** The captain whose question is pending. */
const askerName = (v: View) => { const b = Object.values(v.beliefs).filter((x) => x.predicate === "captain.query").sort((a, c) => c.observedAt - a.observedAt)[0]; return b ? nameOf(v, b.subject.id) : "The captain"; };
/** Whether the viewer believes the raiders hold this fort (the latest word on it says so). */
export function fallenAt(v: View, fort: string): boolean {
  const h = beliefsAbout(v, fort, "fortification.holder").sort((a, b) => b.observedAt - a.observedAt)[0];
  return !!h && h.believedValue === "raiders";
}
/** An adviser's plan as it stands now: advice to send the captain to a fort he has already reached, while raiders are
 *  believed near it, is advice to attack those raiders. */
export function planOf(v: View, planId: string): { kind: string; target?: string } {
  const a = JSON.parse(planId) as { kind: string; target?: string };
  if (a.kind === "advise_send_captain" && a.target && captainSentTo(v, a.target)) {
    const site = v.world.places.find((p) => !p.fortified && nearestFort(v, p.id) === a.target && beliefsAbout(v, p.id, "threat.intensity").some((b) => (b.believedValue as number) > 0));
    if (site) return { kind: "advise_sortie", target: site.id };
  }
  return a;
}
export function planWords(v: View, planId: string): string {
  const a = planOf(v, planId);
  const t = a.target ? nameOf(v, a.target) : "";
  switch (a.kind) {
    case "advise_wait": return "Wait for more news";
    case "advise_repair": return `Repair ${t}`;
    case "advise_repair_rush": return `Repair ${t} quickly, paying extra, with the captain's men`;
    case "advise_repair_labour": return `Repair ${t} with the captain's men only (no cost, slower)`;
    case "advise_send_captain": return a.target && fallenAt(v, a.target) ? `Send the captain to ${t} to retake it` : `Send the captain to ${t}`;
    case "advise_recall": return `${askerName(v)} returns to ${t} to refill his company`;
    case "advise_stay": return `${askerName(v)} stays at ${t} to rebuild the walls and defend`;
    case "advise_retake": return `Retake ${t} with the captain`;
    // the captain is sent to the nearest fort, from which the attack is made (the wording matches what Do it does)
    case "advise_sortie": { const f = nearestFort(v, a.target!); return f && !captainSentTo(v, f) ? `Send the captain to ${nameOf(v, f)} to attack the raiders at ${t}` : `Attack the raiders at ${t}`; }
    case "advise_levy": return "Raise a levy";
    default: return a.kind.replace(/_/g, " ") + (t ? ` ${t}` : "");
  }
}

type LetterLike = { author: string; composedAt?: number; claims: { predicate: string; subject: { id: string }; believedValue: unknown }[] };
/** What an earlier letter (written before this one) said about the same thing, if anything. */
function earlier(v: View, r: LetterLike, c: { predicate: string; subject: { id: string } }): unknown {
  if (r.composedAt === undefined) return undefined;
  let best: { at: number; value: unknown } | undefined;
  for (const x of v.reports) {
    if (x.composedAt >= r.composedAt) continue;
    for (const k of x.claims) if (k.predicate === c.predicate && k.subject.id === c.subject.id && (!best || x.composedAt > best.at)) best = { at: x.composedAt, value: k.believedValue };
  }
  return best?.value;
}
/** Sentences of a letter with their importance (lower first): unchanged walls and men are left out; the fort's own walls and men share a sentence. */
function letterParts(v: View, r: LetterLike): { rank: number; text: string }[] {
  const out: { rank: number; text: string }[] = [];
  const home = r.claims.find((c) => c.predicate === "character.location" && c.subject.id === r.author)?.believedValue as string | undefined;
  const fort: string[] = [];
  const fought = new Map(r.claims.filter((c) => c.predicate === "battle.result").map((c) => [c.subject.id, String(c.believedValue)]));
  const incident = new Map(r.claims.filter((c) => c.predicate === "fortification.incident").map((c) => [c.subject.id, ({ storm: "a storm", fire: "a fire", earthquake: "an earthquake" } as Record<string, string>)[String(c.believedValue)] ?? String(c.believedValue)]));
  const fighting = [...fought.values()].some((x) => x !== "nobody");
  for (const c of r.claims) {
    const s = nameOf(v, c.subject.id), val = c.believedValue, me = c.subject.id === r.author, prev = earlier(v, r, c);
    const here = c.subject.id === home;
    switch (c.predicate) {
      case "fortification.condition":
        if (prev !== undefined && wallWords(prev as number) === wallWords(val as number)) break; // unchanged
        { const why = incident.has(c.subject.id) && (prev === undefined || (val as number) < (prev as number)) ? ` after ${incident.get(c.subject.id)}` : "";
          if (here) fort.push(`the walls are ${wallWords(val as number)}${why}`); else out.push({ rank: 1, text: `The walls at ${s} are ${wallWords(val as number)}${why}.` }); }
        break;
      case "fortification.incident": break; // told with the walls
      case "captain.heading": out.push({ rank: 0, text: `I am returning to ${nameOf(v, String(val))} to refill my company.` }); break;
      case "captain.refilled": out.push({ rank: 3, text: `My company is full again. Shall I return to ${nameOf(v, String(val))} to attack the raiders or to defend it?` }); break;
      case "captain.query": out.push({ rank: 3, text: `Shall I return to ${seatOf(v, r.author)} to refill my company, or stay at ${nameOf(v, String(val))} to help rebuild the walls and defend?` }); break;
      case "fortification.holder": out.push({ rank: -2, text: val === "raiders" ? `${s} has fallen to the raiders!` : `${s} is ours again.` }); break;
      case "battle.result": out.push({ rank: 0, text: val === "nobody" ? `We found no raiders at ${s}.` : `We fought the raiders at ${s} and ${val === "won" ? "won" : "were beaten"}.` }); break;
      case "threat.intensity":
        // a fight and the raiders' present strength are one story: do not tell it twice
        if (fought.has(c.subject.id) && (val as number) <= 0) { if (fought.get(c.subject.id) === "lost") out.push({ rank: 2, text: `The raiders at ${s} have since gone.` }); break; }
        out.push({ rank: 2, text: `${cap(raiderWords(val as number))} at ${s}.` }); break;
      case "fortification.garrison":
        if (prev === val) break;
        { const t = prev === undefined ? `${here ? "the fort has" : `the fort at ${s} has`} ${val} men` : `${here ? "the fort now has" : `the fort at ${s} now has`} ${val} men${(val as number) < (prev as number) ? (fighting ? ", after the fighting" : "") : ", as the garrison recovers"}`;
          if (here) fort.push(t); else out.push({ rank: 1, text: cap(t) + "." }); }
        break;
      case "character.troops":
        if (prev === val) break;
        out.push({ rank: 1, text: me ? (prev === undefined ? `I have ${val} men with me.` : `I now have ${val} men with me${(val as number) < (prev as number) ? (fighting ? ", after the fighting" : "") : ", as my men return"}.`)
          : (prev === undefined ? `${s} has ${val} men with them.` : `${s} now has ${val} men with them.`) });
        break;
      // people speak of themselves in the first person
      case "character.location": out.push({ rank: 4, text: me ? `I am at ${nameOf(v, String(val))}.` : `${s} is at ${nameOf(v, String(val))}.` }); break;
      case "treasury.balance": out.push({ rank: 3, text: `The treasury is ${(val as number) < 60000 ? "low" : "adequate"}.` }); break;
      case "order.status": {
        // the subject is the order's number: say what the order was, not its number
        const o = v.self.orders.find((x) => String(x.orderId) === c.subject.id);
        const verb: Record<string, string> = { repair: "repair", advance: "send the captain to", levy: "raise a levy", travel: "travel to", investigate: "scout", attack: "attack the raiders at" };
        out.push({ rank: 0, text: o ? `Your order to ${verb[o.action] ?? o.action} ${o.action === "levy" ? "" : nameOf(v, o.target) + " "}is ${String(val)}.`.replace("  ", " ") : `Your order is ${String(val)}.` });
        break;
      }
      default: out.push({ rank: 5, text: `${s}: ${c.predicate.replace(/\./g, " ")} ${String(val)}.` });
    }
  }
  if (fort.length) out.push({ rank: 1, text: cap(fort.join(" and ")) + "." });
  return out;
}
/** A letter's content as plain sentences, in words only: what the writer tells the reader, as the writer believes it. */
export function letterSentences(v: View, r: LetterLike): string[] {
  const parts = letterParts(v, r);
  // where the writer is comes first, then what has changed
  parts.sort((x, y) => (x.rank === 4 ? -1 : x.rank) - (y.rank === 4 ? -1 : y.rank));
  return parts.length ? parts.map((p) => p.text) : ["Nothing new in this letter."];
}
/** The one sentence that matters most in a letter (for the list): orders, then walls and men, raiders, treasury, then where someone is. */
export function letterGist(v: View, r: LetterLike): string {
  const parts = letterParts(v, r);
  if (!parts.length) return "Nothing new in this letter.";
  return [...parts].sort((a, b) => a.rank - b.rank)[0].text;
}
/** A letter that brings word of a fort lost to the raiders. */
export function lettersFall(r: LetterLike): boolean { return r.claims.some((c) => c.predicate === "fortification.holder" && c.believedValue === "raiders"); }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
