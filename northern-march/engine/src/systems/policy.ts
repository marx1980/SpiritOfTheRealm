// Phase 9 (docs/POLICY.md, D-070): standing policy and precedent. The ruler proclaims a rule for an area; each official
// learns it when her letter reaches him (or at once, if he is with her) and keeps it until a later proclamation. The
// planner weighs it where no order in force covers the situation (agents/policy.ts). The crown's officer for a people
// acts on the communities policy when they withhold or refuse. Institutional memory: what was done and how it went is
// recorded as a precedent, remembered by those present and by the fort, and cited when the same choice comes again.
import type { SimEvent } from "../events.ts";
import type { PolicyArea, PolicyParams } from "../content.ts";
import { STANCES } from "../content.ts";
import type { BeliefProposition } from "../beliefs.ts";
import type { Reason } from "../schemas.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { best, learn } from "./knowledge.ts";
import { compose } from "./messenger.ts";
import { battleOdds } from "../agents/terms.ts";
import { capability } from "./agents.ts";

const PP = (ctx: Ctx): PolicyParams | undefined => ctx.content.scenario.policy;
const level = (s: string) => STANCES.indexOf(s as (typeof STANCES)[number]);
const placeOf = (ctx: Ctx, who: string) => { const p = ctx.s.positions[who]; return p && "at" in p ? p.at : null; };

/** Who the ruler writes a proclamation to: officials by role, the regent, and the crown's officers for the peoples. */
function audience(ctx: Ctx, pp: PolicyParams) {
  const c = ctx.content, ids = new Set<string>();
  for (const ch of c.characters) if (pp.officials.includes(ch.role)) ids.add(ch.id);
  ids.add(c.scenario.regency.regent);
  for (const d of c.communities?.communities ?? []) ids.add(d.reporter);
  ids.delete(c.scenario.ruler);
  return sorted(ids, (x) => x);
}

function learnPolicy(ctx: Ctx, holder: string, area: string, rule: string, proclaimed: number, cause: number) {
  const known = ctx.s.policyKnown[holder]?.[area];
  if (known && known.proclaimed >= proclaimed) return; // an older letter arriving late changes nothing
  ctx.emit("PolicyLearned", [cause], [chr(holder)], { holder, area, rule, proclaimed, learnedAt: ctx.tick });
}

/** The ruler proclaims a rule. Those with her hear it at once; the others get a letter. */
export function proclaim(ctx: Ctx, area: PolicyArea, rule: string, cause: number) {
  const pp = PP(ctx);
  if (!pp || !pp.rules[area]?.includes(rule)) return;
  const ruler = ctx.content.scenario.ruler, here = placeOf(ctx, ruler), predicate = `policy.${area}`;
  const pr = ctx.emit("PolicyProclaimed", [cause], [chr(ruler)], { area, rule, by: ruler });
  learnPolicy(ctx, ruler, area, rule, pr.id, pr.id);
  learn(ctx, ruler, { subject: chr(ruler), predicate, value: rule, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: pr.id, source: ruler }, [pr.id]);
  const b = best(ctx, ruler, ruler, predicate);
  for (const who of audience(ctx, pp)) {
    if (here && placeOf(ctx, who) === here) { learnPolicy(ctx, who, area, rule, pr.id, pr.id); continue; }
    if (!b || !ctx.enabled("messenger")) continue;
    const { band, ...rest } = b;
    compose(ctx, ruler, who, [{ ...rest, reliabilityBand: band as BeliefProposition["reliabilityBand"] }], pr.id, `policy:${area}:${pr.id}`);
  }
}

/** A precedent's weight now: halved every half-life. */
export function precedentWeight(pp: PolicyParams, ageTicks: number) {
  const halves = Math.floor(ageTicks / (pp.precedent.halfLifeDays * DAY));
  return halves >= 16 ? 0 : Math.floor(pp.precedent.milli / 2 ** halves);
}

function loyaltyTo(ctx: Ctx, who: string, other: string) {
  const r = ctx.content.byId.character.get(who)?.relationships ?? [];
  return r.find((x) => x.to === other && x.kind === "loyalty")?.value ?? r.find((x) => x.to === other && x.kind === "trust")?.value ?? 500;
}

