// Phase 6 (6A): population communities. A community is a collective political actor: it experiences what happens
// where it lives, hears of the rest by rumour after the travel time, remembers a few things, holds specific
// grievances with someone to blame, weighs the stories told by those it trusts, and moves along a behaviour ladder
// (cooperate, petition, delay, withhold, refuse a demand, support a named actor). There is no armed revolt in 6A.
// Every escalation past "delay" needs the plan's hard gates (section D2): grievance, shared narrative, a named
// leader and a recent trigger. A community reacts only to what it witnessed or heard, never to hidden intent.
import type { SimEvent } from "../events.ts";
import type { CommunityDef, CommunityParams, Stance } from "../content.ts";
import { STANCES } from "../content.ts";
import type { CommunityState } from "../world.ts";
import { cmp } from "../world.ts";
import type { BeliefProposition } from "../beliefs.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc } from "./types.ts";
import { best, learn } from "./knowledge.ts";
import { compose } from "./messenger.ts";
import { travel } from "./movement.ts";

const P = (ctx: Ctx): CommunityParams => ctx.content.communities.params;
const defs = (ctx: Ctx): CommunityDef[] => [...ctx.content.communities.communities].sort((a, b) => cmp(a.id, b.id));
const def = (ctx: Ctx, id: string) => ctx.content.communities.communities.find((c) => c.id === id)!;
const level = (s: string) => STANCES.indexOf(s as Stance);
const rt = (ctx: Ctx) => (ctx.runtime.communities ??= { arrived: {} as Record<string, number> }) as { arrived: Record<string, number> };

/** Where an event happened, for those who hear of it. */
function placeOf(e: SimEvent): string | null {
  const p = e.payload;
  switch (e.type) {
    case "RaidDamage": return p.location as string;
    case "FortFell": case "FortRetaken": return p.fort as string;
    case "SortieResolved": return p.from as string;
    case "Arrived": return p.at as string;
    case "LevyRaised": return null; // paid where each community lives
    case "ReliefDelivered": case "TroopMisconduct": case "CommunityParley": case "CommunityPunished": return p.community as string;
    case "GrainShipped": return p.from as string;
    case "GrainDelivered": return p.to as string;
    case "MusterCalled": return p.community as string;
    case "CropDamaged": return p.place as string;
    case "CreatureHunt": return p.place as string;
    case "StoneDelivered": return p.at as string;
    default: return null;
  }
}

/** Rider hours between two places on open roads, or null when there is no way. */
function hoursBetween(ctx: Ctx, a: string, b: string): number | null {
  if (a === b) return 0;
  const path = ctx.map.path(a, b, "rider", (r) => ctx.isOpen(r));
  return path ? Math.ceil(path.ticks / HOUR) : null;
}

/** Cohort-weighted size of a grievance of this kind for this community (permille of the base amount). */
function weight(d: CommunityDef, kind: string) {
  return Math.floor(d.cohorts.reduce((a, c) => a + c.sharePermille * ((c.weights as Record<string, number>)[kind] ?? 1000), 0) / 1000);
}
const scale = (x: number, permille: number) => Math.floor((x * permille) / 1000);
const recent = (ctx: Ctx, c: CommunityState, kinds: string[], days: number, at?: string) =>
  c.memories.some((m) => kinds.includes(m.kind) && ctx.tick - m.tick <= days * DAY && (at === undefined || m.at === at));

/** Is the crown seen to be answering the raiders that hit this community? (a fight, a retaking, or a company arriving) */
function protectedNow(ctx: Ctx, c: CommunityState, d: CommunityDef, fort: string) {
  void d;
  return recent(ctx, c, ["crown_fought", "fort_retaken", "company_arrived"], P(ctx).protectedDays, fort);
}

/** Context multiplier for a burden (D-004.8): heavier when under threat or poor, lighter when calm. */
function context(ctx: Ctx, c: CommunityState, d: CommunityDef) {
  const k = P(ctx).context;
  let m = 1000;
  const threatened = recent(ctx, c, ["raid"], P(ctx).triggerDays) || d.exposedTo.some((s) => !!ctx.s.threats[s] && c.memories.some((x) => x.kind === "raid"));
  if (threatened) m = scale(m, k.underThreatPermille);
  if (c.material < k.poorBelow) m = scale(m, k.poorPermille);
  if (!threatened && c.material >= k.poorBelow) m = scale(m, k.calmPermille);
  return m;
}

