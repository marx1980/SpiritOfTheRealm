import sys, itertools
import proto
from sweep import run

seeds = proto.parse_seeds(sys.argv[1] if len(sys.argv) > 1 else "1..300")
for use, wg, th in itertools.product([9.0, 10.5], [0.6, 0.4, 0.25], [0.45, 0.38]):
    run(f"use={use} w_griev={wg} theta={th}", dict(greyfen_use=use, w_griev=wg, varos_theta=th), seeds)
