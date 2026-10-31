#!/usr/bin/env python3
"""Phase 0 paper prototype (THROWAWAY). Keep the findings, discard this code.

Question: does the chain
  Blackwood threat -> timber shortage -> Northwatch repair risk -> requisition
  -> Greyfen grievance -> Varos opportunity
emerge without a script, at a plausible frequency (5-40% of seeds)?

One province, five agents (Bren, Oren, Elara, Mara, Varos), three resources
(timber, grain, coin; grain is only tracked for Varos), one community (Greyfen).
Nobody is told to produce the chain. Each agent reacts to its own (delayed,
noisy) beliefs; causal links are recorded from the event that actually woke
the agent. Anna is a passive player who follows Elara's veto.

Floats and daily steps are fine here. The real engine uses integers and ticks.
"""
import argparse
import json
import math
import random
import sys

CHAIN = ["THREAT", "SHORTAGE", "REPAIR_RISK", "REQUISITION", "GRIEVANCE", "VAROS_OPPORTUNITY"]


def default_params():
    return dict(
        days=240,
        # Blackwood threat
        p_threat_start=0.006, threat_intensity=[0.3, 1.0], threat_duration=[30, 90], fear_factor=0.8,
        # Greyfen community stocks (timber)
        cut_rate=12.0, greyfen_use=7.0, greyfen_reserve=80.0, greyfen_start=160.0, greyfen_cap=400.0,
        # Crown / Northwatch
        crown_start=120.0, coin_start=400.0, coin_income=22.0, coin_upkeep=18.0, crown_maint=1.2,
        wall_start=75.0, wall_decay=0.25, p_storm=0.02, storm_damage=[5, 25],
        repair_trigger=60.0, wall_target=85.0, timber_per_point=2.0,
        report_delay=[2, 4], delivery_delay=[2, 5],
        # Oren's routine purchasing and decision weights
        routine_every=20, stock_target=100.0, low_stock=60.0, routine_cap=60.0, oren_coin_reserve=120.0,
        w_coin=1.0, greedy_mult=1.4, w_griev=0.6, req_cap_share=0.6,
        # Information flow
        elara_alarm=70.0,
        tax_every=15, tax_delay=[7, 10], tax_noise=0.2,
        rumor_every=10, rumor_delay=[5, 15], rumor_noise=0.25,
        merchant_every=10, merchant_delay=5, merchant_noise=10.0,
        # Greyfen grievance dynamics
        g_min=400.0, n_min=250.0, g_decay=0.012, n_decay=0.010, embargo_days=30, mara_trust_range=[300, 800],
        # Varos
        p_rumor_reach=0.7, rumor_delay_varos=[5, 15],
        varos_ambition=0.75, varos_theta=0.45, varos_grain_range=[20, 120], varos_grain_min=50.0,
        # Varos reads crown weakness from BOTH wall condition and treasury (design change after run log #1-#3)
        coin_ref=300.0, w_wall_weak=0.5,
        # Varos keeps an unrest belief for this many days and re-evaluates on new merchant reports
        varos_memory=45,
    )


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


