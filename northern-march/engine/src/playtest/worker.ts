// L4 worker thread: loads the content once (with the candidate's patch, if any), then plays the tuples it is sent.
import { parentPort, workerData } from "node:worker_threads";
import { labContent } from "./lab.ts";
import { playGame } from "./runner.ts";
import type { Persona } from "./contract.ts";

const { contentDir, patch, days, runSetId, sim } = workerData as { contentDir: string; patch: { path: string; value: unknown }[]; days: number; runSetId: string; sim: Record<string, unknown> };
const content = labContent(contentDir, patch);
parentPort!.on("message", (m: { tupleIndex: number; seed: number; persona: Persona } | "stop") => {
  if (m === "stop") return process.exit(0);
  try {
    const { record } = playGame({ content, seed: m.seed, persona: m.persona, days, runSetId, tupleIndex: m.tupleIndex, params: sim });
    parentPort!.postMessage({ tupleIndex: m.tupleIndex, record });
  } catch (e) {
    parentPort!.postMessage({ tupleIndex: m.tupleIndex, error: String((e as Error).stack ?? e).slice(0, 2000) });
  }
});
