// The battlefield drawn (Phase 8, BATTLEFIELD §13, §16): terrain, and formations as headquarters knows them. Each
// behaviour has its own shape, and every state but good order carries its word (D-063); how a formation is known
// (observed, reported, inferred, stale) changes the line and the fill, never the shape. An optional flash marks units seen
// breaking. Pure: shared by the game and the clip page.
import type { Behaviour, FieldSpec, Kind, Mark, Side } from "../src/battlefield/core.ts";
import { KNIGHT } from "./maparts.ts";

/** The word shown on a formation for its state; good order is the default and has none. */
export const STATE_WORD: Record<Behaviour, string> = { good_order: "", yielding: "Yielding", disorganised: "Disorganised", rallying: "Rallying", withdrawing: "Withdrawing", retreat: "Retreat", rout: "Rout", pursuing: "Pursuing", gone: "" };
/** How units seen breaking are made to stand out: not at all, a flash to light pink, or a flash to a pale tint of their own colour. */
export type FlashStyle = "none" | "pink" | "pale";

export interface Glyph { id: string; side: Side; kind: Kind; label: string; x: number; y: number; behaviour: Behaviour; width: number; category: Mark["category"]; stale: boolean; age: number; shooting?: string }
export const glyphOf = (m: Mark): Glyph => ({ id: m.id, side: m.side, kind: m.kind, label: m.label, x: m.x, y: m.y, behaviour: m.behaviour, width: m.menBand === "few" ? 56 : m.menBand === "some" ? 80 : 104, category: m.category, stale: m.stale, age: m.age, ...(m.shooting ? { shooting: m.shooting } : {}) });

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const mins = (s: number) => (s < 60 ? "now" : `${Math.round(s / 60)} min`);

