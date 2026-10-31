"""Where does the chain break? Diagnostics over a seed range (not part of the prototype)."""
import sys, statistics as st
import proto

def diag(seeds, params=None):
    P = params or proto.default_params()
    rows = dict(threat=0, min_tg_after_threat=[], tg_at_threat=[], shortage_thr=0, shortage_any=0,
                wall_low=0, risk=0, risk_thr=0, choices={}, vetoes=0, req=0, griev=0, griev_G=[], req_G=[])
    for s in seeds:
        out = proto.run_seed(s, P)
        log, tr = out["log"], out["traces"]
        types = [e["type"] for e in log]
        if "THREAT" in types:
            rows["threat"] += 1
            t0 = next(e for e in log if e["type"] == "THREAT")
            tg = [t["true_tg"] for t in tr if t["agent"] == "Oren" and t.get("routine") and t["day"] >= t0["day"]]
            if tg: rows["min_tg_after_threat"].append(min(tg))
        rows["shortage_any"] += "SHORTAGE" in types
        rows["wall_low"] += "WALL_LOW" in types
        rows["risk"] += "REPAIR_RISK" in types
        for t in tr:
            if t["agent"] == "Oren" and not t.get("routine"):
                rows["choices"][t["selected"]] = rows["choices"].get(t["selected"], 0) + 1
                rows["vetoes"] += bool(t.get("elara_veto"))
        rows["req"] += "REQUISITION" in types
        for e in log:
            if e["type"] == "GRIEVANCE": rows["griev"] += 1
    return rows

if __name__ == "__main__":
    seeds = proto.parse_seeds(sys.argv[1]) if len(sys.argv) > 1 else list(range(1, 201))
    r = diag(seeds)
    n = len(seeds)
    print(f"seeds={n} with_threat={r['threat']} shortage_any={r['shortage_any']} wall_low_seeds={r['wall_low']} risk_seeds={r['risk']} req_seeds={r['req']}")
    m = r["min_tg_after_threat"]
    if m: print("Greyfen min stock at routine buys after threat start: median %.0f, p10 %.0f, min %.0f" % (st.median(m), sorted(m)[len(m)//10], min(m)))
    print("Oren choices on repair reports:", r["choices"], "Elara vetoes:", r["vetoes"])
    print("grievance events:", r["griev"])
