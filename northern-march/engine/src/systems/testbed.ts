// Phase 1 testbed systems: just enough world to exercise the engine (events, RNG streams, ablation,
// reports, player inputs). Not a game design. Every name comes from content.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR } from "./types.ts";
import { cmp } from "../world.ts";
import type { PlayerAction } from "../policies.ts";

const loc = (id: string) => ({ kind: "location" as const, id });
const chr = (id: string) => ({ kind: "character" as const, id });

function maybeAlarm(ctx: Ctx, location: string, before: number, cause: number) {
  const after = ctx.s.fortifications[location]?.conditionMilli;
  const alarm = ctx.content.scenario.messenger.alarmBelowMilli;
  if (after !== undefined && before >= alarm && after < alarm) ctx.at(ctx.tick, "messenger:urgent", { location, cause });
}

export const economy: System = {
  id: "economy",
  start: (ctx) => ctx.at(DAY, "economy:day", {}),
  handlers: {
    "economy:day": (ctx) => {
      const sc = ctx.content.scenario, r = ctx.rng("economy");
      for (const h of [...sc.economy.holdings].sort((a, b) => cmp(a.location, b.location))) {
        const amountMilli = h.dailyIncomeMilli + r.int(-h.jitterMilli, h.jitterMilli);
        ctx.emit("TreasuryCollected", [], [loc(h.location)], { holder: sc.ruler, location: h.location, amountMilli }, "economy");
      }
      ctx.emit("UpkeepPaid", [], [chr(sc.ruler)], { holder: sc.ruler, amountMilli: sc.economy.dailyUpkeepMilli });
      ctx.extraDraws("economy");
      ctx.at(ctx.tick + DAY, "economy:day", {});
    },
  },
};

export const weather: System = {
  id: "weather",
  start: (ctx) => ctx.at(DAY + HOUR, "weather:day", {}),
  handlers: {
    "weather:day": (ctx) => {
      const sc = ctx.content.scenario, r = ctx.rng("weather");
      const forts = Object.keys(ctx.s.fortifications).sort(cmp);
      if (forts.length) {
        const before = forts.map((f) => ctx.s.fortifications[f].conditionMilli);
        const e = ctx.emit("FortificationsWeathered", [], forts.map(loc), { changes: forts.map((f) => [f, sc.weather.decayMilliPerDay]) });
        forts.forEach((f, i) => maybeAlarm(ctx, f, before[i], e.id));
      }
      for (const l of [...ctx.content.locations].sort((a, b) => cmp(a.id, b.id))) {
        if (l.exposurePermille <= 0 || !r.chancePermille(l.exposurePermille)) continue;
        const damageMilli = r.int(sc.weather.stormDamageMilli[0], sc.weather.stormDamageMilli[1]);
        const before = ctx.s.fortifications[l.id]?.conditionMilli ?? 0;
        const e = ctx.emit("Storm", [], [loc(l.id)], { location: l.id, damageMilli }, "weather");
        maybeAlarm(ctx, l.id, before, e.id);
      }
      ctx.extraDraws("weather");
      ctx.at(ctx.tick + DAY, "weather:day", {});
    },
  },
};

export const threat: System = {
  id: "threat",
  start: (ctx) => ctx.at(DAY + 2 * HOUR, "threat:day", {}),
  handlers: {
    "threat:day": (ctx) => {
      const t = ctx.content.scenario.threat, r = ctx.rng("threat");
      for (const { site, target } of [...t.sites].sort((a, b) => cmp(a.site, b.site))) {
        const active = ctx.s.threats[site];
        if (!active) {
          if (!r.chancePermille(t.startPermillePerDay)) continue;
          const intensityPermille = r.int(t.intensityPermille[0], t.intensityPermille[1]);
          const untilTick = ctx.tick + DAY * r.int(t.durationDays[0], t.durationDays[1]);
          ctx.emit("ThreatBegan", [], [loc(site), loc(target)], { site, target, intensityPermille, untilTick }, "threat");
        } else if (ctx.tick >= active.untilTick) {
          ctx.emit("ThreatEnded", [active.eventId], [loc(site)], { site });
        } else {
          const before = ctx.s.fortifications[target].conditionMilli;
          const damageMilli = Math.floor((t.raidDamageMilliAtFullIntensity * active.intensityPermille) / 1000);
          const e = ctx.emit("RaidDamage", [active.eventId], [loc(target)], { site, location: target, damageMilli });
          maybeAlarm(ctx, target, before, e.id);
        }
      }
      ctx.extraDraws("threat");
      ctx.at(ctx.tick + DAY, "threat:day", {});
    },
  },
};

function compose(ctx: Ctx, authorId: string, location: string, cause: number) {
  const c = ctx.content, sc = c.scenario.messenger;
  const author = c.byId.character.get(authorId)!;
  const recipient = c.byId.character.get(author.reportsTo!)!;
  const reportId = ctx.s.nextReportId;
  const value = Math.round(ctx.s.fortifications[location].conditionMilli / 1000) * 1000; // a castellan reports in whole points
  const composed = ctx.emit("ReportComposed", [cause], [chr(author.id), loc(location)], {
    reportId, author: author.id, recipient: recipient.id, subject: location, predicate: "condition", value, observedAt: ctx.tick, composedAt: ctx.tick,
  });
  const stream = `messenger:report:${ctx.tick}:${location}`;
  const r = ctx.keyed(stream);
  const lost = r.chancePermille(sc.lossPermille);
  const delay = Math.floor((ctx.travelTicks(author.location, recipient.location) * r.int(sc.delayJitterPermille[0], sc.delayJitterPermille[1])) / 1000);
  ctx.at(ctx.tick + Math.max(1, delay), "messenger:arrive", { reportId, composedEventId: composed.id, lost, stream });
}