/** A small, fixed jitter per formation (so a broken line keeps its shape between frames). */
function jit(id: string, i: number, span: number) {
  let h = 2166136261;
  for (const ch of `${id}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % (2 * span + 1)) - span;
}

// ---- the units: smaller blocks (a block is about a formation's frontage), its type drawn finely inside it ----
/** Block depth; widths come from the men (few, some, many). Everything else on a unit is sized from this. */
const D = 30;
/** Type emblems, drawn in a 32-unit box centred on the origin (white on the block, the side's colour for detail lines). */
const ICONS: Record<string, string> = {
  // an arming sword, point up: blade with a fuller, curved cross-guard, wrapped grip, round pommel
  sword: `<path d="M0 -15 L2.4 -11.4 V4.8 H-2.4 V-11.4Z"/><path class="d" d="M0 -11 V3.6" fill="none" stroke-width=".9"/>`
    + `<path d="M-8.6 5 Q-9.8 6.6 -8 7.8 H8 Q9.8 6.6 8.6 5Z"/><rect x="-1.5" y="7.8" width="3" height="5.6" rx=".6"/>`
    + `<path class="d" d="M-1.5 9.4 H1.5 M-1.5 11.2 H1.5" fill="none" stroke-width=".7"/><circle cy="14.6" r="2.3"/>`,
  // a bow drawn, the arrow nocked and pointing at the enemy
  bow: `<path class="s" d="M-13 5 C-8 -9.5 8 -9.5 13 5" stroke-width="2.6"/><path class="s" d="M-13 5 q-1.6 1 -1.2 2.8 M13 5 q1.6 1 1.2 2.8" stroke-width="1.6"/>`
    + `<path class="s" d="M-13 5 L0 11.5 L13 5" stroke-width=".9"/><path class="s" d="M0 13.5 V-10.5" stroke-width="1.5"/><path d="M0 -16.5 L3.3 -10 L-3.3 -10Z"/>`
    + `<path class="s" d="M0 13.5 l-2.7 2.7 M0 13.5 l2.7 2.7 M0 11 l-2.7 2.7 M0 11 l2.7 2.7" stroke-width="1"/>`,
  // a horse's head and neck with mane, ear, eye, nostril and bridle
  horse: `<path d="M-10 15 C-11 7 -9 0 -5 -5 L-5.5 -12.5 L-2.3 -8.3 L-1 -12.8 L1.2 -8 C4.5 -8.5 7.5 -6.3 9.7 -2.2 L13.6 4.6 C14.4 6.4 13.2 8.2 11.2 7.9 L7.2 6.6 C5.6 6.4 4.2 7.3 3.4 9 L1.6 15Z"/>`
    + `<path class="d" d="M-5 -5 C-8.4 -1 -10 4 -10.2 10" fill="none" stroke-width=".8"/>`
    + `<path d="M-5.6 -8.6 L-8.4 -8 L-8.6 -5.2 L-11.8 -4.2 L-10.8 -1.2 L-13.2 1.2 L-11.8 3.8 L-12.6 7.6 L-10.4 9 C-10.3 3.6 -8.6 -1.2 -5 -5Z" opacity=".8"/>`
    + `<circle class="d" cx="4.2" cy="-3" r="1.15"/><circle class="d" cx="11.7" cy="5.1" r=".8"/>`
    + `<path class="d" d="M1.4 -7.6 L8.8 4.6 M3.8 -2.6 L-.4 3.6 M13.6 6.6 L11.2 6.9" fill="none" stroke-width=".85"/>`,
  // the queen's guard: a crown with jewels
  crown: `<path d="M-12 5.5 L-13.4 -6.5 L-6 0 L0 -10 L6 0 L13.4 -6.5 L12 5.5Z"/><rect x="-12.6" y="5.5" width="25.2" height="5" rx="1"/>`
    + `<circle cx="-13.4" cy="-7.6" r="1.9"/><circle cx="0" cy="-11.4" r="2"/><circle cx="13.4" cy="-7.6" r="1.9"/>`
    + `<circle class="d" cx="-6.5" cy="8" r="1.2"/><circle class="d" cx="0" cy="8" r="1.4"/><circle class="d" cx="6.5" cy="8" r="1.2"/>`,
};
const ICON_OF: Record<string, string> = { foot: "sword", warband: "sword", archers: "bow", bowmen: "bow", horse: "horse", riders: "horse", guard: "crown" };
const isCaptain = (g: Glyph) => g.side === "crown" && g.kind === "foot" && /^\S+'s /.test(g.label); // a captain's company is named for him
function icon(g: Glyph): string {
  const cap = isCaptain(g), s = (D - 4) / 32;
  // the bow points at the enemy: up the field for the crown, down it for the raiders
  const flip = ICON_OF[g.kind] === "bow" && g.side === "raiders" ? ` scale(1 -1)` : "";
  const t = `<g class="ic" transform="translate(${cap ? 9 : 0} 0) scale(${s.toFixed(3)})${flip}">${ICONS[ICON_OF[g.kind] ?? "sword"]}</g>`;
  const k = cap ? `<g class="ic-k" transform="translate(${-g.width / 2 + 13} 1) scale(.62)">${KNIGHT}</g>` : "";
  return t + k;
}

/** One formation, centred on the origin, facing up (crown) or down (raiders: the caller flips it). */
function body(g: Glyph): string {
  const w = g.width, d = D, hw = w / 2, pole = 22, banner = (tilt = 0) => `<g class="bn" transform="rotate(${tilt})"><line x1="0" y1="${-d / 2}" x2="0" y2="${-d / 2 - pole}"/><path d="M0 ${-d / 2 - pole} h14 l-4 4.5 l4 4.5 h-14z"/></g>`;
  switch (g.behaviour) {
    case "good_order":
      return `<rect class="blk" x="${-hw}" y="${-d / 2}" width="${w}" height="${d}" rx="2"/>${banner()}`;
    case "yielding": // in line, facing the enemy, stepping back: chevrons behind
      return `<rect class="blk" x="${-hw}" y="${-d / 2 + 3}" width="${w}" height="${d - 6}" rx="2"/>${banner(-6)}<path class="chev" d="M${-hw / 2 - 9} ${d / 2 + 8} l9 8 l9 -8 M${hw / 2 - 9} ${d / 2 + 8} l9 8 l9 -8"/>`;
    case "disorganised": { // the line broken into uneven pieces, the banner leaning
      const n = 4, pw = w / n;
      return Array.from({ length: n }, (_, i) => `<rect class="blk" x="${-hw + i * pw + jit(g.id, i, 3)}" y="${-d / 2 + jit(g.id, i + 9, 5)}" width="${pw - 5 + jit(g.id, i + 3, 2)}" height="${d - 6 + jit(g.id, i + 5, 3)}" rx="2"/>`).join("") + banner(22);
    }
    case "rallying": // men gathering round an upright banner, inside a turning ring
      return `<circle class="ring" r="${hw * 0.75 + 10}"/>` + Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * 2 * Math.PI, r = hw * 0.55; return `<circle class="dot" cx="${(Math.cos(a) * r).toFixed(0)}" cy="${(Math.sin(a) * r * 0.6).toFixed(0)}" r="5"/>`; }).join("") + banner();
    case "withdrawing": // intact, moving back in order: one straight arrow to the rear
      return `<rect class="blk" x="${-hw}" y="${-d / 2}" width="${w}" height="${d}" rx="2"/>${banner()}<path class="arw" d="M0 ${d / 2 + 4} v22 m-8 -8 l8 8 l8 -8"/>`;
    case "retreat": // stretched and ragged, streaming back
      return `<path class="blk" d="M${-hw} ${-d / 2} L${hw} ${-d / 2 + 4} L${hw * 0.7} ${d / 2 + 12} L${hw * 0.3} ${d / 2 + 3} L${hw * 0.1} ${d / 2 + 20} L${-hw * 0.3} ${d / 2 + 5} L${-hw * 0.6} ${d / 2 + 16} Z"/><path class="arw rag" d="M-7 ${d / 2 + 23} l4 7 l-3 3 l5 8 m-6 -5 l6 5 l4 -8"/>`;
    case "rout": // scattered men running, no banner, no line
      return Array.from({ length: 14 }, (_, i) => `<circle class="dot" cx="${jit(g.id, i, Math.floor(hw * 1.2))}" cy="${Math.abs(jit(g.id, i + 20, 34)) + 6}" r="3.5"/>`).join("");
    case "pursuing": { // the line run out into a loose wedge after the enemy: arrows ahead, banner leaning forward
      const tip = -d / 2 - 10;
      return `<path class="blk" d="M0 ${tip} L${hw * 0.55} ${-d / 2 + 4} L${hw} ${d / 2} L${hw * 0.45} ${d / 2 - 4} L0 ${d / 2 + 3} L${-hw * 0.45} ${d / 2 - 4} L${-hw} ${d / 2} L${-hw * 0.55} ${-d / 2 + 4} Z"/>`
        + `<path class="arw" d="M${-hw * 0.6} ${tip - 3} v-18 m-7 7 l7 -7 l7 7 M${hw * 0.6} ${tip - 3} v-18 m-7 7 l7 -7 l7 7"/>${banner(-24)}`;
    }
    case "gone":
      return "";
  }
}

/** Arrows in flight from a shooting formation and falling on its target: a dashed arc and a scatter of shafts. */
function volley(a: Glyph, b: Glyph): string {
  const dir = a.side === "crown" ? -1 : 1, x0 = a.x, y0 = a.y + dir * (D / 2 + 4), x1 = b.x, y1 = b.y - dir * 6;
  const len = Math.hypot(x1 - x0, y1 - y0), cx = (x0 + x1) / 2 - (y1 - y0) * 0.18, cy = (y0 + y1) / 2 - len * 0.22;
  const ang = Math.atan2(y1 - cy, x1 - cx), ux = Math.cos(ang), uy = Math.sin(ang);
  // each shaft: a line with a head where it lands and a feathered tail
  const shafts = Array.from({ length: 12 }, (_, i) => {
    const px = x1 + jit(`${a.id}>${b.id}`, i, Math.floor(b.width / 2) + 6), py = y1 + jit(`${a.id}>${b.id}`, i + 30, 18);
    const tx = px - ux * 16, ty = py - uy * 16, nx = -uy, ny = ux;
    const head = `M${(px + nx * 2.6 - ux * 4).toFixed(1)} ${(py + ny * 2.6 - uy * 4).toFixed(1)} L${px.toFixed(1)} ${py.toFixed(1)} L${(px - nx * 2.6 - ux * 4).toFixed(1)} ${(py - ny * 2.6 - uy * 4).toFixed(1)}`;
    const tail = `M${(tx + nx * 2.4 - ux * 3).toFixed(1)} ${(ty + ny * 2.4 - uy * 3).toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${(tx - nx * 2.4 - ux * 3).toFixed(1)} ${(ty - ny * 2.4 - uy * 3).toFixed(1)}`;
    return `<path d="M${tx.toFixed(1)} ${ty.toFixed(1)} L${px.toFixed(1)} ${py.toFixed(1)} ${head} ${tail}" style="animation-delay:-${((i * 137) % 900) / 1000}s"/>`;
  }).join("");
  return `<g class="vol ${a.side}"><path class="arc" d="M${x0} ${y0} Q${cx.toFixed(0)} ${cy.toFixed(0)} ${x1} ${y1}"/><g class="rain">${shafts}</g></g>`;
}

// ---- the ground: meadow, farmland on our side, a track, the ridge as a hill, the wood as trees, the stream and its ford,
// the fort's wall at the gate and the raiders' tents at their camp. Fixed for a field, so it is drawn the same every time. ----
function rnd(key: string, i: number) { let h = 2166136261; for (const ch of `${key}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }
const fmt = (n: number) => n.toFixed(0);
const terrainCache = new Map<FieldSpec, string>();
function terrain(field: FieldSpec): string {
  const hit = terrainCache.get(field);
  if (hit) return hit;
  const W = field.width, H = field.height, P = (id: string) => field.places.find((p) => p.id === id);
  const defs = `<defs>
    <filter id="nmf-mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 .30  0 0 0 0 .40  0 0 0 0 .18  1.6 0 0 0 -.62"/></filter>
    <filter id="nmf-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .25  0 0 0 0 .30  0 0 0 0 .12  1.4 0 0 0 -.68"/></filter>
    <pattern id="nmf-furrow" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><rect width="14" height="14" fill="#cbbd86"/><path d="M0 7 H14" stroke="#a8955f" stroke-width="3"/></pattern>
    <pattern id="nmf-furrow2" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-76)"><rect width="14" height="14" fill="#b9c27e"/><path d="M0 7 H14" stroke="#98a35e" stroke-width="3"/></pattern>
    <linearGradient id="nmf-hill" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#d8d39a"/><stop offset=".55" stop-color="#bdb67a"/><stop offset="1" stop-color="#99945c"/></linearGradient>
  </defs>`;
  const out: string[] = [defs, `<rect width="${W}" height="${H}" fill="#b7c48a"/><rect width="${W}" height="${H}" filter="url(#nmf-mottle)"/>`];
  // farmland and hedges behind our line
  const gate = P("gate");
  if (gate) {
    const fy = Math.min(H - 40, gate.y - 230);
    out.push(`<path d="M60 ${fy + 30} L${gate.x - 200} ${fy} L${gate.x - 160} ${H} L40 ${H}Z" fill="url(#nmf-furrow)" opacity=".85"/>`);
    out.push(`<path d="M${gate.x + 190} ${fy + 20} L${W - 120} ${fy - 20} L${W - 60} ${H} L${gate.x + 150} ${H}Z" fill="url(#nmf-furrow2)" opacity=".85"/>`);
    out.push(`<path class="hedge" d="M60 ${fy + 30} L${gate.x - 200} ${fy} M${gate.x + 190} ${fy + 20} L${W - 120} ${fy - 20}"/>`);
  }
  out.push(`<rect width="${W}" height="${H}" filter="url(#nmf-grain)"/>`);
  // the track from the gate past the ridge and the ford to the camp
  const way = ["gate", "ridge", "ford", "camp"].map(P).filter((p): p is NonNullable<typeof p> => !!p);
  if (way.length > 1) {
    const pts = [{ x: way[0].x, y: H }, ...way];
    const d = pts.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `S${fmt(p.x + (i % 2 ? 70 : -60))} ${fmt((p.y + pts[i - 1].y) / 2)} ${p.x} ${p.y}`)).join(" ") + ` L${way[way.length - 1].x} 0`;
    out.push(`<path class="track-edge" d="${d}"/><path class="track" d="${d}"/>`);
  }
  // the ridge: a low hill with contour lines and its south slope in shadow
  for (const r of field.ridges) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, rx = (r.x1 - r.x0) / 2, ry = (r.y1 - r.y0) / 2;
    out.push(`<ellipse cx="${cx}" cy="${cy + 10}" rx="${rx + 40}" ry="${ry + 34}" fill="#8f8a55" opacity=".25"/>`);
    for (let k = 0; k < 4; k++) {
      const s = 1 - k * 0.22, wob = (i: number) => (rnd(r.id, i + k * 20) - 0.5) * 18 * s;
      const pts = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * 2 * Math.PI; return [cx + Math.cos(a) * (rx * s + wob(i)), cy - k * 6 + Math.sin(a) * (ry * s + wob(i + 40))]; });
      // a smooth closed curve through the midpoints, the points as controls
      const mid = (i: number) => { const p = pts[i % pts.length], q = pts[(i + 1) % pts.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
      const d = `M${fmt(mid(0)[0])} ${fmt(mid(0)[1])} ` + pts.map((_, i) => `Q${fmt(pts[(i + 1) % pts.length][0])} ${fmt(pts[(i + 1) % pts.length][1])} ${fmt(mid(i + 1)[0])} ${fmt(mid(i + 1)[1])}`).join(" ") + "Z";
      out.push(`<path d="${d}" fill="url(#nmf-hill)" opacity="${k === 0 ? 1 : 0.55}" stroke="#7d7748" stroke-opacity=".55" stroke-width="2.2" stroke-linejoin="round"/>`);
    }
  }
  // the stream with its banks, and the ford: shallows and stones
  for (const l of field.lines) {
    const d = `M0 ${l.y} C ${W * 0.25} ${l.y - 30}, ${W * 0.5} ${l.y + 30}, ${W} ${l.y - 10}`;
    out.push(`<path d="${d}" fill="none" stroke="#7f8a55" stroke-width="40" opacity=".55"/><path d="${d}" fill="none" stroke="#5b8fb0" stroke-width="22"/><path d="${d}" fill="none" stroke="#a7cbe0" stroke-width="3" stroke-dasharray="40 26" opacity=".9"/>`);
    const ford = P("ford");
    if (ford) {
      const fy = l.y + 2;
      out.push(`<ellipse cx="${ford.x}" cy="${fy}" rx="70" ry="22" fill="#c9c08f" opacity=".9"/>`);
      for (let i = 0; i < 14; i++) out.push(`<ellipse cx="${fmt(ford.x - 60 + rnd("ford", i) * 120)}" cy="${fmt(fy - 14 + rnd("ford", i + 50) * 28)}" rx="${fmt(4 + rnd("ford", i + 9) * 4)}" ry="3.5" fill="#8d8a7c"/>`);
    }
  }
  // the wood: a dark floor under many crowns, with a ragged edge; a few lone trees and bushes about the field
  const tree = (x: number, y: number, r: number, key: string) => `<circle cx="${fmt(x + 3)}" cy="${fmt(y + 4)}" r="${fmt(r)}" fill="#3d5230" opacity=".5"/><circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="${rnd(key, 7) < 0.5 ? "#55753c" : "#4d6c37"}"/><circle cx="${fmt(x - r * 0.3)}" cy="${fmt(y - r * 0.3)}" r="${fmt(r * 0.5)}" fill="#7a9a52" opacity=".75"/>`;
  for (const w of field.woods) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, rx = (w.x1 - w.x0) / 2, ry = (w.y1 - w.y0) / 2;
    const edge = Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * 2 * Math.PI, k = 0.92 + rnd(w.id, i) * 0.16; return `${i ? "L" : "M"}${fmt(cx + Math.cos(a) * rx * k * 1.05)} ${fmt(cy + Math.sin(a) * ry * k * 1.05)}`; }).join(" ") + "Z";
    out.push(`<path d="${edge}" fill="#3f5a2f"/>`);
    for (let y = w.y0 + 14; y <= w.y1 - 6; y += 30) for (let x = w.x0 + 10; x <= w.x1 - 6; x += 32) {
      const i = x * 7 + y, jx = x + (rnd(w.id, i) - 0.5) * 22, jy = y + (rnd(w.id, i + 1) - 0.5) * 18;
      const nx = (jx - cx) / rx, ny = (jy - cy) / ry;
      if (nx * nx + ny * ny > 1.02) continue;
      out.push(tree(jx, jy, 17 + rnd(w.id, i + 2) * 9, `${w.id}${i}`));
    }
  }
  const clear = (x: number, y: number) => !field.woods.some((w) => x > w.x0 - 60 && x < w.x1 + 60 && y > w.y0 - 60 && y < w.y1 + 60) && !field.ridges.some((r) => x > r.x0 - 40 && x < r.x1 + 40 && y > r.y0 - 40 && y < r.y1 + 40) && !field.lines.some((l) => Math.abs(y - l.y) < 60) && Math.abs(x - W / 2) > 120;
  for (let i = 0; i < 70; i++) {
    const x = rnd("lone", i) * W, y = rnd("lone", i + 500) * H;
    if (!clear(x, y)) continue;
    out.push(i % 3 ? `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(9 + rnd("lone", i + 9) * 8)}" ry="7" fill="#6f8a46" opacity=".8"/>` : tree(x, y, 14 + rnd("lone", i + 3) * 8, `lone${i}`));
    if (i % 5 === 0) out.push(`<ellipse cx="${fmt(x + 30)}" cy="${fmt(y + 12)}" rx="6" ry="4" fill="#9a9787"/>`);
  }
  // the fort's wall behind the gate
  if (gate) {
    const wy = Math.min(H - 18, gate.y + 70);
    const merlons = Array.from({ length: 22 }, (_, i) => `<rect x="${gate.x - 330 + i * 30}" y="${wy - 10}" width="16" height="10" fill="#9d978a" stroke="#6e695f" stroke-width="2"/>`).join("");
    out.push(`<rect x="${gate.x - 330}" y="${wy}" width="660" height="26" fill="#b0aa9c" stroke="#6e695f" stroke-width="2.5"/>${merlons}<rect x="${gate.x - 40}" y="${wy - 26}" width="80" height="52" fill="#a49e90" stroke="#6e695f" stroke-width="2.5"/><path d="M${gate.x - 16} ${wy + 26} V${wy + 4} Q${gate.x} ${wy - 10} ${gate.x + 16} ${wy + 4} V${wy + 26}Z" fill="#4b4339"/>`);
  }
  // the raiders' tents round their camp
  const camp = P("camp");
  if (camp) for (let i = 0; i < 7; i++) {
    const x = camp.x - 150 + i * 50 + (rnd("camp", i) - 0.5) * 20, y = camp.y - 40 + (rnd("camp", i + 9) - 0.5) * 50;
    out.push(`<path d="M${fmt(x - 16)} ${fmt(y + 12)} L${fmt(x)} ${fmt(y - 14)} L${fmt(x + 16)} ${fmt(y + 12)}Z" fill="#8a5a3c" stroke="#4e3324" stroke-width="2"/><path d="M${fmt(x)} ${fmt(y - 14)} L${fmt(x + 2)} ${fmt(y + 12)}" stroke="#4e3324" stroke-width="2"/>`);
  }
  const svg = out.join("");
  terrainCache.set(field, svg);
  return svg;
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
  const lines = field.lines.map((l) => `<text class="lbl pl" x="40" y="${l.y - 26}">${esc(l.name)}</text>`).join("");
  const places = field.places.map((p) => `<text class="lbl pl" x="${p.x + 60}" y="${p.y + 6}">${esc(p.name)}</text>`).join("");
  // layers: arrows in flight, the units, their type emblems, report ages, then the state words on top
  const live = glyphs.filter((g) => g.behaviour !== "gone"), byId = new Map(live.map((g) => [g.id, g]));
  const vols = live.filter((g) => g.shooting && byId.has(g.shooting)).map((g) => volley(g, byId.get(g.shooting!)!)).join("");
  const bodies: string[] = [], names: string[] = [], states: string[] = [], icons: string[] = [];
  for (const g of live) {
    const known = g.category === "observed" && !g.stale ? "obs" : g.category === "inferred" ? "inf" : "rep";
    const flashing = o.flash && o.flash !== "none" && known === "obs" && BROKEN.includes(g.behaviour);
    const cls = `f ${g.side} b-${g.behaviour} ${known}${g.stale ? " stale" : ""}${flashing ? ` flash-${o.flash}` : ""}`;
    const flip = g.side === "raiders" ? " rotate(180)" : "";
    const age = known === "obs" ? "" : `${g.age < 60 ? "<1 min" : mins(g.age)}`; // a report is never "now"
    const at = `transform="translate(${g.x} ${g.y})"`, tone = `${g.side} ${known}${g.stale ? " stale" : ""}`;
    bodies.push(`<g class="${cls}" data-id="${esc(g.id)}" ${at}><g transform="${flip}">${body(g)}</g></g>`);
    // names are off unless asked for; what stays is the age of a report, so an old sighting is never read as fresh.
    // The age sits on the side away from the enemy, the state word on the side towards it.
    const name = o.showLabels === true ? esc(g.label) + (age ? " · " : "") : "";
    if (name || age) names.push(`<g class="tag ${tone}" ${at}><text class="lbl fl" y="${g.side === "raiders" ? -26 : 44}">${name}${esc(age)}</text></g>`);
    if (g.behaviour !== "rout") icons.push(`<g class="tag ${tone}" ${at}>${icon(g)}</g>`);
    const word = o.states === false ? "" : STATE_WORD[g.behaviour];
    if (word) states.push(`<g class="tag ${tone}" ${at}><text class="lbl st" y="${g.side === "raiders" ? 64 : -44}">${esc(word)}</text></g>`);
  }
  const fs = vols + bodies.join("") + icons.join("") + names.join("") + states.join("");
  const hq = o.hq ? `<g class="hq" transform="translate(${o.hq.x} ${o.hq.y})"><circle r="13"/><path d="M-7 3 l2.4 -9 l4.6 4.6 l4.6 -4.6 l2.4 9 z"/></g>` : "";
  return `<svg class="field" viewBox="${o.viewBox ?? `0 0 ${field.width} ${field.height}`}" role="img" aria-label="Battlefield">${terrain(field)}${lines}${places}${fs}${hq}${o.extra ?? ""}</svg>`;
}

