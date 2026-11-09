// Bundle the H-03 clip page: node ui/build_h03.ts -> ui/dist/battle-clips.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readContentDir } from "../src/content.ts";

const here = new URL(".", import.meta.url).pathname;
const raw = readContentDir(new URL("../content/march/", import.meta.url).pathname);
const clips = JSON.parse(readFileSync(here + "h03/clips.json", "utf8"));
const res = await build({
  entryPoints: [here + "h03.ts"], bundle: true, format: "iife", write: false, target: "es2022", minify: true,
  define: { __CLIPS__: JSON.stringify(clips), __FIELD__: JSON.stringify(raw.scenario.battle.field) },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync(here + "h03-shell.html", "utf8").replace("/*APP*/", () => js);
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/battle-clips.html", html);
console.log("ui/dist/battle-clips.html", Math.round(html.length / 1024), "KB");
