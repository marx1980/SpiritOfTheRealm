// What an agent expects an action to do, as the agent perceives it (ARCHITECTURE §20.6). Integer milli units.
import type { ActionRef, Perceiver, Situation } from "./model.ts";
import { DAY } from "./model.ts";
import { battleLoss, raiderMen } from "../battle.ts";

export interface FortPicture { id: string; cond: number | null; intensity: number; defence: number; sites: string[] }

export function picture(sit: Situation, per: Perceiver, fort: string): FortPicture {
  const f = sit.forts.find((x) => x.id === fort)!;
  const c = per.get(fort, "fortification.condition");
  let intensity = 0;
  for (const s of f.sites) { const b = per.get(s, "threat.intensity"); if (b) intensity = Math.max(intensity, b.value as number); }
  const defence = sit.at === fort && sit.defenceHere !== null ? sit.defenceHere : f.garrison;
  return { id: fort, cond: c ? (c.value as number) : null, intensity, defence, sites: f.sites };
}

export const dmgPerDay = (sit: Situation, intensity: number, defence: number) =>
  Math.floor((sit.p.raidBaseMilli * intensity * 1000) / (1000 * (1000 + Math.max(0, defence) * sit.p.battle.raidMitigationPerManPermille / 1)));

/** Expected damage over a span of ticks at a given defence (linear in time). */
const lossOver = (sit: Situation, i: number, d: number, ticks: number) => Math.floor((dmgPerDay(sit, i, d) * Math.max(0, ticks)) / DAY);

export function sortieP(sit: Situation, men: number, skill: number, intensity: number) {
  if (intensity <= 0) return 1000;
  const S = Math.floor((men * (sit.p.battle.sortie.skillBasePermille + skill)) / 1000);
  const I = Math.floor((intensity * sit.p.battle.sortie.intensityFactorPermille) / 1000);
  return Math.floor((1000 * S) / Math.max(1, S + I));
}

/** An adviser's own estimate of the odds: off by an amount that shrinks with their military skill (up to +-30 points for the unskilled). */
export function judged(sit: Situation, key: string, p: number, skill: number): number {
  if (!sit.noise) return p;
  const err = Math.floor((sit.noise(key) * 300 * Math.max(0, 1000 - skill)) / (1000 * 1000));
  return Math.max(50, Math.min(950, p + err));
}
/** Crown money a captain's company costs while away from home, for a number of days. */
const awayCost = (sit: Situation, days: number) => Math.floor(sit.p.captainAwayMilli * Math.max(0, days));
const daysOf = (ticks: number) => Math.ceil(ticks / DAY);

export interface Expectation {
  loss: Record<string, number>;     // expected damage per fort over the horizon
  restore: Record<string, number>;  // expected restoration per fort over the horizon
  menLost: number;
  successP: number;                 // 1000 when nothing is at stake
  costMilli: number;                // crown money
  gainMilli: number;                // crown money raised
  leavesPost: boolean;
  renownPermille: number;
  helps?: string;                   // whom the action helps (relationship term)
}

