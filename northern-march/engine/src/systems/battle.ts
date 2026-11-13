// Phase 8 battles in the campaign (D-060, BATTLEFIELD §2B, §22). A sortie that meets raiders who are really there fights
// a battle: the setup is built from the campaign (the garrison, every captain's company present, the raiders' numbers,
// the ruler if she is there), stored in `BattleBegan`, and the battle itself is the pure sub-simulation in
// `battlefield/core.ts`, recomputed from the setup and the ruler's battle orders. With the ruler present the campaign
// pauses for her at the start and at moments headquarters notices; without her it runs on the senior commander's plan.
// At the end the result flows back: losses, the raiders broken or weakened, prestige, the record of obedience,
// community memory (through the sortie's outcome) and each commander's debrief letter.
import { groundAt } from "../environment.ts";
import type { BattleOrder, BattleRecord, BattleSetup, HqFrame, Note } from "../battlefield/core.ts";
import { battleRecord } from "../battlefield/record.ts";
export { battleRecord };
import { buildSetup, personOf, type Person } from "../battlefield/setup.ts";
import { isDead, type BattleState } from "../world.ts";
import type { Ctx, System } from "./types.ts";
import { DAY, HOUR, chr, loc, sorted } from "./types.ts";
import { capability, concludeSortie } from "./agents.ts";
import { learn } from "./knowledge.ts";

const present = (ctx: Ctx, where: string) => sorted(Object.entries(ctx.s.positions).filter(([, p]) => "at" in p && p.at === where).map(([id]) => id), (x) => x);
const who = (ctx: Ctx, id: string): Person => personOf(ctx.content, id, capability(ctx.s, ctx.content, id, "military"));

/** The moment of contact: build the battle and start it (at dawn if contact came at night, §24.4). */
export function beginBattle(ctx: Ctx, o: { commander: string; from: string; site: string; launchedEventId: number; enemy: number; ambushed: boolean; men: number }) {
  const b = ctx.content.scenario.battle, dawn = (b.dawnHour ?? 6) * HOUR, dusk = (b.nightfallHour ?? 19) * HOUR;
  const tod = ctx.tick % DAY;
  const start = tod >= dawn && tod < dusk ? ctx.tick : ctx.tick - tod + (tod >= dusk ? DAY : 0) + dawn;
  ctx.at(start, "battle:begin", { ...o, dusk: start - (start % DAY) + dusk });
}

/** When headquarters next has something to decide on: a report, a warning, or a change in what she sees. At least a
 *  battle minute apart, and at least every ten. */
function nextPause(r: BattleRecord, after: number, end: number): number | null {
  const P = 60, MAX = 600;
  const seen = (h: HqFrame) => h.marks.filter((m) => m.category === "observed").map((m) => `${m.id}:${m.behaviour}`).join("|");
  const cands: number[] = r.notes.filter((n: Note) => n.t >= after + P && (n.kind === "report_received" || n.kind === "danger")).map((n) => n.t);
  for (let i = 1; i < r.hq.length; i++) if (r.hq[i].t >= after + P && seen(r.hq[i]) !== seen(r.hq[i - 1])) { cands.push(r.hq[i].t); break; }
  const t = Math.min(after + MAX, ...cands);
  return t < end ? t : null;
}

