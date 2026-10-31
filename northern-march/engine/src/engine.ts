// Event-sourced simulation core (A1-A3, A6, A7). The log is the source of truth; WorldState is its projection.
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import type { Content } from "./content.ts";
import { ABLATABLE, EVENT_SCHEMA_VERSION, EVENT_TYPES, type SimEvent, type SubjectRef, type SystemId } from "./events.ts";
import { POLICIES, type PlayerAction, type PolicyId } from "./policies.ts";
import { Rng } from "./rng.ts";
import { migrateSave, SAVE_SCHEMA_VERSION, type InputRecord, type SaveFile } from "./save.ts";
import { Scheduler } from "./scheduler.ts";
import { economy, makePlayer, messenger, threat, weather } from "./systems/testbed.ts";
import { DAY, type Ctx, type SimParams, type System } from "./systems/types.ts";
import { buildView, type View } from "./view.ts";
import { applyEvent, initialState, type WorldState } from "./world.ts";

export { SAVE_SCHEMA_VERSION };
export const TICKS_PER_DAY = DAY;
export type { SimParams };

export interface SimConfig {
  content: Content;
  seed: number;
  policy: PolicyId;
  params?: SimParams;
  ablate?: SystemId[];
  replay?: { inputs: InputRecord[]; decisions: number };
}

export function hashLog(log: readonly SimEvent[]): string {
  const h = createHash("sha256");
  for (const e of log) h.update(canonicalJson(e) + "\n", "utf8");
  return h.digest("hex");
}

export interface DecisionObservation { tick: number; staleBelief: boolean; wrongBelief: boolean }

