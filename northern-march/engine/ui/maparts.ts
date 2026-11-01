// Parchment map art: hand-inked look, drawn once as static SVG (cached) so redraws cost nothing.
// Presentation only: reads the map model, never the world.
import type { MapModel, MapPlace } from "../src/presentation/map.ts";

const INK = "#2b2117", PAPER = "#ecdcaa", SEA = "#cfe0d6", WAVE = "#7fa3a6", RIVER = "#8fb3bd";
const FLAG: Record<string, string> = { sound: "#4f7a3a", worn: "#9aa83c", damaged: "#d08a14", bad: "#a8322a", none: "#9a9080" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type Pt = [number, number];
const smooth = (p: Pt[]) => { // Catmull-Rom to cubic bezier
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], e = p[Math.min(p.length - 1, i + 2)];
    d += `C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0]} ${c[1]}`;
  }
  return d;
};

const COAST: Pt[] = [[150, -20], [138, 40], [112, 130], [88, 230], [102, 330], [76, 430], [64, 520], [54, 600], [46, 700], [50, 780], [52, 850], [108, 915], [185, 985]];
const RIVERPTS: Pt[] = [[520, -20], [535, 120], [560, 250], [500, 330], [485, 390], [500, 520], [525, 710], [480, 800], [330, 860], [240, 915], [185, 985]];
const coastX = (y: number) => { for (let i = 0; i < COAST.length - 1; i++) { const [x1, y1] = COAST[i], [x2, y2] = COAST[i + 1]; if (y >= y1 && y <= y2) return x1 + ((x2 - x1) * (y - y1)) / (y2 - y1); } return 60; };
const nearRiver = (x: number, y: number) => RIVERPTS.some(([rx, ry]) => Math.hypot(rx - x, ry - y) < 26);

const DEFS = `<defs>
<filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .42  0 0 0 0 .3  0 0 0 0 .15  .7 0 0 0 -.12"/></filter>
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3"/></filter>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#7a5a2a" stop-opacity="0"/><stop offset="100%" stop-color="#7a5a2a" stop-opacity=".38"/></radialGradient>
<g id="g-tree"><path d="M0 0v6" stroke="${INK}" stroke-width="1.2"/><path d="M-6 1c-4-7 1-13 6-13s10 6 6 13z" fill="#c4cf93" stroke="${INK}" stroke-width="1.1"/></g>
<g id="g-pine"><path d="M0 0v6" stroke="${INK}" stroke-width="1.2"/><path d="M-6 0l6-9 6 9zM-5 -6l5-8 5 8z" fill="#b6c489" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/></g>
<g id="g-mtn"><path d="M-16 8L-4 -12 2 -4 7 -10 17 8z" fill="#e2d2a0" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/><path d="M-4 -12l3 10M-2 -2l-4 8M7 -10l-2 8M5 0l3 8" stroke="${INK}" stroke-width=".9" fill="none"/></g>
<g id="g-hill"><path d="M-13 4q13-18 26 0" fill="#e6d7a6" stroke="${INK}" stroke-width="1.3"/><path d="M-6 1q4-5 8-2" stroke="${INK}" stroke-width=".8" fill="none"/></g>
<g id="g-marsh" stroke="${INK}" stroke-width="1" fill="none"><path d="M-8 3h16" stroke="${RIVER}" stroke-width="2"/><path d="M-4 3v-6M0 3v-8M4 3v-5"/><path d="M-6 0l2 3M2 0l2 3"/></g>
<g id="i-castle"><path d="M-17 12V-3h6v-6h4v6h5v-6h4v6h6v-6h4v6h6V12z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M-5 12v-8a5 5 0 0 1 10 0v8" fill="${INK}"/><path d="M-13 -9v-5M13 -9v-5M0 -3v-12" stroke="${INK}" stroke-width="1.4"/><path d="M-13 3h4M9 3h4" stroke="${INK}" stroke-width="2"/></g>
<g id="i-port"><path d="M-18 12V2l5-5 5 5v10zM-6 12V0l5-6 5 6v12z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-14 6h3M-2 6h3" stroke="${INK}" stroke-width="2"/><path d="M8 14q7 4 14 0l-3-5h-8z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.4"/><path d="M15 9V-7l6 12z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/></g>
<g id="i-town"><path d="M-17 12V0h34v12z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5"/><path d="M-17 0v-4h4v4M-5 0v-4h4v4M7 0v-4h4v4M13 0v-4h4v4" stroke="${INK}" stroke-width="1.2" fill="none"/><path d="M-12 0v-6l5-5 5 5v6zM2 0v-7l5-6 5 6v7z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M-3 12v-5h5v5" fill="${INK}"/></g>
<g id="i-fortress"><path d="M-9 14V-12h-3v-5h5v3h4v-3h4v3h4v-3h5v5h-3V14z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/><path d="M-20 14V2h11M9 2h11v12" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5"/><path d="M-3 14v-7a3.5 3.5 0 0 1 7 0v7" fill="${INK}"/><path d="M-1 -8h2v6h-2z" fill="${INK}"/></g>
<g id="i-keep"><path d="M-12 13V-4h24V13z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.7"/><path d="M-12 -4v-5h5v5M7 -4v-5h5v5M-3 -4v-3h6v3" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-17 13V0h6v13zM11 13V0h6v13z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5"/><path d="M-3 13v-6a3 3 0 0 1 6 0v6" fill="${INK}"/></g>
<g id="i-village"><path d="M-14 11V3l5-6 5 6v8zM2 11V1l6-7 6 7v10z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-9 11V7h3v4M6 11V6h4v5" fill="${INK}"/></g>
<g id="i-hamlet"><path d="M-8 9V1l8-9 8 9v8z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-2 9V4h4v5" fill="${INK}"/></g>
<g id="i-inn"><path d="M-9 10V0l9-8 9 8v10z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-3 10V4h6v6" fill="${INK}"/><path d="M9 -2h7M13 -2v5" stroke="${INK}" stroke-width="1.3"/><circle cx="13" cy="6" r="2.6" fill="${INK}"/></g>
<g id="i-outpost"><path d="M-6 11V-6h12V11z" fill="#f3e8c4" stroke="${INK}" stroke-width="1.6"/><path d="M-8 -6v-4h4v2h8v-2h4v4" fill="#f3e8c4" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M-1.5 11V5h3v6" fill="${INK}"/></g>
<g id="i-pass"><path d="M-22 11L-10 -9 -3 2 0 -3 3 2 10 -9 22 11" fill="#e2d2a0" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-6 11V4a6 6 0 0 1 12 0v7" fill="#f3e8c4" stroke="${INK}" stroke-width="1.4"/></g>
<g id="i-forest"><use href="#g-tree" x="-11" y="4"/><use href="#g-pine" x="9" y="5"/><use href="#g-tree" x="0" y="-4"/></g>
<g id="i-hill"><use href="#g-hill"/></g>
</defs>`;

