// Node only: read the lexicon from a content directory. The page gets the same file inlined at build time (parseLexicon).
import { readFileSync } from "node:fs";
import { parseLexicon, type Lexicon } from "./lexicon.ts";

export function loadLexicon(dir: string): Lexicon {
  return parseLexicon(JSON.parse(readFileSync(`${dir.replace(/\/?$/, "/")}lexicon.json`, "utf8")));
}
