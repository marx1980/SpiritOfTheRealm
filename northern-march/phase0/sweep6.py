"""Is there a region where the Blackwood threat has a real marginal effect on Varos moves?"""
import itertools, json
import proto

VAROS = dict(varos_grain_range=[30, 150], varos_theta=0.40)
seeds = proto.parse_seeds("1..300")
rows = []
print(f"{'use':>5} {'upkeep':>6} {'coin0':>5} | {'chain%':>6} {'varos ON':>8} {'varos OFF':>9} {'delta':>6} | {'req ON':>6} {'req OFF':>7}")
for use, up, coin in itertools.product([9.0, 9.75, 10.5], [18.0, 19.5, 21.0], [120.0, 250.0]):
    P = proto.default_params(); P.update(VAROS, greyfen_use=use, coin_upkeep=up, coin_start=coin)
    on = proto.batch(seeds, P)
    off = proto.batch(seeds, dict(P, p_threat_start=0.0))
    d = on["any_root_pct"]["VAROS_OPPORTUNITY"] - off["any_root_pct"]["VAROS_OPPORTUNITY"]
    rows.append(dict(use=use, upkeep=up, coin0=coin, chain=on["chain_pct"], varos_on=on["any_root_pct"]["VAROS_OPPORTUNITY"],
                     varos_off=off["any_root_pct"]["VAROS_OPPORTUNITY"], delta=round(d, 1),
                     req_on=on["any_root_pct"]["REQUISITION"], req_off=off["any_root_pct"]["REQUISITION"]))
    r = rows[-1]
    print(f"{use:5} {up:6} {coin:5} | {r['chain']:6.1f} {r['varos_on']:8.1f} {r['varos_off']:9.1f} {r['delta']:6.1f} | {r['req_on']:6.1f} {r['req_off']:7.1f}")
json.dump(rows, open("results/marginal_effect_grid.json", "w"), indent=2)
