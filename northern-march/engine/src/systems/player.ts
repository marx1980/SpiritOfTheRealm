// The player system turns policy (or recorded) decisions into PlayerInput events and hands them to the order pipeline.
import type { PlayerAction } from "../policies.ts";
import type { Ctx, System } from "./types.ts";
import { chr, loc, sorted } from "./types.ts";
import { issue } from "./orders.ts";
import { travel } from "./movement.ts";
import { DAY, HOUR } from "./types.ts";

/** Who receives an action: for a repair, whoever holds the place and reports on it to the ruler; for a levy, the steward. */
function recipientFor(ctx: Ctx, a: PlayerAction): string | null {
  const cs = sorted(ctx.content.characters, (c) => c.id);
  if (a.action === "repair") return cs.find((c) => c.location === a.target && c.reportsTo === ctx.content.scenario.ruler)?.id ?? null;
  if (a.action === "advance") return cs.find((c) => c.role === "captain")?.id ?? null;
  return cs.find((c) => c.role === "steward")?.id ?? null;
}

/** Decision points: a report reaches the ruler, an adviser speaks to her, she is warned of danger, she arrives
 *  somewhere, or (in interactive play) a daily checkpoint. The cause is what she perceived, if anything. */
export function makePlayer(decide: (ctx: Ctx, cause: number | null, reason: string) => PlayerAction[]): System {
  return {
    id: "player",
    start: (ctx) => { if (ctx.params.checkpoints) ctx.at(DAY + 12 * HOUR, "player:checkpoint", {}); },
    handlers: {
      "player:checkpoint": (ctx) => {
        ctx.at(ctx.tick, "player:decide", { cause: null, reason: "checkpoint" });
        ctx.at(ctx.tick + DAY, "player:checkpoint", {});
      },
      "player:dayend": (ctx, { cause }) => { ctx.at(ctx.tick, "player:decide", { cause, reason: "dayend" }); },
      "player:decide": (ctx, { cause, deliveredEventId, reason }) => {
        if (ctx.s.campaign.ended) return;
        const ruler = ctx.content.scenario.ruler;
        const why: number | null = cause ?? deliveredEventId ?? null;
        for (const a of decide(ctx, why, reason ?? "report")) {
          const input = ctx.emit("PlayerInput", why ? [why] : [], [chr(ruler)], { player: ruler, action: a.action, target: a.target ?? null, decision: a.decision!,
            ...(a.order ? { order: a.order } : {}), ...(a.followed ? { followed: a.followed } : {}),
            ...(a.mission ? { mission: a.mission } : {}), ...(a.to ? { to: a.to } : {}), ...(a.consult ? { consult: true } : {}), ...(a.muster ? { muster: true } : {}), ...(a.sell ? { sell: true } : {}), ...(a.raid ? { raid: a.raid } : {}), ...(a.repairMode ? { repairMode: a.repairMode } : {}) });
          if (a.action === "travel") { travel(ctx, ruler, a.target!, "rider", false, input.id); continue; }
          if (a.action === "order") {
            const d = a.order!;
            issue(ctx, ruler, d.recipient, d.intent, d.objective, input.id, false,
              { discretion: d.discretion, constraints: d.constraints, contingencies: d.contingencies, reportingPolicy: d.reportingPolicy });
            continue;
          }
          const to = recipientFor(ctx, a);
          if (!to) continue;
          if (a.action === "advance" && a.mission && a.mission !== "defend" && a.raid) {
            // scout: go and look at the raiders; attack: advance on them
            issue(ctx, ruler, to, a.mission === "scout" ? "investigate" : "attack", loc(a.raid), input.id);
            continue;
          }
 
          if (a.action === "levy" && a.muster) {
            issue(ctx, ruler, to, "levy", loc(a.target!), input.id, false, { constraints: [{ kind: "men", textKey: "yes" }, { kind: "deliverTo", textKey: a.to ?? "" }] });
            continue;
          }
          if (a.action === "requisition" || a.action === "purchase") {
            issue(ctx, ruler, to, a.action === "purchase" ? "negotiate" : "requisition", loc(a.target!), input.id, false,
              { constraints: [{ kind: "deliverTo", textKey: a.to ?? "" }, ...(a.good ? [{ kind: "good", textKey: a.good }] : []), ...(a.sell ? [{ kind: "sell", textKey: "yes" }] : []), ...(a.consult ? [{ kind: "consult", textKey: "yes" }] : [])] });
            continue;
          }
          issue(ctx, ruler, to, a.action, a.action === "levy" ? chr(ruler) : loc(a.target!), input.id, false,
            a.action === "repair" && a.repairMode && a.repairMode !== "standard" ? { constraints: [{ kind: "repairMode", textKey: a.repairMode }] } : {});
        }
      },
    },
  };
}