const ICON: Record<string, { id: string; top: number }> = {
  city: { id: "i-castle", top: -15 }, port: { id: "i-port", top: -9 }, town: { id: "i-town", top: -13 }, fortress: { id: "i-fortress", top: -17 },
  keep: { id: "i-keep", top: -9 }, village: { id: "i-village", top: -8 }, hamlet: { id: "i-hamlet", top: -8 }, waystation: { id: "i-inn", top: -8 },
  outpost: { id: "i-outpost", top: -10 }, pass: { id: "i-pass", top: -9 }, forest: { id: "i-forest", top: -12 }, hill: { id: "i-hill", top: -8 },
};

let cache: { key: string; svg: string } | null = null;
function artwork(m: MapModel, kinds: Map<string, string>, terrains: Map<string, string>) {
  const key = m.places.map((p) => p.id + p.x + p.y).join();
  if (cache?.key === key) return cache.svg;
  const r = rng(20240511), land = smooth(COAST), places = m.places;
  const awayFromPlaces = (x: number, y: number, d: number) => places.every((p) => Math.hypot(p.x - x, p.y - y) > d);
  const onLand = (x: number, y: number) => x > coastX(y) + 18;
  const glyphs: { y: number; s: string }[] = [];
  const put = (id: string, x: number, y: number, k = 1) => { if (onLand(x, y) && !nearRiver(x, y)) glyphs.push({ y, s: `<use href="#${id}" x="${x.toFixed(0)}" y="${y.toFixed(0)}"${k !== 1 ? ` transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${k}) translate(${-x.toFixed(0)} ${-y.toFixed(0)})"` : ""}/>` }); };
  for (const p of places) {
    const t = terrains.get(p.id), k = kinds.get(p.id);
    if (k === "forest") for (let i = 0; i < 34; i++) { const a = r() * 6.283, d = 14 + r() * 62; const x = p.x + Math.cos(a) * d * 1.3, y = p.y + Math.sin(a) * d; if (awayFromPlaces(x, y, 30) || Math.hypot(x - p.x, y - p.y) < 40) put(r() < 0.55 ? "g-tree" : "g-pine", x, y); }
    else if (t === "marsh") for (let i = 0; i < 9; i++) put("g-marsh", p.x + (r() - 0.5) * 120, p.y + (r() - 0.5) * 70);
    else if (t === "hills") for (let i = 0; i < 7; i++) { const x = p.x + (r() - 0.5) * 110, y = p.y + (r() - 0.5) * 70; if (awayFromPlaces(x, y, 34)) put(r() < 0.35 ? "g-mtn" : "g-hill", x, y); }
  }
  for (let i = 0; i < 26; i++) { const x = 760 + r() * 280, y = 20 + r() * 900; if (awayFromPlaces(x, y, 40)) put("g-mtn", x, y, 0.8 + r() * 0.5); }
  for (let i = 0; i < 14; i++) { const x = 160 + r() * 800, y = 10 + r() * 90; if (awayFromPlaces(x, y, 40)) put("g-mtn", x, y, 0.8 + r() * 0.4); }
  for (let i = 0; i < 90; i++) { const x = 70 + r() * 940, y = 40 + r() * 930; if (awayFromPlaces(x, y, 48)) put(r() < 0.6 ? "g-tree" : "g-pine", x, y, 0.8); }
  glyphs.sort((a, b) => a.y - b.y);

  const waves = [1, 2, 3].map((i) => `<path d="${land}" transform="translate(${-i * 15} 0)" fill="none" stroke="${WAVE}" stroke-width="${(1.6 - i * 0.3).toFixed(1)}" stroke-dasharray="${i === 1 ? "none" : `${14 + i * 4} ${7 + i * 3}`}" opacity="${(0.8 - i * 0.18).toFixed(2)}"/>`).join("").replace(/stroke-dasharray="none"/g, "");
  const river = `<path d="${smooth(RIVERPTS)}" fill="none" stroke="${INK}" stroke-width="7.5" stroke-linecap="round" opacity=".55"/><path d="${smooth(RIVERPTS)}" fill="none" stroke="${RIVER}" stroke-width="5" stroke-linecap="round"/>`;
  const byId = new Map(places.map((p) => [p.id, p]));
  const roads = m.routes.map((rt) => {
    const a = byId.get(rt.from)!, b = byId.get(rt.to)!, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y), sgn = (rt.from.length + rt.to.length) % 2 ? 1 : -1;
    const cx = mx + (-(b.y - a.y) / len) * len * 0.07 * sgn, cy = my + ((b.x - a.x) / len) * len * 0.07 * sgn;
    const d = rt.crossing ? `M${a.x} ${a.y}L${b.x} ${b.y}` : `M${a.x} ${a.y}Q${cx.toFixed(0)} ${cy.toFixed(0)} ${b.x} ${b.y}`;
    let mark = "";
    if (rt.crossing === "bridge") mark = `<g transform="translate(${mx} ${my}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})"><rect x="-13" y="-7" width="26" height="14" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/><path d="M-13 -3h26M-13 3h26" stroke="${INK}" stroke-width="1.2"/><path d="M-8 -7v14M0 -7v14M8 -7v14" stroke="${INK}" stroke-width=".8"/></g>`;
    else if (rt.crossing === "ford") mark = `<g transform="translate(${mx} ${my})" stroke="${INK}" stroke-width="1.3" fill="none"><circle r="10" fill="${PAPER}" stroke="none"/><path d="M-8 -3q4-3 8 0t8 0M-8 3q4-3 8 0t8 0"/></g>`;
    else if (rt.crossing === "ferry") mark = `<g transform="translate(${mx} ${my})"><circle r="12" fill="${PAPER}"/><path d="M-9 3q9 5 18 0l-3-5h-12zM0 -2V-10l6 7" fill="#f3e8c4" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/></g>`;
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${rt.crossing ? "1 6" : "1.5 6.5"}" opacity=".8"/>${mark}`;
  }).join("");

  const title = `<g transform="translate(-112 14)"><path d="M0 8q4-8 12-8h188q8 0 12 8v34q-4 8-12 8H12q-8 0-12-8z" fill="${PAPER}" stroke="${INK}" stroke-width="2"/><path d="M5 12q2-6 8-6h186q6 0 8 6v26q-2 6-8 6H13q-6 0-8-6z" fill="none" stroke="${INK}" stroke-width=".8"/><text x="106" y="33" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="19" font-style="italic" fill="${INK}" stroke="none" letter-spacing="1">The Northern March</text></g>`;
  const sea = `<text transform="translate(-45 520) rotate(-90)" text-anchor="middle" font-family="Georgia,serif" font-size="26" font-style="italic" fill="${WAVE}" letter-spacing="9" stroke="none">Sea of Ravens</text>`;
  const compass = `<g transform="translate(960 900)" stroke="${INK}" fill="none" stroke-width="1.4"><circle r="26" opacity=".5"/><path d="M0 -34L6 0 0 34 -6 0zM-34 0L0 -6 34 0 0 6z" fill="${PAPER}"/><path d="M0 -34L6 0 0 0z M0 34L-6 0 0 0z M-34 0L0 6 0 0z M34 0L0 -6 0 0z" fill="${INK}" stroke="none"/><text y="-40" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="${INK}" stroke="none">N</text></g>`;

  const svg = `${DEFS}<rect x="-130" y="-20" width="1180" height="1010" fill="${SEA}"/>${waves}
<path d="${land} L1100 985 L1100 -20 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" filter="url(#rough)"/>
<rect x="-130" y="-20" width="1180" height="1010" filter="url(#paper)" opacity=".9" pointer-events="none"/>${river}${roads}${glyphs.map((g) => g.s).join("")}${sea}${title}${compass}`;
  cache = { key, svg };
  return svg;
}

export interface MapArtInput { model: MapModel; selected: string; kinds: Map<string, string>; terrains: Map<string, string> }
const wcls = (w?: string) => !w ? "none" : w === "sound" ? "sound" : w === "worn" ? "worn" : w === "damaged" ? "damaged" : "bad";

export function mapSvg({ model: m, selected, kinds, terrains }: MapArtInput): string {
  const art = artwork(m, kinds, terrains);
  const places = m.places.map((p: MapPlace) => {
    const k = ICON[kinds.get(p.id) ?? "village"] ?? ICON.village;
    const flag = p.fortified ? `<path d="M0 ${k.top}v-12" stroke="${INK}" stroke-width="1.5"/><path d="M0 ${k.top - 12}l12 4-12 4z" fill="${FLAG[wcls(p.wall?.words)]}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>` : "";
    const raided = !!p.raiders && p.raiders.words !== "no raiders";
    const raid = raided ? `<g transform="translate(${p.x + 36} ${p.y - 30}) scale(2)"><path d="M-9 8L0-9 9 8z" fill="${FLAG.bad}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M0-9v-6" stroke="${INK}" stroke-width="1.3"/></g>` : "";
    const you = p.you ? `<circle cx="${p.x}" cy="${p.y}" r="27" fill="none" stroke="#a0381c" stroke-width="3" stroke-dasharray="5 4"/>` : "";
    const sel = p.id === selected ? `<circle cx="${p.x}" cy="${p.y}" r="31" fill="#a0381c" fill-opacity=".12" stroke="#a0381c" stroke-width="2"/>` : "";
    const sub = p.fortified ? (p.wall ? p.wall.words : "unknown") : raided ? p.raiders!.words : "";
    const parts = p.troops ? [...(p.troops.fort ? [`${p.troops.fort.exact ? "" : "~"}${p.troops.fort.count} in fort`] : []), ...p.troops.captains.map((c) => `${esc(c.name)} ${c.exact ? "" : "~"}${c.count}`)] : [];
    const txt = (s: string, dy: number, cls: string) => `<text class="${cls}" x="${p.x + 27}" y="${p.y + dy}">${s}</text>`;
    return `${sel}${you}<g transform="translate(${p.x} ${p.y}) scale(1.3)"><use href="#${k.id}"/>${flag}</g>${raid}${txt(esc(p.name), 5, "nm")}${sub ? txt(esc(sub), 20, "sb") : ""}${parts.length ? txt(parts.join(" · "), sub ? 34 : 20, "sb") : ""}<circle class="hit" fill="transparent" cx="${p.x}" cy="${p.y}" r="28" data-place="${p.id}"/>`;
  }).join("");
  return `<svg viewBox="-120 -20 1160 1010" role="img" aria-label="Map of the realm">${art}${places}</svg>`;
}
