// Phase 9 (docs/POLICY.md, D-069, D-070): standing policy and precedent. Spec from the plan and backlog P0.12: officials
// act under standing policy when no immediate order covers a situation, merge it with orders and their own beliefs, and
// cite precedent in their reasons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, type Sim } from "../src/engine.ts";
import { checkRun } from "../src/invariants.ts";
import { DAY } from "../src/systems/types.ts";
import type { PlayerAction } from "../src/policies.ts";
import { CONTENT, variant } from "./helpers.ts";

type Trace = { agent: string; candidates: { action: { kind: string; target?: string }; score: number; contributions: { kind: string; ref: { kind: string; id: string }; weight: number; textKey: string }[] }[]; selected: { kind: string }; ordersInForce: unknown[] };
const traces = (sim: Sim) => sim.log.filter((e) => e.type === "DecisionMade").map((e) => ({ e, t: e.payload.trace as Trace })).filter((x) => x.t && x.t.candidates);
const sortieCands = (sim: Sim) => traces(sim).flatMap(({ e, t }) => t.candidates.filter((c) => c.action.kind === "sortie").map((c) => ({ e, t, c })));
const P = CONTENT.scenario.policy!;

/** Campaigns under a scripted policy, with a standing policy in force from the start (initial) or none. */
function campaign(seed: number, policy: "passive" | "delegating" | "aggressive", initial?: Record<string, string>, days = 160, edit: (r: any) => void = () => {}) {
  const c = variant((r) => { if (initial) r.scenario.policy!.initial = initial; edit(r); });
  const sim = createSim({ content: c, seed, policy });
  sim.runDays(days);
  return sim;
}
/** An interactive run in which Anna proclaims a policy on a given day. */
function proclaimed(seed: number, action: PlayerAction, day: number, days: number) {
  const c = variant((r) => { r.scenario.scripts = []; });
  const sim = createSim({ content: c, seed, policy: "external", params: { dayEnd: true } });
  let done = false;
  for (let i = 0; i < 6000 && sim.tick < days * DAY; i++) {
    const p = sim.next(days * DAY); if (!p.paused) break;
    if (!done && sim.tick >= day * DAY) { sim.answer([action]); done = true; continue; }
    sim.answer([]);
  }
  return sim;
}

test("policy: a proclamation reaches each official by letter; until it does he holds no policy", () => {
  const sim = proclaimed(3, { action: "policy", policy: { area: "military", rule: "hold_walls" } }, 4, 30);
  const pr = sim.log.find((e) => e.type === "PolicyProclaimed");
  assert.ok(pr, "proclaimed");
  assert.deepEqual([pr!.payload.area, pr!.payload.rule], ["military", "hold_walls"]);
  const w = sim.unsafeWorldForDebug();
  const officials = CONTENT.characters.filter((c) => c.role === "castellan" || c.role === "captain").map((c) => c.id);
  const learnt = officials.filter((id) => w.policyKnown[id]?.military?.rule === "hold_walls");
  assert.ok(learnt.length >= 2, `learnt by ${learnt.join(", ")}`);
  // away from court, each learnt it when her letter reached him, and not before
  for (const id of learnt) {
    const l = sim.log.find((e) => e.type === "PolicyLearned" && e.payload.holder === id)!;
    const by = sim.log.find((e) => e.id === l.causedBy[0])!;
    assert.equal(by.type, "ReportDelivered", `${id} learnt from a letter`);
    assert.ok(l.tick > pr!.tick, `${id} learnt later`);
  }
});

test("policy: under 'hold the walls' officials stop sallying on their own unless their own case outweighs it, and say why", () => {
  // A policy is a reason, not a switch (POLICY.md §2): a loyal castellan keeps it; an ambitious captain may still go for
  // renown, and his trace shows the policy he overrode.
  let on = 0, off = 0, cited = 0, applied = 0, loyal = 0;
  const free = (sim: Sim) => sim.log.filter((e) => e.type === "SortieLaunched" && !(sim.log.find((d) => d.id === e.payload.decisionEventId)?.payload.trace as Trace | undefined)?.ordersInForce?.length);
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = campaign(seed, "delegating", { military: "hold_walls" }), b = campaign(seed, "delegating");
    on += free(a).length; off += free(b).length;
    loyal += free(a).filter((e) => e.payload.commander === "bren").length;
    for (const { t, c } of sortieCands(a)) { if (t.ordersInForce?.length) continue; applied++; if (c.contributions.some((r) => r.ref.kind === "policy" && r.ref.id === "military:hold_walls" && r.weight < 0)) cited++; }
  }
  assert.ok(off > 10, `sorties without the policy: ${off}`);
  assert.ok(on <= Math.floor(off * 0.6), `with 'hold the walls' ${on}, without ${off}`);
  assert.equal(loyal, 0, "Bren, loyal to the queen, keeps the policy");
  assert.ok(applied > 0 && cited / applied >= 0.95, `policy cited in ${cited} of ${applied} sortie weighings`);
});

test("policy: 'bold' and 'cautious' follow the official's own judged odds", () => {
  const bold = sortieCands(campaign(2, "delegating", { military: "bold" })), cautious = sortieCands(campaign(2, "delegating", { military: "cautious" }));
  const pol = (x: { c: Trace["candidates"][number] }, id: string) => x.c.contributions.find((r) => r.ref.kind === "policy" && r.ref.id === id);
  assert.ok(bold.some((x) => (pol(x, "military:bold")?.weight ?? 0) > 0), "bold urges a sally");
  assert.ok(cautious.some((x) => (pol(x, "military:cautious")?.weight ?? 0) < 0), "cautious holds back on poor odds");
  assert.ok(cautious.every((x) => pol(x, "military:cautious")), "cautious is weighed at every sally");
});