export const battle: System = {
  id: "battle",
  start: () => {},
  handlers: {
    "battle:begin": (ctx, { commander, from, site, launchedEventId, enemy, ambushed, men, dusk }) => {
      const sc = ctx.content.scenario, b = sc.battle, ruler = sc.ruler;
      if (!ctx.s.threats[site]) return; // the raiders were gone by morning
      const here = present(ctx, from).filter((id) => !isDead(ctx.s, id)), chars = here.map((id) => ctx.content.byId.character.get(id)).filter((c) => !!c);
      const castellan = chars.find((c) => c!.role === "castellan"), sergeant = chars.find((c) => c!.role === "sergeant");
      const captains = chars.filter((c) => c!.role === "captain" && (ctx.s.troops[c!.id] ?? 0) > 0).map((c) => c!.id).sort();
      if (captains.includes(commander)) captains.splice(captains.indexOf(commander), 1), captains.unshift(commander);
      const rulerHere = here.includes(ruler);
      const seed = ctx.keyed(`battle:seed:${from}:${site}:${ctx.tick}`).int(1, 2147483646); // where and when, not event ids: a bigger cast must not reshuffle the fight
      // the day's weather where the fort stands and how heavy the ground is (Phase 10); without an environment, rain after a storm
      const ground = ctx.enabled("environment") ? groundAt(ctx.content, ctx.s.env, ctx.content.byId.location.get(from)!.province) : null;
      const rainy = (ctx.s.lastStorm[from] ?? -1e9) > ctx.tick - DAY;
      const setup: BattleSetup = buildSetup({
        battleId: launchedEventId, seed, site, place: ctx.content.byId.location.get(from)?.name ?? from,
        endT: Math.max(600, dusk - ctx.tick), weather: ground ? ground.weather : rainy ? "rain" : "clear", ...(ground?.mudPermille ? { mudPermille: ground.mudPermille } : {}),
        field: b.field!, params: b.tactics!, forces: b.forces!, obedience: sc.agents.obedience,
        garrison: { men: ctx.s.fortifications[from]?.garrison ?? 0, archers: ctx.s.fortifications[from]?.archers ?? 0, horse: ctx.s.fortifications[from]?.horse ?? 0, ...(castellan ? { castellan: who(ctx, castellan.id) } : {}), ...(sergeant ? { sergeant: who(ctx, sergeant.id) } : {}) },
        companies: captains.map((id) => ({ captain: who(ctx, id), men: ctx.s.troops[id] ?? 0 })),
        raiderMen: enemy,
        ruler: { ...who(ctx, ruler), present: rulerHere, post: "rear" },
      });
      const ev = ctx.emit("BattleBegan", [launchedEventId], [chr(commander), loc(from), loc(site)], { battleId: launchedEventId, commander, from, site, enemy, ambushed, men, launchedEventId, setup });
      if (rulerHere) {
        // her plan before the fight: the campaign pauses for her, then the battle is planned out
        ctx.at(ctx.tick, "player:decide", { cause: ev.id, reason: "battle" });
      }
      ctx.at(ctx.tick, "battle:replan", { battleId: launchedEventId });
    },
    "battle:replan": (ctx, { battleId }) => {
      const st = ctx.s.battles[String(battleId)];
      if (!st || st.status !== "running") return;
      const r = battleRecord(st), now = ctx.tick - st.startTick, version = st.orders.length;
      ctx.at(st.startTick + r.result.endT, "battle:end", { battleId, version });
      if (st.setup.ruler.present) {
        const t = nextPause(r, now, r.result.endT);
        if (t !== null) ctx.at(st.startTick + t, "battle:checkpoint", { battleId, version });
      }
    },
    "battle:checkpoint": (ctx, { battleId, version }) => {
      const st = ctx.s.battles[String(battleId)];
      if (!st || st.status !== "running" || st.orders.length !== version) return; // superseded by a later plan
      ctx.at(ctx.tick, "player:decide", { cause: st.beganEventId, reason: "battle" });
      ctx.at(ctx.tick, "battle:replan", { battleId });
    },
    "battle:end": (ctx, { battleId, version }) => {
      const st = ctx.s.battles[String(battleId)];
      if (!st || st.status !== "running" || st.orders.length !== version) return;
      concludeBattle(ctx, st);
    },
  },
};

/** The ruler's battle order, as player input: given now, in battle time. Returns the event, or null if no battle needs it. */
export function giveBattleOrder(ctx: Ctx, cause: number, d: { to: string; task: BattleOrder["task"]; via: BattleOrder["via"]; signal?: string; delay?: number }) {
  const ruler = ctx.content.scenario.ruler;
  const st = Object.values(ctx.s.battles).filter((b) => b.status === "running" && b.setup.ruler.present).sort((a, b) => b.startTick - a.startTick)[0];
  if (!st) return null;
  const now = ctx.tick - st.startTick, t = now + Math.max(0, Math.floor(d.delay ?? 0)); // talking takes battle time (Phase 13)
  const order: BattleOrder = { schemaVersion: 1, id: 1000 + st.orders.length, t, from: ruler, to: d.to, task: d.task, via: now === 0 ? "voice" : d.via, ...(d.signal ? { signal: d.signal } : {}) };
  return ctx.emit("BattleOrderGiven", [cause], [chr(ruler), chr(d.to)], { battleId: st.setup.battleId, order });
}