interface Effects { memory?: { kind: string; actor: string; at: string; weight: number; about?: string }; material?: number; trust?: [string, number][];
  eased?: [number, number][]; grievances?: { kind: string; delta: number; blameCrown: number }[]; breaks?: string; how: string; source: number }

/** What one experience does to a community. Reads only the community's own memory and what it witnessed. */
function effectsOf(ctx: Ctx, id: string, type: string, p: Record<string, any>, how: "witnessed" | "rumour", source: number): Effects | null {
  const pr = P(ctx), d = def(ctx, id), c = ctx.s.communities[id], g = pr.grievance;
  const out: Effects = { how, source };
  const eased = (kinds: string[] | null, permille: number) =>
    c.grievances.filter((x) => kinds === null || kinds.includes(x.kind)).map((x): [number, number] => [x.id, x.intensity - scale(x.intensity, permille)]);
  switch (type) {
    case "RaidDamage": {
      const exposed = d.exposedTo.includes(p.site) || p.location === id;
      out.memory = { kind: "raid", actor: "raiders", at: p.location, weight: exposed ? 500 : 200 };
      if (how === "witnessed" && exposed) {
        const intensity = ctx.s.threats[p.site]?.intensityPermille ?? 0;
        out.material = -scale(pr.raidMaterialAtFull, intensity);
        if (!protectedNow(ctx, c, d, p.location)) {
          const delta = scale(scale(scale(g.raidAtFull, intensity), weight(d, "unprotected")), c.material < pr.context.poorBelow ? pr.context.poorPermille : 1000);
          if (delta > 0) out.grievances = [{ kind: "unprotected", delta, blameCrown: 400 }];
        }
      }
      return out;
    }
    case "FortFell": {
      out.memory = { kind: "fort_fell", actor: "raiders", at: p.fort, weight: 800 };
      if (how === "witnessed" && (d.exposedTo.includes(p.site) || p.fort === id)) out.grievances = [{ kind: "unprotected", delta: scale(100, weight(d, "unprotected")), blameCrown: 500 }];
      return out;
    }
    case "FortRetaken": {
      out.memory = { kind: "fort_retaken", actor: "crown", at: p.fort, weight: 700 };
      out.eased = eased(["unprotected"], pr.remedy.fortRetakenPermille);
      out.trust = [["crown", pr.trust.protectedCrown]];
      return out;
    }
    case "SortieResolved": {
      if (!p.found) return null;
      out.memory = { kind: "crown_fought", actor: p.commander, at: p.from, weight: 500 };
      if (p.success) { out.eased = eased(["unprotected"], pr.remedy.sortieWonPermille); out.trust = [["crown", pr.trust.protectedCrown]]; }
      return out;
    }
    case "Arrived": {
      out.memory = { kind: "company_arrived", actor: p.who, at: p.at, weight: 300 };
      return out;
    }
    case "LevyRaised": {
      const paid = ((p.shares ?? []) as [string, number][]).some(([x, m]) => x === id && m > 0);
      const refused = ((p.refused ?? []) as string[]).includes(id);
      out.memory = { kind: refused ? "refused_demand" : paid ? "levy_paid" : "levy_heard", actor: "crown", at: id, weight: paid || refused ? 600 : 150 };
      if (!paid) return out;
      const delta = scale(scale(g.levy, context(ctx, c, d)), weight(d, "levy"));
      out.grievances = [{ kind: "levy", delta, blameCrown: 900 }];
      out.material = -pr.levyMaterial;
      out.trust = [["crown", pr.trust.levyCrown]];
      const promise = c.memories.find((m) => m.kind === "promise" && m.about === "consult_before_levy" && !m.broken);
      if (promise) {
        out.grievances.push({ kind: "broken_promise", delta: scale(g.brokenPromise, weight(d, "broken_promise")), blameCrown: 1000 });
        out.trust.push(["crown", pr.trust.brokenPromiseCrown]);
        out.breaks = "consult_before_levy";
      }
      return out;
    }
    case "ReliefDelivered": {
      out.memory = { kind: "relief", actor: "crown", at: p.community, weight: p.community === id ? 700 : 200 };
      if (p.community !== id) return out;
      out.material = pr.reliefMaterial;
      out.eased = c.grievances.map((x): [number, number] => [x.id, x.intensity - scale(x.intensity, x.kind === "broken_promise" ? pr.remedy.reliefPromisePermille : pr.remedy.reliefPermille)]);
      out.trust = [["crown", pr.trust.reliefCrown]];
      return out;
    }
    // Phase 9: what the crown's officer did under the communities policy (D-070)
    case "CommunityParley": {
      const pp = ctx.content.scenario.policy!.parley;
      out.memory = { kind: "parley", actor: "crown", at: p.community, weight: p.community === id ? 600 : 150 };
      if (p.community !== id) return out;
      out.eased = eased(null, pp.remedyPermille);
      out.trust = [["crown", pp.trust]];
      return out;
    }
    case "CommunityPunished": {
      const pp = ctx.content.scenario.policy!.punish;
      out.memory = { kind: "punished", actor: "crown", at: p.community, weight: p.community === id ? 800 : 300 };
      if (p.community !== id) return out;
      out.grievances = [{ kind: "levy", delta: scale(scale(g.levy, pp.grievancePermille), weight(d, "levy")), blameCrown: 1000 }];
      out.material = -pr.levyMaterial;
      out.trust = [["crown", pp.trust]];
      return out;
    }
    case "TroopMisconduct": {
      out.memory = { kind: "misconduct", actor: p.captain, at: p.community, weight: p.community === id ? 600 : 150 };
      if (p.community !== id) return out;
      out.material = -pr.misconductMaterial;
      out.grievances = [{ kind: "misconduct", delta: scale(scale(g.misconduct, p.severityPermille), weight(d, "misconduct")), blameCrown: 400 }];
      out.trust = [["crown", pr.trust.misconductCrown]];
      return out;
    }
    case "GrainShipped": {
      const q = ctx.content.scenario.grain!.requisition;
      if (p.how !== "requisition") { out.memory = { kind: "sold_grain", actor: "crown", at: p.from, weight: p.from === id ? 300 : 100 }; return out; }
      out.memory = { kind: p.consulted ? "consulted" : "requisitioned", actor: "crown", at: p.from, weight: p.from === id ? 600 : 150 };
      if (p.from !== id) return out;
      const delta = scale(scale(scale(q.grievance, context(ctx, c, d)), weight(d, "levy")), p.consulted ? q.consultedPermille : 1000);
      out.grievances = [{ kind: "levy", delta, blameCrown: p.consulted ? 500 : 900 }];
      out.material = -q.material;
      out.trust = [["crown", p.consulted ? q.trustConsulted : q.trustTaken]];
      const promise = c.memories.find((m) => m.kind === "promise" && m.about === "consult_before_levy" && !m.broken);
      if (promise && !p.consulted) {
        out.grievances.push({ kind: "broken_promise", delta: scale(g.brokenPromise, weight(d, "broken_promise")), blameCrown: 1000 });
        out.trust.push(["crown", pr.trust.brokenPromiseCrown]);
        out.breaks = "consult_before_levy";
      }
      return out;
    }
    case "MusterCalled": { // men taken from the village are a levy of another kind: the more of its hands, the greater the grievance
      out.memory = { kind: "mustered", actor: "crown", at: p.community, weight: p.community === id ? 600 : 150 };
      if (p.community !== id) return out;
      const share = scale(p.sharePermille, ctx.content.scenario.manpower!.grievanceAtFullPermille);
      out.grievances = [{ kind: "levy", delta: scale(scale(scale(g.levy, context(ctx, c, d)), weight(d, "levy")), share), blameCrown: 900 }];
      out.material = -scale(pr.levyMaterial, share);
      out.trust = [["crown", scale(pr.trust.levyCrown, share)]];
      return out;
    }
    case "CreatureHunt": { // something in the wood took stock (and sometimes a person): the place at once, others as a tale (Phase 11)
      const bw = ctx.content.scenario.wilds!;
      out.memory = { kind: "beast", actor: "beast", at: p.place, weight: p.place === id ? 500 : 150 };
      if (how !== "witnessed" || p.place !== id) return out;
      out.material = -(p.livestock as number) * bw.creature.materialPerHead;
      if (p.missing) out.grievances = [{ kind: "unprotected", delta: scale(120, weight(d, "unprotected")), blameCrown: 300 }];
      return out;
    }
    case "StoneDelivered": { // the Stone is back in the crown's hands: what it is worth, and no more, lifts the crown in their eyes (Phase 11)
      if (p.to !== ctx.content.scenario.ruler) return null;
      const bw = ctx.content.scenario.wilds!;
      out.memory = { kind: "stone_returned", actor: "crown", at: p.at, weight: 300 };
      out.trust = [["crown", Math.floor((bw.stone.trustPerLegitimacy * bw.stone.actualLegitimacy) / 1000)]];
      return out;
    }
    case "CropDamaged": { // the people whose fields they were lose some of their means (Phase 10); no one is blamed
      if (how !== "witnessed" || p.place !== id) return null;
      out.memory = { kind: "harvest_failed", actor: "weather", at: p.place, weight: 500 };
      out.material = -(ctx.content.scenario.environment?.harvest.materialPermille ?? 0);
      return out;
    }
    case "GrainDelivered": {
      out.memory = { kind: "grain_delivered", actor: "crown", at: p.to, weight: p.to === id ? 500 : 100 };
      if (p.to !== id) return out;
      out.material = Math.floor(pr.reliefMaterial / 2);
      out.trust = [["crown", Math.floor(pr.trust.reliefCrown / 2)]];
      return out;
    }
  }
  return null;
}

