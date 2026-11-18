'use strict';
// Shared hand-drawing kit: palette, seeded wobble, sketch primitives and stroke lettering.
// Loaded by both the game screen and the phone controller.
const INK = '#1818e0', INK_SOFT = '#6c6cf0', GRAPH = '#2a2a31', DESK = '#d6c9b1', NAVY = '#0a0a6e', SHADE = '#6b5a45';
const PAPER_COL = '#fdfdfb';

// ---------------------------------------------------------------- random
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(n) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
function vnoise(seed, x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = hash((i * 374761393 + seed * 668265263) | 0), b = hash(((i + 1) * 374761393 + seed * 668265263) | 0);
  return (a + (b - a) * u) * 2 - 1;
}
let boil = 0;              // advances a few times a second: every hand-drawn mark is redrawn slightly differently
const rngAt = (a, b, c) => mulberry((Math.round(a * 3) * 73856093) ^ (Math.round(b * 3) * 19349663) ^ ((c | 0) * 83492791) ^ (boil * 7919));

// ---------------------------------------------------------------- sketch primitives
function sline(c, x0, y0, x1, y1, lw, col, jit = 0.8) {
  const r = rngAt(x0 + x1, y0 + y1, lw * 10);
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const j = () => (r() - 0.5) * 2 * jit;
  const bow = (r() - 0.5) * len * 0.03;
  c.strokeStyle = col; c.lineWidth = lw;
  c.beginPath();
  c.moveTo(x0 + j(), y0 + j());
  c.quadraticCurveTo((x0 + x1) / 2 - dy / len * bow, (y0 + y1) / 2 + dx / len * bow, x1 + j(), y1 + j());
  c.stroke();
}
function sRoundRect(c, x, y, w, h, r, lw, col, jit = 0.7) {
  const rn = rngAt(x + w, y + h, r);
  const j = () => (rn() - 0.5) * 2 * jit;
  c.strokeStyle = col; c.lineWidth = lw;
  c.beginPath();
  c.moveTo(x + r + j(), y + j());
  c.arcTo(x + w + j(), y + j(), x + w + j(), y + h + j(), r);
  c.arcTo(x + w + j(), y + h + j(), x + j(), y + h + j(), r);
  c.arcTo(x + j(), y + h + j(), x + j(), y + j(), r);
  c.arcTo(x + j(), y + j(), x + w + j(), y + j(), r);
  c.closePath(); c.stroke();
}
function sEllipse(c, cx, cy, rx, ry, lw, col) {
  const seed = (Math.round(cx) * 31 + Math.round(cy) * 17 + boil * 101) | 0;
  c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
  const start = -2.4 + vnoise(seed, 0.5) * 0.2;
  for (let i = 0; i <= 46; i++) {
    const t = start + i / 42 * Math.PI * 2;
    const k = 1 + vnoise(seed, i / 9) * 0.045 + i * 0.0012;
    const px = cx + Math.cos(t) * rx * k, py = cy + Math.sin(t) * ry * k;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.stroke();
}
function dashLine(c, x0, y0, x1, y1, dash, gap, lw, col) {
  const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    sline(c, x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e, lw, col, 0.5);
  }
}
function drawScissors(c, x, y, ang, size, open, col, lw) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw;
  const a = 0.07 + open * 0.42, bl = size * 0.62, hl = size * 0.36, hr = size * 0.15;
  for (const s of [-1, 1]) {
    const ca = Math.cos(a * s), sa = Math.sin(a * s);
    c.beginPath();                                   // blade: a thin leaf from pivot to tip
    c.moveTo(-ca * size * 0.08, -sa * size * 0.08);
    c.quadraticCurveTo(ca * bl * 0.5 - sa * size * 0.09 * s, sa * bl * 0.5 + ca * size * 0.09 * s, ca * bl, sa * bl);
    c.lineTo(0, 0);
    c.stroke();
    const hx = -ca * hl, hy = sa * hl;               // handle crosses to the other side
    c.beginPath(); c.moveTo(0, 0); c.lineTo(hx + ca * hr, hy - sa * hr); c.stroke();
    c.beginPath(); c.ellipse(hx - ca * hr * 0.4, hy + sa * hr * 0.4, hr * 1.25, hr, -a * s, 0, 7); c.stroke();
  }
  c.beginPath(); c.arc(0, 0, Math.max(1, lw * 0.75), 0, 7); c.fill();
  c.restore();
}
function drawTool(c, x, y, ang, len, pencil) {
  c.save(); c.translate(x, y); c.rotate(ang);
  const col = pencil ? GRAPH : INK, hw = 9;
  const L = (a, b, d, e, lw = 2.2) => sline(c, a, b, d, e, lw, col, 0.55);
  L(0, 0, 30, -hw); L(0, 0, 30, hw);
  L(30, -hw, len, -hw); L(30, hw, len, hw); L(len, -hw, len, hw);
  if (pencil) {
    c.fillStyle = col; c.beginPath(); c.moveTo(-1, 0); c.lineTo(10, -3.4); c.lineTo(10, 3.4); c.fill();
    for (let i = 0; i < 2; i++) { const yy = -hw + i * hw; L(30, yy, 36, yy + hw / 2, 1.2); L(36, yy + hw / 2, 30, yy + hw, 1.2); }
    L(38, -3, len - 42, -3, 1.1); L(38, 3, len - 42, 3, 1.1);
    L(len - 42, -hw, len - 42, hw); L(len - 24, -hw, len - 24, hw);
    for (let i = 1; i < 4; i++) L(len - 42 + i * 4.5, -hw, len - 42 + i * 4.5, hw, 1);
  } else {
    L(30, -hw, 30, hw, 1.4); L(9, 0, 27, 0, 1.2);
    L(len - 92, -hw, len - 92, hw, 1.4);
    L(len - 86, -hw - 5, len - 22, -hw - 5); L(len - 86, -hw - 5, len - 86, -hw); L(len - 22, -hw - 5, len - 17, -hw);
  }
  for (let xx = 44; xx < len - (pencil ? 46 : 6); xx += 5.5) L(xx, hw - 1, xx - 4.5, hw - 7, 0.9);
  c.restore();
}