export const messenger: System = {
  id: "messenger",
  start: (ctx) => {
    for (const ch of [...ctx.content.characters].sort((a, b) => cmp(a.id, b.id)))
      if (ch.reportsTo && ctx.s.fortifications[ch.location])
        ctx.at(ctx.content.scenario.messenger.reportEveryDays * DAY + 6 * HOUR, "messenger:routine", { author: ch.id });
  },
  handlers: {
    "messenger:routine": (ctx, { author }) => {
      const where = ctx.content.byId.character.get(author)!.location;
      compose(ctx, author, where, ctx.s.fortifications[where].lastChangeEvent);
      ctx.at(ctx.tick + ctx.content.scenario.messenger.reportEveryDays * DAY, "messenger:routine", { author });
    },
    "messenger:urgent": (ctx, { location, cause }) => {
      const castellan = [...ctx.content.characters].sort((a, b) => cmp(a.id, b.id)).find((c) => c.location === location && c.reportsTo);
      if (castellan) compose(ctx, castellan.id, location, cause);
    },
    "messenger:arrive": (ctx, { reportId, composedEventId, lost, stream }) => {
      const rep = ctx.s.reports[String(reportId)];
      if (lost) { ctx.emit("ReportLost", [composedEventId], [{ kind: "report", id: String(reportId) }], { reportId }, stream); return; }
      const d = ctx.emit("ReportDelivered", [composedEventId], [chr(rep.recipient), { kind: "report", id: String(reportId) }], { reportId, recipient: rep.recipient }, stream);
      ctx.emit("BeliefUpdated", [d.id], [chr(rep.recipient), loc(rep.subject)], {
        holder: rep.recipient, key: `${rep.subject}:${rep.predicate}`, value: rep.value, observedAt: rep.observedAt, reportId,
      });
      if (rep.recipient === ctx.content.scenario.ruler) ctx.at(ctx.tick, "player:decide", { deliveredEventId: d.id });
    },
    "messenger:sendOrder": (ctx, { inputEventId, target }) => {
      const c = ctx.content, ruler = c.byId.character.get(c.scenario.ruler)!;
      const stream = `messenger:order:${ctx.tick}:${target}`;
      const r = ctx.keyed(stream);
      const lost = r.chancePermille(c.scenario.messenger.lossPermille);
      const j = c.scenario.messenger.delayJitterPermille;
      const delay = Math.floor((ctx.travelTicks(ruler.location, target) * r.int(j[0], j[1])) / 1000);
      ctx.at(ctx.tick + Math.max(1, delay), "messenger:orderArrive", { inputEventId, target, lost, stream });
    },
    "messenger:orderArrive": (ctx, { inputEventId, target, lost, stream }) => {
      const subj = [{ kind: "order" as const, id: String(inputEventId) }, loc(target)];
      if (lost) { ctx.emit("OrderLost", [inputEventId], subj, { inputEventId, target }, stream); return; }
      const d = ctx.emit("OrderDelivered", [inputEventId], subj, { inputEventId, target }, stream);
      ctx.at(ctx.tick, "player:startRepair", { inputEventId, deliveredEventId: d.id, location: target });
    },
  },
};

/** The player system turns policy (or recorded) decisions into PlayerInput events and executes them. */
export function makePlayer(decide: (ctx: Ctx, deliveredEventId: number) => PlayerAction[]): System {
  return {
    id: "player",
    start: () => {},
    handlers: {
      "player:decide": (ctx, { deliveredEventId }) => {
        const ruler = ctx.content.scenario.ruler;
        for (const a of decide(ctx, deliveredEventId)) {
          const input = ctx.emit("PlayerInput", [deliveredEventId], [chr(ruler)], { player: ruler, action: a.action, target: a.target ?? null, decision: a.decision! });
          if (a.action === "levy") ctx.emit("LevyRaised", [input.id], [chr(ruler)], { payer: ruler, amountMilli: ctx.content.scenario.player.levyMilli });
          else ctx.at(ctx.tick, "messenger:sendOrder", { inputEventId: input.id, target: a.target });
        }
      },
      "player:startRepair": (ctx, { inputEventId, deliveredEventId, location }) => {
        const sc = ctx.content.scenario, payer = sc.ruler;
        const cond = ctx.s.fortifications[location]?.conditionMilli;
        const subj = [loc(location)];
        const refuse = (reason: string) => ctx.emit("RepairRefused", [deliveredEventId], subj, { location, reason, inputEventId });
        if (cond === undefined) return refuse("noFortification");
        if (ctx.s.repairs[location]) return refuse("inProgress");
        const restoredMilli = sc.player.repairRestoreToMilli - cond;
        if (restoredMilli <= 0) return refuse("notNeeded");
        const costMilli = restoredMilli * sc.player.repairCostMilliPerMilli;
        if (ctx.s.treasuryMilli[payer] < costMilli) return refuse("funds");
        const st = ctx.emit("RepairStarted", [deliveredEventId], subj, { location, payer, costMilli, startedAt: ctx.tick, inputEventId });
        ctx.at(ctx.tick + sc.player.repairDays * DAY, "player:completeRepair", { location, restoredMilli, startedEventId: st.id });
      },
      "player:completeRepair": (ctx, { location, restoredMilli, startedEventId }) => {
        ctx.emit("RepairCompleted", [startedEventId], [loc(location)], { location, restoredMilli });
      },
    },
  };
}