// ---- the decision: where on the ladder (plan section D) -----------------------------------------------------------

/** Integer fifth (or n-th) root of a product of values in 0..1000: the geometric mean, exactly reproducible. */
export function geoMean(xs: number[]): number {
  if (xs.some((x) => x <= 0)) return 0;
  const prod = xs.reduce((a, x) => a * BigInt(x), 1n), n = BigInt(xs.length);
  let lo = 0n, hi = 1000n;
  while (lo < hi) { const mid = (lo + hi + 1n) / 2n; if (mid ** n <= prod) lo = mid; else hi = mid - 1n; }
  return Number(lo);
}

export interface LadderInputs { S: number; G: number; Gall: number; N: number; L: number; C: number; R: number; E: number; T: boolean; M: number; Md: number; leader: string | null; supporter: string | null }

/** The inputs of plan D1, computed from what the community knows: its grievances, memories, trust and what it sees. */
export function inputsOf(ctx: Ctx, id: string): LadderInputs {
  const pr = P(ctx), d = def(ctx, id), c = ctx.s.communities[id];
  const Gall = Math.min(1000, c.grievances.reduce((a, g) => a + g.intensity, 0));
  const G = Math.min(1000, c.grievances.reduce((a, g) => a + scale(g.intensity, g.blameCrown), 0));
  const N = Gall > 0 ? Math.floor((G * 1000) / Math.max(1, c.grievances.reduce((a, g) => a + g.intensity, 0))) : 0;
  const leaderAt = d.leader ? ctx.s.positions[d.leader.id] : null;
  const L = d.leader ? (leaderAt && "at" in leaderAt && leaderAt.at === id ? d.leader.trust : Math.floor(d.leader.trust / 2)) : 0;
  const C = d.cohesion, R = Math.floor((d.resources * (500 + Math.floor(c.material / 2))) / 1000);
  // expected success: weakness signals the community has witnessed or heard of (D-004.4, several independent ones)
  const w = pr.weakness, fort = d.recruitsFor ?? (ctx.s.fortifications[id] ? id : null);
  let E = d.expectedBase;
  if (recent(ctx, c, ["fort_fell"], w.windowDays)) E += w.fortFell;
  if (recent(ctx, c, ["raid"], pr.triggerDays) && !recent(ctx, c, ["crown_fought", "fort_retaken"], pr.triggerDays)) E += w.unanswered;
  if (fort && ctx.s.fortifications[fort]) {
    const here = Object.entries(ctx.s.positions).some(([who, p]) => "at" in p && p.at === fort && (ctx.s.troops[who] ?? 0) > 0);
    if (!here) E += w.noCompany;
    const f = ctx.s.fortifications[fort];
    if (f.garrison * 2 < f.establishment) E += w.lowGarrison;
  }
  E = Math.min(1000, E);
  const T = c.lastTrigger >= 0 && ctx.tick - c.lastTrigger <= pr.triggerDays * DAY;
  const M = Math.floor((G * geoMean([N, L, C, R, E])) / 1000);
  const Md = Math.floor((G * geoMean([N, C, R, E])) / 1000);
  // a named actor the community would rally to: one who tells them the crown is to blame, has access, and is trusted enough
  const supporter = ctx.content.communities.narrators.filter((n) => n.story === "crown" && hasAccess(ctx, id, n.who) && (c.trust[n.who] ?? 0) >= pr.ladder.supportTrust)
    .map((n) => n.who).sort(cmp)[0] ?? null;
  return { S: d.supportAt ?? pr.ladder.support, G, Gall, N, L, C, R, E, T, M, Md, leader: d.leader?.id ?? null, supporter };
}