class Sim:
    def __init__(self, seed, P):
        self.seed, self.P = seed, P
        self.rw = random.Random(f"{seed}:world")
        self.rt = random.Random(f"{seed}:threat")
        self.rr = random.Random(f"{seed}:rumor")
        self.rc = random.Random(f"{seed}:chars")
        self.day = 0
        self.log, self.traces, self.pending = [], [], {}
        self.nid = 1
        # reality
        self.W, self.Tc, self.coin, self.Tg = P["wall_start"], P["crown_start"], P["coin_start"], P["greyfen_start"]
        self.G = self.N = 0.0
        self.L = self.rc.uniform(*P["mara_trust_range"])
        self.varos_grain = self.rc.uniform(*P["varos_grain_range"])
        # threat
        self.threat_started, self.threat_id, self.threat_end, self.I = False, None, -1, 0.0
        self.shock_cause = None
        # bookkeeping
        self.open_shortage = None
        self.wall_armed = True
        self.last_storm, self.last_storm_day = None, -99
        self.last_req = None
        self.grievance_active, self.grievance_id = False, None
        self.embargo_until = -1
        # beliefs (start accurate, then drift through delayed noisy reports)
        self.oren_tg, self.oren_w = P["greyfen_start"], P["wall_start"]
        self.elara_tg = P["greyfen_start"]
        self.varos_w = P["wall_start"]
        self.varos_coin = P["coin_start"]

    # ---- plumbing -------------------------------------------------------
    def emit(self, etype, caused_by=None, **data):
        eid = self.nid
        self.nid += 1
        self.log.append(dict(id=eid, day=self.day, type=etype, caused_by=list(caused_by or []), data=data))
        return eid

    def at(self, delay, fn, *args):
        self.pending.setdefault(self.day + max(1, int(delay)), []).append((fn, args))

    def trace(self, agent, trigger, candidates, selected, event_id=None, **extra):
        self.traces.append(dict(day=self.day, agent=agent, trigger=trigger, event_id=event_id,
                                candidates=[dict(action=a, score=round(s, 4)) for a, s in candidates],
                                selected=selected, **extra))

    def _set(self, name, val):
        setattr(self, name, val)

    def threat_active(self):
        return self.threat_started and self.day < self.threat_end

    # ---- daily step -----------------------------------------------------
    def step(self, d):
        P = self.P
        self.day = d
        # weather
        if self.rw.random() < P["p_storm"]:
            dmg = self.rw.uniform(*P["storm_damage"])
            self.W = max(0.0, self.W - dmg)
            self.last_storm, self.last_storm_day = self.emit("STORM", [], damage=round(dmg, 1)), d
        # Blackwood threat (at most one per run)
        if not self.threat_started and self.rt.random() < P["p_threat_start"]:
            self.threat_started = True
            self.I = self.rt.uniform(*P["threat_intensity"])
            dur = self.rt.randint(*P["threat_duration"])
            self.threat_end = d + dur
            self.threat_id = self.emit("THREAT", [], intensity=round(self.I, 2), duration=dur)
            self.shock_cause = self.threat_id
        if self.threat_started and d == self.threat_end:
            self.emit("THREAT_END", [self.threat_id])
        if self.shock_cause and not self.threat_active() and self.Tg >= P["greyfen_reserve"] + 40:
            self.shock_cause = None
        # Greyfen woodcutters, wall decay, treasury
        fear = P["fear_factor"] * self.I if self.threat_active() else 0.0
        cut = P["cut_rate"] * (1 - fear) * self.rw.uniform(0.85, 1.15)
        self.Tg = clamp(self.Tg + cut - P["greyfen_use"], 0.0, P["greyfen_cap"])
        self.W = max(0.0, self.W - P["wall_decay"])
        self.coin += P["coin_income"] - P["coin_upkeep"]
        self.Tc = max(0.0, self.Tc - P["crown_maint"])
        # scheduled arrivals (reports, deliveries, rumours)
        for fn, args in self.pending.pop(d, []):
            fn(*args)
        # agents' routines
        if d > 0 and d % P["routine_every"] == 0:
            self.oren_routine()
        if d % P["tax_every"] == 0:
            v = self.Tg * self.rr.uniform(1 - P["tax_noise"], 1 + P["tax_noise"])
            self.at(self.rr.randint(*P["tax_delay"]), self._set, "oren_tg", v)
        if d % P["rumor_every"] == 0:
            v = self.Tg * self.rr.uniform(1 - P["rumor_noise"], 1 + P["rumor_noise"])
            self.at(self.rr.randint(*P["rumor_delay"]), self._set, "elara_tg", v)
        if d % P["merchant_every"] == 0:
            v = self.W + self.rr.uniform(-P["merchant_noise"], P["merchant_noise"])
            c = self.coin * self.rr.uniform(0.8, 1.2)  # merchants also hear of royal pay arrears
            self.at(P["merchant_delay"], self._set, "varos_w", v)
            self.at(P["merchant_delay"], self._set, "varos_coin", c)
            self.at(P["merchant_delay"], self.varos_on_merchant)
        self.community_update()
        self.check_wall()

    # ---- Bren (castellan of Northwatch) ----------------------------------
    def check_wall(self):
        P = self.P
        if self.W >= P["repair_trigger"] + 10:
            self.wall_armed = True
        if self.W < P["repair_trigger"] and self.wall_armed:
            self.wall_armed = False
            cause = [self.last_storm] if self.day - self.last_storm_day <= 3 else []
            ev = self.emit("WALL_LOW", cause, W=round(self.W, 1))
            self.bren_on_wall_low(ev)

    def bren_repair(self):
        P = self.P
        need = P["timber_per_point"] * max(0.0, P["wall_target"] - self.W)
        use = min(self.Tc, need)
        self.Tc -= use
        self.W += use / P["timber_per_point"]
        if self.W >= P["repair_trigger"] + 10:
            self.wall_armed = True
        return use, need

    def bren_on_wall_low(self, ev):
        P = self.P
        need = P["timber_per_point"] * (P["wall_target"] - self.W)
        s_repair = self.Tc / need if need else 1.0
        can_repair = self.Tc >= 0.5 * need
        cands = [("REPAIR", s_repair if can_repair else -1.0), ("REPORT_RISK", 1.0 - s_repair)]
        if can_repair:
            self.bren_repair()
            self.trace("Bren", ev, cands, "REPAIR", true_tc=round(self.Tc, 1))
            return
        cause = [self.open_shortage] if self.open_shortage else [ev]
        rid = self.emit("REPAIR_RISK", cause, need=round(need, 1), W=round(self.W, 1), Tc=round(self.Tc, 1))
        self.trace("Bren", ev, cands, "REPORT_RISK", event_id=rid)
        self.at(self.rw.randint(*P["report_delay"]), self.oren_on_report, rid, need, self.W)

    # ---- Oren (steward) and Elara's veto ----------------------------------
    def price_estimate(self, s_b):
        return 1.0 + max(0.0, 40.0 - s_b) / 40.0

    def oren_on_report(self, rid, need, w_reported):
        P = self.P
        self.oren_w = w_reported
        tg_b = self.oren_tg
        s_b = max(0.0, tg_b - P["greyfen_reserve"])
        price = self.price_estimate(s_b)
        afford = max(0.0, self.coin - P["oren_coin_reserve"]) / price
        buy_qty = min(need, s_b, afford)
        req_qty = min(need, P["req_cap_share"] * tg_b)
        u = clamp((P["wall_target"] - self.oren_w) / 40.0, 0.0, 1.5)
        sc_buy = u * (buy_qty / need) - P["w_coin"] * P["greedy_mult"] * (buy_qty * price / max(self.coin, 1.0))
        sc_req = u * (req_qty / need) - P["w_griev"] * (req_qty / max(tg_b, 1.0))
        cands = [("BUY", sc_buy), ("REQUISITION", sc_req), ("NONE", 0.0)]
        best = max(cands, key=lambda c: c[1])[0]
        veto = False
        if best == "REQUISITION" and self.elara_tg < P["elara_alarm"]:
            veto = True  # Elara advises against; Anna (passive) follows her
            best = max([c for c in cands if c[0] != "REQUISITION"], key=lambda c: c[1])[0]
        extra = dict(belief_tg=round(tg_b, 1), true_tg=round(self.Tg, 1), elara_tg=round(self.elara_tg, 1),
                     elara_veto=veto, need=round(need, 1))
        if best == "REQUISITION":
            amount = min(req_qty, P["req_cap_share"] * self.Tg)
            before = self.Tg
            self.Tg -= amount
            eid = self.emit("REQUISITION", [rid], amount=round(amount, 1), greyfen_before=round(before, 1))
            self.last_req = eid
            self.oren_tg = max(0.0, self.oren_tg - amount)
            self.community_hit(amount, before)
            self.at(self.rw.randint(*P["delivery_delay"]), self.deliver, amount)
            self.trace("Oren", rid, cands, "REQUISITION", event_id=eid, **extra)
        elif best == "BUY":
            actual = min(buy_qty, max(0.0, self.Tg - P["greyfen_reserve"])) if self.day >= self.embargo_until else 0.0
            self.Tg -= actual
            self.coin -= actual * price
            self.oren_tg = max(0.0, self.oren_tg - actual)
            eid = self.emit("PURCHASE", [rid], qty=round(actual, 1))
            self.at(self.rw.randint(*P["delivery_delay"]), self.deliver, actual)
            self.trace("Oren", rid, cands, "BUY", event_id=eid, **extra)
        else:
            self.trace("Oren", rid, cands, "NONE", **extra)

    def deliver(self, qty):
        self.Tc += qty
        if self.W < self.P["wall_target"] - 5:
            self.bren_repair()

    def oren_routine(self):
        P = self.P
        if self.Tc >= 0.8 * P["stock_target"]:
            self.open_shortage = None
        need = min(P["routine_cap"], max(0.0, P["stock_target"] - self.Tc))
        if need <= 0:
            return
        tg_b = self.oren_tg
        s_b = max(0.0, tg_b - P["greyfen_reserve"])
        price = self.price_estimate(s_b)
        afford = max(0.0, self.coin - P["oren_coin_reserve"]) / price
        buy_qty = min(need, s_b, afford)
        embargo = self.day < self.embargo_until
        actual = 0.0 if embargo else min(buy_qty, max(0.0, self.Tg - P["greyfen_reserve"]))
        self.Tg -= actual
        self.coin -= actual * price
        self.oren_tg = max(0.0, self.oren_tg - actual)
        self.at(self.rw.randint(*P["delivery_delay"]), self.deliver, actual)
        projected = self.Tc + actual
        self.trace("Oren", None, [("BUY", buy_qty), ("NONE", 0.0)], "BUY" if buy_qty > 0 else "NONE",
                   belief_tg=round(tg_b, 1), true_tg=round(self.Tg + actual, 1), routine=True, embargo=embargo)
        if projected < P["low_stock"]:
            if self.shock_cause:
                cause = [self.shock_cause]
            elif embargo and self.grievance_id:
                cause = [self.grievance_id]
            else:
                cause = []
            self.open_shortage = self.emit("SHORTAGE", cause, projected=round(projected, 1), need=round(need, 1),
                                           bought=round(actual, 1))

    # ---- Greyfen community (Mara) -----------------------------------------
    def community_hit(self, amount, before):
        share = amount / max(before, 1.0)
        hardship = clamp(1.0 - self.Tg / 60.0, 0.0, 1.0)
        self.G = min(1000.0, self.G + 120 + 500 * share + 300 * hardship)
        self.N = min(1000.0, self.N + 150 + 250 * share)

    def community_update(self):
        P = self.P
        self.G *= (1 - P["g_decay"])
        self.N *= (1 - P["n_decay"])
        if self.grievance_active and self.G < 0.6 * P["g_min"]:
            self.grievance_active = False
        if not self.grievance_active and self.last_req and self.G >= P["g_min"] and self.N >= P["n_min"]:
            organised = self.L >= 450
            gid = self.emit("GRIEVANCE", [self.last_req], G=round(self.G), N=round(self.N), organised=organised)
            self.grievance_active, self.grievance_id = True, gid
            if organised:
                self.embargo_until = self.day + P["embargo_days"]
            self.trace("Mara", self.last_req, [("ORGANISE_EMBARGO", self.L), ("GRUMBLE", 450.0)],
                       "ORGANISE_EMBARGO" if organised else "GRUMBLE", event_id=gid, leadership=round(self.L))
            if self.rr.random() < P["p_rumor_reach"]:
                self.at(self.rr.randint(*P["rumor_delay_varos"]), self.varos_on_rumor, gid, self.G)

    # ---- Varos (rival lord) -------------------------------------------------
    def varos_on_rumor(self, gid, g_at_emit):
        unrest = clamp(g_at_emit / 800.0 + self.rr.uniform(-0.15, 0.15), 0.0, 1.0)
        self.varos_unrest = (unrest, self.day, gid)
        self.varos_evaluate("rumour")

    def varos_on_merchant(self):
        """New information about crown weakness wakes Varos if his unrest belief is still fresh."""
        u = getattr(self, "varos_unrest", None)
        if u and self.day - u[1] <= self.P["varos_memory"] and getattr(self, "varos_acted_gid", None) != u[2]:
            self.varos_evaluate("merchant")

    def varos_evaluate(self, kind):
        P = self.P
        unrest, _, gid = self.varos_unrest
        if getattr(self, "varos_acted_gid", None) == gid:
            return
        wall_weak = 1.0 - clamp(self.varos_w, 0.0, 100.0) / 100.0
        coin_weak = 1.0 - clamp(self.varos_coin / P["coin_ref"], 0.0, 1.0)
        weak = P["w_wall_weak"] * wall_weak + (1.0 - P["w_wall_weak"]) * coin_weak
        score = P["varos_ambition"] * (0.6 * unrest + 0.4 * weak)
        act = score >= P["varos_theta"] and self.varos_grain >= P["varos_grain_min"]
        cands = [("VAROS_OPPORTUNITY", score - P["varos_theta"]), ("WAIT", 0.0)]
        if act:
            self.varos_acted_gid = gid
            eid = self.emit("VAROS_OPPORTUNITY", [gid], score=round(score, 3), woken_by=kind)
            self.trace("Varos", gid, cands, "VAROS_OPPORTUNITY", event_id=eid, unrest_b=round(unrest, 2),
                       wall_b=round(self.varos_w, 1), grain=round(self.varos_grain), woken_by=kind)
        else:
            self.trace("Varos", gid, cands, "WAIT", unrest_b=round(unrest, 2), wall_b=round(self.varos_w, 1),
                       grain=round(self.varos_grain), woken_by=kind)