// ---------------------------------------------------------------- stroke lettering
// Single-line capitals on a 4x6 grid. Two-point strokes are ruled lines, longer ones are curves.
const GDEF = {
  A: '0,6 2,0|2,0 4,6|0.9,4 3.1,4', B: '0,0 0,6|0,0 4,0 4,3 0,3|0,3 4.7,3 4.7,6 0,6',
  C: '4,1.2 3,0 1,0 0,2 0,4 1,6 3,6 4,4.8', D: '0,0 0,6|0,0 4.6,0 4.6,6 0,6',
  E: '0,0 0,6|0,0 3.8,0|0,3 3,3|0,6 3.8,6', F: '0,0 0,6|0,0 3.8,0|0,3 3,3',
  G: '4,1.2 3,0 1,0 0,2 0,4 1,6 3,6 4,5 4,3.4|4,3.4 2.2,3.4', H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '2:1,0 1,6', J: '3,0 3,4.5 3,6 1.5,6 0,6 0,4.5', K: '0,0 0,6|4,0 0,3.6|1.4,2.6 4,6',
  L: '0,0 0,6|0,6 3.6,6', M: '5:0,6 0,0|0,0 2.5,4|2.5,4 5,0|5,0 5,6', N: '0,6 0,0|0,0 4,6|4,6 4,0',
  O: '2,0 0,0 0,3 0,6 2,6 4,6 4,3 4,0 2,0', P: '0,0 0,6|0,0 4.6,0 4.6,3.2 0,3.2',
  Q: '2,0 0,0 0,3 0,6 2,6 4,6 4,3 4,0 2,0|2.6,4.4 4.3,6.5', R: '0,0 0,6|0,0 4.6,0 4.6,3.2 0,3.2|1.8,3.2 4,6',
  S: '4,1 3.4,0 2,0 0,0 0,1.6 0,3 2,3 4,3 4,4.5 4,6 2,6 0.6,6 0,5', T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,4 0,6 2,6 4,6 4,4 4,0', V: '0,0 2,6|2,6 4,0', W: '5:0,0 1.2,6|1.2,6 2.5,1.6|2.5,1.6 3.8,6|3.8,6 5,0',
  X: '0,0 4,6|4,0 0,6', Y: '0,0 2,3|4,0 2,3|2,3 2,6', Z: '0,0 4,0|4,0 0,6|0,6 4,6',
  0: '2,0 0,0 0,3 0,6 2,6 4,6 4,3 4,0 2,0', 1: '3:0.5,1.3 2,0|2,0 2,6',
  2: '0,1.2 0.5,0 2,0 4,0 4,1.6 4,3 0,6|0,6 4,6', 3: '0,0.8 1,0 2,0 4,0 4,1.5 4,3 1.5,3|1.5,3 4,3 4,4.5 4,6 2,6 1,6 0,5.2',
  4: '3,6 3,0|3,0 0,4|0,4 4,4', 5: '3.8,0 0.4,0|0.4,0 0.2,2.6|0.2,2.6 2,2.1 4,2.1 4,4 4,6 2,6 0.8,6 0,5',
  6: '3.6,0 1,0.5 0,3 0,4.5 0,6 2,6 4,6 4,4.4 4,2.8 2,2.8 0.6,2.8 0,4.4', 7: '0,0 4,0|4,0 1.4,6',
  8: '2,0 0.2,0 0.2,1.5 0.2,3 2,3 4,3 4,4.5 4,6 2,6 0,6 0,4.5 0,3 2,3 3.8,3 3.8,1.5 3.8,0 2,0',
  9: '4,2 4,3.4 2,3.4 0,3.4 0,1.7 0,0 2,0 4,0 4,2 4,5 2.5,6 0.6,6',
  '.': '1:0.4,5.7 0.6,6', ',': '1:0.7,5.4 0.2,6.9', '!': '1:0.5,0 0.5,4.2|0.5,5.7 0.5,6',
  '?': '0,1.2 0.5,0 2,0 4,0 4,1.5 4,3 2,3 2,4.2|2,5.7 2,6', ':': '1:0.5,1.9 0.5,2.2|0.5,5.5 0.5,5.8',
  '-': '3:0.2,3.2 2.8,3.2', "'": '1:0.6,0 0.3,1.5', '/': '3:3,0 0,6', '+': '3:0,3 3,3|1.5,1.5 1.5,4.5',
};
const GLYPH = {}, GAP = 1.5, SPACE = 2.8;
for (const k in GDEF) {
  let d = GDEF[k], w = 4;
  if (d[1] === ':') { w = +d[0]; d = d.slice(2); }
  GLYPH[k] = { w, s: d.split('|').map(s => s.split(' ').map(p => p.split(',').map(Number))) };
}
function textWidth(str, cap) {
  let w = 0;
  for (const ch of str.toUpperCase()) w += (ch === ' ' ? SPACE : (GLYPH[ch] || GLYPH['?']).w + GAP);
  return (w - GAP) * cap / 6;
}
function drawText(c, str, x, y, cap, o = {}) {
  str = String(str).toUpperCase();
  const u = cap / 6, lw = o.lw || Math.max(1.3, cap * 0.095), jit = o.jit ?? Math.min(1.3, 0.28 + cap * 0.016);
  if (o.align === 'center') x -= textWidth(str, cap) / 2; else if (o.align === 'right') x -= textWidth(str, cap);
  c.strokeStyle = o.color || INK; c.lineWidth = lw;
  let cx = x, k = 0;
  for (const ch of str) {
    if (ch === ' ') { cx += SPACE * u; continue; }
    const g = GLYPH[ch] || GLYPH['?'];
    for (const st of g.s) {
      const r = rngAt(x + k * 13.7, y, ++k + str.length * 7), j = () => (r() - 0.5) * 2 * jit;
      const P = st.map(p => [cx + p[0] * u + j(), y + p[1] * u + j()]);
      c.beginPath(); c.moveTo(P[0][0], P[0][1]);
      if (P.length === 2) {
        const ox = (P[1][0] - P[0][0]) * 0.035, oy = (P[1][1] - P[0][1]) * 0.035;
        c.moveTo(P[0][0] - ox, P[0][1] - oy); c.lineTo(P[1][0] + ox, P[1][1] + oy);
      } else {
        for (let i = 1; i < P.length - 2; i++) c.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
        const n = P.length; c.quadraticCurveTo(P[n - 2][0], P[n - 2][1], P[n - 1][0], P[n - 1][1]);
      }
      c.stroke();
    }
    cx += (g.w + GAP) * u;
  }
}
function arrowGlyph(c, cx, cy, dir, s, col, lw) {
  const d = { left: [-1, 0], right: [1, 0], up: [0, -1] }[dir], px = -d[1], py = d[0];
  const tx = cx + d[0] * s, ty = cy + d[1] * s;
  sline(c, cx - d[0] * s, cy - d[1] * s, tx, ty, lw, col, 0.4);
  sline(c, tx, ty, tx - d[0] * s * 0.8 + px * s * 0.7, ty - d[1] * s * 0.8 + py * s * 0.7, lw, col, 0.4);
  sline(c, tx, ty, tx - d[0] * s * 0.8 - px * s * 0.7, ty - d[1] * s * 0.8 - py * s * 0.7, lw, col, 0.4);
}
function keycap(c, x, y, s, label, col, held) {
  const dy = held ? 2.5 : 0;
  c.fillStyle = PAPER_COL; c.beginPath(); c.roundRect(x, y + dy, s, s, s * 0.2); c.fill();
  if (!held) sline(c, x + s * 0.16, y + s + 3.5, x + s * 0.84, y + s + 3.5, 1.6, col, 0.4);
  sRoundRect(c, x, y + dy, s, s, s * 0.2, 2, col, 0.5);
  if (label.length === 1) drawText(c, label, x + s / 2, y + dy + s * 0.29, s * 0.42, { color: col, align: 'center', lw: 2 });
  else arrowGlyph(c, x + s / 2, y + dy + s / 2, label, s * 0.21, col, 2);
}
function scrap(c, x, y, w, h, rot, seed) {
  const r = mulberry(seed), pts = [];
  const edge = (x0, y0, x1, y1) => { const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 34)); for (let i = 0; i < n; i++) { const t = i / n; pts.push([x0 + (x1 - x0) * t + (r() - 0.5) * 2.2, y0 + (y1 - y0) * t + (r() - 0.5) * 2.2]); } };
  edge(0, 0, w, 0); edge(w, 0, w, h); edge(w, h, 0, h); edge(0, h, 0, 0);
  c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2);
  const path = (ox, oy) => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0] + ox, p[1] + oy) : c.moveTo(p[0] + ox, p[1] + oy)); c.closePath(); };
  path(3.5, 4.5); c.fillStyle = SHADE; c.fill();
  path(0, 0); c.fillStyle = PAPER_COL; c.fill(); c.strokeStyle = NAVY; c.lineWidth = 1.1; c.stroke();
  return () => c.restore();
}
function flame(c, x, y, h, sway, col, lw, fill) {      // a teardrop rising from (x, y)
  const w = h * 0.42;
  c.beginPath(); c.moveTo(x, y);
  c.bezierCurveTo(x - w * 1.3, y - h * 0.25, x - w * 0.5, y - h * 0.6, x + sway, y - h);
  c.bezierCurveTo(x + w * 0.3, y - h * 0.6, x + w * 1.3, y - h * 0.3, x, y);
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.strokeStyle = col; c.lineWidth = lw; c.stroke();
}
function hopIcon(c, x, y, s, col, lw) {                 // a dot leaving the page along a dashed arc
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw;
  c.setLineDash([s * 0.16, s * 0.14]); c.beginPath(); c.arc(x, y, s * 0.5, Math.PI, Math.PI * 1.86); c.stroke(); c.setLineDash([]);
  c.beginPath(); c.arc(x + s * 0.5, y - s * 0.12, Math.max(1.6, s * 0.13), 0, 7); c.fill();
  sline(c, x - s * 0.72, y + 1, x + s * 0.72, y + 1, lw * 0.8, col, 0.3);
}
// Every seat at the table is a different drawing instrument. Seat 0 and 1 also have keyboard keys.
function mixWhite(hex, t) { const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(v + (255 - v) * t); return 'rgb(' + f(n >> 16) + ',' + f(n >> 8 & 255) + ',' + f(n & 255) + ')'; }
function strandsFor(col, style) {
  if (style === 1) return [{ o: -1.4, amp: 0.9, f: 1 / 11, w: 1.5, col }, { o: 0.2, amp: 1.1, f: 1 / 9, w: 1.8, col: mixWhite(col, 0.06) }, { o: 1.5, amp: 1, f: 1 / 13, w: 1.3, col: mixWhite(col, 0.15) }, { o: 0, amp: 3.1, f: 1 / 26, w: 0.8, col: mixWhite(col, 0.42) }];   // pencil: a bundle of thin strokes
  if (style === 2) return [{ o: 0, amp: 0.6, f: 1 / 22, w: 5.4, col }, { o: 2.3, amp: 0.5, f: 1 / 12, w: 1.1, col: mixWhite(col, 0.35) }];                                                                                                                              // felt tip: one fat stroke
  if (style === 3) return [{ o: -1.3, amp: 1.4, f: 1 / 6, w: 2.6, col }, { o: 1.3, amp: 1.4, f: 1 / 7, w: 2.6, col: mixWhite(col, 0.14) }, { o: 0, amp: 2.3, f: 1 / 5, w: 1.2, col: mixWhite(col, 0.4) }];                                                                 // crayon: waxy and uneven
  return [{ o: 0, amp: 0.9, f: 1 / 15, w: 3.7, col }, { o: 0, amp: 2.7, f: 1 / 24, w: 1, col: mixWhite(col, 0.4) }];                                                                                                                                                     // pen
}
const INSTRUMENTS = [
  ['PEN', INK, 0], ['PENCIL', GRAPH, 1], ['RED PEN', '#d42a3c', 0], ['MARKER', '#1d8a4a', 2], ['CRAYON', '#e0761a', 3], ['GEL PEN', '#8a2be2', 0],
  ['FELT TIP', '#0e9aa7', 2], ['CHARCOAL', '#6a5140', 1], ['PINK PEN', '#e0409a', 0], ['CHALK', '#7f8fa6', 3], ['BIRO', '#101010', 0], ['HIGHLITE', '#c2a800', 2],
];