export class Sim {
  readonly log: SimEvent[] = [];
  tick = 0;
  policyId: PolicyId;
  readonly seed: number;
  readonly content: Content;
  readonly cfg: SimConfig;
  readonly decisionsObserved: DecisionObservation[] = [];
  private state: WorldState;
  private sched = new Scheduler();
  private systems = new Map<SystemId, System>();
  private disabled: Set<SystemId>;
  private streams = new Map<string, Rng>();
  private keyedStreams: { name: string; rng: Rng }[] = [];
  private decideCount = 0;
  private handlersRun = 0;
  private ctx: Ctx;
  private routeCache = new Map<string, number>();

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.seed = cfg.seed;
    this.content = cfg.content;
    this.policyId = cfg.replay ? "replay" : cfg.policy;
    if (cfg.policy !== "replay" && !POLICIES[cfg.policy]) throw new Error(`unknown policy ${cfg.policy}`);
    if (cfg.policy !== "replay" && !POLICIES[cfg.policy].fn) throw new Error(`policy ${cfg.policy}: ${POLICIES[cfg.policy].note}`);
    for (const a of cfg.ablate ?? []) if (!ABLATABLE.includes(a)) throw new Error(`unknown system ${a} (ablatable: ${ABLATABLE.join(", ")})`);
    this.disabled = new Set(cfg.ablate ?? []);
    this.state = initialState(cfg.content);
    this.ctx = this.makeCtx();
    for (const s of [economy, weather, threat, messenger, makePlayer((ctx, d) => this.decide(ctx, d))]) this.systems.set(s.id, s);
    this.emit("ScenarioStarted", [], [], { contentVersion: cfg.content.version, seed: cfg.seed });
    for (const s of this.systems.values()) if (!this.disabled.has(s.id)) s.start(this.ctx);
  }

  // ---- boundary (A7) --------------------------------------------------------
  get world(): never {
    throw new Error("WorldState is not readable outside the simulation: use ViewOf(agent | player)");
  }
  viewOf(who: "player" | string): View {
    return buildView(this.state, who === "player" ? this.content.scenario.ruler : who, this.tick);
  }
  /** Debug inspectors and tests only. Never from presentation or planners. */
  unsafeWorldForDebug(): WorldState {
    return structuredClone(this.state);
  }
  projectFromLog(): WorldState {
    const s = initialState(this.content);
    for (const e of this.log) applyEvent(s, e);
    return s;
  }

  // ---- running ----------------------------------------------------------------
  runUntil(t: number): void {
    if (!Number.isSafeInteger(t) || t < this.tick) throw new Error(`bad target tick ${t}`);
    for (;;) {
      const next = this.sched.peekTick();
      if (next === undefined || next >= t) break;
      const item = this.sched.pop()!;
      this.tick = item.tick;
      const sys = item.handler.split(":")[0] as SystemId;
      const fn = this.systems.get(sys)?.handlers[item.handler];
      if (!fn) throw new Error(`no handler ${item.handler}`);
      this.handlersRun++;
      fn(this.ctx, item.args);
    }
    this.tick = t;
  }
  runDays(n: number): void {
    this.runUntil(this.tick + n * DAY);
  }

  stats() {
    return { handlersRun: this.handlersRun, events: this.log.length };
  }
  streamsCreated(): string[] {
    return [...this.streams.keys(), ...this.keyedStreams.map((k) => k.name)];
  }
  rngDraws(): Record<string, number> {
    const out: Record<string, number> = {};
    const add = (name: string, n: number) => { const sys = name.split(":")[0]; out[sys] = (out[sys] ?? 0) + n; };
    for (const [n, r] of this.streams) add(n, r.draws);
    for (const k of this.keyedStreams) add(k.name, k.rng.draws);
    return out;
  }

  // ---- save / load (A1, A4) --------------------------------------------------------
  save(): SaveFile {
    const inputs: InputRecord[] = this.log.filter((e) => e.type === "PlayerInput").map((e) => ({
      decision: e.payload.decision as number, tick: e.tick, action: e.payload.action as "repair" | "levy", target: (e.payload.target as string | null) ?? null,
    }));
    const rngStates: SaveFile["rngStates"] = {};
    for (const [n, r] of [...this.streams].sort(([a], [b]) => (a < b ? -1 : 1))) rngStates[n] = { state: r.getState(), draws: r.draws };
    return {
      schemaVersion: SAVE_SCHEMA_VERSION, contentVersion: this.content.version, contentHash: this.content.hash,
      seed: this.seed, policy: this.cfg.replay ? (this.resumePolicy ?? "passive") : this.cfg.policy,
      params: this.cfg.params ?? {}, ablate: [...(this.cfg.ablate ?? [])],
      tick: this.tick, decisions: this.decideCount, inputs, rngStates, logHash: hashLog(this.log), eventCount: this.log.length,
    };
  }
  resumePolicy?: PolicyId;
  restoreStream(name: string, st: { state: [number, number, number, number]; draws: number }) {
    const r = Rng.fromState(st.state);
    r.draws = st.draws;
    this.streams.set(name, r);
  }
  compareStream(name: string, st: { state: [number, number, number, number] }): boolean {
    const r = this.streams.get(name);
    return !!r && r.getState().every((v, i) => v === st.state[i]);
  }

  // ---- internals ---------------------------------------------------------------------
  private decide(ctx: Ctx, deliveredEventId: number): PlayerAction[] {
    const n = this.decideCount++;
    let actions: PlayerAction[];
    const rp = this.cfg.replay;
    if (rp && n < rp.decisions) {
      const recs = rp.inputs.filter((i) => i.decision === n);
      for (const r of recs) if (r.tick !== ctx.tick) throw new Error(`replay diverged: decision ${n} recorded at ${r.tick}, reached at ${ctx.tick}`);
      actions = recs.map((r) => (r.action === "levy" ? { action: "levy" } : { action: "repair", target: r.target! }));
    } else {
      const pol = rp ? this.resumePolicy! : this.cfg.policy;
      const fn = POLICIES[pol as Exclude<PolicyId, "replay">].fn!;
      const view = buildView(this.state, this.content.scenario.ruler, ctx.tick);
      actions = fn(view, () => ctx.rng("player"));
      for (const a of actions) {
        if (a.action !== "repair" || !a.target) continue;
        const b = view.beliefs[`${a.target}:condition`], truth = this.state.fortifications[a.target]?.conditionMilli;
        if (b && truth !== undefined)
          this.decisionsObserved.push({ tick: ctx.tick, staleBelief: ctx.tick - b.observedAt > 10 * DAY, wrongBelief: Math.abs(b.value - truth) > 5000 });
      }
    }
    return actions.map((a) => ({ ...a, decision: n }));
  }

  private emit(type: string, causedBy: number[], subjects: SubjectRef[], payload: Record<string, unknown>, rngStream?: string): SimEvent {
    const def = EVENT_TYPES[type];
    if (!def) throw new Error(`unregistered event type ${type}`);
    if (this.disabled.has(def.system)) throw new Error(`ablated system ${def.system} tried to emit ${type}`);
    const id = this.log.length + 1;
    for (const c of causedBy) if (!Number.isSafeInteger(c) || c < 1 || c >= id) throw new Error(`${type}: cause ${c} is not an earlier event`);
    if (!causedBy.length && !def.root) throw new Error(`${type} needs a cause`);
    const e: SimEvent = { schemaVersion: EVENT_SCHEMA_VERSION, id, tick: this.tick, type, domain: def.domain, significance: def.significance, causedBy: [...causedBy], subjects, payload };
    if (rngStream) e.rngStream = rngStream;
    canonicalJson(e); // integers only (A2)
    applyEvent(this.state, e);
    this.log.push(e);
    return e;
  }

  private stream(name: string): Rng {
    const sys = name.split(":")[0] as SystemId;
    if (this.disabled.has(sys)) throw new Error(`ablated system ${sys} tried to draw from ${name}`);
    let r = this.streams.get(name);
    if (!r) { r = Rng.fromSeed(this.seed, name); this.streams.set(name, r); }
    return r;
  }

  private travel(from: string, to: string): number {
    const key = `${from}>${to}`;
    const hit = this.routeCache.get(key);
    if (hit !== undefined) return hit;
    const dist = new Map<string, number>([[from, 0]]), done = new Set<string>();
    for (;;) {
      let cur: string | undefined, best = Infinity;
      for (const [k, d] of [...dist].sort(([a], [b]) => (a < b ? -1 : 1))) if (!done.has(k) && d < best) { best = d; cur = k; }
      if (cur === undefined) throw new Error(`no route ${from} -> ${to}`);
      if (cur === to) break;
      done.add(cur);
      for (const r of this.content.routes) {
        const n = r.from === cur ? r.to : r.to === cur ? r.from : null;
        if (n && !done.has(n) && best + r.travelTicks < (dist.get(n) ?? Infinity)) dist.set(n, best + r.travelTicks);
      }
    }
    this.routeCache.set(key, dist.get(to)!);
    return dist.get(to)!;
  }

  private makeCtx(): Ctx {
    const self = this;
    return {
      get tick() { return self.tick; },
      seed: this.seed,
      content: this.content,
      get s() { return self.state; },
      params: this.cfg.params ?? {},
      emit: (t, c, sub, p, st) => self.emit(t, c, sub, p, st),
      at: (tick, handler, args) => { if (!self.disabled.has(handler.split(":")[0] as SystemId)) self.sched.push(tick, handler, args); },
      rng: (name) => self.stream(name),
      keyed: (name) => {
        const sys = name.split(":")[0] as SystemId;
        if (self.disabled.has(sys)) throw new Error(`ablated system ${sys} tried to draw from ${name}`);
        const rng = Rng.fromSeed(self.seed, name);
        self.keyedStreams.push({ name, rng });
        return rng;
      },
      enabled: (sys) => !self.disabled.has(sys),
      travelTicks: (a, b) => self.travel(a, b),
      observe: () => {},
      extraDraws: (sys) => { const n = self.cfg.params?.extraDraws?.[sys] ?? 0; for (let i = 0; i < n; i++) self.stream(sys).u32(); },
    };
  }
}

export function createSim(cfg: SimConfig): Sim {
  return new Sim(cfg);
}

export function loadSave(raw: unknown, content: Content): Sim {
  const s = migrateSave(raw as Record<string, unknown>);
  if (s.contentVersion !== content.version) throw new Error(`content version mismatch: save ${s.contentVersion}, loaded ${content.version}`);
  if (s.contentHash !== content.hash) throw new Error("content hash mismatch: same version label, different data");
  const sim = new Sim({ content, seed: s.seed, policy: "replay", params: s.params, ablate: s.ablate, replay: { inputs: s.inputs, decisions: s.decisions } });
  sim.resumePolicy = s.policy;
  sim.runUntil(s.tick);
  if (hashLog(sim.log) !== s.logHash) throw new Error("log hash mismatch: the save does not replay to the same log");
  for (const [name, st] of Object.entries(s.rngStates)) {
    if (name === "player") sim.restoreStream(name, st); // the replayed run used recorded inputs, not the player stream
    else if (!sim.compareStream(name, st)) throw new Error(`rng state mismatch for stream ${name}`);
  }
  return sim;
}
