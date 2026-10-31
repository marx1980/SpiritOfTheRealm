"""Phase 0b tests (coupling redesign). Written before the changes to proto_b.py.

Run: python3 -m unittest test_phase0b -v   (from this folder)
"""
import json
import unittest

import proto
import proto_b

CAL = dict(greyfen_use=10.5, coin_start=120.0, coin_upkeep=21.0, varos_grain_range=[30, 150], varos_theta=0.40)
OFF_FLAGS = dict(fix_homeostasis=False, fix_garrison=False, fix_blame=False, anna_policy="delegating")


def dump(x):
    return json.dumps(x, sort_keys=True)


def params_b(**over):
    P = proto_b.default_params()
    P.update(over)
    return P


class TestBackwardCompatible(unittest.TestCase):
    def test_all_fixes_off_reproduces_phase0(self):
        Pa = proto.default_params()
        Pa.update(CAL)
        Pb = params_b(**CAL, **OFF_FLAGS)
        for s in range(1, 31):
            self.assertEqual(dump(proto.run_seed(s, Pa)["log"]), dump(proto_b.run_seed(s, Pb)["log"]), f"seed {s}")


class TestDeterminismAndPairing(unittest.TestCase):
    def test_same_seed_same_log(self):
        P = params_b()
        self.assertEqual(dump(proto_b.run_seed(11, P)["log"]), dump(proto_b.run_seed(11, P)["log"]))

    def test_on_off_arms_identical_until_threat(self):
        P = params_b()
        Poff = dict(P, p_threat_start=0.0)
        for s in range(1, 41):
            on, off = proto_b.run_seed(s, P)["log"], proto_b.run_seed(s, Poff)["log"]
            t = next((e["day"] for e in on if e["type"] == "THREAT"), None)
            if t is None:
                self.assertEqual(dump(on), dump(off), f"seed {s}: no threat but arms differ")
            else:
                pre = lambda log: [e for e in log if e["day"] < t]
                self.assertEqual(dump(pre(on)), dump(pre(off)), f"seed {s}: arms differ before threat")

    def test_causes_point_to_earlier_events(self):
        for s in range(1, 41):
            log = proto_b.run_seed(s, params_b())["log"]
            ids = {e["id"] for e in log}
            for e in log:
                for c in e["caused_by"]:
                    self.assertIn(c, ids)
                    self.assertLess(c, e["id"])


class TestGarrison(unittest.TestCase):
    def test_no_diversion_without_threat(self):
        Poff = params_b(p_threat_start=0.0)
        for s in range(1, 41):
            types = {e["type"] for e in proto_b.run_seed(s, Poff)["log"]}
            self.assertNotIn("GARRISON_DIVERTED", types)

    def test_diversion_is_caused_by_threat_and_traced(self):
        seen = 0
        for s in range(1, 81):
            r = proto_b.run_seed(s, params_b())
            by_id = {e["id"]: e for e in r["log"]}
            for e in r["log"]:
                if e["type"] == "GARRISON_DIVERTED":
                    seen += 1
                    self.assertEqual(by_id[e["caused_by"][0]]["type"], "THREAT")
                    self.assertTrue(any(t["agent"] == "Bren" and t["event_id"] == e["id"] for t in r["traces"]))
        self.assertGreater(seen, 0)


class TestBlame(unittest.TestCase):
    def test_same_taking_hurts_more_in_danger(self):
        sim = proto_b.Sim(1, params_b())
        sim.Tg = 100.0
        calm = sim.grievance_increment(30.0, 130.0, danger=False)
        danger = sim.grievance_increment(30.0, 130.0, danger=True)
        self.assertGreater(danger, calm)

    def test_blame_off_is_context_free(self):
        sim = proto_b.Sim(1, params_b(fix_blame=False))
        sim.Tg = 100.0
        self.assertEqual(sim.grievance_increment(30.0, 130.0, danger=False),
                         sim.grievance_increment(30.0, 130.0, danger=True))


class TestHomeostasis(unittest.TestCase):
    def test_labour_rises_when_stock_low_but_not_into_closed_forest(self):
        sim = proto_b.Sim(1, params_b())
        sim.Tg = 20.0
        low = sim.labour_mult(threat_on=False)
        sim.Tg = 300.0
        high = sim.labour_mult(threat_on=False)
        self.assertGreater(low, 1.0)
        self.assertLess(high, 1.0)
        sim.Tg = 20.0
        self.assertLessEqual(sim.labour_mult(threat_on=True), 1.0)

    def test_rationing_cuts_use_when_low(self):
        sim = proto_b.Sim(1, params_b())
        sim.Tg = 10.0
        self.assertLess(sim.daily_use(), sim.P["greyfen_use"])
        sim.Tg = 300.0
        self.assertEqual(sim.daily_use(), sim.P["greyfen_use"])


class TestPolicies(unittest.TestCase):
    def test_policies_run_and_every_varos_move_is_traced(self):
        for pol in ("passive", "delegating", "aggressive"):
            for s in range(1, 21):
                r = proto_b.run_seed(s, params_b(anna_policy=pol))
                moves = [e["id"] for e in r["log"] if e["type"] == "VAROS_OPPORTUNITY"]
                traced = {t["event_id"] for t in r["traces"] if t["agent"] == "Varos"}
                self.assertTrue(set(moves) <= traced, pol)


if __name__ == "__main__":
    unittest.main()
