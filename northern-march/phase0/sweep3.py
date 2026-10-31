import sys, itertools
import proto
from sweep import run

seeds = proto.parse_seeds(sys.argv[1] if len(sys.argv) > 1 else "1..300")
for use, coin, up in itertools.product([9.0, 10.5], [400.0, 200.0, 120.0], [18.0, 21.0]):
    run(f"use={use} coin0={coin} upkeep={up}", dict(greyfen_use=use, coin_start=coin, coin_upkeep=up), seeds)
