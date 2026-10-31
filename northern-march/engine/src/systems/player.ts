// The player system turns policy (or recorded) decisions into PlayerInput events and hands them to the order pipeline.
import type { PlayerAction } from "../policies.ts";
import type { Ctx, System } from "./types.ts";
import { chr, loc, sorted } from "./types.ts";
import { issue } from "./orders.ts";

/** Who receives an action: for a repair, whoever holds the place and reports on it to the ruler; for a levy, the steward. */
function recipientFor(ctx: Ctx, a: PlayerAction): string | null {
  const cs = sorted(ctx.content.characters, (c) => c.id);
  if (a.action === "repair") return cs.find((c) => c.location === a.target && c.reportsTo === ctx.content.scenario.ruler)?.id ?? null;
  if (a.action === "advance") return cs.find((c) => c.role === "captain")?.id ?? null;
  return cs.find((c) => c.role === "steward")?.id ?? null;
}

export function makePlayer(decide: (ctx: Ctx, deliveredEventId: number) => PlayerAction[]): System {
  return {
    id: "player",
    start: () => {},
    handlers: {
      "player:decide": (ctx, { deliveredEventId }) => {
        const ruler = ctx.content.scenario.ruler;
        for (const a of decide(ctx, deliveredEventId)) {
          const input = ctx.emit("PlayerInput", [deliveredEventId], [chr(ruler)], { player: ruler, action: a.action, target: a.target ?? null, decision: a.decision! });
          const to = recipientFor(ctx, a);
          if (!to) continue;
          issue(ctx, ruler, to, a.action, a.action === "levy" ? chr(ruler) : loc(a.target!), input.id);
        }
      },
    },
  };
}
