// Physical transmission (DESIGN_PIPELINE §4): reports and orders travel with a rider, leg by leg. Each leg can be
// lost; agents at interception points can capture the papers and carry them to their master; at the end, a messenger
// who misses the recipient follows word left with locals (redirect) or gives up (undeliverable).
import { downgrade, type BeliefProposition } from "../beliefs.ts";
import type { Report } from "../schemas.ts";
import type { Messenger } from "../world.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { best, interpretBand, learn, observe } from "./knowledge.ts";

const where = (ctx: Ctx, who: string) => { const p = ctx.s.positions[who]; return "at" in p ? p.at : p.transit.dest; };
const ref = (m: { kind: string }, id: number) => (m.kind === "order" ? { orderId: id } : { reportId: id });
const T = (kind: "report" | "order", ev: string) => (kind === "order" ? `Order${ev}` : `Report${ev}`);

function legs(ctx: Ctx, mid: number, path: { legTicks: number[] }, tag: string) {
  const j = ctx.content.scenario.messenger.legJitterPermille;
  const r = ctx.keyed(`messenger:${mid}:${tag}`);
  let t = ctx.tick;
  return path.legTicks.map((d) => (t += Math.max(1, Math.floor((d * r.int(j[0], j[1])) / 1000))));
}

function schedule(ctx: Ctx, mid: number, arrivals: number[], cause: number) {
  if (arrivals.length) ctx.at(arrivals[0], "messenger:leg", { mid, leg: 0, cause });
  else ctx.at(ctx.tick + 60, "messenger:final", { mid, cause });
}

/** Send a report or an order to where the sender believes the recipient is. */
export function dispatch(ctx: Ctx, kind: "report" | "order", id: number, sender: string, recipient: string, cause: number) {
  // Where the sender last heard the recipient was, while that belief is alive; otherwise the recipient's seat.
  const target = (best(ctx, sender, recipient, "character.location") ?? best(ctx, sender, recipient, "character.seat"))?.believedValue as string | undefined;
  const from = where(ctx, sender);
  const subj = [chr(recipient), { kind, id: String(id) } as const];
  if (!target) return ctx.emit(T(kind, "Undeliverable"), [cause], subj, { ...ref({ kind }, id), messengerId: null, at: from, reason: "recipient location unknown" });
  const path = ctx.map.path(from, target, "rider", (r) => ctx.isOpen(r));
  if (!path) return ctx.emit(T(kind, "Undeliverable"), [cause], subj, { ...ref({ kind }, id), messengerId: null, at: from, reason: "no open route" });
  const mid = ctx.s.nextMessengerId;
  const arrivals = legs(ctx, mid, path, "out");
  // Word sent on a later day does not arrive on the same day as, or before, word of the same kind already on its way.
  const day = Math.floor(ctx.tick / DAY);
  const ahead = Object.values(ctx.s.messengers).filter((m) => m.kind === kind && m.sender === sender && m.recipient === recipient && Math.floor(m.departedAt / DAY) < day);
  if (ahead.length && arrivals.length) arrivals[arrivals.length - 1] = Math.max(arrivals[arrivals.length - 1], Math.max(...ahead.map((m) => m.arrivals[m.arrivals.length - 1] ?? 0)) + DAY);
  const ev = ctx.emit(T(kind, "Dispatched"), [cause], subj, { ...ref({ kind }, id), messengerId: mid, sender, recipient, path: path.locations, arrivals });
  schedule(ctx, mid, arrivals, ev.id);
  return ev;
}

