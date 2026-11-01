// G-12 (C2): advisers matter. Objective-success rate of "follow the best adviser" minus "follow the worst adviser",
// paired by seed. PASS: difference >= 10 points and bootstrap interval lower bound > 0.
//   node tools/phase5_g12.ts tune 200        -> TUNE seeds 1..200, every adviser; picks best and worst (no gate log)
//   node tools/phase5_g12.ts gate 50000 1000 -> sealed block, using the aliases recorded in results/g12_aliases.json
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import { createSim } from "../src/engine.ts";
import { GateLog, pairedBootstrap, wilson } from "../src/gates.ts";
import { gateKey } from "../src/batch.ts";
import type { PolicyId } from "../src/policies.ts";

const DAYS = 240;
const content = loadContent(new URL("../content/march/", import.meta.url).pathname);
const [mode, a, b] = process.argv.slice(2);

function arm(policy: PolicyId, seeds: number[], aliases: Record<string, string> = {}) {
  const met: boolean[] = [], ends: Record<string, number> = {};
  let followed = 0;
  for (const seed of seeds) {
    const sim = createSim({ content, seed, policy, policyAliases: aliases });
    sim.runDays(DAYS);
    const o = sim.objectiveStatus();
    met.push(o.met);
    if (o.ended) ends[o.ended] = (ends[o.ended] ?? 0) + 1;
    followed += sim.log.filter((e) => e.type === "PlayerInput" && e.payload.followed).length;
  }
  return { met, rate: met.filter(Boolean).length / met.length, ends, followedPerRun: followed / seeds.length };
}

const advisers = content.characters.filter((c) => c.tier === "A" && c.id !== content.scenario.ruler && ["adviser", "steward", "scholar"].includes(c.role)).map((c) => c.id);

if (mode === "tune") {
  const n = Number(a ?? 200), seeds = Array.from({ length: n }, (_, i) => 1 + i);
  const res: Record<string, ReturnType<typeof arm>> = {};
  for (const id of advisers) { res[id] = arm(`follow:${id}`, seeds); console.log(id, res[id].rate.toFixed(3), JSON.stringify(res[id].ends), res[id].followedPerRun.toFixed(1)); }
  const passive = arm("passive", seeds); console.log("passive", passive.rate.toFixed(3), JSON.stringify(passive.ends));
  const ranked = advisers.slice().sort((x, y) => res[y].rate - res[x].rate || (x < y ? -1 : 1));
  const aliases = { "follow-best-adviser": ranked[0], "follow-worst-adviser": ranked.at(-1)! };
  writeFileSync("results/g12_aliases.json", JSON.stringify({ tuneSeeds: `1..${n}`, rates: Object.fromEntries(advisers.map((x) => [x, res[x].rate])), passive: passive.rate, aliases }, null, 1) + "\n");
  console.log("aliases", JSON.stringify(aliases));
} else if (mode === "gate") {
  const block = Number(a), n = Number(b ?? 1000), seeds = Array.from({ length: n }, (_, i) => block + i);
  const { aliases } = JSON.parse(readFileSync("results/g12_aliases.json", "utf8"));
  const log = new GateLog("results/gate_log.jsonl"), cal = gateKey(content);
  log.claim(block, cal);
  const best = arm("follow-best-adviser", seeds, aliases), worst = arm("follow-worst-adviser", seeds, aliases);
  const diff = best.rate - worst.rate, { diffCi } = pairedBootstrap(best.met, worst.met);
  const verdict = diff >= 0.1 && diffCi[0] > 0 ? "PASS" : diff >= 0.1 || diffCi[0] > 0 ? "AMBER" : "FAIL";
  const row = { gate: "G-12", phase: 5, seedBlock: block, seeds: `${seeds[0]}..${seeds.at(-1)}`, calibrationHash: cal, contentVersion: content.version, aliases,
    best: { rate: best.rate, ci: wilson(best.met.filter(Boolean).length, n), ends: best.ends, followedPerRun: best.followedPerRun },
    worst: { rate: worst.rate, ci: wilson(worst.met.filter(Boolean).length, n), ends: worst.ends, followedPerRun: worst.followedPerRun },
    diff, diffCi, verdict, t: new Date().toISOString() };
  log.record(row);
  console.log(JSON.stringify(row));
} else throw new Error("usage: tune N | gate BLOCK N");
