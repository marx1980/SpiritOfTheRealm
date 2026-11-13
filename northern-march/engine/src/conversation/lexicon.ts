// The words the templated layer listens for (data: content/march/lexicon.json). Language, not world.
export interface Lexicon {
  schemaVersion: number;
  affirm: string[]; cancel: string[]; correct: string[]; fillers: string[];
  verbs: Record<string, string[]>;
  modes: Record<string, string[]>;
  goods: Record<string, string[]>;
  arms: Record<string, string[]>;
  prepositions: { from: string[]; at: string[]; to: string[] };
  questions: Record<string, string[]>;
  battle: {
    verbs: Record<string, string[]>; fieldAliases: Record<string, string[]>; limits: string[];
    conditions: Record<string, string[]>; command: string[]; via: Record<string, string[]>; signals: Record<string, string[]>; all: string[];
    cost: { questionSeconds: number; readbackSeconds: number; technicalSeconds: number; pressAfter: number };
  };
  fuzzy: { minLength: number; oneEditUpTo: number; twoEditsFrom: number };
  /** What another layer may change when it speaks: courtesy it may add or drop, phrases that count as one (validate.ts). */
  speech: { free: string[]; same: string[][] };
}

/** Validate a parsed lexicon file; throws with the first problem. */
export function parseLexicon(raw: unknown): Lexicon {
  const x = raw as Lexicon;
  const strs = (v: unknown, what: string) => { if (!Array.isArray(v) || v.some((w) => typeof w !== "string" || !w.trim())) throw new Error(`lexicon: ${what} must be a list of words`); };
  const maps = (v: unknown, what: string) => { if (!v || typeof v !== "object") throw new Error(`lexicon: ${what} missing`); for (const [k, w] of Object.entries(v)) strs(w, `${what}.${k}`); };
  if (!x || x.schemaVersion !== 1) throw new Error("lexicon: schemaVersion 1 expected");
  for (const k of ["affirm", "cancel", "correct", "fillers"] as const) strs(x[k], k);
  for (const k of ["verbs", "modes", "goods", "arms", "questions"] as const) maps(x[k], k);
  for (const k of ["from", "at", "to"] as const) strs(x.prepositions?.[k], `prepositions.${k}`);
  for (const k of ["verbs", "fieldAliases", "conditions", "via", "signals"] as const) maps(x.battle?.[k], `battle.${k}`);
  for (const k of ["limits", "command", "all"] as const) strs(x.battle?.[k], `battle.${k}`);
  for (const k of ["questionSeconds", "readbackSeconds", "technicalSeconds", "pressAfter"] as const) if (!Number.isInteger(x.battle?.cost?.[k])) throw new Error(`lexicon: battle.cost.${k}`);
  strs(x.speech?.free, "speech.free");
  if (!Array.isArray(x.speech?.same) || !x.speech.same.length) throw new Error("lexicon: speech.same must be a list of groups");
  x.speech.same.forEach((g, i) => { strs(g, `speech.same.${i}`); if (g.length < 2) throw new Error(`lexicon: speech.same.${i} needs two phrases or more`); });
  return x;
}
