"""Phase 0 tests. Written before the prototype.

Run: python3 -m unittest test_phase0 -v   (from this folder)
"""
import json
import unittest

import proto

CHAIN_TYPES = ["THREAT", "SHORTAGE", "REPAIR_RISK", "REQUISITION", "GRIEVANCE", "VAROS_OPPORTUNITY"]


class TestDeterminism(unittest.TestCase):
    def test_same_seed_same_log(self):
        a = proto.run_seed(7)
        b = proto.run_seed(7)
        self.assertEqual(json.dumps(a["log"], sort_keys=True), json.dumps(b["log"], sort_keys=True))
        self.assertEqual(json.dumps(a["traces"], sort_keys=True), json.dumps(b["traces"], sort_keys=True))

    def test_different_seeds_differ(self):
        logs = {json.dumps(proto.run_seed(s)["log"], sort_keys=True) for s in range(1, 8)}
        self.assertGreater(len(logs), 1)


class TestCausality(unittest.TestCase):
    def test_caused_by_points_to_earlier_events(self):
        for seed in range(1, 41):
            log = proto.run_seed(seed)["log"]
            ids = {e["id"] for e in log}
            for e in log:
                for c in e["caused_by"]:
                    self.assertIn(c, ids, f"seed {seed}: dangling cause")
                    self.assertLess(c, e["id"], f"seed {seed}: cause is not earlier")

    def test_ids_increase_and_days_do_not_go_backwards(self):
        log = proto.run_seed(3)["log"]
        for prev, cur in zip(log, log[1:]):
            self.assertLess(prev["id"], cur["id"])
            self.assertLessEqual(prev["day"], cur["day"])


class TestAblation(unittest.TestCase):
    def test_no_threat_means_no_threat_rooted_chain(self):
        params = proto.default_params()
        params["p_threat_start"] = 0.0
        for seed in range(1, 41):
            log = proto.run_seed(seed, params)["log"]
            self.assertFalse(any(e["type"] == "THREAT" for e in log))
            self.assertFalse(proto.full_chain(log))


class TestTraces(unittest.TestCase):
    def test_every_chain_action_has_a_trace(self):
        """Requisitions and Varos moves must come from a recorded decision, not a script."""
        checked = 0
        for seed in range(1, 61):
            out = proto.run_seed(seed)
            traces = out["traces"]
            for e in out["log"]:
                if e["type"] in ("REQUISITION", "VAROS_OPPORTUNITY"):
                    matches = [
                        t for t in traces
                        if t["event_id"] == e["id"] and t["selected"] in ("REQUISITION", "VAROS_OPPORTUNITY")
                    ]
                    self.assertEqual(len(matches), 1, f"seed {seed}: event {e['id']} has no unique trace")
                    t = matches[0]
                    self.assertTrue(t["candidates"], "trace has no candidates")
                    self.assertEqual(t["trigger"], e["caused_by"][0])
                    checked += 1
        self.assertGreater(checked, 0, "no requisitions or Varos moves found to check")

    def test_agents_decide_from_beliefs_not_truth(self):
        """Oren's recorded belief about Greyfen stock must be allowed to differ from the true stock."""
        diffs = 0
        for seed in range(1, 61):
            for t in proto.run_seed(seed)["traces"]:
                if t["agent"] == "Oren" and "belief_tg" in t and "true_tg" in t:
                    if abs(t["belief_tg"] - t["true_tg"]) > 1e-6:
                        diffs += 1
        self.assertGreater(diffs, 0)


class TestFunnel(unittest.TestCase):
    def test_funnel_is_monotone(self):
        for seed in range(1, 41):
            f = proto.funnel(proto.run_seed(seed)["log"])
            reached = [f[t] for t in CHAIN_TYPES]
            for i in range(1, len(reached)):
                if reached[i]:
                    self.assertTrue(reached[i - 1], f"seed {seed}: stage {i} reached without stage {i-1}")


if __name__ == "__main__":
    unittest.main()