function arrive(ctx: Ctx, m: Messenger, cause: number) {
  const dest = m.path[m.path.length - 1];
  if (m.kind === "captured") {
    if (m.carries === "report") return receiveCapturedReport(ctx, m, ctx.s.reports[String(m.ref)], cause);
    return receiveCapturedOrder(ctx, m, cause);
  }
  const rp = ctx.s.positions[m.recipient];
  const subj = [chr(m.recipient), { kind: m.kind as "report" | "order", id: String(m.ref) }];
  if ("at" in rp && rp.at === dest) {
    if (m.kind === "order") {
      const r = ctx.emit("OrderReceived", [cause], subj, { orderId: m.ref, recipient: m.recipient, at: dest, messengerId: m.id });
      learnSender(ctx, m.recipient, ctx.s.orders[String(m.ref)].order.issuer, m.path[0], m.departedAt, r.id);
      ctx.at(ctx.tick, "orders:received", { orderId: m.ref, receivedEventId: r.id });
      return;
    }
    return deliverReport(ctx, m, dest, cause);
  }
  const word = ctx.s.departures[dest]?.[m.recipient];
  const limit = ctx.content.scenario.messenger.redirectLimit;
  // Letters for an absent ruler are read to the council at her seat before they are sent after her (the regent acts on them).
  const ruler = ctx.content.scenario.ruler;
  if (m.kind === "report" && m.recipient === ruler && dest === ctx.content.scenario.regency.seat) {
    const report = ctx.s.reports[String(m.ref)];
    const hearers = sorted(ctx.content.characters.filter((c) => c.reportsTo === ruler && c.id !== report.author && ctx.s.tiers[c.id] !== "C").map((c) => c.id)
      .filter((id) => { const p = ctx.s.positions[id]; return "at" in p && p.at === dest; }), (x) => x);
    if (hearers.length) {
      const sh = ctx.emit("ReportShared", [cause], [chr(ruler), { kind: "report", id: String(report.id) }], { reportId: report.id, at: dest, hearers, inAbsence: true });
      for (const h of hearers) readReport(ctx, h, report, sh.id);
    }
  }
  if (word && word.to && m.redirects < limit) {
    const target = where(ctx, m.recipient);
    const path = ctx.map.path(dest, target, "rider", (r) => ctx.isOpen(r));
    if (path && path.locations.length > 1) {
      const arrivals = legs(ctx, m.id, path, `redirect${m.redirects}`);
      const ev = ctx.emit("MessengerRedirected", [cause], [chr(m.recipient), loc(dest), loc(target)],
        { messengerId: m.id, carrying: { kind: m.kind, id: m.ref }, from: dest, to: target, path: path.locations, arrivals, departedAt: ctx.tick });
      return schedule(ctx, m.id, arrivals, ev.id);
    }
  }
  const reason = word && word.to ? "redirect limit" : "recipient not found";
  ctx.emit(T(m.kind as "report" | "order", "Undeliverable"), [cause], subj, { ...ref(m, m.ref), messengerId: m.id, at: dest, reason });
}

function deliverReport(ctx: Ctx, m: Messenger, at: string, cause: number) {
  const report = ctx.s.reports[String(m.ref)];
  const d = ctx.emit("ReportDelivered", [cause], [chr(m.recipient), { kind: "report", id: String(m.ref) }], { reportId: m.ref, recipient: m.recipient, at, messengerId: m.id });
  readReport(ctx, m.recipient, report, d.id);
  // At court the dispatch is read out: councillors present hear it too (DESIGN_PIPELINE §5).
  if (m.recipient === ctx.content.scenario.ruler) {
    const hearers = sorted(ctx.content.characters.filter((c) => c.reportsTo === m.recipient && c.id !== report.author).map((c) => c.id)
      .filter((id) => { const p = ctx.s.positions[id]; return "at" in p && p.at === at; }), (x) => x);
    if (hearers.length) {
      const sh = ctx.emit("ReportShared", [d.id], [chr(m.recipient), { kind: "report", id: String(report.id) }], { reportId: report.id, at, hearers });
      for (const h of hearers) readReport(ctx, h, report, sh.id);
    }
    ctx.at(ctx.tick, "player:decide", { cause: d.id, reason: "report" });
    const day = Math.floor(ctx.tick / 86400);
    if (ctx.params.dayEnd && ctx.s.dayEndDay !== day) {
      ctx.emit("DayEndScheduled", [d.id], [chr(m.recipient)], { day });
      ctx.at(day * 86400 + 86400 - 1, "player:dayend", { cause: d.id });
    }
  }
}

/** An order says who sent it and from where: the recipient learns the issuer's seat and whereabouts (B5 evidence "order"). */
export function learnSender(ctx: Ctx, recipient: string, issuer: string, from: string, sentAt: number, receivedEventId: number) {
  if (recipient === issuer) return;
  const ev = { kind: "order" as const, eventId: receivedEventId, source: issuer };
  learn(ctx, recipient, { subject: chr(issuer), predicate: "character.seat", value: ctx.content.byId.character.get(issuer)!.location, observedAt: sentAt, band: "certain" }, ev, [receivedEventId]);
  learn(ctx, recipient, { subject: chr(issuer), predicate: "character.location", value: from, observedAt: sentAt, band: "probable" }, ev, [receivedEventId]);
}

/** A reader weighs a report by their trust in the author and their own skill in its domain. */
function readReport(ctx: Ctx, reader: string, report: Report, eventId: number) {
  const holder = ctx.content.byId.character.get(reader)!;
  const trust = holder.relationships.find((r) => r.to === report.author && r.kind === "trust")?.value ?? 500;
  const low = trust < ctx.content.scenario.knowledge.lowTrustBelow;
  for (const c of report.claims) {
    const band = interpretBand(ctx, reader, c.predicate, low ? downgrade(c.reliabilityBand) : c.reliabilityBand);
    // a letter states things as they stood when it was written: every figure in it is as fresh as that day
    const observedAt = c.observedAt;
    learn(ctx, reader, { subject: c.subject, predicate: c.predicate, value: c.believedValue, observedAt, band },
      { kind: "report", eventId, source: report.author, reportId: report.id }, [eventId]);
  }
}

