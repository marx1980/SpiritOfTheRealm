// Placeholder physical processes (treasury, weathering and storms, a forest threat). They exist to give the
// knowledge and messenger systems something real to observe; later phases replace them.
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { cmp } from "../world.ts";
import { best, learn, observe, observeTreasury } from "./knowledge.ts";
import { travel } from "./movement.ts";

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

/** Personal danger (P0.07): signalled before it can be lethal. The ruler at a raided fort is warned when she believes the
 *  walls are failing; if they are breached with her inside, she is captured or killed and the campaign ends. */
function presence(ctx: Ctx, fort: string, raid: number): boolean {
  const sc = ctx.content.scenario, ruler = sc.ruler, pos = ctx.s.positions[ruler];
  if (!("at" in pos) || pos.at !== fort) return false;
  const cond = ctx.s.fortifications[fort].conditionMilli;
  if (cond < sc.endStates.fortificationBreachedBelowMilli) {
    const r = ctx.keyed(`threat:presence:${ctx.tick}`);
    const ending = r.chancePermille(sc.presence.deathPermille) ? "killed" : "captured";
    ctx.emit("CampaignEnded", [raid], [chr(ruler), loc(fort)], { ending, where: fort });
    return true;
  }
  observe(ctx, ruler, loc(fort), "fortification.condition", raid); // she is on the walls when the raiders strike
  const believed = best(ctx, ruler, fort, "fortification.condition");
  if (believed && (believed.believedValue as number) < sc.presence.dangerBelowMilli && ctx.tick - ctx.s.campaign.lastDanger > 5 * DAY) {
    const w = ctx.emit("DangerSignalled", [raid], [chr(ruler), loc(fort)], { who: ruler, where: fort, believedMilli: believed.believedValue });
    ctx.at(ctx.tick, "player:decide", { cause: w.id, reason: "danger" });
  }
  return false;
}

/** Those at the fort when something befalls it know what it was. */
function witness(ctx: Ctx, where: string, kind: string, cause: number) {
  if (!ctx.s.fortifications[where]) return; // only forts are written about
  for (const who of presentAt(ctx, where).filter((x) => ctx.s.tiers[x] !== "C"))
    learn(ctx, who, { subject: loc(where), predicate: "fortification.incident", value: kind, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: cause, source: who }, [cause]);
}

