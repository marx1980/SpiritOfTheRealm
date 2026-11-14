// Phase 14B (docs/FRONTIER.md): the court across the border. It reads the March through its informants, settles on a stance and
// sends it to its actors, each by a road of its own length; an actor acts on the last instruction that has reached him, so two of
// them can hold stances that cannot both be served. A commander on `strike` may march: a host appears at the gate and raids the
// target fort through the ordinary raid mechanics. The crown's representative writes what he has seen. Every step is an event with a cause.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc } from "./types.ts";
import { FRONTIER_STANCES, type FrontierParams, type FrontierStance } from "../content.ts";
import { best, learn } from "./knowledge.ts";
import { compose } from "./messenger.ts";
import { isDead } from "../world.ts";
import { siteDay } from "./physical.ts";

const P = (ctx: Ctx) => ctx.content.scenario.frontier!;
const INSTRUCTED = ["ambassador", "commander", "merchant"] as const;

/** How weak the court judges the March to be, 0 to 1000: the worst of the objective forts (a fallen one counts as lost), blurred by `noise`. */
export function weaknessOf(forts: { conditionMilli: number; fallen: boolean }[], noise: number): number {
  const worst = Math.max(0, ...forts.map((f) => (f.fallen ? 1000 : Math.floor((100000 - f.conditionMilli) / 100))));
  return Math.max(0, Math.min(1000, worst + noise));
}

/** The stance the court takes: a step toward what the reading calls for, and only once the present one has been held long enough. */
export function stanceFor(weakness: number, current: FrontierStance, since: number, now: number, court: Pick<FrontierParams["court"], "holdDays" | "thresholds">): FrontierStance {
  const t = court.thresholds;
  const target: FrontierStance = weakness < t.tradeFrom ? "settle" : weakness < t.pressFrom ? "trade" : weakness < t.strikeFrom ? "press" : "strike";
  if (target === current || now - since < court.holdDays * DAY) return current;
  const i = FRONTIER_STANCES.indexOf(current), j = FRONTIER_STANCES.indexOf(target);
  return FRONTIER_STANCES[i + (j > i ? 1 : -1)];
}

function review(ctx: Ctx) {
  const p = P(ctx), c = p.court, r = ctx.rng("frontier"), f = ctx.s.fr!;
  // a fixed schedule of draws per review, used or not (G-02)
  const noise = r.int(-c.informantNoise, c.informantNoise), next = r.int(c.reviewDays[0], c.reviewDays[1]);
  const forts = ctx.content.scenario.objective.forts.map((id) => ({ conditionMilli: ctx.s.fortifications[id].conditionMilli, fallen: !!ctx.s.fallen[id] }));
  // a refusal makes the March look weaker for a while; a truce holds the court at `settle` (its instructions still take the roads)
  const refused = ctx.tick < f.refusedUntil ? p.treaty.refusePermille : 0;
  const from = f.stance, weakness = Math.min(1000, weaknessOf(forts, noise) + refused), stance = ctx.tick < f.truceUntil ? "settle" : stanceFor(weakness, from, f.since, ctx.tick, c);
  const ev = ctx.emit("FrontierReview", [], [loc(p.market)], { weakness, stance, from, changed: stance !== from }, "frontier");
  ctx.at(ctx.tick + next * DAY, "frontier:review", {});
  if (stance === from) return;
  for (const actor of INSTRUCTED) {
    const [lo, hi] = p.delayDays[actor], days = ctx.keyed(`frontier:delay:${ev.id}:${actor}`).int(lo, hi), arrivesAt = ctx.tick + days * DAY;
    const ins = ctx.emit("FrontierInstruction", [ev.id], [chr(p.actors[actor]), loc(p.market)], { actor, who: p.actors[actor], stance, arrivesAt });
    ctx.at(arrivesAt, "frontier:arrive", { instr: ins.id, actor, stance });
  }
}

function arrive(ctx: Ctx, instr: number, actor: (typeof INSTRUCTED)[number], stance: FrontierStance) {
  const p = P(ctx), clash = ctx.s.fr!.clash;
  const a = ctx.emit("FrontierInstructionArrived", [instr], [chr(p.actors[actor])], { actor, who: p.actors[actor], stance }, "frontier");
  if (!clash && ctx.s.fr!.clash)
    ctx.emit("FrontierContradiction", [a.id], [chr(p.actors.ambassador), chr(p.actors.commander)], { ambassador: ctx.s.fr!.current.ambassador.stance, commander: ctx.s.fr!.current.commander.stance }, "frontier");
  if (actor === "commander" && stance === "strike") consider(ctx, a.id);
  if (actor === "ambassador" && stance === "settle") propose(ctx, a.id);
}