function receiveCapturedReport(ctx: Ctx, m: Messenger, report: Report, cause: number) {
  const got = ctx.emit("InterceptedReportReceived", [cause], [chr(m.recipient), { kind: "report", id: String(report.id) }], { reportId: report.id, by: m.recipient, messengerId: m.id });
  for (const c of report.claims)
    learn(ctx, m.recipient, { subject: c.subject, predicate: c.predicate, value: c.believedValue, observedAt: c.observedAt, band: c.reliabilityBand },
      { kind: "intercepted", eventId: got.id, source: report.author, reportId: report.id }, [got.id]);
  learn(ctx, m.recipient, { subject: { kind: "report", id: String(report.id) }, predicate: "report.route", value: `${report.author}>${report.recipient}`, observedAt: ctx.tick, band: "certain" },
    { kind: "intercepted", eventId: got.id, source: report.author, reportId: report.id }, [got.id]);
}

function receiveCapturedOrder(ctx: Ctx, m: Messenger, cause: number) {
  const o = ctx.s.orders[String(m.ref)].order;
  const got = ctx.emit("InterceptedOrderReceived", [cause], [chr(m.recipient), { kind: "order", id: String(o.id) }], { orderId: o.id, by: m.recipient, messengerId: m.id });
  learn(ctx, m.recipient, { subject: { kind: "order", id: String(o.id) }, predicate: "order.content", value: `${o.issuer}>${o.recipient}:${o.intent}:${o.objective.id}`, observedAt: ctx.tick, band: "certain" },
    { kind: "intercepted", eventId: got.id, source: o.issuer }, [got.id]);
}

/** Compose a report from the author's current beliefs, with the author's bias, and send it. */
export function compose(ctx: Ctx, author: string, recipient: string, claims: BeliefProposition[], cause: number, purpose?: string) {
  const sc = ctx.content.scenario.messenger;
  const ch = ctx.content.byId.character.get(author)!;
  const id = ctx.s.nextReportId;
  const badNews = Math.floor(ch.traits.reduce((a, t) => a + ctx.content.byId.trait.get(t)!.badNewsReportingPermille, 0) / Math.max(1, ch.traits.length));
  const r = ctx.keyed(`messenger:bias:${id}`);
  const bias: string[] = [];
  const out = claims.map((c) => {
    if (c.predicate === "fortification.condition" && (c.believedValue as number) < sc.alarmBelowMilli && r.chancePermille(1000 - badNews)) {
      bias.push("understates_damage");
      return { ...c, believedValue: Math.min(100000, (c.believedValue as number) + sc.understateMilli) };
    }
    return c;
  });
  const report: Report = { id, author, recipient, subject: out[0].subject, claims: out, composedAt: ctx.tick, route: [], ...(bias.length ? { authorBias: bias } : {}), ...(purpose ? { purpose } : {}) };
  const ev = ctx.emit("ReportComposed", [cause], [chr(author), chr(recipient), out[0].subject], { report });
  dispatch(ctx, "report", id, author, recipient, ev.id);
}

function selfClaim(ctx: Ctx, who: string, eventId: number): BeliefProposition {
  const here = where(ctx, who);
  return { id: 0, subject: chr(who), predicate: "character.location", believedValue: here, evidenceRefs: [{ kind: "observation", eventId, source: who }],
    observedOrLearnedAt: ctx.tick, observedAt: ctx.tick, learnedAt: ctx.tick, reliabilityBand: "certain" };
}

/** A castellan at their charge inspects it and writes to their superior. */
function inspectAndReport(ctx: Ctx, author: string, cause: number) {
  const ch = ctx.content.byId.character.get(author)!;
  const p = ctx.s.positions[author];
  if (ctx.s.tiers[author] === "C" || !("at" in p) || p.at !== ch.location || !ctx.s.fortifications[ch.location] || !ch.reportsTo) return;
  const upd = observe(ctx, author, loc(ch.location), "fortification.condition", cause)!;
  observe(ctx, author, loc(ch.location), "fortification.garrison", cause);
  // captains' companies with them at the fort are counted too
  const companies = Object.entries(ctx.s.positions).filter(([id, p]) => "at" in p && p.at === ch.location && (ctx.s.troops[id] ?? 0) > 0).map(([id]) => id).sort();
  for (const id of companies) observe(ctx, author, chr(id), "character.troops", cause);
  const recent = (b: { observedAt: number } | undefined | null) => !!b && ctx.tick - b.observedAt <= ctx.content.scenario.messenger.reportEveryDays * DAY;
  const beliefs = [best(ctx, author, ch.location, "fortification.condition"), best(ctx, author, ch.location, "fortification.garrison"), ...companies.map((id) => best(ctx, author, id, "character.troops")),
    ...ctx.content.scenario.threat.sites.filter((x) => x.target === ch.location).map((x) => best(ctx, author, x.site, "threat.intensity")),
    ...[best(ctx, author, ch.location, "fortification.incident")].filter((b) => recent(b)),
    // a fight since the last routine letter is told, so that a change in men is explained
    ...ctx.content.scenario.threat.sites.filter((x) => x.target === ch.location).map((x) => best(ctx, author, x.site, "battle.result"))
      .filter((b) => b && ctx.tick - b.observedAt <= ctx.content.scenario.messenger.reportEveryDays * DAY)].filter((x) => !!x);
  const claims = [selfClaim(ctx, author, upd.id), ...beliefs.map((b) => ({ ...b!, reliabilityBand: b!.band as BeliefProposition["reliabilityBand"] }))].map(({ band: _b, ...rest }: any) => rest);
  compose(ctx, author, ch.reportsTo, claims, upd.id);
}