/** Expected consequences of one action over the planning horizon, from the agent's beliefs. */
export function expect(sit: Situation, per: Perceiver, a: ActionRef): Expectation {
  const H = sit.p.agents.horizonDays * DAY;
  const pics = Object.fromEntries(sit.forts.map((f) => [f.id, picture(sit, per, f.id)]));
  const loss: Record<string, number> = {}, restore: Record<string, number> = {};
  // baseline: raids at the believed strength, plus the weather everyone knows (decay and the usual storms)
  const weather = (f: { stormMilliPerDay: number }) => Math.floor(((f.stormMilliPerDay + sit.p.decayMilliPerDay) * H) / DAY);
  for (const f of sit.forts) loss[f.id] = lossOver(sit, pics[f.id].intensity, pics[f.id].defence, H) + weather(f);
  const e: Expectation = { loss, restore, menLost: 0, successP: 1000, costMilli: 0, gainMilli: 0, leavesPost: false, renownPermille: 0 };
  const T = a.target;
  const reinforce = (fort: string, men: number, delay: number, pPermille: number) => {
    const p = pics[fort];
    if (!p) return; // not a fortified place: nothing to defend there
    const f = sit.forts.find((x) => x.id === fort)!;
    const withHelp = lossOver(sit, p.intensity, p.defence, Math.min(H, delay)) + lossOver(sit, p.intensity, p.defence + men, H - delay) + weather(f);
    loss[fort] = Math.floor((pPermille * withHelp + (1000 - pPermille) * loss[fort]) / 1000);
  };
  /** A repair finishing within the horizon lifts the wall back to `to` at completion; damage before and after is in `loss`. */
  const repairGain = (fort: string, to: number, delay: number, pPermille: number) => {
    const p = pics[fort];
    if (p.cond === null || delay >= H) return 0;
    const before = p.cond - Math.floor((loss[fort] * delay) / H);
    return Math.floor((Math.max(0, to - before) * pPermille) / 1000);
  };
  const repairCost = (fort: string, to: number) => Math.max(0, to - (pics[fort].cond ?? to)) * sit.p.repairCostPerMilli;
  switch (a.kind) {
    case "hold": case "advise_wait": break;
    case "request_repair": {
      const delay = 2 * sit.travel(sit.post, sit.rulerSeat, "rider") + sit.p.repairDays * DAY;
      restore[T!] = repairGain(T!, sit.p.restoreToMilli, delay, sit.superior ? sit.answerRate(sit.superior) : 0);
      break;
    }
    case "request_reinforcement": {
      const c = sit.captains.find((x) => x.id === T)!;
      const delay = sit.travel(sit.post, c.seat, "rider") + sit.travel(c.seat, sit.post, "army");
      reinforce(sit.post, c.troops, delay, sit.answerRate(c.id));
      e.helps = c.id;
      break;
    }
    case "sortie": {
      const fort = sit.forts.find((f) => f.sites.includes(T!))!.id;
      const p = pics[fort];
      const intensity = (per.get(T!, "threat.intensity")?.value as number) ?? 0;
      const men = p.defence;
      e.successP = sortieP(sit, men, sit.cap.military ?? 0, intensity);
      const s = e.successP, sp = sit.p.battle.sortie;
      loss[fort] = Math.floor((s * lossOver(sit, intensity, men, DAY) + (1000 - s) * lossOver(sit, p.intensity, Math.floor((men * (1000 - sp.lossOnFailurePermille)) / 1000), H)) / 1000);
      e.menLost = Math.floor((men * (s * sp.lossOnSuccessPermille + (1000 - s) * sp.lossOnFailurePermille)) / 1_000_000);
      e.renownPermille = s;
      break;
    }
    case "march_to": case "send_detachment": {
      const men = a.kind === "march_to" ? sit.troops : Math.floor(sit.troops / 2);
      const from = sit.at ?? sit.post;
      reinforce(T!, men, sit.travel(from, T!, "army"), 1000);
      e.leavesPost = a.kind === "march_to" && sit.at === sit.post && T !== sit.post;
      if (pics[T!]?.intensity > 0) e.renownPermille = a.kind === "march_to" ? 300 : 100;
      break;
    }
    case "return_to_post": {
      if (sit.at && pics[sit.at] && sit.troops) {
        const p = pics[sit.at];
        loss[sit.at] = lossOver(sit, p.intensity, Math.max(0, p.defence - sit.troops), H);
      }
      break;
    }
    case "repair_works": case "partial_repair": {
      const to = a.kind === "repair_works" ? sit.p.restoreToMilli : sit.p.partialRestoreToMilli;
      restore[T!] = repairGain(T!, to, sit.p.repairDays * DAY, 1000);
      e.costMilli = repairCost(T!, to);
      break;
    }
    case "investigate": e.leavesPost = sit.at === sit.post && T !== sit.post; break;
    case "delegate_investigation": break; // someone else goes
    case "levy": e.gainMilli = sit.p.levyMilli; break;
    case "half_levy": e.gainMilli = Math.floor(sit.p.levyMilli / 2); break;
    // advice: what the adviser expects if the ruler did this
    case "advise_repair": {
      const delay = sit.travel(sit.rulerSeat, T!, "rider") + sit.p.repairDays * DAY;
      restore[T!] = repairGain(T!, sit.p.restoreToMilli, delay, 900);
      e.costMilli = repairCost(T!, sit.p.restoreToMilli);
      break;
    }
    case "advise_retake": case "advise_send_captain": {
      const c = sit.captains[0];
      if (c && per.get(T!, "fortification.holder")?.value === "raiders") {
        // marching on a fort the raiders hold is an assault: win and the walls are ours again, lose and the captain's men pay for it
        const delay = sit.travel(sit.rulerSeat, c.seat, "rider") + sit.travel(c.seat, T!, "army");
        const skill = c.id === sit.agent ? (sit.cap.military ?? 0) : 600;
        const foe = raiderMen(sit.p.battle, pics[T!].intensity);
        e.successP = judged(sit, `odds:${T}`, sortieP(sit, c.troops, skill, pics[T!].intensity), sit.cap.military ?? 0);
        const s = e.successP;
        restore[T!] = repairGain(T!, sit.p.retakeMilli, delay, s);
        e.menLost = Math.floor((s * battleLoss(sit.p.battle, c.troops, foe, true) + (1000 - s) * battleLoss(sit.p.battle, c.troops, foe, false)) / 1000);
        e.costMilli = awayCost(sit, daysOf(delay) + 10);
        if (c.id === sit.agent) { e.leavesPost = true; e.renownPermille = s; }
      } else if (c) {
        const delay = sit.travel(sit.rulerSeat, c.seat, "rider") + sit.travel(c.seat, T!, "army");
        reinforce(T!, c.troops, delay, 800);
        e.costMilli = awayCost(sit, daysOf(delay) + 10);
        if (c.id === sit.agent) { e.leavesPost = true; e.renownPermille = 300; }
      }
      break;
    }
    case "advise_sortie": {
      const c = sit.captains[0];
      const fort = sit.forts.find((f) => f.sites.includes(T!))!.id;
      const p = pics[fort];
      const intensity = (per.get(T!, "threat.intensity")?.value as number) ?? 0;
      if (c) {
        const men = p.defence + c.troops;
        const skill = c.id === sit.agent ? (sit.cap.military ?? 0) : 600;
        e.successP = judged(sit, `odds:${T}`, sortieP(sit, men, skill, intensity), sit.cap.military ?? 0);
        const s = e.successP, foe = raiderMen(sit.p.battle, intensity);
        const delay = sit.travel(sit.rulerSeat, c.seat, "rider") + sit.travel(c.seat, fort, "army");
        e.costMilli = awayCost(sit, daysOf(delay) + 5);
        loss[fort] = lossOver(sit, p.intensity, p.defence, Math.min(H, delay)) +
          Math.floor((s * lossOver(sit, intensity, men, DAY) + (1000 - s) * lossOver(sit, p.intensity, Math.floor((men * 700) / 1000), H - delay - DAY)) / 1000);
        e.menLost = Math.floor((s * battleLoss(sit.p.battle, men, foe, true) + (1000 - s) * battleLoss(sit.p.battle, men, foe, false)) / 1000);
        if (c.id === sit.agent) { e.leavesPost = true; e.renownPermille = s; }
      }
      break;
    }
    case "advise_repair_rush": case "advise_repair_labour": { // the captain's men help: quicker and dearer (rush), or free but slow (labour)
      const c = sit.captains[0], f = sit.forts.find((x) => x.id === T)!;
      const rush = a.kind === "advise_repair_rush";
      const crew = c ? Math.floor((c.troops * sit.p.companyWorkPermille) / 1000) : 0;
      const days = rush ? (sit.p.repairDays * f.garrison) / Math.max(1, f.garrison + crew) : (sit.p.repairDays * sit.p.labourWorkPermille * f.garrison) / (1000 * Math.max(1, f.garrison + crew));
      const to = rush ? sit.p.restoreToMilli : Math.min(sit.p.labourToMilli, sit.p.restoreToMilli);
      restore[T!] = repairGain(T!, to, sit.travel(sit.rulerSeat, T!, "rider") + Math.ceil(days * DAY), 900);
      e.costMilli = (rush ? Math.floor((repairCost(T!, to) * sit.p.rushCostPermille) / 1000) : 0) + awayCost(sit, Math.ceil(days));
      break;
    }
    case "advise_recall": { // he goes home: the company refills, the fort he leaves has fewer defenders
      const c = sit.captains[0], q = c ? per.get(c.id, "captain.query") : null, here = q ? String(q.value) : "";
      const have = (c && (per.get(c.id, "character.troops")?.value as number)) || 0;
      if (c && pics[here]) {
        const p = pics[here];
        loss[here] = lossOver(sit, p.intensity, Math.max(0, p.defence - have), H) + weather(sit.forts.find((x) => x.id === here)!);
        e.menLost = -Math.max(0, c.troops - have);
        e.helps = c.id;
      }
      break;
    }
    case "advise_stay": { // he stays: his men defend and help rebuild, and the company stays below strength
      const c = sit.captains[0], have = (c && (per.get(c.id, "character.troops")?.value as number)) || 0;
      if (c && pics[T!]) {
        reinforce(T!, have, 0, 1000);
        // his men can help rebuild (labour), but it takes an order and time
        restore[T!] = repairGain(T!, Math.min(sit.p.labourToMilli, sit.p.restoreToMilli), Math.ceil((sit.p.repairDays * sit.p.labourWorkPermille) / 1000) * DAY, 600);
        e.costMilli = awayCost(sit, 14);
      }
      break;
    }
    case "advise_levy": e.gainMilli = sit.p.levyMilli; break;
    default: throw new Error(`no expectation model for ${a.kind}`);
  }
  return e;
}
