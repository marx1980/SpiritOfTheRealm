"""Prototype of the plan's gate evaluator (C0 protocol), exercised on the Phase 0 toy.

- paired ON/OFF arms (same seeds, separate RNG streams)
- Wilson interval for proportions, paired bootstrap for difference and ratio
- three-state verdicts: PASS / AMBER / FAIL
- sealed seed block: every evaluation is appended to results/gate_log.jsonl

Throwaway like the rest of Phase 0. The real evaluator is a Phase 1 deliverable.
"""
import hashlib
import json
import math
import random
import sys
import time

import proto

LOG = "results/gate_log.jsonl"


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def band_verdict(point, ci, lo, hi):
    """PASS: CI inside band. AMBER: point inside, CI crosses an edge. FAIL: point outside."""
    if lo <= ci[0] and ci[1] <= hi:
        return "PASS"
    if lo <= point <= hi:
        return "AMBER"
    return "FAIL"


def flags(seeds, params):
    chain, end = [], []
    for s in seeds:
        log = proto.run_seed(s, params)["log"]
        chain.append(proto.full_chain(log))
        end.append(any(e["type"] == "VAROS_OPPORTUNITY" for e in log))
    return chain, end


def paired_bootstrap(on, off, B=2000, seed=0):
    n = len(on)
    rng = random.Random(seed)
    diffs, ratios = [], []
    for _ in range(B):
        idx = [rng.randrange(n) for _ in range(n)]
        a = sum(on[i] for i in idx) / n
        b = sum(off[i] for i in idx) / n
        diffs.append(a - b)
        ratios.append(a / b if b > 0 else 1e9)
    diffs.sort()
    ratios.sort()
    q = lambda xs, f: xs[int(f * B)]
    return (q(diffs, 0.025), q(diffs, 0.975)), (q(ratios, 0.025), q(ratios, 0.975))


def evaluate(label, overrides, seeds):
    P = proto.default_params()
    P.update(overrides)
    Poff = dict(P, p_threat_start=0.0)
    chain_on, end_on = flags(seeds, P)
    _, end_off = flags(seeds, Poff)
    n = len(seeds)
    on_rate, off_rate = sum(end_on) / n, sum(end_off) / n
    A = on_rate - off_rate
    (a_lo, a_hi), (r_lo, r_hi) = paired_bootstrap(end_on, end_off)
    ratio = on_rate / off_rate if off_rate > 0 else float("inf")
    g03 = band_verdict(A, (a_lo, a_hi), 0.05, 0.40)
    if ratio >= 1.5 and r_lo > 1.0:
        g04 = "PASS"
    elif ratio >= 1.5:
        g04 = "AMBER"
    else:
        g04 = "FAIL"
    labelled = sum(chain_on)
    res = dict(label=label, seeds=f"{seeds[0]}..{seeds[-1]}", n=n,
               labelled_chain_rate=round(labelled / n, 4), labelled_chain_ci=[round(x, 4) for x in wilson(labelled, n)],
               end_rate_on=round(on_rate, 4), end_rate_off=round(off_rate, 4),
               attributable_A=round(A, 4), A_ci=[round(a_lo, 4), round(a_hi, 4)], G03=g03,
               lift_ratio=round(ratio, 2) if ratio != float("inf") else "inf", ratio_ci_low=round(r_lo, 2), G04=g04,
               calibration_hash=hashlib.sha1(json.dumps(overrides, sort_keys=True).encode()).hexdigest()[:8])
    with open(LOG, "a") as f:
        f.write(json.dumps(dict(res, t=time.strftime("%Y-%m-%d %H:%M:%S"))) + "\n")
    return res


if __name__ == "__main__":
    seeds = proto.parse_seeds(sys.argv[1] if len(sys.argv) > 1 else "10000..10999")
    VAROS = dict(varos_grain_range=[30, 150], varos_theta=0.40)
    variants = [
        ("CAL (band calibration, D-002)", dict(VAROS, greyfen_use=10.5, coin_start=120.0, coin_upkeep=21.0)),
        ("ALT1 (use 9.75, upkeep 21, coin 120)", dict(VAROS, greyfen_use=9.75, coin_start=120.0, coin_upkeep=21.0)),
        ("ALT2 (use 9.0, upkeep 21, coin 120)", dict(VAROS, greyfen_use=9.0, coin_start=120.0, coin_upkeep=21.0)),
    ]
    out = []
    for label, over in variants:
        r = evaluate(label, over, seeds)
        out.append(r)
        print(f"{label}\n  labelled chain {100*r['labelled_chain_rate']:.1f}% {r['labelled_chain_ci']} | end-state on {100*r['end_rate_on']:.1f}% off {100*r['end_rate_off']:.1f}%"
              f"\n  attributable A = {100*r['attributable_A']:.1f}% CI [{100*r['A_ci'][0]:.1f}, {100*r['A_ci'][1]:.1f}] -> G-03 {r['G03']}"
              f"\n  lift ratio {r['lift_ratio']} (CI low {r['ratio_ci_low']}) -> G-04 {r['G04']}")
    json.dump(out, open("results/gate_check_sealed_10000.json", "w"), indent=2)
