// The battlefield drawn (Phase 8, BATTLEFIELD §13, §16): terrain, and formations as headquarters knows them. Each
// behaviour has its own shape, and every state but good order carries its word (D-063); how a formation is known
// (observed, reported, inferred, stale) changes the line and the fill, never the shape. An optional flash marks units seen
// breaking. Pure: shared by the game and the clip page.
import type { Behaviour, FieldSpec, Kind, Mark, Side } from "../src/battlefield/core.ts";

/** The word shown on a formation for its state; good order is the default and has none. */
export const STATE_WORD: Record<Behaviour, string> = { good_order: "", yielding: "Yielding", disorganised: "Disorganised", rallying: "Rallying", withdrawing: "Withdrawing", retreat: "Retreat", rout: "Rout", pursuing: "Pursuing", gone: "" };
/** How units seen breaking are made to stand out: not at all, a flash to light pink, or a flash to a pale tint of their own colour. */
export type FlashStyle = "none" | "pink" | "pale";

export interface Glyph { id: string; side: Side; kind: Kind; label: string; x: number; y: number; behaviour: Behaviour; width: number; category: Mark["category"]; stale: boolean; age: number }
export const glyphOf = (m: Mark): Glyph => ({ id: m.id, side: m.side, kind: m.kind, label: m.label, x: m.x, y: m.y, behaviour: m.behaviour, width: m.menBand === "few" ? 80 : m.menBand === "some" ? 120 : 160, category: m.category, stale: m.stale, age: m.age });

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const mins = (s: number) => (s < 60 ? "now" : `${Math.round(s / 60)} min`);

