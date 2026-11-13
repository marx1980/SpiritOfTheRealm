// Bundle the debug UI into one self-contained HTML page: engine + content + h01 scenario.
//   node ui/build.ts  -> ui/dist/northern-march.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readContentDir } from "../src/content.ts";

const here = new URL(".", import.meta.url).pathname;
const raw = readContentDir(new URL("../content/march/", import.meta.url).pathname);
const lexicon = JSON.parse(readFileSync(new URL("../content/march/lexicon.json", import.meta.url).pathname, "utf8"));
const h01 = JSON.parse(readFileSync(here + "h01.json", "utf8"));
const res = await build({
  entryPoints: [here + "app.ts"], bundle: true, format: "iife", write: false, target: "es2022", minify: true,
  define: { __RAW__: JSON.stringify(raw), __H01__: JSON.stringify(h01), __LEXICON__: JSON.stringify(lexicon) },
  plugins: [{ name: "stub-node", setup(b) { b.onResolve({ filter: /^node:(fs|path)$/ }, () => ({ path: here + "fs-stub.ts" })); } }],
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync(here + "shell.html", "utf8").replace("/*APP*/", () => js);
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/northern-march.html", html);
// the same page as an installable web app (GitHub Pages): a manifest and icons beside it, so a phone runs it as its own app
const app = html.replace("<title>", `<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="theme-color" content="#1b2027">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Northern March">\n<title>`);
mkdirSync(here + "dist/pages", { recursive: true });
writeFileSync(here + "dist/pages/index.html", app);
for (const f of ["manifest.webmanifest", "icon-192.png", "icon-512.png"]) writeFileSync(here + "dist/pages/" + f, readFileSync(here + "pages/" + f));
console.log("ui/dist/northern-march.html", Math.round(html.length / 1024), "KB");
