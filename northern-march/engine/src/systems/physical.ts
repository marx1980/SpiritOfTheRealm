// Placeholder physical processes (treasury, weathering and storms, a forest threat). They exist to give the
// knowledge and messenger systems something real to observe; later phases replace them.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { cmp } from "../world.ts";
import { best, observe } from "./knowledge.ts";

const presentAt = (ctx: Ctx, where: string) => sorted(Object.entries(ctx.s.positions).filter(([, p]) => "at" in p && p.at === where).map(([id]) => id), (x) => x);
export function defence(ctx: Ctx, where: string) {
  let men = ctx.s.fortifications[where]?.garrison ?? 0;
  for (const who of presentAt(ctx, where)) men += ctx.s.troops[who] ?? 0;
  return men;
}

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
  start: (ctx) => {
    ctx.at(DAY + 2 * HOUR, "threat:day", {});
    ctx.content.scenario.scripts.forEach((s, i) => { if (s.kind === "threat") ctx.at(s.day * DAY + 2 * HOUR - 60, "threat:script", { i }); });
  },
  handlers: {
    "threat:script": (ctx, { i }) => {
      const s = ctx.content.scenario.scripts[i];
      if (s.kind !== "threat" || ctx.s.threats[s.site]) return;
      const target = ctx.content.scenario.threat.sites.find((x) => x.site === s.site)!.target;
      const sc = ctx.emit("ThreatScripted", [], [loc(s.site)], { site: s.site, intensityPermille: s.intensityPermille, durationDays: s.durationDays });
      ctx.emit("ThreatBegan", [sc.id], [loc(s.site), loc(target)], { site: s.site, target, intensityPermille: s.intensityPermille, untilTick: ctx.tick + s.durationDays * DAY });
    },
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
          const men = defence(ctx, target);
          const damageMilli = Math.floor((t.raidDamageMilliAtFullIntensity * active.intensityPermille) / (1000 + men * ctx.content.scenario.battle.raidMitigationPerManPermille));
          const e = ctx.emit("RaidDamage", [active.eventId], [loc(target)], { site, location: target, damageMilli, defenders: men });
          // Those present experience the raid: they see the damage and estimate the raiders' strength.
          for (const who of presentAt(ctx, target)) {
            observe(ctx, who, loc(target), "fortification.condition", e.id);
            observe(ctx, who, loc(site), "threat.intensity", e.id);
          }
          maybeAlarm(ctx, target, before, e.id);
        }
      }
      // Days without raids are evidence too: those at the target who still believe in a threat notice the quiet.
      for (const { site, target } of sorted(t.sites, (x) => x.site)) {
        if (ctx.s.threats[site]) continue;
        const last = ctx.s.lastRaid[target];
        if (last === undefined || ctx.tick - last < ctx.content.scenario.agents.quietDaysToEnd * DAY) continue;
        for (const who of presentAt(ctx, target)) {
          const b = best(ctx, who, site, "threat.intensity");
          if (b && (b.believedValue as number) > 0) observe(ctx, who, loc(site), "threat.intensity", ctx.s.fortifications[target].lastChangeEvent);
        }
      }
      ctx.extraDraws("threat");
      ctx.at(ctx.tick + DAY, "threat:day", {});
    },
  },
};