export const messenger: System = {
  id: "messenger",
  start: (ctx) => {
    for (const ch of sorted(ctx.content.characters, (c) => c.id))
      if (ch.reportsTo && ctx.s.fortifications[ch.location])
        ctx.at(ctx.content.scenario.messenger.reportEveryDays * DAY + 6 * HOUR, "messenger:routine", { author: ch.id });
  },
  handlers: {
    "messenger:routine": (ctx, { author }) => {
      const charge = ctx.content.byId.character.get(author)!.location;
      inspectAndReport(ctx, author, ctx.s.fortifications[charge].lastChangeEvent);
      ctx.at(ctx.tick + ctx.content.scenario.messenger.reportEveryDays * DAY, "messenger:routine", { author });
    },
    "messenger:urgent": (ctx, { location, cause }) => {
      // the senior person posted there writes: principal characters first, then the locally relevant
      const posted = sorted(ctx.content.characters.filter((c) => c.location === location && c.reportsTo && ctx.s.tiers[c.id] !== "C"), (c) => `${ctx.s.tiers[c.id]}:${c.id}`);
      if (posted.length) inspectAndReport(ctx, posted[0].id, cause);
    },
    "messenger:compose": (ctx, { author, recipient, claims, cause, purpose }) => compose(ctx, author, recipient, claims, cause, purpose),
    "messenger:dispatchOrder": (ctx, { orderId, cause }) => {
      const o = ctx.s.orders[String(orderId)].order;
      dispatch(ctx, "order", orderId, o.issuer, o.recipient, cause);
    },
    "messenger:leg": (ctx, { mid, leg, cause }) => {
      const m = ctx.s.messengers[String(mid)];
      if (!m) return;
      const at = m.path[leg + 1];
      const start = leg === 0 ? m.departedAt : m.arrivals[leg - 1];
      const r = ctx.keyed(`messenger:${mid}:${m.redirects}:${leg}`);
      const sc = ctx.content.scenario.messenger;
      const kind = m.kind === "captured" ? m.carries! : m.kind;
      const subj = [chr(m.recipient), loc(at)];
      // The interceptor's own couriers are not lost (they know the country); ordinary messengers can be.
      if (m.kind !== "captured" && r.chancePermille(Math.min(1000, Math.floor((sc.lossPermillePerDay * (m.arrivals[leg] - start)) / DAY)))) {
        ctx.emit(T(kind, "Lost"), [cause], subj, { ...ref({ kind }, m.ref), messengerId: m.id, at });
        return;
      }
      if (m.kind !== "captured") {
        for (const p of sorted(ctx.content.scenario.interception.filter((x) => x.location === at), (x) => x.by)) {
          if (p.by === m.sender || p.by === m.recipient || !r.chancePermille(p.permille)) continue;
          const path = ctx.map.path(at, where(ctx, p.by), "rider", (x) => ctx.isOpen(x));
          if (!path) continue;
          const captureMessengerId = ctx.s.nextMessengerId;
          const arrivals = legs(ctx, captureMessengerId, path, "capture");
          const ev = ctx.emit(T(m.kind, "Intercepted"), [cause], [chr(p.by), loc(at)], { ...ref(m, m.ref), messengerId: m.id, at, by: p.by, captureMessengerId, path: path.locations, arrivals });
          schedule(ctx, captureMessengerId, arrivals, ev.id);
          return;
        }
      }
      if (leg + 1 === m.path.length - 1) arrive(ctx, m, cause);
      else ctx.at(m.arrivals[leg + 1], "messenger:leg", { mid, leg: leg + 1, cause });
    },
    "messenger:final": (ctx, { mid, cause }) => { const m = ctx.s.messengers[String(mid)]; if (m) arrive(ctx, m, cause); },
  },
};