/** The commander on `strike` decides whether to march; his reasons are recorded. */
function consider(ctx: Ctx, cause: number) {
  const p = P(ctx), f = ctx.s.fr!, who = p.actors.commander;
  if (f.current.commander.stance !== "strike" || isDead(ctx.s, who) || !ctx.enabled("threat") || ctx.s.threats[p.site]) return;
  if (f.lastStrike >= 0 && ctx.tick - f.lastStrike < p.strike.cooldownDays * DAY) return;
  const ch = ctx.content.byId.character.get(who)!, reasons: { kind: string; ref: string; weight: number }[] = [{ kind: "base", ref: "caution", weight: p.strike.declinePermille }];
  for (const t of ch.traits) { const w = p.strike.traitShift[t]; if (w) reasons.push({ kind: "trait", ref: t, weight: w }); }
  const decline = Math.max(0, Math.min(1000, reasons.reduce((n, x) => n + x.weight, 0)));
  const k = ctx.keyed(`frontier:strike:${ctx.tick}`);
  const roll = k.int(0, 999), intensityPermille = k.int(p.strike.intensityPermille[0], p.strike.intensityPermille[1]), durationDays = k.int(p.strike.durationDays[0], p.strike.durationDays[1]);
  if (roll < decline) { ctx.emit("FrontierDeclined", [cause], [chr(who)], { reasons, declinePermille: decline }, "frontier"); return; }
  const s = ctx.emit("FrontierStrike", [cause], [chr(who), loc(p.site), loc(p.target)], { site: p.site, target: p.target, intensityPermille, durationDays, reasons }, "frontier");
  ctx.emit("ThreatBegan", [s.id], [loc(p.site), loc(p.target)], { site: p.site, target: p.target, intensityPermille, untilTick: ctx.tick + durationDays * DAY }, "frontier");
}

/** The ambassador on `settle` offers terms to the crown, once per cooldown, and writes to her about them. */
function propose(ctx: Ctx, cause: number) {
  const p = P(ctx), f = ctx.s.fr!, who = p.actors.ambassador, ruler = ctx.content.scenario.ruler;
  if (f.current.ambassador.stance !== "settle" || isDead(ctx.s, who)) return;
  if (f.lastTreaty >= 0 && ctx.tick - f.lastTreaty < p.treaty.cooldownDays * DAY) return;
  if (ctx.tick < f.truceUntil) return; // terms are already agreed
  const t = ctx.emit("TreatyProposed", [cause], [chr(who), chr(ruler)], { from: who, stance: f.current.ambassador.stance, tributeMilli: p.treaty.tributeMilli, truceDays: p.treaty.truceDays, openDays: p.treaty.openDays }, "frontier");
  if (!ctx.enabled("messenger")) return;
  // an ambassador to the crown knows where the crown sits (a background actor holds no beliefs of his own until he needs one)
  if (!best(ctx, who, ruler, "character.seat")) learn(ctx, who, { subject: chr(ruler), predicate: "character.seat", value: ctx.content.byId.character.get(ruler)!.location, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: t.id, source: who }, [t.id]);
  const upd = learn(ctx, who, { subject: chr(who), predicate: "frontier.treaty", value: t.id, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: t.id, source: who }, [t.id]);
  const b = best(ctx, who, who, "frontier.treaty");
  if (!b) return;
  const { band, ...rest } = b;
  compose(ctx, who, ruler, [{ ...rest, reliabilityBand: band as typeof b.reliabilityBand }], upd.id);
}

/** The ruler answers the offer that is open. The word takes the ambassador's road; only its arrival signs or refuses. Anything else does nothing. */
export function answerTreaty(ctx: Ctx, offer: number, accept: boolean, cause: number) {
  const p = ctx.content.scenario.frontier, f = ctx.s.fr;
  if (!p || !f || !ctx.enabled("frontier") || !f.offer || f.offer.id !== offer || f.offer.answered || ctx.tick >= f.offer.lapsesAt) return;
  const ruler = ctx.content.scenario.ruler, a = ctx.emit("TreatyAnswered", [cause, offer], [chr(ruler), chr(p.actors.ambassador)], { offer, accepted: accept }, "frontier");
  const [lo, hi] = p.delayDays.ambassador, days = ctx.keyed(`frontier:answer:${a.id}`).int(lo, hi);
  ctx.at(ctx.tick + days * DAY, "frontier:answered", { answer: a.id, accept });
}

