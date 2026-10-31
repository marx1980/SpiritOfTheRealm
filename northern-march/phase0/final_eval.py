"""Final evaluation of the chosen Phase 0 calibration. Writes results/final_eval.json."""
import json
import proto
from sweep import run

CAL = dict(greyfen_use=10.5, coin_start=120.0, coin_upkeep=21.0, varos_grain_range=[30, 150], varos_theta=0.40)
out = {"calibration": CAL}

def P_of(over):
    P = proto.default_params(); P.update(over); return P

print("== Gate and holdouts (calibrated) ==")
for name, spec in [("gate seeds 1-100", "1..100"), ("holdout A 1001-1200", "1001..1200"), ("holdout B 2001-2400", "2001..2400")]:
    r = proto.batch(proto.parse_seeds(spec), P_of(CAL))
    out[name] = r
    print(f"{name:22s} chain={r['chain_pct']:5.1f}% ({r['chain_count']}/{r['n']})  funnel={r['funnel_pct']}")
    run("FINAL " + name, CAL, proto.parse_seeds(spec))

print("\n== Baseline (uncalibrated) on the same gate seeds ==")
r = proto.batch(proto.parse_seeds("1..100"), proto.default_params())
out["uncalibrated gate seeds 1-100"] = r
print(f"chain={r['chain_pct']}%")

print("\n== Threat-off control (calibrated, seeds 1-300) ==")
ctrl = proto.batch(proto.parse_seeds("1..300"), P_of({**CAL, "p_threat_start": 0.0}))
out["threat_off_control"] = ctrl
print("chain=%s%%  any-root requisition=%s%% grievance=%s%% varos=%s%%" % (
    ctrl["chain_pct"], ctrl["any_root_pct"]["REQUISITION"], ctrl["any_root_pct"]["GRIEVANCE"], ctrl["any_root_pct"]["VAROS_OPPORTUNITY"]))

print("\n== Sensitivity (+/-25%, seeds 1-300) ==")
sens = {}
for k in ["greyfen_use", "coin_start", "coin_upkeep", "varos_theta", "p_threat_start", "p_storm", "cut_rate", "fear_factor", "w_griev", "elara_alarm", "p_rumor_reach"]:
    base = P_of(CAL)[k]
    row = {}
    for f in (0.75, 1.25):
        v = round(base * f, 4)
        r = proto.batch(proto.parse_seeds("1..300"), P_of({**CAL, k: v}))
        row[str(v)] = r["chain_pct"]
    sens[k] = row
    print(f"{k:16s} base={base:<7} -> {row}")
out["sensitivity_pm25"] = sens
json.dump(out, open("results/final_eval.json", "w"), indent=2)
