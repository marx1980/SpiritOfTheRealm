// Event-sourced simulation core (A1-A3, A6, A7). The log is the source of truth; WorldState is its projection.
import { canonicalJson, sha256 } from "./canonical.ts";
import type { Content } from "./content.ts";
import { ABLATABLE, EVENT_SCHEMA_VERSION, EVENT_TYPES, type SimEvent, type SubjectRef, type SystemId } from "./events.ts";
import { POLICIES, policyFn, type PlayerAction, type PolicyId } from "./policies.ts";
import { Rng } from "./rng.ts";
import { migrateSave, SAVE_SCHEMA_VERSION, type InputRecord, type SaveFile } from "./save.ts";
import { Scheduler } from "./scheduler.ts";
import { economy, threat, weather } from "./systems/physical.ts";
import { knowledge } from "./systems/knowledge.ts";
import { messenger } from "./systems/messenger.ts";
import { movement } from "./systems/movement.ts";
import { orders } from "./systems/orders.ts";
import { agents } from "./systems/agents.ts";
import { communities } from "./systems/communities.ts";
import { grain } from "./systems/grain.ts";
import { goods } from "./systems/goods.ts";
import { manpower } from "./systems/manpower.ts";
import { battle } from "./systems/battle.ts";
import { policy } from "./systems/policy.ts";
import { environment } from "./systems/environment.ts";
import { exploration } from "./systems/exploration.ts";
import { routeSpeedPermille } from "./environment.ts";
import { makePlayer } from "./systems/player.ts";
import { MapGraph } from "./map.ts";
import { beliefsAbout } from "./view.ts";
import { DAY, type Ctx, type SimParams, type System } from "./systems/types.ts";
import { buildView, validateBattleDraft, validateDraft, type View } from "./view.ts";
import { applyEvent, initialState, type WorldState } from "./world.ts";

export { SAVE_SCHEMA_VERSION };
export const TICKS_PER_DAY = DAY;
export type { SimParams };

export interface SimConfig {
  content: Content;
  seed: number;
  policy: PolicyId;
  /** follow-best-adviser / follow-worst-adviser → adviser id, as measured on TUNE seeds (G-12). */
  policyAliases?: Record<string, string>;
  params?: SimParams;
  ablate?: SystemId[];
  replay?: { inputs: InputRecord[]; decisions: number };
}