/** A small, fixed jitter per formation (so a broken line keeps its shape between frames). */
function jit(id: string, i: number, span: number) {
  let h = 2166136261;
  for (const ch of `${id}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % (2 * span + 1)) - span;
}

/** One formation, centred on the origin, facing up (crown) or down (raiders: the caller flips it). */
function body(g: Glyph): string {
  const w = g.width, d = 34, hw = w / 2, banner = (tilt = 0) => `<g class="bn" transform="rotate(${tilt})"><line x1="0" y1="${-d / 2}" x2="0" y2="${-d / 2 - 34}"/><path d="M0 ${-d / 2 - 34} h22 l-6 7 l6 7 h-22z"/></g>`;
  switch (g.behaviour) {
    case "good_order":
      return `<rect class="blk" x="${-hw}" y="${-d / 2}" width="${w}" height="${d}" rx="2"/>${banner()}`;
    case "yielding": // in line, facing the enemy, stepping back: chevrons behind
      return `<rect class="blk" x="${-hw}" y="${-d / 2 + 4}" width="${w}" height="${d - 8}" rx="2"/>${banner(-6)}<path class="chev" d="M${-hw / 2 - 14} ${d / 2 + 12} l14 12 l14 -12 M${hw / 2 - 14} ${d / 2 + 12} l14 12 l14 -12"/>`;
    case "disorganised": { // the line broken into uneven pieces, the banner leaning
      const n = 5, pw = w / n;
      return Array.from({ length: n }, (_, i) => `<rect class="blk" x="${-hw + i * pw + jit(g.id, i, 4)}" y="${-d / 2 + jit(g.id, i + 9, 7)}" width="${pw - 8 + jit(g.id, i + 3, 3)}" height="${d - 10 + jit(g.id, i + 5, 4)}" rx="2"/>`).join("") + banner(22);
    }
    case "rallying": // men gathering round an upright banner, inside a turning ring
      return `<circle class="ring" r="${hw * 0.75 + 14}"/>` + Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * 2 * Math.PI, r = hw * 0.55; return `<circle class="dot" cx="${(Math.cos(a) * r).toFixed(0)}" cy="${(Math.sin(a) * r * 0.6).toFixed(0)}" r="7"/>`; }).join("") + banner();
    case "withdrawing": // intact, moving back in order: one straight arrow to the rear
      return `<rect class="blk" x="${-hw}" y="${-d / 2}" width="${w}" height="${d}" rx="2"/>${banner()}<path class="arw" d="M0 ${d / 2 + 6} v34 m-12 -12 l12 12 l12 -12"/>`;
    case "retreat": // stretched and ragged, streaming back
      return `<path class="blk" d="M${-hw} ${-d / 2} L${hw} ${-d / 2 + 6} L${hw * 0.7} ${d / 2 + 18} L${hw * 0.3} ${d / 2 + 4} L${hw * 0.1} ${d / 2 + 30} L${-hw * 0.3} ${d / 2 + 8} L${-hw * 0.6} ${d / 2 + 24} Z"/><path class="arw rag" d="M${-10} ${d / 2 + 34} l6 10 l-4 4 l8 12 m-10 -8 l10 8 l6 -12"/>`;
    case "rout": // scattered men running, no banner, no line
      return Array.from({ length: 14 }, (_, i) => `<circle class="dot" cx="${jit(g.id, i, Math.floor(hw * 1.2))}" cy="${Math.abs(jit(g.id, i + 20, 50)) + 10}" r="5"/>`).join("");
    case "pursuing": { // the line run out into a loose wedge after the enemy: arrows ahead, banner leaning forward
      const tip = -d / 2 - 14;
      return `<path class="blk" d="M0 ${tip} L${hw * 0.55} ${-d / 2 + 6} L${hw} ${d / 2} L${hw * 0.45} ${d / 2 - 6} L0 ${d / 2 + 4} L${-hw * 0.45} ${d / 2 - 6} L${-hw} ${d / 2} L${-hw * 0.55} ${-d / 2 + 6} Z"/>`
        + `<path class="arw" d="M${-hw * 0.6} ${tip - 4} v-26 m-11 11 l11 -11 l11 11 M${hw * 0.6} ${tip - 4} v-26 m-11 11 l11 -11 l11 11"/>${banner(-24)}`;
    }
    case "gone":
      return "";
  }
}

const BROKEN: Behaviour[] = ["rout", "retreat"];

/** What the view is framed on: the units seen now (old reports may fall outside it), else everything known. */
export const framePoints = (glyphs: Glyph[]) => { const live = glyphs.filter((g) => g.behaviour !== "gone"), seen = live.filter((g) => g.category === "observed" && !g.stale); return seen.length ? seen : live; };
/** A view box round where the units are (with room for their words), at least `minW` metres wide, in the given
 *  width:height ratio, kept inside the field: the screen frames the fighting instead of the whole map. */
export function frameBox(points: { x: number; y: number }[], field: FieldSpec, aspect: number, minW = 900, margin = 170): string {
  if (!points.length) return `0 0 ${field.width} ${field.height}`;
  let x0 = Math.min(...points.map((p) => p.x)) - margin, x1 = Math.max(...points.map((p) => p.x)) + margin;
  let y0 = Math.min(...points.map((p) => p.y)) - margin, y1 = Math.max(...points.map((p) => p.y)) + margin;
  let w = Math.max(minW, x1 - x0), h = Math.max(y1 - y0, w / aspect);
  w = Math.max(w, h * aspect);
  if (w > field.width) { w = field.width; h = Math.min(field.height, w / aspect); }
  if (h > field.height) { h = field.height; w = Math.min(field.width, h * aspect); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bx = Math.max(0, Math.min(field.width - w, cx - w / 2)), by = Math.max(0, Math.min(field.height - h, cy - h / 2));
  return `${Math.round(bx)} ${Math.round(by)} ${Math.round(w)} ${Math.round(h)}`;
}

export function battleSvg(field: FieldSpec, glyphs: Glyph[], o: { hq?: { x: number; y: number }; showLabels?: boolean; states?: boolean; flash?: FlashStyle; viewBox?: string; ruler?: boolean; extra?: string } = {}): string {
  const wood = field.woods.map((w) => `<rect class="wood" x="${w.x0}" y="${w.y0}" width="${w.x1 - w.x0}" height="${w.y1 - w.y0}" rx="40"/>`).join("");
  const ridge = field.ridges.map((r) => `<rect class="ridge" x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" rx="50"/>`).join("");
  const lines = field.lines.map((l) => `<path class="stream" d="M0 ${l.y} C ${field.width * 0.25} ${l.y - 30}, ${field.width * 0.5} ${l.y + 30}, ${field.width} ${l.y - 10}"/><text class="lbl" x="40" y="${l.y - 14}">${esc(l.name)}</text>`).join("");
  const places = field.places.map((p) => `<text class="lbl pl" x="${p.x + 70}" y="${p.y + 6}">${esc(p.name)}</text>`).join("");
  // three layers: the units, then their names, then the state words on top (the words matter most when units crowd)
  const bodies: string[] = [], names: string[] = [], states: string[] = [];
  for (const g of glyphs.filter((g) => g.behaviour !== "gone")) {
    const known = g.category === "observed" && !g.stale ? "obs" : g.category === "inferred" ? "inf" : "rep";
    const flashing = o.flash && o.flash !== "none" && known === "obs" && BROKEN.includes(g.behaviour);
    const cls = `f ${g.side} b-${g.behaviour} ${known}${g.stale ? " stale" : ""}${flashing ? ` flash-${o.flash}` : ""}`;
    const flip = g.side === "raiders" ? " rotate(180)" : "";
    const age = known === "obs" ? "" : ` · ${g.age < 60 ? "<1 min" : mins(g.age)}`; // a report is never "now"
    const at = `transform="translate(${g.x} ${g.y})"`, tone = `${g.side} ${known}${g.stale ? " stale" : ""}`;
    bodies.push(`<g class="${cls}" data-id="${esc(g.id)}" ${at}><g transform="${flip}">${body(g)}</g></g>`);
    // the name on the side away from the enemy, the state word on the side towards it
    if (o.showLabels !== false) names.push(`<g class="tag ${tone}" ${at}><text class="lbl fl" y="${g.side === "raiders" ? -40 : 60}">${esc(g.label)}${esc(age)}</text></g>`);
    const word = o.states === false ? "" : STATE_WORD[g.behaviour];
    if (word) states.push(`<g class="tag ${tone}" ${at}><text class="lbl st" y="${g.side === "raiders" ? 100 : -78}">${esc(word)}${esc(o.showLabels === false ? age : "")}</text></g>`);
  }
  const fs = bodies.join("") + names.join("") + states.join("");
  const hq = o.hq ? `<g class="hq" transform="translate(${o.hq.x} ${o.hq.y})"><circle r="16"/><path d="M-9 4 l3 -11 l6 6 l6 -6 l3 11 z"/></g>` : "";
  return `<svg class="field" viewBox="${o.viewBox ?? `0 0 ${field.width} ${field.height}`}" role="img" aria-label="Battlefield">${ridge}${wood}${lines}${places}${fs}${hq}${o.extra ?? ""}</svg>`;
}

export const BATTLE_CSS = `
.field { display: block; width: 100%; height: auto; max-height: 78vh; background: var(--land); border-radius: 6px; }
.field .wood { fill: color-mix(in srgb, var(--ok) 30%, var(--land)); stroke: color-mix(in srgb, var(--ok) 55%, var(--land)); stroke-width: 6; }
.field .ridge { fill: color-mix(in srgb, var(--warn) 18%, var(--land)); stroke: color-mix(in srgb, var(--warn) 45%, var(--land)); stroke-width: 5; stroke-dasharray: 18 10; }
.field .stream { fill: none; stroke: #6f9fbf; stroke-width: 16; opacity: .7; }
.field .lbl { font: 600 34px var(--f-body); fill: var(--mute); paint-order: stroke; stroke: var(--land); stroke-width: 8px; }
.field .lbl.fl { font-size: 28px; text-anchor: middle; fill: var(--ink); font-weight: 400; }
.field { --raid: #a0241c; --flash-pink: #ffb6d9; }
.field .f.crown { --c: var(--accent); } .field .f.raiders { --c: var(--raid); }
.field .lbl.st { font-size: 36px; text-anchor: middle; fill: var(--ink); font-weight: 700; letter-spacing: .02em; stroke-width: 10px; }
.field .tag.rep, .field .tag.inf { opacity: .8; } .field .tag.stale { opacity: .45; }
.field .f .blk { fill: var(--c); stroke: var(--ink); stroke-width: 3; }
.field .f .dot { fill: var(--c); }
.field .f .bn line { stroke: var(--ink); stroke-width: 3; } .field .f .bn path { fill: var(--c); stroke: var(--ink); stroke-width: 2; }
.field .f .ring { fill: none; stroke: var(--c); stroke-width: 4; stroke-dasharray: 12 9; }
.field .f .chev, .field .f .arw { fill: none; stroke: var(--c); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
.field .f .rag { stroke-width: 5; }
.field .f.rep .blk, .field .f.rep .dot { fill: color-mix(in srgb, var(--c) 18%, transparent); stroke: var(--c); stroke-dasharray: 10 7; }
.field .f.inf { opacity: .55; } .field .f.inf .blk, .field .f.inf .dot { fill: transparent; stroke: var(--c); stroke-dasharray: 3 6; stroke-width: 4; }
.field .f.stale { opacity: .35; }
.field .hq circle { fill: var(--panel); stroke: var(--accent); stroke-width: 5; } .field .hq path { fill: var(--warn); }
@media (prefers-reduced-motion: no-preference) {
  .field .b-rallying .ring { animation: nm-turn 4s linear infinite; transform-box: fill-box; transform-origin: center; }
  .field .b-disorganised > g { animation: nm-sway 1.6s ease-in-out infinite; }
  .field .b-rout > g { animation: nm-flee 0.9s ease-in-out infinite; }
  .field .b-yielding .chev { animation: nm-step 1.4s ease-in-out infinite; }
}
/* units seen breaking flip to a flash colour and back: once a second, half as fast for viewers who reduce motion */
.field .f.flash-pink { --fl: var(--flash-pink); } .field .f.crown.flash-pale { --fl: #cfe2f3; } .field .f.raiders.flash-pale { --fl: #f4c0ba; }
.field .f.flash-pink .blk, .field .f.flash-pink .dot, .field .f.flash-pink .bn path, .field .f.flash-pale .blk, .field .f.flash-pale .dot, .field .f.flash-pale .bn path { animation: nm-flash 1s steps(1, end) infinite; }
@media (prefers-reduced-motion: reduce) { .field .f.flash-pink .blk, .field .f.flash-pink .dot, .field .f.flash-pink .bn path, .field .f.flash-pale .blk, .field .f.flash-pale .dot, .field .f.flash-pale .bn path { animation-duration: 2s; } }
@keyframes nm-flash { 0% { fill: var(--c); } 50% { fill: var(--fl); } }
@keyframes nm-turn { to { transform: rotate(360deg); } }
@keyframes nm-sway { 0%, 100% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }
@keyframes nm-flee { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(8px); } }
@keyframes nm-step { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
`;
