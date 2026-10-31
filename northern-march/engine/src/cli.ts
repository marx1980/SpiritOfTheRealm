#!/usr/bin/env node
// Headless CLI: run | g01 | validate | gate | inspect | timeline
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { loadContent, readContentDir, validateContent } from "./content.ts";
import { createSim, hashLog } from "./engine.ts";
import { sha256 } from "./canonical.ts";
import { runBatch, calibrationHash } from "./batch.ts";
import { evaluateCausalGate, GateLog, policyRuleDetail } from "./gates.ts";
import { ancestry, timeline } from "./inspect.ts";
import type { SystemId } from "./events.ts";
import type { PolicyId } from "./policies.ts";

const DEFAULT_CONTENT = new URL("../content/march/", import.meta.url).pathname;
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, dflt?: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const seedsOf = (spec: string) => {
  const [a, b] = spec.split("..").map(Number);
  return b === undefined ? spec.split(",").map(Number) : Array.from({ length: b - a + 1 }, (_, i) => a + i);
};
const content = () => loadContent(opt("content", DEFAULT_CONTENT)!);

switch (cmd) {
  case "validate": {
    const { errors } = validateContent(readContentDir(rest[0] ?? DEFAULT_CONTENT));
    for (const e of errors) console.log(`${e.code}: ${e.msg}`);
    console.log(errors.length ? `INVALID (${errors.length} errors)` : "valid");
    process.exit(errors.length ? 1 : 0);
  }
  case "g01": {
    const c = content(), days = Number(opt("days", "240"));
    const hashes = seedsOf(opt("seeds", "1..100")!).map((seed) => {
      const s = createSim({ content: c, seed, policy: (opt("policy", "delegating") as PolicyId) });
      s.runDays(days);
      const h = hashLog(s.log);
      if (rest.includes("--verbose")) console.log(seed, h);
      return h;
    });
    console.log(`combined ${sha256(hashes.join("\n"))}`);
    break;
  }
  case "run": {
    const c = content(), out = opt("out", "results/run")!;
    const ablate = (opt("ablate")?.split(",").filter(Boolean) ?? []) as SystemId[];
    mkdirSync(out, { recursive: true });
    const file = `${out}/metrics.jsonl`;
    writeFileSync(file, "");
    const rows = runBatch({ content: c, seeds: seedsOf(opt("seeds", "1..100")!), days: Number(opt("days", "240")), policy: opt("policy", "delegating") as PolicyId, ablate },
      (row) => appendFileSync(file, JSON.stringify(row) + "\n"));
    console.log(`${rows.length} rows -> ${file}`);
    break;
  }
  case "gate": {
    // Causal gate on the testbed's end state (fortificationBreached), threat ON vs OFF, per policy (C0).
    const c = content(), block = Number(opt("block")), n = Number(opt("n", "1000")), days = Number(opt("days", "240"));
    const policies = (opt("policies", "passive,delegating,aggressive,random-valid")!).split(",") as PolicyId[];
    const log = new GateLog(opt("log", "results/gate_log.jsonl")!);
    const cal = calibrationHash(c);
    log.claim(block, cal);
    const seeds = Array.from({ length: n }, (_, i) => block + i);
    const per: Record<string, ReturnType<typeof evaluateCausalGate>> = {}, logHashes: Record<string, string[]> = {};
    for (const policy of policies) {
      const on = runBatch({ content: c, seeds, days, policy }), off = runBatch({ content: c, seeds, days, policy, ablate: ["threat"] });
      per[policy] = evaluateCausalGate(on.map((r) => r.endStateFlags.fortificationBreached), off.map((r) => r.endStateFlags.fortificationBreached));
      logHashes[policy] = on.map((r) => r.logHash);
    }
    const differ = (a: string, b: string) => logHashes[a].filter((h, i) => h !== logHashes[b][i]).length >= 0.1 * n;
    const g03 = policyRuleDetail(per, "G03", differ), g04 = policyRuleDetail(per, "G04", differ);
    const row = { gate: "causal(fortificationBreached, threat)", seedBlock: block, n, calibrationHash: cal, contentVersion: c.version, perPolicy: per, G03: g03, G04: g04, t: new Date().toISOString() };
    log.record(row);
    console.log(JSON.stringify(row, null, 2));
    break;
  }
  case "inspect": {
    const s = createSim({ content: content(), seed: Number(opt("seed", "1")), policy: opt("policy", "delegating") as PolicyId });
    s.runDays(Number(opt("days", "240")));
    console.log(ancestry(s.log, Number(opt("event", String(s.log.length)))));
    break;
  }
  case "timeline": {
    const s = createSim({ content: content(), seed: Number(opt("seed", "1")), policy: opt("policy", "delegating") as PolicyId });
    s.runDays(Number(opt("days", "240")));
    console.log(timeline(s.log, opt("types")?.split(",")));
    break;
  }
  default:
    console.log("usage: cli.ts run|g01|validate|gate|inspect|timeline [--seeds a..b] [--days D] [--policy P] [--ablate sys] [--out dir]");
    process.exit(cmd ? 1 : 0);
}