export function hashLog(log: readonly SimEvent[]): string {
  return sha256(log.map((e) => canonicalJson(e) + "\n").join(""));
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
  readonly map: MapGraph;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.seed = cfg.seed;
    this.content = cfg.content;
    this.policyId = cfg.replay ? "replay" : cfg.policy;
    if (cfg.policy !== "replay" && cfg.policy !== "external") {
      if (!policyFn(cfg.policy, cfg.policyAliases)) {
        const known = POLICIES[cfg.policy as keyof typeof POLICIES];
        throw new Error(known ? `policy ${cfg.policy}: ${known.note}` : `unknown policy ${cfg.policy}`);
      }
    }
    for (const a of cfg.ablate ?? []) if (!ABLATABLE.includes(a)) throw new Error(`unknown system ${a} (ablatable: ${ABLATABLE.join(", ")})`);
    this.disabled = new Set(cfg.ablate ?? []);
    this.state = initialState(cfg.content);
    this.map = new MapGraph(cfg.content);
    // mud and snow slow every journey (Phase 10); with the environment switched off the roads are as they always were
    if (cfg.content.scenario.environment && !this.disabled.has("environment")) this.map.speedPermille = (r) => routeSpeedPermille(cfg.content, this.state.env, r);
    this.ctx = this.makeCtx();
    for (const s of [economy, weather, environment, exploration, threat, movement, knowledge, messenger, orders, agents, communities, grain, goods, manpower, battle, policy, makePlayer((ctx, d, r) => this.decide(ctx, d, r))]) this.systems.set(s.id, s);
    this.emit("ScenarioStarted", [], [], { contentVersion: cfg.content.version, seed: cfg.seed });
    for (const s of this.systems.values()) if (!this.disabled.has(s.id)) s.start(this.ctx);
  }

  // ---- boundary (A7) --------------------------------------------------------
  get world(): never {
    throw new Error("WorldState is not readable outside the simulation: use ViewOf(agent | player)");
  }
  viewOf(who: "player" | string): View {
    return buildView(this.state, this.content, who === "player" ? this.content.scenario.ruler : who, this.tick);
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
    if (this.pendingDecision) throw new Error("waiting for the player: call answer() first");
    for (;;) {
      if (this.state.campaign.ended) return; // nothing happens after the end
      const next = this.sched.peekTick();
      if (next === undefined || next >= t) break;
      const item = this.sched.pop()!;
      this.tick = item.tick;
      // interactive play: stop at the player's decision points and wait for answer()
      if (item.handler === "player:decide" && this.awaitsHuman()) { this.pendingDecision = item; return; }
      this.runItem(item);
    }
    this.tick = t;
  }
  private runItem(item: { handler: string; args: Record<string, unknown> }) {
    const sys = item.handler.split(":")[0] as SystemId;
    const fn = this.systems.get(sys)?.handlers[item.handler];
    if (!fn) throw new Error(`no handler ${item.handler}`);
    this.handlersRun++;
    fn(this.ctx, item.args as Record<string, any>);
  }
  private pendingDecision: { handler: string; args: Record<string, unknown> } | null = null;
  private pendingAnswer: PlayerAction[] | null = null;
  private awaitsHuman() {
    const pol = this.cfg.replay ? this.resumePolicy : this.cfg.policy;
    return pol === "external" && !(this.cfg.replay && this.decideCount < this.cfg.replay.decisions) && !this.state.campaign.ended;
  }

  /** Interactive play: run until the player must decide (or until `limit`). Returns what she sees at that moment. */
  next(limit: number): { paused: boolean; reason?: string; letterId?: number; adviceId?: number; ended?: boolean; view?: View } {
    if (!this.pendingDecision) {
      const before = this.tick;
      this.runUntil(Math.max(limit, before));
    }
    const ended = !!this.state.campaign.ended;
    if (this.pendingDecision) {
      // a report pause names the letter that arrived (the cause is its ReportDelivered event)
      const cause = this.pendingDecision.args.cause as number | null;
      const ev = cause === null ? undefined : this.log.find((e) => e.id === cause);
      const letterId = ev?.type === "ReportDelivered" ? (ev.payload.reportId as number) : undefined;
      const adviceId = ev?.type === "RecommendationMade" ? (ev.payload.recommendation as { id: number }).id : undefined;
      return { paused: true, reason: this.pendingDecision.args.reason as string ?? "report", ...(letterId !== undefined ? { letterId } : {}), ...(adviceId !== undefined ? { adviceId } : {}), view: this.viewOf("player"), ended };
    }
    return { paused: false, ended };
  }

  /** The player's answer at a decision point. Orders are validated against what she knows (A7). */
  answer(actions: PlayerAction[]): void {
    if (!this.pendingDecision) throw new Error("no decision is pending");
    const view = this.viewOf("player");
    for (const a of actions) {
      if (a.action === "order") {
        const problems = validateDraft(view, a.order!);
        if (problems.length) throw new Error(`cannot order: ${problems.join("; ")}`);
      }
      if (a.action === "travel" && !this.content.scenario.presence.travelTo.includes(a.target!)) throw new Error(`cannot travel to ${a.target}`);
      if (a.action === "battle") {
        const problems = validateBattleDraft(view, a.battle);
        if (problems.length) throw new Error(`cannot order: ${problems.join("; ")}`);
        const sig = a.battle!.via === "signal" ? view.battle!.signals.find((x) => x.id === a.battle!.signal) : undefined;
        if (sig) a.battle = { ...a.battle!, task: structuredClone(sig.task) as NonNullable<PlayerAction["battle"]>["task"] };
      }
    }
    const item = this.pendingDecision;
    this.pendingDecision = null;
    this.pendingAnswer = actions;
    this.runItem(item);
    this.pendingAnswer = null;
  }

  /** Campaign objective (P0.24, Phase 5 version): the ruler alive and free, and every objective fortification above breach. */
  objectiveStatus() {
    const sc = this.content.scenario, breach = sc.endStates.fortificationBreachedBelowMilli;
    const fortsBelowBreach = sc.objective.forts.filter((f) => this.state.fortifications[f].conditionMilli < breach);
    const ended = this.state.campaign.ended;
    return { met: !ended && fortsBelowBreach.length === 0, ended: ended?.ending ?? null, fortsBelowBreach };
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
  /** Replay helper: run exactly up to the given number of scheduled steps, then sit at `tick`. */
  replayTo(handlers: number, tick: number) {
    while (this.handlersRun < handlers) {
      const item = this.sched.pop();
      if (!item) throw new Error("replay ran out of scheduled steps");
      this.tick = item.tick;
      this.runItem(item);
    }
    this.tick = tick;
  }
  save(): SaveFile {
    if (this.pendingDecision) throw new Error("answer the pending decision before saving");
    const inputs: InputRecord[] = this.log.filter((e) => e.type === "PlayerInput").map((e) => ({
      decision: e.payload.decision as number, tick: e.tick, action: e.payload.action as InputRecord["action"], target: (e.payload.target as string | null) ?? null,
      ...(e.payload.order ? { order: e.payload.order as InputRecord["order"] } : {}), ...(e.payload.followed ? { followed: e.payload.followed as string } : {}),
      ...(e.payload.mission ? { mission: e.payload.mission as InputRecord["mission"] } : {}), ...(e.payload.raid ? { raid: e.payload.raid as string } : {}),
      ...(e.payload.repairMode ? { repairMode: e.payload.repairMode as InputRecord["repairMode"] } : {}),
      ...(e.payload.to ? { to: e.payload.to as string } : {}), ...(e.payload.consult ? { consult: true } : {}),
      ...(e.payload.muster ? { muster: true } : {}), ...(e.payload.arm ? { arm: e.payload.arm as "foot" } : {}), ...(e.payload.sell ? { sell: true } : {}), ...(e.payload.good ? { good: e.payload.good as string } : {}), ...(e.payload.units ? { units: e.payload.units as number } : {}), ...(e.payload.market ? { market: true } : {}),
      ...(e.payload.battle ? { battle: e.payload.battle as InputRecord["battle"] } : {}), ...(e.payload.policy ? { policy: e.payload.policy as InputRecord["policy"] } : {}),
    }));
    const rngStates: SaveFile["rngStates"] = {};
    for (const [n, r] of [...this.streams].sort(([a], [b]) => (a < b ? -1 : 1))) rngStates[n] = { state: r.getState(), draws: r.draws };
    return {
      schemaVersion: SAVE_SCHEMA_VERSION, contentVersion: this.content.version, contentHash: this.content.hash,
      seed: this.seed, policy: this.cfg.replay ? (this.resumePolicy ?? "passive") : this.cfg.policy,
      params: this.cfg.params ?? {}, ablate: [...(this.cfg.ablate ?? [])],
      tick: this.tick, decisions: this.decideCount, inputs, rngStates, logHash: hashLog(this.log), eventCount: this.log.length, handlersRun: this.handlersRun,
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
  private decide(ctx: Ctx, cause: number | null, reason: string): PlayerAction[] {
    void cause; void reason;
    const n = this.decideCount++;
    let actions: PlayerAction[];
    const rp = this.cfg.replay;
    if (rp && n < rp.decisions) {
      const recs = rp.inputs.filter((i) => i.decision === n);
      for (const r of recs) if (r.tick !== ctx.tick) throw new Error(`replay diverged: decision ${n} recorded at ${r.tick}, reached at ${ctx.tick}`);
      actions = recs.map((r) => ({ action: r.action, ...(r.target ? { target: r.target } : {}), ...(r.order ? { order: r.order } : {}), ...(r.followed ? { followed: r.followed } : {}),
        ...(r.mission ? { mission: r.mission } : {}), ...(r.raid ? { raid: r.raid } : {}), ...(r.repairMode ? { repairMode: r.repairMode } : {}),
        ...(r.to ? { to: r.to } : {}), ...(r.consult ? { consult: true } : {}),
        ...(r.muster ? { muster: true } : {}), ...(r.arm ? { arm: r.arm } : {}), ...(r.sell ? { sell: true } : {}), ...(r.good ? { good: r.good } : {}), ...(r.units ? { units: r.units } : {}), ...(r.market ? { market: true } : {}), ...(r.battle ? { battle: r.battle } : {}), ...(r.policy ? { policy: r.policy } : {}) }));
    } else if ((rp ? this.resumePolicy : this.cfg.policy) === "external") {
      actions = this.pendingAnswer ?? [];
    } else if (reason === "battle") {
      actions = []; // scripted rulers leave a battle to its plan and her commanders (D-060)
    } else {
      const pol = rp ? this.resumePolicy! : this.cfg.policy;
      const fn = policyFn(pol, this.cfg.policyAliases)!;
      const view = buildView(this.state, this.content, this.content.scenario.ruler, ctx.tick);
      actions = fn(view, () => ctx.rng("player"));
      for (const a of actions) {
        if (a.action !== "repair" || !a.target) continue;
        const b = beliefsAbout(view, a.target, "fortification.condition")[0], truth = this.state.fortifications[a.target]?.conditionMilli;
        const hl = this.content.byId.predicate.get("fortification.condition")!.halfLifeTicks;
        if (b && truth !== undefined)
          this.decisionsObserved.push({ tick: ctx.tick, staleBelief: b.ageTicks > hl, wrongBelief: Math.abs((b.believedValue as number) - truth) > 5000 });
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
    for (const s of this.systems.values()) if (s.onEvent && !this.disabled.has(s.id)) s.onEvent(this.ctx, e);
    return e;
  }

  private stream(name: string): Rng {
    const sys = name.split(":")[0] as SystemId;
    if (this.disabled.has(sys)) throw new Error(`ablated system ${sys} tried to draw from ${name}`);
    let r = this.streams.get(name);
    if (!r) { r = Rng.fromSeed(this.seed, name); this.streams.set(name, r); }
    return r;
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
      map: this.map,
      isOpen: (r) => !self.state.routesClosed[r],
      runtime: {},
      halfLife: (p) => { const d = self.content.byId.predicate.get(p); if (!d) throw new Error(`unknown predicate ${p}`); return d.halfLifeTicks; },
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
  if (s.handlersRun !== undefined) sim.replayTo(s.handlersRun, s.tick);
  else sim.runUntil(s.tick);
  if (hashLog(sim.log) !== s.logHash) throw new Error("log hash mismatch: the save does not replay to the same log");
  for (const [name, st] of Object.entries(s.rngStates)) {
    if (name === "player") sim.restoreStream(name, st); // the replayed run used recorded inputs, not the player stream
    else if (!sim.compareStream(name, st)) throw new Error(`rng state mismatch for stream ${name}`);
  }
  return sim;
}