function hasAccess(ctx: Ctx, id: string, who: string) {
  const pos = ctx.s.positions[who];
  if (!pos || !("at" in pos)) return false;
  const h = hoursBetween(ctx, pos.at, id);
  return h !== null && h <= P(ctx).narrative.accessHours;
}

/** The highest rung the inputs reach. `k` scales the thresholds (below 1000 when asking whether to stay on a rung). */
export function rungOf(ctx: Ctx, x: LadderInputs, k = 1000): number {
  const l = P(ctx).ladder, t = (v: number) => scale(v, k);
  const gates = x.G >= t(l.gMin) && x.N >= t(l.nMin) && x.leader !== null && x.L >= t(l.lMin) && x.T;
  if (gates && x.M >= t(x.S) && x.supporter) return 5;
  if (gates && x.M >= t(l.refuse)) return 4;
  if (gates && x.M >= t(l.withhold)) return 3;
  if (x.G >= t(l.gMin) && x.N >= t(l.nMin) && x.Md >= t(l.delay)) return 2;
  if (x.G >= t(l.petition)) return 1;
  return 0;
}

function review(ctx: Ctx, id: string, cause: number) {
  const c = ctx.s.communities[id], cur = level(c.stance);
  if (!c.lastTriggerEvent) return; // nothing has ever aggrieved it
  const x = inputsOf(ctx, id);
  const up = rungOf(ctx, x), stay = rungOf(ctx, x, P(ctx).ladder.downPermille);
  const next = up > cur ? cur + 1 : stay < cur ? cur - 1 : cur; // one rung a day, and a margin before stepping down
  if (next === cur) return;
  const to = STANCES[next], told = level(c.told);
  // the crown's officer writes when things get worse than he last wrote, or when they settle back down
  const tell = (next >= 3 && next > told) || (next <= 1 && told >= 3);
  const ev = ctx.emit("CommunityStanceChanged", [c.lastTriggerEvent || cause], [loc(id)],
    { community: id, from: c.stance, to, inputs: x, gates: { G: x.G >= P(ctx).ladder.gMin, N: x.N >= P(ctx).ladder.nMin, L: x.leader !== null && x.L >= P(ctx).ladder.lMin, T: x.T },
      ...(to === "support" ? { supports: x.supporter } : {}), tell });
  if (tell) tellTheCrown(ctx, id, ev.id, to, to === "support" ? x.supporter : null);
}

