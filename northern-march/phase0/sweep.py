"""Logged parameter sweeps. Every run is appended to results/sweep_log.jsonl (nothing is hidden)."""
import json, sys, time
import proto

LOG = "results/sweep_log.jsonl"

def run(label, overrides, seeds):
    P = proto.default_params()
    P.update(overrides)
    r = proto.batch(seeds, P)
    row = dict(label=label, overrides=overrides, seeds=f"{seeds[0]}..{seeds[-1]}", n=r["n"],
               chain_pct=r["chain_pct"], funnel=r["funnel_pct"], t=time.strftime("%H:%M:%S"))
    with open(LOG, "a") as f:
        f.write(json.dumps(row) + "\n")
    f = r["funnel_pct"]
    print(f"{label:34s} chain={r['chain_pct']:5.1f}%  thr={f['THREAT']:5.1f} short={f['SHORTAGE']:5.1f} "
          f"risk={f['REPAIR_RISK']:5.1f} req={f['REQUISITION']:5.1f} griev={f['GRIEVANCE']:5.1f} varos={f['VAROS_OPPORTUNITY']:5.1f}")
    return row

if __name__ == "__main__":
    seeds = proto.parse_seeds(sys.argv[1] if len(sys.argv) > 1 else "1..300")
    run("baseline", {}, seeds)
    for k, vals in [("greyfen_use", [9.0, 10.5, 11.5]), ("greyfen_cap", [250.0, 200.0]),
                    ("p_storm", [0.04]), ("fear_factor", [1.0]), ("crown_maint", [1.8]),
                    ("g_min", [300.0]), ("elara_alarm", [50.0]), ("varos_theta", [0.38]),
                    ("p_threat_start", [0.012])]:
        for v in vals:
            run(f"{k}={v}", {k: v}, seeds)
