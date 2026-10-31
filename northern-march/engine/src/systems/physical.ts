// Placeholder physical processes (treasury, weathering and storms, a forest threat). They exist to give the
// knowledge and messenger systems something real to observe; later phases replace them.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { cmp } from "../world.ts";

export function maybeAlarm(ctx: Ctx, location: string, before: number, cause: number) {
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
      for (const h of sorted(sc.economy.holdings, (h) => h.location)) {
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
      for (const l of sorted(ctx.content.locations, (l) => l.id)) {
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
      for (const { site, target } of sorted(t.sites, (x) => x.site)) {
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