function concludeBattle(ctx: Ctx, st: BattleState) {
  const r = battleRecord(st), res = r.result, setup = st.setup, ruler = ctx.content.scenario.ruler;
  const ev = ctx.emit("BattleEnded", [st.beganEventId], [loc(st.from), loc(st.site)], {
    battleId: setup.battleId, winner: res.winner, reason: res.reason, endT: res.endT, ruler: res.ruler, lost: res.lost, lostBy: res.lostBy,
    conduct: res.conduct, debrief: r.debrief.map((d) => ({ author: d.author, result: d.result, ownLosses: d.ownLosses, enemyLosses: d.enemyLosses })),
  });
  // the record of obedience and prestige (§20): winning raises a commander, losing lowers him; one who went against
  // his orders and won becomes a hero, and one who did so and lost bears the blame
  const crownCommanders = setup.commanders.filter((c) => c.side === "crown" && c.id !== ruler).map((c) => c.id).sort();
  // Phase 12: a departure from orders carries its judged outcome (the battle replayed with it obeyed, COMMAND.md §8)
  for (const c of res.conduct) {
    const judged = (res.disobedience ?? []).find((d) => d.commander === c.commander && d.orderId === c.orderId && d.t === c.t && d.trigger === (c.trigger ?? "order"));
    ctx.emit("BattleConduct", [ev.id], [chr(c.commander)], { battleId: setup.battleId, commander: c.commander, orderId: c.orderId, issuer: c.issuer, decision: c.decision, outcome: res.winner,
      ...(c.trigger ? { trigger: c.trigger, t: c.t } : {}), ...(judged ? { judged: judged.outcome } : {}) });
  }
  for (const c of crownCommanders) {
    const defied = res.conduct.some((x) => x.commander === c && (x.decision === "keep" || x.decision === "defy") && x.issuer === ruler);
    const delta = res.winner === "crown" ? (defied ? 150 : 100) : res.winner === "raiders" ? (defied ? -150 : -80) : 0;
    if (delta) ctx.emit("PrestigeChanged", [ev.id], [chr(c)], { who: c, delta, reason: res.winner === "crown" ? (defied ? "won_against_orders" : "won") : defied ? "lost_against_orders" : "lost" });
  }
  // her fate, if she was there
  if (res.ruler === "killed" || res.ruler === "captured") { ctx.emit("CampaignEnded", [ev.id], [chr(ruler), loc(st.from)], { ending: res.ruler, where: st.from }); return; }
  // losses to the garrison and to each company (the guard is not counted on the campaign map)
  const troopsLost: Record<string, number> = {};
  let garrisonLost = 0;
  const garrisonKinds = { archers: 0, horse: 0 };
  for (const c of setup.commanders.filter((c) => c.side === "crown" && c.id !== ruler)) {
    const n = res.lostBy[c.id] ?? 0;
    if (!n) continue;
    if ((ctx.s.troops[c.id] ?? 0) > 0 && ctx.content.byId.character.get(c.id)?.role === "captain") troopsLost[c.id] = Math.min(ctx.s.troops[c.id], n);
    else {
      garrisonLost += n;
      // which of the fort's men fell, by kind (D-067)
      for (const f of setup.formations.filter((f) => f.commander === c.id)) { const k = f.kind === "archers" ? "archers" : f.kind === "horse" ? "horse" : null; if (k) garrisonKinds[k] += res.lostByFormation[f.id] ?? 0; }
    }
  }
  garrisonLost = Math.min(garrisonLost, ctx.s.fortifications[st.from]?.garrison ?? 0);
  // the raiders: broken if beaten, weakened by what they lost if not
  const threat = ctx.s.threats[st.site];
  const success = res.winner === "crown";
  if (threat && !success && st.enemy > 0 && res.lost.raiders > 0) {
    const left = Math.max(0, st.enemy - res.lost.raiders);
    const intensityPermille = Math.max(1, Math.floor((threat.intensityPermille * left) / st.enemy));
    if (intensityPermille < threat.intensityPermille) ctx.emit("ThreatWeakened", [ev.id], [loc(st.site)], { site: st.site, intensityPermille, battleId: setup.battleId });
  }
  // each commander's own account, as he believes it: his result, his losses, the enemy's (debrief, §22)
  for (const d of r.debrief) {
    if (d.author === ruler) continue;
    learn(ctx, d.author, { subject: loc(st.site), predicate: "battle.result", value: d.result, observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: ev.id, source: d.author }, [ev.id]);
    learn(ctx, d.author, { subject: chr(d.author), predicate: "battle.ownLosses", value: d.ownLosses, observedAt: ctx.tick, band: "probable" }, { kind: "observation", eventId: ev.id, source: d.author }, [ev.id]);
    learn(ctx, d.author, { subject: loc(st.site), predicate: "battle.enemyLosses", value: d.enemyLosses, observedAt: ctx.tick, band: "uncertain" }, { kind: "observation", eventId: ev.id, source: d.author }, [ev.id]);
  }
  if (setup.ruler.present) learn(ctx, ruler, { subject: loc(st.site), predicate: "battle.result", value: res.winner === "crown" ? "won" : res.winner === "raiders" ? "lost" : "drawn", observedAt: ctx.tick, band: "certain" }, { kind: "observation", eventId: ev.id, source: ruler }, [ev.id]);
  concludeSortie(ctx, {
    commander: st.commander, from: st.from, site: st.site, launchedEventId: st.launchedEventId, cause: ev.id,
    found: true, success, pPermille: -1, men: st.men, ambushed: st.ambushed, enemy: st.enemy, garrisonLost, garrisonKinds, troopsLost, battleId: setup.battleId,
    debriefs: r.debrief.filter((d) => d.author !== ruler).map((d) => d.author),
  });
  // Phase 12: commanders who fell (after the losses are counted, so a dead captain's surviving men go back to the fort)
  for (const f of res.fallen ?? []) ctx.emit("CommanderFell", [ev.id], [chr(f.commander), loc(st.from)], { who: f.commander, fate: f.fate, why: f.why, battleId: setup.battleId, from: st.from, ...(f.successor ? { successor: f.successor } : {}) });
}
