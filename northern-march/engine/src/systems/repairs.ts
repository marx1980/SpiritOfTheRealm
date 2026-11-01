// Repairs at a fort are work: the garrison and any captains' companies there do it together, so the job speeds up
// when men arrive and slows when they leave. Work is counted in man-ticks; the end is recomputed on every change.
import type { Ctx } from "./types.ts";
import { loc } from "./types.ts";

const oref = (id: number) => ({ kind: "order" as const, id: String(id) });

/** Men working at a fort: its garrison plus the companies of captains with them there. */
export function menAt(ctx: Ctx, where: string): number {
  const helpers = Object.entries(ctx.s.positions).filter(([, p]) => "at" in p && p.at === where).reduce((n, [id]) => n + (ctx.s.troops[id] ?? 0), 0);
  return (ctx.s.fortifications[where]?.garrison ?? 0) + helpers;
}

/** Schedule the end of the repair at the pace of the men now working on it. */
export function scheduleRepairEnd(ctx: Ctx, where: string) {
  const r = ctx.s.repairs[where];
  if (!r) return;
  const left = Math.max(0, r.work - r.done);
  ctx.at(ctx.tick + Math.ceil(left / r.men), "orders:completeRepair", { orderId: r.orderId, location: where, gen: r.gen });
}

/** A captain's company arrives at, or leaves, a fort where work is under way: record the work done so far at the old pace. */
export function resyncRepair(ctx: Ctx, where: string, cause: number) {
  const r = ctx.s.repairs[where];
  if (!r) return;
  const men = Math.max(1, menAt(ctx, where));
  if (men === r.men) return;
  const done = r.done + (ctx.tick - r.lastT) * r.men;
  ctx.emit("RepairResynced", [cause], [loc(where), oref(r.orderId)], { location: where, orderId: r.orderId, done, men, gen: r.gen + 1 });
  scheduleRepairEnd(ctx, where);
}