/** The raiders break in: the fort is lost, those inside get word out (the castellan writes at once) and then fall back. */
function fall(ctx: Ctx, fort: string, site: string, cause: number) {
  const ev = ctx.emit("FortFell", [cause], [loc(fort), loc(site)], { fort, site });
  for (const who of presentAt(ctx, fort).filter((x) => ctx.s.tiers[x] !== "C"))
    learn(ctx, who, { subject: loc(fort), predicate: "fortification.holder", value: "raiders", observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: ev.id, source: who }, [ev.id]);
  ctx.at(ctx.tick, "messenger:urgent", { location: fort, cause: ev.id });
  ctx.at(ctx.tick + HOUR, "threat:flee", { fort, cause: ev.id });
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
      const up = ctx.emit("UpkeepPaid", [], [chr(sc.ruler)], { holder: sc.ruler, amountMilli: sc.economy.dailyUpkeepMilli });
      observeTreasury(ctx, up.id);
      // Garrisons refill by 2% of their establishment (at least one man) a day, up to that establishment.
      const gains = Object.keys(ctx.s.fortifications).sort(cmp).flatMap((f): [string, number][] => {
        const fo = ctx.s.fortifications[f], gap = fo.establishment - fo.garrison;
        return gap > 0 && !ctx.s.fallen[f] ? [[f, Math.min(gap, Math.max(1, Math.floor((fo.establishment * 20) / 1000)))]] : [];
      });
      if (gains.length) ctx.emit("GarrisonRecovered", [], gains.map(([f]) => loc(f)), { changes: gains });
      // A captain's company refills by 2% of its establishment a day, only while he is in his home town.
      const back = ctx.content.characters.filter((c) => c.troops).sort((a, b) => cmp(a.id, b.id)).flatMap((c): [string, number][] => {
        const pos = ctx.s.positions[c.id], gap = c.troops! - (ctx.s.troops[c.id] ?? 0);
        return gap > 0 && "at" in pos && pos.at === c.location ? [[c.id, Math.min(gap, Math.max(1, Math.floor((c.troops! * 20) / 1000)))]] : [];
      });
      if (back.length) ctx.emit("CompanyRecovered", [], back.map(([c]) => chr(c)), { changes: back });
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
        const e = ctx.emit("Storm", [], [loc(l.id)], { location: l.id, damageMilli, kind: "storm" }, "weather");
        maybeAlarm(ctx, l.id, before, e.id);
        witness(ctx, l.id, "storm", e.id);
      }
      // rarer incidents at the forts: fires and earthquakes (own keyed draws, so the weather stream stays aligned)
      for (const f of forts) {
        const k = ctx.keyed(`weather:incident:${ctx.tick}:${f}`);
        const fire = k.chancePermille(sc.weather.fireDailyPermille), fireDmg = k.int(sc.weather.fireDamageMilli[0], sc.weather.fireDamageMilli[1]);
        const quake = k.chancePermille(sc.weather.quakeDailyPermille), quakeDmg = k.int(sc.weather.quakeDamageMilli[0], sc.weather.quakeDamageMilli[1]);
        for (const [kind, hit, damageMilli] of [["fire", fire, fireDmg], ["earthquake", quake, quakeDmg]] as const) {
          if (!hit) continue;
          const before = ctx.s.fortifications[f].conditionMilli;
          const e = ctx.emit("Storm", [], [loc(f)], { location: f, damageMilli, kind }, "weather");
          maybeAlarm(ctx, f, before, e.id);
          witness(ctx, f, kind, e.id);
        }
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
    // those left at a fallen fort fall back to the nearest fort still held
    "threat:flee": (ctx, { fort, cause }) => {
      const ruler = ctx.content.scenario.ruler;
      const refuge = Object.keys(ctx.s.fortifications).filter((f) => f !== fort && !ctx.s.fallen[f]).sort(cmp)
        .map((f) => ({ f, ticks: ctx.map.path(fort, f, "rider", (r) => ctx.isOpen(r))?.ticks ?? Infinity })).sort((a, b) => a.ticks - b.ticks)[0];
      if (!refuge || refuge.ticks === Infinity) return;
      for (const who of presentAt(ctx, fort).filter((x) => x !== ruler)) travel(ctx, who, refuge.f, (ctx.s.troops[who] ?? 0) > 0 ? "army" : "rider", false, cause);
    },
    "threat:day": (ctx) => {
      const t = ctx.content.scenario.threat, r = ctx.rng("threat");
      for (const { site, target } of sorted(t.sites, (x) => x.site)) {
        const active = ctx.s.threats[site];
        // A fixed draw schedule (three draws per site per day, used or not), so this stream stays aligned day by day
        // whatever other systems do to the world (G-02).
        const roll = r.int(0, 999), intensityPermille = r.int(t.intensityPermille[0], t.intensityPermille[1]), days = r.int(t.durationDays[0], t.durationDays[1]);
        if (active && ctx.s.fallen[target]) continue; // the raiders hold the fort: they stay until driven out, and there is nothing left to batter
        if (!active) {
          if (roll >= t.startPermillePerDay) continue;
          const untilTick = ctx.tick + DAY * days;
          ctx.emit("ThreatBegan", [], [loc(site), loc(target)], { site, target, intensityPermille, untilTick }, "threat");
        } else if (ctx.tick >= active.untilTick) {
          ctx.emit("ThreatEnded", [active.eventId], [loc(site)], { site });
        } else {
          const before = ctx.s.fortifications[target].conditionMilli;
          const men = defence(ctx, target);
          const damageMilli = Math.floor((t.raidDamageMilliAtFullIntensity * active.intensityPermille) / (1000 + men * ctx.content.scenario.battle.raidMitigationPerManPermille));
          const e = ctx.emit("RaidDamage", [active.eventId], [loc(target)], { site, location: target, damageMilli, defenders: men });
          // Those present experience the raid: they see the damage and estimate the raiders' strength.
          for (const who of presentAt(ctx, target).filter((x) => ctx.s.tiers[x] !== "C")) {
            observe(ctx, who, loc(target), "fortification.condition", e.id);
            observe(ctx, who, loc(site), "threat.intensity", e.id);
          }
          maybeAlarm(ctx, target, before, e.id);
          if (presence(ctx, target, e.id)) return; // the campaign has ended
          if (ctx.s.fortifications[target].conditionMilli < ctx.content.scenario.endStates.fortificationBreachedBelowMilli) fall(ctx, target, site, e.id);
        }
      }
      // Days without raids are evidence too: those at the target who still believe in a threat notice the quiet.
      for (const { site, target } of sorted(t.sites, (x) => x.site)) {
        if (ctx.s.threats[site]) continue;
        const last = ctx.s.lastRaid[target];
        if (last === undefined || ctx.tick - last < ctx.content.scenario.agents.quietDaysToEnd * DAY) continue;
        for (const who of presentAt(ctx, target).filter((x) => ctx.s.tiers[x] !== "C")) {
          const b = best(ctx, who, site, "threat.intensity");
          if (b && (b.believedValue as number) > 0) observe(ctx, who, loc(site), "threat.intensity", ctx.s.fortifications[target].lastChangeEvent);
        }
      }
      ctx.extraDraws("threat");
      ctx.at(ctx.tick + DAY, "threat:day", {});
    },
  },
};
