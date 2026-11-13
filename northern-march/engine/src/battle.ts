// Fighting raiders: how many men a band has, and what a fight costs each side. Pure; shared by the engine and the planner.
import type { BattleParams } from "./content.ts";

/** Raiders' strength in men, from the intensity (0..1000) people report. */
export const raiderMen = (b: BattleParams, intensityPermille: number) => Math.floor((intensityPermille * b.sortie.raiderMenAtFull) / 1000);

/** Men a force of `men` loses fighting `enemy` men: the base rate at an even match, more against a larger enemy, less against a smaller. */
export function battleLoss(b: BattleParams, men: number, enemy: number, won: boolean): number {
  const share = (1000 * enemy) / Math.max(1, enemy + men);
  // with battles fought out on the field, the rates commanders expect are the battles' own (D-068)
  const est = b.field ? b.sortie.estimate : undefined;
  const rate = won ? est?.lossOnWinPermille ?? b.sortie.lossOnSuccessPermille : est?.lossOnDefeatPermille ?? b.sortie.lossOnFailurePermille;
  return Math.min(men, Math.floor((men * rate * share) / (500 * 1000)));
}
