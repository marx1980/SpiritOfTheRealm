// What an agent expects an action to do, as the agent perceives it (ARCHITECTURE §20.6). Integer milli units.
import type { ActionRef, Perceiver, Situation } from "./model.ts";
import { DAY } from "./model.ts";

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
    case "levy": e.gainMilli = sit.p.levyMilli; break;
    case "half_levy": e.gainMilli = Math.floor(sit.p.levyMilli / 2); break;
    // advice: what the adviser expects if the ruler did this
    case "advise_repair": {
      const delay = sit.travel(sit.rulerSeat, T!, "rider") + sit.p.repairDays * DAY;
      restore[T!] = repairGain(T!, sit.p.restoreToMilli, delay, 900);
      e.costMilli = repairCost(T!, sit.p.restoreToMilli);
      break;
    }
    case "advise_send_captain": {
      const c = sit.captains[0];
      if (c) {
        const delay = sit.travel(sit.rulerSeat, c.seat, "rider") + sit.travel(c.seat, T!, "army");
        reinforce(T!, c.troops, delay, 800);
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
        e.successP = sortieP(sit, men, skill, intensity);
        const s = e.successP, sp = sit.p.battle.sortie;
        const delay = sit.travel(sit.rulerSeat, c.seat, "rider") + sit.travel(c.seat, fort, "army");
        loss[fort] = lossOver(sit, p.intensity, p.defence, Math.min(H, delay)) +
          Math.floor((s * lossOver(sit, intensity, men, DAY) + (1000 - s) * lossOver(sit, p.intensity, Math.floor((men * 700) / 1000), H - delay - DAY)) / 1000);
        e.menLost = Math.floor((men * (s * sp.lossOnSuccessPermille + (1000 - s) * sp.lossOnFailurePermille)) / 1_000_000);
        if (c.id === sit.agent) { e.leavesPost = true; e.renownPermille = s; }
      }
      break;
    }
    case "advise_levy": e.gainMilli = sit.p.levyMilli; break;
    default: throw new Error(`no expectation model for ${a.kind}`);
  }
  return e;
}
