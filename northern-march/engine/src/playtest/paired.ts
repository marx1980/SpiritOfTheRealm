// L6: paired evaluation. Baseline and candidate play identical (seed, persona) tuples; the candidate differs only by
// bounded parameter changes (content patches). Results are sealed as immutable packages (hashed, read-only files).
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pairedBootstrap } from "../gates.ts";
import { readSummaries, runLab, type LabOptions, type Patch, type Summary } from "./lab.ts";
import type { PlaytestRunManifest } from "./contract.ts";

/** Seal a finished run set: hash every file, write package.json, make the files read-only. */
export function sealPackage(dir: string, extra: Record<string, unknown> = {}) {
  const files = ["manifest.json", "records.jsonl", "summaries.jsonl", "state.json"].filter((f) => existsSync(`${dir}/${f}`));
  const hashes = Object.fromEntries(files.map((f) => [f, createHash("sha256").update(readFileSync(`${dir}/${f}`)).digest("hex")]));
  writeFileSync(`${dir}/package.json`, JSON.stringify({ sealed: true, files: hashes, ...extra }, null, 1));
  for (const f of [...files, "package.json"]) chmodSync(`${dir}/${f}`, 0o444);
  return hashes;
}
export function verifyPackage(dir: string): string[] {
  const p = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { files: Record<string, string> };
  return Object.entries(p.files).filter(([f, h]) => createHash("sha256").update(readFileSync(`${dir}/${f}`)).digest("hex") !== h).map(([f]) => `${f} changed after sealing`);
}

export function compare(base: Summary[], cand: Summary[]) {
  if (base.length !== cand.length || base.some((b, i) => b.seed !== cand[i].seed || b.persona !== cand[i].persona)) throw new Error("arms are not paired tuple by tuple");
  const personas = [...new Set(base.map((s) => s.persona))];
  const row = (pick: (s: Summary) => boolean) => {
    const on = cand.filter(pick), off = base.filter(pick);
    const met = pairedBootstrap(on.map((s) => s.objectiveMet), off.map((s) => s.objectiveMet), 2000, 7);
    const sup = pairedBootstrap(on.map((s) => Object.values(s.topStance).includes("support")), off.map((s) => Object.values(s.topStance).includes("support")), 2000, 7);
    const r = (k: number) => Math.round(1000 * k) / 10, rate = (xs: Summary[], f: (s: Summary) => boolean) => r(xs.filter(f).length / Math.max(1, xs.length));
    const diverged = on.filter((s, i) => s.logHash !== off[i].logHash).length;
    return { games: on.length, diverged, objectiveMet: { base: rate(off, (s) => s.objectiveMet), cand: rate(on, (s) => s.objectiveMet), diffCi: met.diffCi.map(r) },
      varosFollowing: { base: rate(off, (s) => Object.values(s.topStance).includes("support")), cand: rate(on, (s) => Object.values(s.topStance).includes("support")), diffCi: sup.diffCi.map(r) },
      newFailures: { base: off.filter((s) => s.newFailures).length, cand: on.filter((s) => s.newFailures).length } };
  };
  return { all: row(() => true), perPersona: Object.fromEntries(personas.map((p) => [p, row((s) => s.persona === p)])) };
}

/** Run baseline and candidate on the same tuples (dev or validation partition only: sealed data is never feedback). */
export async function pairedExperiment(base: PlaytestRunManifest, patch: Patch[], dir: string, o: Omit<LabOptions, "outDir"> = {}) {
  if (base.partition === "sealed") throw new Error("paired experiments may not use sealed data (v4 data partitions)");
  const b = await runLab({ ...base, mode: "paired", runSetId: `${base.runSetId}-base` }, { ...o, outDir: `${dir}/base` });
  const c = await runLab({ ...base, mode: "paired", runSetId: `${base.runSetId}-cand`, params: { ...base.params, contentPatch: [...((base.params.contentPatch as Patch[]) ?? []), ...patch] } }, { ...o, outDir: `${dir}/cand` });
  const result = { patch, base: b, cand: c, comparison: compare(readSummaries(`${dir}/base`), readSummaries(`${dir}/cand`)) };
  writeFileSync(`${dir}/comparison.json`, JSON.stringify(result, null, 1));
  return result;
}
