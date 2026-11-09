// The battle record is a pure function of (setup, orders, until): memoised here, never part of world state (D-060).
import { runBattle, type BattleOrder, type BattleRecord, type BattleSetup } from "./core.ts";

const memo = new Map<string, BattleRecord>();
export function battleRecord(b: { setup: BattleSetup; orders: readonly BattleOrder[] }, until?: number): BattleRecord {
  const key = `${b.setup.seed}:${b.setup.battleId}:${b.orders.map((o) => o.id).join(",")}:${until ?? "end"}`;
  let r = memo.get(key);
  if (!r) {
    r = runBattle(b.setup, [...b.orders], until === undefined ? {} : { until });
    memo.set(key, r);
    if (memo.size > 24) memo.delete(memo.keys().next().value!);
  }
  return r;
}