/** The crown's officer for the place writes when a community stops cooperating (or starts again). An officer who is
 *  himself the actor the community rallies to says nothing of it. */
function tellTheCrown(ctx: Ctx, id: string, cause: number, stance: string, supports: string | null) {
  const d = def(ctx, id), who = d.reporter, ruler = ctx.content.scenario.ruler;
  if (supports === who) return;
  const pos = ctx.s.positions[who];
  if (!pos || !("at" in pos)) return;
  const claim = (predicate: string, value: string) => {
    learn(ctx, who, { subject: loc(id), predicate, value, observedAt: ctx.tick, band: "probable" }, { kind: "observation", eventId: cause, source: who }, [cause]);
  };
  claim("community.stance", stance);
  const top = [...ctx.s.communities[id].grievances].sort((a, b) => scale(b.intensity, b.blameCrown) - scale(a.intensity, a.blameCrown) || a.id - b.id)[0];
  if (top) claim("community.grievance", top.kind);
  send(ctx, who, ruler, id, ["community.stance", "community.grievance"], cause, `community:${id}`);
}

function send(ctx: Ctx, author: string, recipient: string, id: string, preds: string[], cause: number, purpose: string) {
  if (!ctx.enabled("messenger")) return; // with no messengers, nothing is written
  // everyone knows where the crown holds court; a letter for the ruler goes there and is sent on if she is away
  if (!best(ctx, author, recipient, "character.location"))
    learn(ctx, author, { subject: chr(recipient), predicate: "character.location", value: ctx.content.scenario.regency.seat, observedAt: ctx.tick, band: "uncertain" },
      { kind: "scenario", eventId: cause, source: author }, [cause]);
  const claims = preds.map((p) => best(ctx, author, id, p)).filter((b): b is NonNullable<typeof b> => !!b)
    .map(({ band, ...rest }) => ({ ...rest, reliabilityBand: band as BeliefProposition["reliabilityBand"] }));
  if (claims.length) compose(ctx, author, recipient, claims, cause, purpose);
}