# ---- running and analysis ---------------------------------------------------
def run_seed(seed, params=None):
    P = default_params() if params is None else params
    sim = Sim(seed, P)
    for d in range(P["days"]):
        sim.step(d)
    return dict(seed=seed, log=sim.log, traces=sim.traces,
                final=dict(W=round(sim.W, 1), Tc=round(sim.Tc, 1), Tg=round(sim.Tg, 1), coin=round(sim.coin, 1)))


def _up(by_id, e, idx):
    if idx == 0:
        return True
    for c in e["caused_by"]:
        p = by_id[c]
        if p["type"] == CHAIN[idx - 1] and _up(by_id, p, idx - 1):
            return True
    return False


def funnel(log):
    by_id = {e["id"]: e for e in log}
    return {t: any(e["type"] == t and _up(by_id, e, i) for e in log) for i, t in enumerate(CHAIN)}


def full_chain(log):
    return funnel(log)[CHAIN[-1]]


def parse_seeds(spec):
    if ".." in spec:
        a, b = spec.split("..")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in spec.split(",")]


def batch(seeds, params=None):
    n = len(seeds)
    stage = {t: 0 for t in CHAIN}
    any_stage = {"REQUISITION": 0, "GRIEVANCE": 0, "VAROS_OPPORTUNITY": 0}
    for s in seeds:
        log = run_seed(s, params)["log"]
        f = funnel(log)
        for t in CHAIN:
            stage[t] += f[t]
        types = {e["type"] for e in log}
        for t in any_stage:
            any_stage[t] += t in types
    pct = lambda x: round(100.0 * x / n, 1)
    return dict(n=n, funnel_pct={t: pct(stage[t]) for t in CHAIN},
                any_root_pct={t: pct(v) for t, v in any_stage.items()},
                chain_pct=pct(stage[CHAIN[-1]]), chain_count=stage[CHAIN[-1]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1..100")
    ap.add_argument("--set", action="append", default=[], help="key=json_value")
    ap.add_argument("--out")
    a = ap.parse_args()
    P = default_params()
    for kv in a.set:
        k, v = kv.split("=", 1)
        assert k in P, f"unknown param {k}"
        P[k] = json.loads(v)
    res = batch(parse_seeds(a.seeds), P)
    res["set"] = a.set
    print(json.dumps(res, indent=2))
    if a.out:
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)


if __name__ == "__main__":
    main()