test("policy: an order in force wins over a policy; the policy is not weighed where an order covers the situation", () => {
  const sim = campaign(3, "aggressive", { military: "hold_walls" });
  const covered = traces(sim).filter(({ t }) => t.ordersInForce?.length);
  assert.ok(covered.length > 0);
  for (const { t } of covered) for (const c of t.candidates) assert.ok(!c.contributions.some((r) => r.ref.kind === "policy" && r.ref.id.startsWith("military:")), `${t.agent}: no policy under orders`);
  // attack orders are still carried out under 'hold the walls'
  assert.ok(sim.log.some((e) => e.type === "SortieLaunched" || e.type === "BattleBegan"), "the queen's own attacks go ahead");
});

test("precedent: a fort remembers its sorties; a later sally there cites them", () => {
  let cited = 0, second = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = campaign(seed, "delegating");
    const recs = sim.log.filter((e) => e.type === "PrecedentRecorded" && e.payload.kind === "sortie");
    for (const r of recs) {
      assert.ok(["won", "lost"].includes(r.payload.outcome as string));
      assert.ok(typeof r.payload.oddsPermille === "number");
    }
    for (const { e, t, c } of sortieCands(sim)) {
      const prec = c.contributions.filter((r) => r.kind === "precedent");
      // a later sally against the same raiders' ground, by someone who was there or holds that fort
      const known = recs.filter((r) => r.tick < e.tick && r.payload.site === c.action.target && (r.payload.knownBy as string[]).some((k) => k === t.agent || k === `fort:${CONTENT.byId.character.get(t.agent)?.location}`));
      if (known.length) { second++; if (prec.length) cited++; }
      for (const p of prec) {
        const ev = sim.log.find((x) => x.id === Number(p.ref.id));
        assert.ok(ev && ev.type === "PrecedentRecorded" && ev.tick < e.tick, "cites a real, earlier precedent");
        assert.equal(p.textKey, ev!.payload.outcome === "won" ? "reason.precedent_won" : "reason.precedent_lost");
        assert.ok(ev!.payload.outcome === "won" ? p.weight > 0 : p.weight < 0);
      }
    }
  }
  assert.ok(second > 0 && cited / second >= 0.5, `precedent cited in ${cited} of ${second} later sortie weighings`);
});

test("communities policy: refusal met by parley eases the grievance, by punishment brings the dues and anger", () => {
  const run = (rule: string) => { const out: Sim[] = []; for (const seed of [1, 2, 3, 4]) out.push(campaign(seed, "aggressive", { communities: rule }, 200)); return out; };
  const neg = run("negotiate"), pun = run("punish"), tol = run("tolerate");
  const count = (s: Sim[], t: string) => s.reduce((n, sim) => n + sim.log.filter((e) => e.type === t).length, 0);
  assert.ok(count(neg, "CommunityParley") > 0, "parleys");
  assert.ok(count(pun, "CommunityPunished") > 0, "punishments");
  assert.equal(count(tol, "CommunityParley") + count(tol, "CommunityPunished"), 0, "tolerate does nothing");
  const heard = (s: Sim[], type: string) => s.flatMap((sim) => sim.log.filter((e) => e.type === "CommunityHeard" && e.payload.type === type));
  assert.ok(heard(neg, "CommunityParley").some((e) => (e.payload.eased as unknown[] | undefined)?.length), "a parley eases");
  assert.ok(heard(pun, "CommunityPunished").some((e) => (e.payload.grievances as { delta: number }[] | undefined)?.some((g) => g.delta > 0)), "punishment aggrieves");
  // each act is recorded as a precedent with what the people did next
  for (const s of [neg, pun]) assert.ok(s.some((sim) => sim.log.some((e) => e.type === "PrecedentRecorded" && (e.payload.kind === "negotiate" || e.payload.kind === "punish"))));
});

test("emergency policy: with Anna away, the regent repairs under 'repairs' and not without it", () => {
  const edit = (r: any) => {
    r.scenario.scripts = [{ day: 1, kind: "travel", who: "anna", to: "greybridge", mode: "rider" }, { day: 3, kind: "threat", site: "blackwood", intensityPermille: 700, durationDays: 60 }];
    r.characters.find((x: any) => x.id === "bren").location = "northwatch";
    r.locations.find((x: any) => x.id === "northwatch").fortification.conditionMilli = 62000;
    r.scenario.messenger.lossPermillePerDay = 0; r.scenario.interception = [];
  };
  const regent = (sim: Sim) => sim.log.filter((e) => e.type === "OrderIssued" && (e.payload.order as { issuer: string }).issuer === CONTENT.scenario.regency.regent);
  const on = campaign(2, "passive", { emergency: "repairs" }, 40, edit), off = campaign(2, "passive", undefined, 40, edit);
  assert.ok(regent(on).length > 0, "the regent acted under the policy");
  assert.equal(regent(off).length, 0, "and not without it");
  const d = on.log.find((e) => e.type === "DecisionMade" && (e.payload.trace as { kind: string }).kind === "regency" && e.payload.authority === "within");
  assert.equal(d?.payload.policy, "emergency:repairs", "her authority came from the policy");
});

test("policy: invariants hold and nothing changes when no policy is in force", () => {
  const a = campaign(4, "delegating"), b = campaign(4, "delegating", { military: "cautious", communities: "negotiate" });
  assert.deepEqual(checkRun(b), []);
  assert.ok(!a.log.some((e) => e.type === "PolicyProclaimed" || e.type === "CommunityParley" || e.type === "CommunityPunished"));
  assert.ok(P.policyMilli > 0);
});
