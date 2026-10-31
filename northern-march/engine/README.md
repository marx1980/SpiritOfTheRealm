# Northern March engine

Run with Node 22.18+ (TypeScript runs directly; no build step).

    npm install            # dev types only
    npm test               # 57 tests
    npx tsc -p .           # type check
    node src/cli.ts g01 --seeds 1..100          # determinism hash
    node src/cli.ts run --seeds 1..1000 --policy delegating --ablate threat --out results/off
    node src/cli.ts gate --block 20000 --n 1000 # sealed-block causal gate (refuses reuse)
    node src/cli.ts inspect --seed 3 --event 500
    node src/cli.ts validate content/testbed