const REMEDY: Record<string, string> = { unprotected: "protection", levy: "relief", broken_promise: "relief", misconduct: "recall" };

/** A grievance the community holds against the crown above the petition threshold is put to the ruler in writing,
 *  by its leader (or the crown's officer when it has none); again only after some days if nothing changed. */
function petitions(ctx: Ctx, id: string) {
  const pr = P(ctx), d = def(ctx, id), c = ctx.s.communities[id], ruler = ctx.content.scenario.ruler;
  const author = d.leader?.id ?? d.reporter;
  const pos = ctx.s.positions[author];
  if (!pos || !("at" in pos)) return;
  // one petition at a time: not again within some days of the last one, whatever it was about
  if (c.grievances.some((g) => g.petitionedAt !== null && ctx.tick - g.petitionedAt < pr.ladder.repetitionDays * DAY)) return;
  for (const g of [...c.grievances].sort((a, b) => scale(b.intensity, b.blameCrown) - scale(a.intensity, a.blameCrown) || a.id - b.id)) { // the sorest first
    if (scale(g.intensity, g.blameCrown) < pr.ladder.petition) continue;
    if (g.petitionedAt !== null) { // told already: again only if it has grown since, or as a reminder after a long silence
      const since = ctx.tick - g.petitionedAt;
      if (since < pr.ladder.repetitionDays * DAY) continue;
      if (since < pr.ladder.reminderDays * DAY && scale(g.intensity, g.blameCrown) - g.petitionedFelt < pr.ladder.regrowth) continue;
    }
    const pe = ctx.emit("PetitionMade", [g.cause], [loc(id), chr(author)], { community: id, grievanceId: g.id, kind: g.kind, author, intensity: g.intensity, felt: scale(g.intensity, g.blameCrown) });
    learn(ctx, author, { subject: loc(id), predicate: "community.grievance", value: g.kind, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: pe.id, source: author }, [pe.id]);
    learn(ctx, author, { subject: loc(id), predicate: "community.request", value: REMEDY[g.kind] ?? "relief", observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: pe.id, source: author }, [pe.id]);
    send(ctx, author, ruler, id, ["community.grievance", "community.request"], pe.id, `petition:${id}`);
    return; // one petition at a time
  }
}

/** Captains' companies quartered away from home: now and then an incident with the townsfolk (keyed draws). */
function misconduct(ctx: Ctx, id: string) {
  const pr = P(ctx).misconduct, day = Math.floor(ctx.tick / DAY);
  for (const ch of [...ctx.content.characters].filter((x) => x.troops).sort((a, b) => cmp(a.id, b.id))) {
    const pos = ctx.s.positions[ch.id];
    if (!("at" in pos) || pos.at !== id || ch.location === id || (ctx.s.troops[ch.id] ?? 0) <= 0) continue;
    const since = ctx.s.lastArrival[id]?.[ch.id], cause = rt(ctx).arrived[ch.id];
    if (since === undefined || cause === undefined || ctx.tick - since < pr.afterDays * DAY) continue;
    const k = ctx.keyed(`communities:misconduct:${day}:${id}:${ch.id}`);
    const chance = ch.traits.some((t) => t === "aggressive" || t === "proud") ? scale(pr.dailyPermille, pr.traitPermille) : pr.dailyPermille;
    const hit = k.chancePermille(chance), severityPermille = k.int(500, 1500);
    if (hit) ctx.emit("TroopMisconduct", [cause], [loc(id), chr(ch.id)], { community: id, captain: ch.id, severityPermille, men: ctx.s.troops[ch.id] });
  }
}

