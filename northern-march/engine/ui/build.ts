// Bundle the debug UI into one self-contained HTML page: engine + content + h01 scenario.
//   node ui/build.ts  -> ui/dist/northern-march.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readContentDir } from "../src/content.ts";

const here = new URL(".", import.meta.url).pathname;
const raw = readContentDir(new URL("../content/march/", import.meta.url).pathname);
const h01 = JSON.parse(readFileSync(here + "h01.json", "utf8"));
const res = await build({
  entryPoints: [here + "app.ts"], bundle: true, format: "iife", write: false, target: "es2022", minify: true,
  define: { __RAW__: JSON.stringify(raw), __H01__: JSON.stringify(h01) },
  plugins: [{ name: "stub-node", setup(b) { b.onResolve({ filter: /^node:(fs|path)$/ }, () => ({ path: here + "fs-stub.ts" })); } }],
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync(here + "shell.html", "utf8").replace("/*APP*/", () => js);
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/northern-march.html", html);
console.log("ui/dist/northern-march.html", Math.round(html.length / 1024), "KB");