function answered(ctx: Ctx, answer: number, accept: boolean) {
  const p = P(ctx), ruler = ctx.content.scenario.ruler, offer = ctx.s.fr!.offer;
  if (!offer) return;
  if (accept) ctx.emit("TreatySigned", [answer], [chr(p.actors.ambassador), chr(ruler)], { offer: offer.id, tributeMilli: p.treaty.tributeMilli, truceDays: p.treaty.truceDays, truceUntil: ctx.tick + p.treaty.truceDays * DAY, payer: ruler }, "frontier");
  else ctx.emit("TreatyRefused", [answer], [chr(p.actors.ambassador), chr(ruler)], { offer: offer.id, until: ctx.tick + p.treaty.refuseDays * DAY }, "frontier");
}

/** The merchant, on a peaceful or trading stance and with no host at the gate, brings grain to the March every `everyDays`. */
function trade(ctx: Ctx) {
  const p = P(ctx), f = ctx.s.fr!, who = p.actors.merchant, st = f.current.merchant.stance;
  if ((st !== "trade" && st !== "settle") || isDead(ctx.s, who) || ctx.s.threats[p.site]) return;
  if (ctx.tick - Math.max(f.lastTrade, 0) < p.trade.everyDays * DAY) return;
  const sacks = ctx.keyed(`frontier:trade:${ctx.tick}`).int(p.trade.sacks[0], p.trade.sacks[1]);
  ctx.emit("FrontierTrade", [f.current.merchant.event], [chr(who), loc(p.market), loc(p.trade.dest)], { from: p.market, to: p.trade.dest, sacks }, "frontier");
}

/** The crown's representative looks at the commander and writes to the ruler what he thinks he saw. */
function report(ctx: Ctx) {
  const p = P(ctx), rep = p.actors.representative, f = ctx.s.fr!, ruler = ctx.content.scenario.ruler;
  if (isDead(ctx.s, rep) || !ctx.enabled("messenger")) return; // a letter needs the messengers
  const cur = f.current.commander, k = ctx.keyed(`frontier:report:${ctx.tick}`);
  const idx = FRONTIER_STANCES.indexOf(cur.stance), blurred = k.int(0, 999) < p.report.blurPermille, dir = k.int(0, 1) ? 1 : -1;
  const seen = blurred ? Math.max(0, Math.min(FRONTIER_STANCES.length - 1, idx + dir)) : idx;
  // his looking is the court's own event, so that everything that follows from it (his belief, his letter) has the frontier before it
  const looked = ctx.emit("FrontierObserved", [cur.event], [chr(rep), loc(p.site)], { who: rep, seen }, "frontier");
  const upd = learn(ctx, rep, { subject: loc(p.site), predicate: "frontier.posture", value: seen, observedAt: ctx.tick, band: "probable" }, { kind: "observation", eventId: looked.id, source: rep }, [looked.id]);
  const b = best(ctx, rep, p.site, "frontier.posture");
  if (!b) return;
  const { band, ...rest } = b;
  compose(ctx, rep, ruler, [{ ...rest, reliabilityBand: band as typeof b.reliabilityBand }], upd.id);
}

export const frontier: System = {
  id: "frontier",
  start: (ctx) => {
    const p = ctx.content.scenario.frontier;
    if (!p) return;
    const r = ctx.rng("frontier");
    ctx.at(r.int(p.court.reviewDays[0], p.court.reviewDays[1]) * DAY + 8 * HOUR, "frontier:review", {});
    ctx.at(DAY + 3 * HOUR, "frontier:day", {});
    ctx.at(p.report.everyDays * DAY + 9 * HOUR, "frontier:report", {});
  },
  handlers: {
    "frontier:review": (ctx) => review(ctx),
    "frontier:arrive": (ctx, { instr, actor, stance }) => arrive(ctx, instr, actor, stance),
    "frontier:answered": (ctx, { answer, accept }) => answered(ctx, answer, accept),
    "frontier:report": (ctx) => { report(ctx); ctx.at(ctx.tick + P(ctx).report.everyDays * DAY, "frontier:report", {}); },
    "frontier:day": (ctx) => {
      const p = P(ctx), r = ctx.rng("frontier"), f = ctx.s.fr!;
      // the host at the gate: a fixed draw schedule, used or not, and never a random start (only a strike begins it)
      const roll = r.int(0, 999), intensityPermille = r.int(p.strike.intensityPermille[0], p.strike.intensityPermille[1]), days = r.int(p.strike.durationDays[0], p.strike.durationDays[1]);
      if (ctx.enabled("threat") && siteDay(ctx, p.site, p.target, { roll, intensityPermille, days }, 0, "frontier")) return; // the campaign has ended
      // a commander still on `strike` whose cooldown has run out, an ambassador still on `settle`
      trade(ctx);
      consider(ctx, f.current.commander.event);
      propose(ctx, f.current.ambassador.event);
      ctx.extraDraws("frontier");
      ctx.at(ctx.tick + DAY, "frontier:day", {});
    },
  },
};