/** A narrator of the crown-blame story who has a home post rides to a nearby community that has a fresh, serious grievance
 *  (access by presence), stays a while, and returns. Each day among them he earns their trust (organisation). */
function courting(ctx: Ctx) {
  const pr = P(ctx), n = pr.narrative;
  for (const nar of ctx.content.communities.narrators.filter((x) => x.story === "crown" && x.who !== ctx.content.scenario.ruler)) {
    const home = ctx.content.byId.character.get(nar.who)?.location, pos = ctx.s.positions[nar.who];
    if (!home || !pos || !("at" in pos)) continue;
    const here = defs(ctx).find((d) => d.id === pos.at && d.id !== home);
    if (here) {
      const c = ctx.s.communities[here.id], arrived = rt(ctx).arrived[nar.who], since = ctx.s.lastArrival[here.id]?.[nar.who] ?? ctx.tick;
      const x = inputsOf(ctx, here.id);
      if (arrived !== undefined && (ctx.tick - since >= n.stayDays * DAY || x.G < pr.ladder.gMin)) { travel(ctx, nar.who, home, "rider", false, arrived); continue; }
      if (arrived !== undefined && (c.trust[nar.who] ?? 0) < 1000)
        ctx.emit("NarratorVisited", [arrived], [loc(here.id), chr(nar.who)], { community: here.id, who: nar.who, trust: [[nar.who, n.trustPerDay]], memoryCap: pr.memoryCap });
      continue;
    }
    if (pos.at !== home) continue;
    const goal = defs(ctx).filter((d) => d.id !== home && d.id !== pos.at).map((d) => ({ d, x: inputsOf(ctx, d.id), h: hoursBetween(ctx, home, d.id) }))
      .filter(({ x, h, d }) => h !== null && h <= n.courtHours && x.G >= pr.ladder.gMin && x.N >= pr.ladder.nMin && x.T && ctx.s.communities[d.id].lastTriggerEvent)
      .sort((a, b) => b.x.G - a.x.G || cmp(a.d.id, b.d.id))[0];
    if (goal) travel(ctx, nar.who, goal.d.id, "rider", false, ctx.s.communities[goal.d.id].lastTriggerEvent);
  }
}

/** Once a day: grievances fade, the land recovers a little, and the stories told by those with access move the blame. */
function drift(ctx: Ctx) {
  const pr = P(ctx), changes: { community: string; material: number; grievances: [number, number, number][] }[] = [];
  for (const d of defs(ctx)) {
    const c = ctx.s.communities[d.id];
    const material = Math.min(Math.max(c.material, d.material), c.material + pr.materialRecoveryPerDay);
    const companyHere = ctx.content.characters.some((ch) => ch.troops && ch.location !== d.id && (ctx.s.troops[ch.id] ?? 0) > 0 && (() => { const p = ctx.s.positions[ch.id]; return "at" in p && p.at === d.id; })());
    const voices = ctx.content.communities.narrators.filter((n) => hasAccess(ctx, d.id, n.who))
      .map((n) => ({ story: n.story, trust: c.trust[n.who === ctx.content.scenario.ruler ? "crown" : n.who] ?? 0 })).filter((v) => v.trust >= pr.narrative.trustFloor);
    const gs: [number, number, number][] = [];
    for (const g of [...c.grievances].sort((a, b) => a.id - b.id)) {
      const decay = Math.max(1, scale(g.intensity, g.kind === "misconduct" && !companyHere ? scale(pr.grievance.decayPermillePerDay, pr.remedy.companyGoneDecayPermille) : pr.grievance.decayPermillePerDay));
      let intensity = g.intensity - decay;
      if (intensity < pr.grievance.dropBelow) intensity = 0;
      let blame = g.blameCrown;
      for (const v of voices) {
        // a levy or a broken promise cannot be blamed on anyone else; raids and misconduct can
        if (v.story === "others" && (g.kind === "levy" || g.kind === "broken_promise")) continue;
        const target = v.story === "crown" ? 1000 : 0;
        blame += Math.trunc(((target - blame) * pr.narrative.ratePermillePerDay * v.trust) / 1000000);
      }
      if (intensity !== g.intensity || blame !== g.blameCrown) gs.push([g.id, intensity, blame]);
    }
    if (material !== c.material || gs.length) changes.push({ community: d.id, material, grievances: gs });
  }
  if (changes.length) ctx.emit("CommunitiesDrifted", [], changes.map((x) => loc(x.community)), { changes });
}