/** The crown's officer acts on the communities policy he holds, when a people withholds or refuses. */
function communityPolicy(ctx: Ctx, community: string, cause: number) {
  const pp = PP(ctx)!, c = ctx.content, ruler = c.scenario.ruler;
  const d = c.communities.communities.find((x) => x.id === community)!;
  const officer = d.reporter, known = ctx.s.policyKnown[officer]?.communities;
  if (!known || known.rule === "tolerate") return;
  const at = placeOf(ctx, officer);
  if (!at) return; // on the road: he acts when the next refusal finds him at his post
  const rule = known.rule as "negotiate" | "punish";
  const fort = d.recruitsFor ?? (ctx.s.fortifications[community] ? community : at);
  const reasons: Reason[] = [];
  const policyW = Math.floor((pp.policyMilli * loyaltyTo(ctx, officer, ruler)) / 1000);
  reasons.push({ kind: "order", ref: { kind: "policy", id: `communities:${rule}` }, weight: policyW, textKey: "reason.policy_for" });
  // what happened the last times he or this fort met these people with the same answer
  const mine = ctx.s.precedents.filter((p) => p.kind === rule && p.community === community && p.knownBy.some((k) => k === officer || k === `fort:${fort}`))
    .sort((a, b) => b.tick - a.tick).slice(0, pp.precedent.max);
  for (const p of mine) {
    const w = precedentWeight(pp, ctx.tick - p.tick) * (p.outcome === "eased" ? 1 : p.outcome === "escalated" ? -1 : 0);
    if (w) reasons.push({ kind: "precedent", ref: { kind: "event", id: String(p.id) }, weight: w, textKey: w > 0 ? "reason.precedent_won" : "reason.precedent_lost" });
  }
  // his own beliefs: punishment needs men he believes he has
  let men = 0;
  if (rule === "punish") {
    men = at === fort ? ctx.s.fortifications[fort]?.garrison ?? 0 : ((best(ctx, officer, fort, "fortification.garrison")?.believedValue as number | undefined) ?? 0);
    if (men < pp.punish.minMen) reasons.push({ kind: "resource", ref: { kind: "location", id: fort }, weight: -policyW - 1, textKey: "reason.too_few_men" });
  }
  const score = reasons.reduce((n, r) => n + r.weight, 0), applied = score > 0;
  const a = ctx.emit("PolicyApplied", [cause], [chr(officer), loc(community)], { officer, area: "communities", rule, community, applied, score, reasons });
  if (!applied) return;
  const treasury = ctx.s.treasuryMilli[ruler] ?? 0;
  const act = rule === "negotiate"
    ? ctx.emit("CommunityParley", [a.id], [chr(officer), loc(community)], { community, officer, payer: ruler, remitMilli: Math.max(0, Math.min(pp.parley.remitMilli, treasury)) })
    : ctx.emit("CommunityPunished", [a.id], [chr(officer), loc(community)], { community, officer, payer: ruler, seizedMilli: pp.punish.seizeMilli, men });
  ctx.at(ctx.tick + pp.precedent.watchDays * DAY, "policy:watch", { kind: rule, community, place: fort, officer, then: level(ctx.s.communities[community].stance), cause: act.id });
}

export const policy: System = {
  id: "policy",
  start: () => {},
  onEvent: (ctx: Ctx, e: SimEvent) => {
    if (!PP(ctx)) return;
    if (e.type === "ReportDelivered") ctx.at(ctx.tick, "policy:delivered", { reportId: e.payload.reportId, recipient: e.payload.recipient, cause: e.id });
    else if (e.type === "SortieResolved" && e.payload.found && e.payload.battleId !== undefined) ctx.at(ctx.tick, "policy:sortie", { cause: e.id, payload: e.payload });
    else if (e.type === "CommunityStanceChanged" && level(e.payload.to as string) >= 3 && level(e.payload.to as string) > level(e.payload.from as string))
      ctx.at(ctx.tick + HOUR, "policy:community", { community: e.payload.community, cause: e.id });
  },
  handlers: {
    "policy:delivered": (ctx, { reportId, recipient, cause }) => {
      const r = ctx.s.reports[String(reportId)];
      const m = r?.purpose?.match(/^policy:(\w+):(\d+)$/);
      if (!m) return;
      const claim = r.claims.find((x) => x.predicate === `policy.${m[1]}`);
      if (claim) learnPolicy(ctx, recipient, m[1], claim.believedValue as string, Number(m[2]), cause);
    },
    // a sortie fought out becomes a precedent: the odds as they stood, and how it went
    "policy:sortie": (ctx, { cause, payload }) => {
      const p = payload as { commander: string; from: string; site: string; success: boolean; men: number; enemy: number; battleId: number };
      const b = ctx.s.battles[String(p.battleId)];
      const crown = b ? b.setup.commanders.filter((x) => x.side === "crown").map((x) => x.id) : [p.commander];
      const skill = capability(ctx.s, ctx.content, p.commander, "military");
      ctx.emit("PrecedentRecorded", [cause], [loc(p.from), loc(p.site)], {
        kind: "sortie", place: p.from, site: p.site, oddsPermille: battleOdds(ctx.content.scenario.battle, p.men, skill, p.enemy), outcome: p.success ? "won" : "lost",
        knownBy: sorted(new Set([...crown, `fort:${p.from}`]), (x) => x) });
    },
    "policy:community": (ctx, { community, cause }) => communityPolicy(ctx, community, cause),
    "policy:watch": (ctx, { kind, community, place, officer, then, cause }) => {
      const now = level(ctx.s.communities[community].stance);
      ctx.emit("PrecedentRecorded", [cause], [loc(community)], {
        kind, place, community, outcome: now < then ? "eased" : now > then ? "escalated" : "unchanged", knownBy: sorted(new Set([officer, `fort:${place}`]), (x) => x) });
    },
  },
};
