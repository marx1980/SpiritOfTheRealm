"""Phase 0b TUNE-seed analysis: per-fix ablation and knife-edge test (C0.6). Seeds 1-1000 only."""
import json
from multiprocessing import Pool
import gate_b, proto_b

SEEDS = list(range(1, 1001))
FIXES = ["fix_homeostasis", "fix_garrison", "fix_blame"]
KEY = ["greyfen_use", "cut_rate", "coin_upkeep", "varos_theta", "lab_k", "garrison_divert", "blame_danger", "blame_calm"]

def short(r):
    return {p: dict(A=round(x["A"], 3), on=round(x["on"], 3), off=round(x["off"], 3)) for p, x in r.items()}

if __name__ == "__main__":
    out = {"ablation": {}, "knife_edge": {}}
    with Pool() as pool:
        for f in FIXES:
            out["ablation"]["only " + f] = short(gate_b.evaluate({g: g == f for g in FIXES}, SEEDS, pool, boot=False))
            out["ablation"]["without " + f] = short(gate_b.evaluate({f: False}, SEEDS, pool, boot=False))
        P0 = proto_b.default_params(); P0.update(gate_b.BASE)
        for k in KEY:
            row = {}
            for m in (0.75, 1.25):
                v = P0[k] * m
                r = gate_b.evaluate({k: v}, SEEDS, pool, policies=("delegating",), boot=False)["delegating"]
                row[str(m)] = dict(value=round(v, 3), A=round(r["A"], 3), on=round(r["on"], 3), off=round(r["off"], 3))
            row["knife_edge"] = any(x["A"] < 0.005 or x["A"] > 0.80 for x in row.values() if isinstance(x, dict))
            out["knife_edge"][k] = row
    json.dump(out, open("results/phase0b_tune.json", "w"), indent=2)
    for k, v in out["ablation"].items(): print(k, v)
    for k, v in out["knife_edge"].items(): print(k, v)
