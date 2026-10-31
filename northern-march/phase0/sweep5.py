import sys
import proto
from sweep import run

tune = proto.parse_seeds("1..300")
base = dict(greyfen_use=10.5, coin_start=120.0, coin_upkeep=21.0)
run("cal-a: base + grain range 30-150", {**base, "varos_grain_range": [30, 150]}, tune)
run("cal-b: base + theta 0.40", {**base, "varos_theta": 0.40}, tune)
CAL = {**base, "varos_grain_range": [30, 150], "varos_theta": 0.40}
run("cal-c: base + grain + theta (CHOSEN)", CAL, tune)
