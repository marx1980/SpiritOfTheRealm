"""Phase 0b gate tooling: paired ON/OFF arms x player policies, TUNE vs sealed GATE mode (plan C0)."""
import hashlib, json, sys, time
from multiprocessing import Pool
import proto_b
from gate_check import wilson, band_verdict, paired_bootstrap

LOG = "results/gate_log.jsonl"
POLICIES = ("passive", "delegating", "aggressive")
BASE = dict(greyfen_use=10.5, coin_start=120.0, coin_upkeep=21.0, varos_grain_range=[30, 150], varos_theta=0.40)


def _one(args):
    s, P = args
    log = proto_b.run_seed(s, P)["log"]
    return int(proto_b.full_chain(log)), int(any(e["type"] == "VAROS_OPPORTUNITY" for e in log))


def arm(seeds, P, pool):
    res = pool.map(_one, [(s, P) for s in seeds], chunksize=50)
    return [r[0] for r in res], [r[1] for r in res]


def calib_hash(over):
    """Hash of the FULL parameter set (defaults + overrides), policy excluded. Hashing only the
    overrides (the first version) gave Phase 0b the same hash as Phase 0's CAL: see DECISIONS D-008."""
    P = proto_b.default_params(); P.update(over); P.pop("anna_policy", None)
    return hashlib.sha1(json.dumps(P, sort_keys=True).encode()).hexdigest()[:8]


def evaluate(over, seeds, pool, policies=POLICIES, boot=True):
    out = {}
    for pol in policies:
        P = proto_b.default_params(); P.update(BASE); P.update(over); P["anna_policy"] = pol
        chain, on = arm(seeds, P, pool)
        _, off = arm(seeds, dict(P, p_threat_start=0.0), pool)
        n = len(seeds); ron, roff = sum(on) / n, sum(off) / n
        r = dict(n=n, chain=sum(chain) / n, on=ron, off=roff, A=ron - roff,
                 lift=(ron / roff if roff else float("inf")))
        if boot:
            (alo, ahi), (rlo, _) = paired_bootstrap(on, off)
            r.update(A_ci=[alo, ahi], lift_ci_low=rlo, G03=band_verdict(r["A"], (alo, ahi), 0.05, 0.40),
                     G04=("PASS" if r["lift"] >= 1.5 and rlo > 1.0 else "AMBER" if r["lift"] >= 1.5 else "FAIL"))
        out[pol] = r
    return out


def policy_rule(res, key):
    v = [r[key] for r in res.values()]
    if "FAIL" in v:
        return "FAIL"
    return "PASS" if v.count("PASS") >= 2 else "AMBER"


def gate(over, block_start, pool, label, n=1000):
    assert block_start >= 10000 and block_start % 10000 == 0, "GATE blocks only"
    h = calib_hash(dict(BASE, **over))
    try:
        for line in open(LOG):
            row = json.loads(line)
            if row.get("seed_block") == block_start and row.get("calibration_hash") == h:
                raise SystemExit(f"block {block_start} already used for calibration {h}")
    except FileNotFoundError:
        pass
    seeds = list(range(block_start, block_start + n))
    res = evaluate(over, seeds, pool)
    row = dict(label=label, phase="0b", seed_block=block_start, n=n, calibration_hash=h, overrides=over,
               per_policy=res, G03=policy_rule(res, "G03"), G04=policy_rule(res, "G04"),
               t=time.strftime("%Y-%m-%d %H:%M:%S"))
    with open(LOG, "a") as f:
        f.write(json.dumps(row) + "\n")
    return row