/** Who hears of an event, and when: those where it happened (and those its raiders strike) at once, the rest by rumour. */
function audience(ctx: Ctx, e: SimEvent): { id: string; delay: number; how: "witnessed" | "rumour" }[] {
  const out: { id: string; delay: number; how: "witnessed" | "rumour" }[] = [];
  const at = placeOf(e), pr = P(ctx);
  for (const d of defs(ctx)) {
    if (e.type === "LevyRaised") { out.push({ id: d.id, delay: 0, how: "witnessed" }); continue; }
    if (e.type === "StoneDelivered") { out.push({ id: d.id, delay: 0, how: "rumour" }); continue; }
    if (!at) continue;
    const direct = at === d.id || (e.type === "RaidDamage" && d.exposedTo.includes(e.payload.site as string)) || (e.type === "FortFell" && d.exposedTo.includes(e.payload.site as string));
    if (direct) { out.push({ id: d.id, delay: 0, how: "witnessed" }); continue; }
    const h = hoursBetween(ctx, at, d.id);
    if (h !== null && h <= pr.rumourDays * 24) out.push({ id: d.id, delay: h * HOUR, how: "rumour" });
  }
  return out;
}

const HEARD = new Set(["RaidDamage", "FortFell", "FortRetaken", "SortieResolved", "LevyRaised", "ReliefDelivered", "TroopMisconduct", "Arrived", "GrainShipped", "GrainDelivered", "MusterCalled", "CommunityParley", "CommunityPunished", "CropDamaged", "CreatureHunt", "StoneDelivered"]);

export const communities: System = {
  id: "communities",
  start: (ctx) => ctx.at(DAY + 20 * HOUR, "communities:day", {}),
  onEvent: (ctx, e) => {
    if (e.type === "Arrived" || e.type === "DetachmentArrived") rt(ctx).arrived[(e.payload.who ?? e.payload.commander) as string] = e.id;
    if (!HEARD.has(e.type)) return;
    if (e.type === "Arrived" && !((ctx.s.troops[e.payload.who as string] ?? 0) > 0 && ctx.s.fortifications[e.payload.at as string])) return; // only companies at forts
    for (const a of audience(ctx, e)) ctx.at(ctx.tick + a.delay, "communities:hear", { community: a.id, how: a.how, type: e.type, payload: e.payload, source: e.id });
  },
  handlers: {
    "communities:hear": (ctx, { community, how, type, payload, source }) => {
      const fx = effectsOf(ctx, community, type, payload, how, source);
      if (!fx) return;
      ctx.emit("CommunityHeard", [source], [loc(community)], { community, type, ...fx, memoryCap: P(ctx).memoryCap });
    },
    "communities:relief": (ctx, { community, orderId, cause }) => {
      ctx.emit("ReliefDelivered", [cause], [loc(community)], { community, orderId });
    },
    "communities:day": (ctx) => {
      drift(ctx);
      courting(ctx);
      for (const d of defs(ctx)) misconduct(ctx, d.id);
      for (const d of defs(ctx)) { review(ctx, d.id, ctx.s.communities[d.id].lastTriggerEvent); petitions(ctx, d.id); }
      ctx.extraDraws("communities");
      ctx.at(ctx.tick + DAY, "communities:day", {});
    },
  },
};

/** Share of a stance's normal contribution (income, recruits, levy) a community gives (1000 when the system is off). */
export function contribution(ctx: Ctx, kind: "income" | "recruits" | "levy", communityId: string): number {
  if (!ctx.enabled("communities")) return 1000;
  const c = ctx.s.communities[communityId];
  if (!c) return 1000;
  return P(ctx).effects[kind][c.stance as Stance] ?? 1000;
}