export const BATTLE_CSS = `
.field { display: block; width: 100%; height: auto; max-height: 78vh; border-radius: 6px; background: #b7c48a;
  --land: #c9d19e; --ink: #1f2a2e; --mute: #3f4a35; --panel: #f4f1e4; --warn: #a8701a; --crown: #24527a; --raid: #9a1f17; --flash-pink: #ffb6d9; }
.field .track-edge { fill: none; stroke: #8f7f57; stroke-width: 30; stroke-linecap: round; opacity: .55; }
.field .track { fill: none; stroke: #c8b38a; stroke-width: 22; stroke-linecap: round; }
.field .hedge { fill: none; stroke: #4f6b37; stroke-width: 10; stroke-linecap: round; stroke-dasharray: 14 6; }
.field .lbl { font: 600 28px var(--f-body); fill: var(--mute); paint-order: stroke; stroke: var(--land); stroke-width: 7px; stroke-linejoin: round; }
.field .lbl.pl { font-style: italic; font-weight: 600; fill: #3b3a2a; }
.field .lbl.fl { font-size: 21px; text-anchor: middle; fill: var(--ink); font-weight: 600; }
.field .lbl.st { font-size: 25px; text-anchor: middle; fill: var(--ink); font-weight: 700; letter-spacing: .02em; stroke-width: 9px; }
.field .crown { --c: var(--crown); } .field .raiders { --c: var(--raid); }
.field .ic { fill: #fff; } .field .ic .s { fill: none; stroke: #fff; stroke-linecap: round; stroke-linejoin: round; }
.field .ic .d { fill: var(--c); stroke: var(--c); stroke-linecap: round; }
.field .tag.rep .ic, .field .tag.inf .ic { fill: var(--c); } .field .tag.rep .ic .s, .field .tag.inf .ic .s { stroke: var(--c); } .field .tag.rep .ic .d, .field .tag.inf .ic .d { fill: #fff; stroke: #fff; }
.field .ic-k { fill: #fff; stroke: #1f2a2e; stroke-width: 1.4; }
.field .tag.rep, .field .tag.inf { opacity: .85; } .field .tag.stale { opacity: .45; }
.field .f .blk { fill: var(--c); stroke: #10171a; stroke-width: 2; }
.field .f .dot { fill: var(--c); stroke: #10171a; stroke-width: 1; }
.field .f .bn line { stroke: #10171a; stroke-width: 2; } .field .f .bn path { fill: var(--c); stroke: #10171a; stroke-width: 1.5; }
.field .f .ring { fill: none; stroke: var(--c); stroke-width: 3; stroke-dasharray: 9 7; }
.field .f .chev, .field .f .arw { fill: none; stroke: var(--c); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.field .f .rag { stroke-width: 3.5; }
.field .f.rep .blk, .field .f.rep .dot { fill: color-mix(in srgb, var(--c) 22%, transparent); stroke: var(--c); stroke-dasharray: 7 5; stroke-width: 2.5; }
.field .f.inf { opacity: .6; } .field .f.inf .blk, .field .f.inf .dot { fill: transparent; stroke: var(--c); stroke-dasharray: 2 5; stroke-width: 3; }
.field .f.stale { opacity: .35; }
.field .vol .arc { fill: none; stroke: #1c170f; stroke-width: 2; stroke-dasharray: 4 10; opacity: .75; }
.field .vol .rain path { fill: none; stroke: #1c170f; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.field .hq circle { fill: var(--panel); stroke: var(--crown); stroke-width: 4; } .field .hq path { fill: var(--warn); }
@media (prefers-reduced-motion: no-preference) {
  .field .vol .arc { animation: nm-fly .8s linear infinite; }
  .field .vol .rain path { animation: nm-rain .9s ease-in infinite; }
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
@keyframes nm-fly { to { stroke-dashoffset: -28; } }
@keyframes nm-rain { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: .15; } }
@keyframes nm-turn { to { transform: rotate(360deg); } }
@keyframes nm-sway { 0%, 100% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
@keyframes nm-flee { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
@keyframes nm-step { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
`;
