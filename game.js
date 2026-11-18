(() => {
'use strict';

// ---------------------------------------------------------------- constants
const W = 1280, H = 800, RS = 1.5;
const CELL = 4, GW = W / CELL, GH = H / CELL, N = GW * GH;
const ICELL = 2, IW = W / ICELL, IH = H / ICELL;
const PAPER = { x: 84, y: 96, w: 1160, h: 672 };   // the playing box, drawn on a page that fills the whole screen
const BAND = 5;            // cells: a cut this close to an edge tears through
const SPEED0 = 106, SPEED_MAX = 184, SPEED_RAMP = 1.17, TURN = 2.79;
const RULER_TIME = 7;       // seconds the other player is stuck drawing straight lines and corners
const SNIP_TIME = 4.5;      // seconds of cutting one pair of scissors gives
const TEAR = 90;           // px: how far a cut's end will rip to reach an edge
const METER_MAX = 1.4, METER_REGEN = 0.28;   // seconds of air time, and how fast it comes back
const FIRE_R = 135, F_WARN = 1.3, F_GROW = 2.4, F_HOLD = 1.6, F_OUT = 0.7, PILL_R = 18;
const WIN = 5;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- canvases
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const worldCtx = (c) => { const x = c.getContext('2d'); x.setTransform(RS, 0, 0, RS, 0, 0); x.lineCap = 'round'; x.lineJoin = 'round'; return x; };
const PW = W * RS, PH = H * RS;
const main = document.getElementById('game');
const ctx = worldCtx(main);
const deskC = mk(PW, PH), maskC = mk(PW, PH), shadowC = mk(PW, PH), tempC = mk(PW, PH), slitC = mk(PW, PH);
const maskCtx = worldCtx(maskC), shadowCtx = shadowC.getContext('2d'), tempCtx = tempC.getContext('2d'), slitCtx = worldCtx(slitC);
const inkC = [mk(PW, PH), mk(PW, PH), mk(PW, PH)];
const inkCtx = inkC.map(worldCtx);

// ---------------------------------------------------------------- audio
let actx = null, noiseBuf = null, muted = false, master = null, musicBus = null, musicOn = true, loops = null, musicT = 0, musicStep = 0, melody = [];
function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    master = actx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(actx.destination);
    musicBus = actx.createGain(); musicBus.gain.value = musicOn ? 1 : 0; musicBus.connect(master);
    const loop = (type, freq, q) => {       // a bed of filtered hiss whose volume we ride: pen, pencil, fire
      const s = actx.createBufferSource(), f = actx.createBiquadFilter(), gn = actx.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; gn.gain.value = 0;
      s.connect(f).connect(gn).connect(master); s.start(0, Math.random()); return { f, g: gn, base: freq };
    };
    loops = { draw: INSTRUMENTS.map((d, i) => d[2] === 1 || d[2] === 3 ? loop('bandpass', 4200 - i * 60, 1.5) : loop('bandpass', 2100 + i * 70, 0.7)), fire: loop('lowpass', 560, 0.5) };
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function noise(dur, f0, f1, q, vol, type = 'bandpass') {
  if (muted || !audio()) return;
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.3, dur + 0.02);
}
function tone(freq, dur, vol, delay = 0, type = 'triangle', slide = 1) {
  if (muted || !audio()) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.03);
}
// --- continuous sound: the scratch of each line, the fire, and a small looping tune
const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]], ARP = [0, 2, 1, 3, 2, 1, 3, 2], SCALE = [69, 72, 74, 76, 79, 81, 84];
const BEAT = 60 / 84 / 2;
function mnote(n, t, dur, vol, type) {
  const o = actx.createOscillator(), gn = actx.createGain();
  o.type = type; o.frequency.value = MIDI(n);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.015); gn.gain.exponentialRampToValueAtTime(0.0006, t + dur);
  o.connect(gn).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
}
function musicStepAt(i, t) {
  const bar = Math.floor(i / 8), s = i % 8, ch = CHORDS[bar % 4], sw = s % 2 ? 0.035 : 0;
  if (s === 0) {                       // write this bar's bit of melody; the phrase repeats every 8 bars
    const r = mulberry(4100 + bar % 8); let k = 2 + Math.floor(r() * 3); melody = [];
    for (let j = 0; j < 8; j++) { k = Math.max(0, Math.min(SCALE.length - 1, k + Math.floor(r() * 3) - 1)); melody.push(r() < (j % 2 ? 0.3 : 0.55) ? SCALE[k] : 0); }
  }
  mnote(ch[ARP[s]], t + sw, 0.5, 0.028, 'triangle');
  if (s === 0 || s === 5) mnote(ch[0] - 12, t + sw, 0.7, 0.07, 'sine');
  if (melody[s]) mnote(melody[s], t + sw, 0.9, 0.04, 'sine');
  if (s % 2) {                         // pencil taps keep time
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), gn = actx.createGain();
    src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = s === 3 || s === 7 ? 2600 : 5200; f.Q.value = 2;
    gn.gain.setValueAtTime(s === 3 || s === 7 ? 0.035 : 0.016, t + sw); gn.gain.exponentialRampToValueAtTime(0.0006, t + sw + 0.05);
    src.connect(f).connect(gn).connect(musicBus); src.start(t + sw, Math.random(), 0.07);
  }
}
function updateAudio(dt) {
  if (!actx || actx.state !== 'running') return;
  const now = actx.currentTime, live = state === 'play' && !paused;
  const quiet = players.length > 2 ? 0.7 : 1;
  ALL.forEach((p) => {
    const i = INSTRUMENTS[p.id][2] === 1 || INSTRUMENTS[p.id][2] === 3 ? 1 : 0;      // scratchy or smooth
    const L = loops.draw[p.id], on = live && players.includes(p) && p.alive && !p.cutting && !(p.snip > 0);
    const grit = i ? 0.55 + 0.45 * Math.abs(vnoise(7, clock * 21)) : 0.85 + 0.15 * vnoise(3, clock * 6);      // pencil stutters, pen glides
    L.g.gain.setTargetAtTime(on ? (i ? 0.075 : 0.05) * grit * quiet : 0, now, 0.035);
    L.f.frequency.setTargetAtTime(L.base * (1 + 0.18 * vnoise(11 + p.id, clock * 4)), now, 0.06);
  });
  let heat = 0;
  if (live && fire) heat = fire.t < F_WARN ? 0.12 : fireRadius(fire) / FIRE_R * (fire.t > F_WARN + F_GROW + F_HOLD ? Math.max(0, 1 - (fire.t - F_WARN - F_GROW - F_HOLD) / F_OUT) : 1);
  loops.fire.g.gain.setTargetAtTime(heat * 0.3, now, 0.12);
  loops.fire.f.frequency.setTargetAtTime(420 + heat * 500 + vnoise(5, clock * 7) * 120, now, 0.1);
  if (heat > 0 && Math.random() < dt * (4 + heat * 16)) noise(0.015 + Math.random() * 0.035, 2500 + Math.random() * 4500, 1400, 2.5, 0.04 + Math.random() * 0.1 * heat);   // crackle
  if (musicT < now) { musicT = now + 0.06; }
  while (musicT < now + 0.25) { musicStepAt(musicStep++, musicT); musicT += BEAT; }
}
const sfx = {
  snip: () => { noise(0.045, 5200, 2600, 3, 0.11); },
  drop: () => { noise(0.42, 2400, 240, 0.8, 0.2, 'lowpass'); noise(0.06, 6000, 3000, 2, 0.16); },
  crash: () => { tone(150, 0.2, 0.25, 0, 'triangle', 0.4); noise(0.12, 1800, 500, 1, 0.16); },
  fall: () => { tone(520, 0.4, 0.14, 0, 'sine', 0.3); },
  point: () => { tone(587, 0.16, 0.14); tone(880, 0.3, 0.14, 0.11); },
  match: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 0.13, i * 0.11)); },
  hop: () => { tone(300, 0.13, 0.09, 0, 'sine', 1.7); },
  strike: () => { noise(0.1, 2600, 6500, 2, 0.16); },
  whoosh: () => { noise(1.1, 260, 1500, 0.7, 0.24, 'lowpass'); },
  rip: () => { noise(0.14, 1500, 3800, 1.2, 0.14); },
  ruler: () => { tone(880, 0.07, 0.12, 0, 'square'); tone(660, 0.09, 0.12, 0.09, 'square'); noise(0.05, 3000, 1800, 3, 0.1); },
  tick: () => { noise(0.03, 3000, 2000, 4, 0.07); },
  go: () => { noise(0.05, 4200, 2600, 3, 0.1); },
};

// ---------------------------------------------------------------- state
const paper = new Uint8Array(N), cut = new Uint8Array(N), frail = new Uint8Array(N), dist8 = new Uint8Array(N);
const label = new Int32Array(N), queue = new Int32Array(N);
const inkOwner = new Uint8Array(IW * IH), inkT = new Float32Array(IW * IH);
const MAXP = INSTRUMENTS.length;
const KEYSETS = [{ keys: { l: 'KeyA', r: 'KeyD', c: 'KeyW' }, caps: ['A', 'D', 'W'] }, { keys: { l: 'ArrowLeft', r: 'ArrowRight', c: 'ArrowUp' }, caps: ['left', 'right', 'up'] }];
const ALL = INSTRUMENTS.map((d, i) => ({ id: i, name: d[0], color: d[1], strands: strandsFor(d[1], d[2]), keys: (KEYSETS[i] || { keys: {} }).keys, caps: (KEYSETS[i] || { caps: [] }).caps, score: 0 }));
let players = ALL.slice(0, 2);     // who is in this round: the two keyboard seats, plus every seat with a phone on it
const keys = Object.create(null);
let state = 'title', mode = 0, time = 0, stateT = 0, paused = false, pieces = [], cutDirty = false;
let snipEv = null;
let pill = null, fire = null, pillT = 4.5, nextKind = Math.floor(Math.random() * 3);   // pickups take turns: 0 match, 1 scissors, 2 ruler
let roundMsg = null, best = 0, lastCount = -1, clock = 0, newBest = false;
try { best = +localStorage.getItem('pps-duet-best') || 0; } catch (e) { /* storage unavailable */ }

// ---------------------------------------------------------------- paper
function buildDesk() {
  const c = worldCtx(deskC), r = mulberry(11);
  c.fillStyle = DESK; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(110,85,50,0.16)'; c.lineWidth = 1;
  for (let i = -H; i < W; i += 7) {       // engraver's hatching, broken so it reads as drawn
    let t = r() * 60;
    while (t < H * 1.5) {
      const l = 40 + r() * 220, o = (r() - 0.5) * 1.6;
      c.beginPath(); c.moveTo(i + t + o, t); c.lineTo(i + t + l + o, t + l); c.stroke();
      t += l + 6 + r() * 30;
    }
  }
}
function freshPaper() {
  paper.fill(0); cut.fill(0); inkOwner.fill(0);
  const x0 = PAPER.x / CELL, y0 = PAPER.y / CELL, x1 = (PAPER.x + PAPER.w) / CELL, y1 = (PAPER.y + PAPER.h) / CELL;
  for (let y = y0; y < y1; y++) paper.fill(1, y * GW + x0, y * GW + x1);
  computeFrail();
  for (const c of [...inkCtx, slitCtx, maskCtx]) c.clearRect(0, 0, W, H);
  maskCtx.fillStyle = PAPER_COL; maskCtx.fillRect(0, 0, W, H);
  const r = mulberry(5); maskCtx.fillStyle = 'rgba(30,30,120,0.05)';
  for (let i = 0; i < 2600; i++) maskCtx.fillRect(r() * W, r() * H, 0.7 + r(), 0.7 + r());
  // college ruled, edge to edge: blue rules below a clear header (where the scores go), one red margin line
  maskCtx.strokeStyle = 'rgba(70,120,215,0.34)'; maskCtx.lineWidth = 1; maskCtx.beginPath();
  for (let y = PAPER.y + 26; y < H; y += 26) { maskCtx.moveTo(0, y + 0.5); maskCtx.lineTo(W, y + 0.5); }
  maskCtx.stroke();
  maskCtx.strokeStyle = 'rgba(226,72,88,0.5)'; maskCtx.lineWidth = 1.3; maskCtx.beginPath(); maskCtx.moveTo(58.5, 0); maskCtx.lineTo(58.5, H); maskCtx.stroke();
  rebuildShadow(); pieces = [];
}
function rebuildShadow() {
  const c = shadowCtx;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, PW, PH); c.drawImage(maskC, 0, 0);
  c.globalCompositeOperation = 'source-in'; c.fillStyle = SHADE; c.fillRect(0, 0, PW, PH);
  c.globalCompositeOperation = 'destination-out'; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1.6;
  c.beginPath(); for (let i = -PH; i < PW; i += 6) { c.moveTo(i, PH); c.lineTo(i + PH, 0); } c.stroke();
  c.globalCompositeOperation = 'source-over';
}
function computeFrail() {
  for (let i = 0; i < N; i++) dist8[i] = paper[i] ? 255 : 0;
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const i = y * GW + x; if (!dist8[i]) continue;
    const m = Math.min(dist8[i - 1], dist8[i - GW], dist8[i - GW - 1], dist8[i - GW + 1]) + 1; if (m < dist8[i]) dist8[i] = m;
  }
  for (let y = GH - 2; y > 0; y--) for (let x = GW - 2; x > 0; x--) {
    const i = y * GW + x; if (!dist8[i]) continue;
    const m = Math.min(dist8[i + 1], dist8[i + GW], dist8[i + GW + 1], dist8[i + GW - 1]) + 1; if (m < dist8[i]) dist8[i] = m;
  }
  for (let i = 0; i < N; i++) frail[i] = paper[i] && dist8[i] <= BAND ? 1 : 0;
}
function composePaper() {
  const c = tempCtx;
  c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, PW, PH); c.drawImage(maskC, 0, 0);
  c.globalCompositeOperation = 'source-atop'; c.drawImage(inkC[boil % 3], 0, 0); c.drawImage(slitC, 0, 0);
  c.globalCompositeOperation = 'source-over';
}
const NB = [1, -1, GW, -GW], NB8 = [1, -1, GW, -GW, GW + 1, GW - 1, -GW + 1, -GW - 1];
function checkPieces() {
  let removed = false;
  for (let iter = 0; iter < 3; iter++) {
    label.fill(0); let n = 0, keep = 0, keepSize = 0;
    for (let i = 0; i < N; i++) {
      if (label[i] || !paper[i] || cut[i] || frail[i]) continue;
      n++; let qh = 0, qt = 0; queue[qt++] = i; label[i] = n;
      while (qh < qt) {
        const c = queue[qh++];
        for (let k = 0; k < 4; k++) { const j = c + NB[k]; if (!label[j] && paper[j] && !cut[j] && !frail[j]) { label[j] = n; queue[qt++] = j; } }
      }
      if (qt > keepSize) { keepSize = qt; keep = n; }
    }
    if (n <= 1) break;
    // whoever holds the scissors keeps the ground directly under the blades
    for (const p of players) if (p.alive && (p.snip > 0 || time - p.cutEndT < 0.12)) {
      const gx = p.x / CELL | 0, gy = p.y / CELL | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (gy + dy) * GW + gx + dx; if (paper[j] && !label[j]) label[j] = keep; }
    }
    // the cut line itself stays with the big sheet, so you can stand on your own cut
    const stay = [];
    for (let i = 0; i < N; i++) if (paper[i] && cut[i] && !label[i]) for (let k = 0; k < 8; k++) if (label[i + NB8[k]] === keep) { stay.push(i); break; }
    for (const i of stay) label[i] = keep;
    // the torn margin goes with whichever side is nearer
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (label[i]) queue[qt++] = i;
    while (qh < qt) { const c = queue[qh++]; for (let k = 0; k < 4; k++) { const j = c + NB[k]; if (paper[j] && !label[j]) { label[j] = label[c]; if (!cut[j]) queue[qt++] = j; } } }
    const groups = new Map();
    for (let i = 0; i < N; i++) {
      const l = label[i]; if (!l || l === keep || !paper[i]) continue;
      let g = groups.get(l); if (!g) groups.set(l, g = { cells: [], x0: GW, y0: GH, x1: 0, y1: 0 });
      const x = i % GW, y = i / GW | 0; g.cells.push(i);
      if (x < g.x0) g.x0 = x; if (x > g.x1) g.x1 = x; if (y < g.y0) g.y0 = y; if (y > g.y1) g.y1 = y;
    }
    if (!groups.size) break;
    composePaper();
    for (const g of groups.values()) makePiece(g);
    for (const g of groups.values()) for (const i of g.cells) { paper[i] = 0; cut[i] = 0; }
    computeFrail(); removed = true;
  }
  if (removed) { rebuildShadow(); sfx.drop(); }
}
function makePiece(g) {
  const pad = 2, x0 = g.x0 - pad, y0 = g.y0 - pad, bw = g.x1 - g.x0 + 1 + pad * 2, bh = g.y1 - g.y0 + 1 + pad * 2;
  const sm = mk(bw, bh), sc = sm.getContext('2d'), id = sc.createImageData(bw, bh);
  for (const i of g.cells) id.data[(((i / GW | 0) - y0) * bw + (i % GW) - x0) * 4 + 3] = 255;
  sc.putImageData(id, 0, 0);
  const S = CELL * RS, big = mk(bw * S, bh * S), bc = big.getContext('2d', { willReadFrequently: true });
  bc.imageSmoothingEnabled = true; bc.drawImage(sm, 0, 0, big.width, big.height);
  const im = bc.getImageData(0, 0, big.width, big.height), d = im.data;       // sharpen the soft upscale into a clean scissor edge
  for (let k = 3; k < d.length; k += 4) { const a = d[k]; d[k] = a >= 116 ? 255 : a <= 84 ? 0 : (a - 84) * 8; }
  bc.putImageData(im, 0, 0);
  const pc = mk(big.width, big.height), px = pc.getContext('2d'), sx = x0 * S, sy = y0 * S;
  px.drawImage(tempC, sx, sy, big.width, big.height, 0, 0, big.width, big.height);
  px.globalCompositeOperation = 'destination-in'; px.drawImage(big, 0, 0);
  maskCtx.save(); maskCtx.setTransform(1, 0, 0, 1, 0, 0); maskCtx.globalCompositeOperation = 'destination-out'; maskCtx.drawImage(big, sx, sy); maskCtx.restore();
  pieces.push({ c: pc, x: x0 * CELL, y: y0 * CELL, w: bw * CELL, h: bh * CELL, t: 0, dir: Math.random() < 0.5 ? -1 : 1, spin: 0.12 + Math.random() * 0.25 });
}

// ---------------------------------------------------------------- round flow
function spawn() {
  const n = players.length, turn = Math.random() * Math.PI * 2;
  players.forEach((p, i) => {
    if (n === 2) {
      p.x = PAPER.x + PAPER.w * (i ? 0.78 : 0.22) + (Math.random() - 0.5) * 80; p.y = PAPER.y + PAPER.h * (0.3 + Math.random() * 0.4);
      p.a = (i ? Math.PI : 0) + (Math.random() - 0.5) * 1.1;
    } else {                        // a ring round the middle, everyone facing roughly inward
      const t = turn + i / n * Math.PI * 2;
      p.x = PAPER.x + PAPER.w / 2 + Math.cos(t) * PAPER.w * 0.33; p.y = PAPER.y + PAPER.h / 2 + Math.sin(t) * PAPER.h * 0.3;
      p.a = Math.atan2(PAPER.y + PAPER.h / 2 - p.y, PAPER.x + PAPER.w / 2 - p.x) + (Math.random() - 0.5) * 1.2;
    }
    p.alive = true; p.cutting = false; p.needRelease = false; p.meter = METER_MAX; p.dist = Math.random() * 500;
    p.last = [[], [], []]; p.slitLast = null; p.deadT = 0; p.death = null; p.snipT = 0; p.cutEndT = -9; p.snip = 0; p.ruler = 0; p.rulerCd = 0; p.wasL = p.wasR = false;
  });
}
function startRound() { players = ALL.filter((p, i) => i < 2 || seats[i]); snipEv = null; pill = null; fire = null; pillT = 4.5; freshPaper(); spawn(); time = 0; state = 'ready'; stateT = 0; roundMsg = null; lastCount = -1; newBest = false; }
function startMatch() { ALL.forEach(p => p.score = 0); startRound(); }
function toTitle() { snipEv = null; pill = null; fire = null; state = 'title'; stateT = 0; paused = false; freshPaper(); }
function die(p, how) {
  if (!p.alive) return;
  p.alive = false; p.death = how; p.deadT = 0; p.cutting = false;
  if (how === 'crash' || how === 'out') {
    sfx.crash();
    inkCtx.forEach((c, L) => {
      const r = mulberry(L * 77 + p.id * 13 + (p.x | 0)), j = () => (r() - 0.5) * 5;
      c.strokeStyle = p.color; c.lineWidth = 2.6;
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(p.x - 10 + j(), p.y - 10 * s + j()); c.lineTo(p.x + 10 + j(), p.y + 10 * s + j()); c.stroke(); }
    });
  } else sfx.fall();
}
function endRound() {
  const alive = players.filter(p => p.alive);
  state = 'over'; stateT = 0; finishRound(alive);
  const dead = players.filter(p => !p.alive);
  roundMsg.low = dead.reduce((a, p) => a + p.y, 0) / dead.length < PAPER.y + PAPER.h / 2;
  roundMsg.tip = TIPS[tipN++ % TIPS.length];
}
function finishRound(alive) {
  const why = (p, a, b, c, d) => p.death === 'out' ? a : p.death === 'burn' ? b : p.death === 'fall' ? c : d;
  if (mode === 1) {
    newBest = time > best + 0.05;
    if (newBest) { best = time; try { localStorage.setItem('pps-duet-best', String(best)); } catch (e) { /* storage unavailable */ } }
    const gone = players.filter(p => !p.alive), who = gone[0];
    roundMsg = { head: time.toFixed(1) + ' SECONDS', color: INK, sub: gone.length > 1 ? 'SEVERAL LINES ENDED AT ONCE' : who.name + why(who, ' CROSSED THE LINE', ' WALKED INTO THE FIRE', ' WENT OVER THE EDGE', ' HIT INK'), extra: newBest ? 'NEW BEST' : 'BEST ' + best.toFixed(1), next: 'SPACE - TRY AGAIN' };
    if (newBest) sfx.match();
    return;
  }
  if (alive.length === 1) {
    const w = alive[0], l = players.length === 2 ? players.find(p => p !== w) : null; w.score++;
    const match = w.score >= WIN;
    roundMsg = { head: w.name + (match ? ' WINS THE MATCH' : ' TAKES IT'), color: w.color, sub: l ? l.name + why(l, ' LEFT THE BOX', ' GOT BURNED', ' WENT DOWN WITH THE PAPER', ' RAN INTO INK') : 'LAST LINE LEFT ON THE PAGE', next: match ? 'SPACE - REMATCH' : 'SPACE - NEXT ROUND', match };
    match ? sfx.match() : sfx.point();
  } else roundMsg = { head: 'NOBODY TAKES IT', color: INK, sub: 'THE LAST LINES ENDED TOGETHER', next: 'SPACE - NEXT ROUND' };
}

// ---------------------------------------------------------------- simulation
const TIPS = ['THE SCISSORS CUT ALONG THE WAY YOU WERE HEADING WHEN YOU GRABBED THEM', 'STANDING ON THE CUT LINE ITSELF IS SAFE', 'WHILE RULED, EACH KEY PRESS IS ONE SQUARE TURN', 'FIRE WIPES OUT EVERY LINE IT TOUCHES', 'THE DASHED RING SHOWS HOW FAR THE FIRE WILL SPREAD', 'YOU CANNOT JUMP OVER FIRE', 'JUMPS REFILL WHILE YOU DRAW', 'SCORCHED PAPER IS SAFE ONCE THE FLAMES ARE GONE', 'YOU HAVE TO BE ON THE GROUND TO GRAB THE MATCH', 'ESC GOES BACK TO THE TITLE'];
let tipN = 0;
const STEP = 1 / 120;
function markInk(p, x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let s = 0; s <= n; s++) {
    const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n, ix = Math.round(x / ICELL), iy = Math.round(y / ICELL);
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const j = (iy + dy) * IW + ix + dx; if (j >= 0 && j < inkOwner.length && !inkOwner[j]) { inkOwner[j] = p.id + 1; inkT[j] = time; }
    }
  }
}
function markCut(x0, y0, x1, y1) {
  let cx = x0 / CELL | 0, cy = y0 / CELL | 0; const ex = x1 / CELL | 0, ey = y1 / CELL | 0;
  const dx = Math.abs(ex - cx), dy = Math.abs(ey - cy), sx = cx < ex ? 1 : -1, sy = cy < ey ? 1 : -1; let err = dx - dy;
  for (;;) {
    const i = cy * GW + cx; if (paper[i] && !cut[i]) { cut[i] = 1; cutDirty = true; }
    if (cx === ex && cy === ey) break;
    const e2 = err * 2, px = cx;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; if (cx !== px) { const k = cy * GW + cx; if (paper[k] && !cut[k]) cut[k] = 1; } cy += sy; }
  }
}
function drawInk(p, x, y) {       // not a plotted curve: the hand drifts, presses harder and lighter, and thin strokes skip
  const nx = -Math.sin(p.a), ny = Math.cos(p.a);
  for (let L = 0; L < 3; L++) {
    const c = inkCtx[L], seed = p.id * 97 + L * 31;
    const wander = vnoise(seed + 5, p.dist / 70) * 1.5 + vnoise(seed + 6, p.dist / 9) * 0.35;       // slow drift plus a little tremor
    const press = 0.78 + 0.34 * vnoise(seed + 3, p.dist / 46);
    p.strands.forEach((s, k) => {
      const off = wander + s.o + vnoise(seed + k * 7, p.dist * s.f) * s.amp, qx = x + nx * off, qy = y + ny * off, last = p.last[L][k];
      const skip = s.w < 1.4 && vnoise(seed + 40 + k, p.dist / 13) > 0.38;                           // light strokes lift off the page now and then
      if (last && !skip) { c.strokeStyle = s.col; c.lineWidth = s.w * (k ? 0.85 + 0.3 * press : press + 0.12); c.beginPath(); c.moveTo(last[0], last[1]); c.lineTo(qx, qy); c.stroke(); }
      p.last[L][k] = [qx, qy];
    });
  }
}
function tear(x, y) {            // paper rips from a cut's end to the nearest edge or hole, if one is close
  const gx = x / CELL | 0, gy = y / CELL | 0, R = Math.ceil(TEAR / CELL); let bd = TEAR * TEAR + 1, tx = 0, ty = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const cx = gx + dx, cy = gy + dy; if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || paper[cy * GW + cx]) continue;
    const px = (cx + 0.5) * CELL, py = (cy + 0.5) * CELL, d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < bd) { bd = d; tx = px; ty = py; }
  }
  if (bd > TEAR * TEAR) return;
  markCut(x, y, tx, ty); cutDirty = true;
  const len = Math.sqrt(bd) || 1, n = Math.max(2, Math.round(len / 7)), ux = (tx - x) / len, uy = (ty - y) / len, r = mulberry((x * 31 + y * 17) | 0);
  const c = slitCtx; c.strokeStyle = NAVY; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y);
  for (let i = 1; i <= n; i++) { const t = i / n * len, j = i < n ? (r() - 0.5) * 6 : 0; c.lineTo(x + ux * t - uy * j, y + uy * t + ux * j); }
  c.stroke(); sfx.rip();
}
function drawSlit(p, x, y) {
  const c = slitCtx, l = p.slitLast;
  if (l) {
    c.globalCompositeOperation = 'destination-over'; c.strokeStyle = '#c4c4ee'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(l[0] + 1.4, l[1] + 2); c.lineTo(x + 1.4, y + 2); c.stroke();
    c.globalCompositeOperation = 'source-over'; c.strokeStyle = NAVY; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(l[0], l[1]); c.lineTo(x, y); c.stroke();
  }
  p.slitLast = [x, y];
}
function stepPlayers(dt) {
  const speed = Math.min(SPEED_MAX, SPEED0 + time * SPEED_RAMP);
  for (const p of players) {
    if (!p.alive) continue;
    p.a += steer(p, dt);
    const want = !!held(p, 'c');
    if (!want) p.needRelease = false;
    if (p.cutting && (!want || p.meter <= 0)) { p.cutting = false; if (p.meter <= 0) p.needRelease = true; p.last = [[], [], []]; }
    else if (!p.cutting && want && !p.needRelease && p.meter > 0.2) { p.cutting = true; sfx.hop(); if (p.snip > 0 && p.slitLast) { tear(p.x, p.y); p.slitLast = null; } }
    p.px = p.x; p.py = p.y;
    p.x += Math.cos(p.a) * speed * dt; p.y += Math.sin(p.a) * speed * dt; p.dist += speed * dt;
  }
  for (const p of players) {          // judge everyone against the page as it was before this step
    if (!p.alive) continue;
    const gx = p.x / CELL | 0, gy = p.y / CELL | 0;
    if (p.x < PAPER.x || p.y < PAPER.y || p.x >= PAPER.x + PAPER.w || p.y >= PAPER.y + PAPER.h) { die(p, 'out'); continue; }
    if (!paper[gy * GW + gx]) { die(p, 'fall'); continue; }
    if (!p.cutting) {
      const hx = p.x + Math.cos(p.a) * 2.6, hy = p.y + Math.sin(p.a) * 2.6;
      const j = (hy / ICELL | 0) * IW + (hx / ICELL | 0), o = inkOwner[j];
      if (o && (o - 1 !== p.id || time - inkT[j] > 0.3)) die(p, 'crash');
    }
  }
  for (const p of players) {
    if (!p.alive) continue;
    if (p.cutting) {
      p.meter = Math.max(0, p.meter - dt);      // in the air: no ink laid, no ink hit
    } else if (p.snip > 0) {        // carrying scissors: the line becomes a cut until they run out
      p.meter = Math.min(METER_MAX, p.meter + METER_REGEN * dt);
      if (!p.slitLast) { p.slitLast = [p.px, p.py]; tear(p.px, p.py); }
      p.snip -= dt; markCut(p.px, p.py, p.x, p.y); drawSlit(p, p.x, p.y);
      p.snipT -= dt; if (p.snipT <= 0) { sfx.snip(); p.snipT = 0.17; }
      if (p.snip <= 0) { p.snip = 0; p.cutEndT = time; tear(p.x, p.y); p.slitLast = null; p.last = [[], [], []]; }
    } else { p.meter = Math.min(METER_MAX, p.meter + METER_REGEN * dt); markInk(p, p.px, p.py, p.x, p.y); drawInk(p, p.x, p.y); }
  }
}
// ---------------------------------------------------------------- the match and the fire
function fireRadius(f) { const t = f.t - F_WARN; return t <= 0 ? 0 : FIRE_R * Math.min(1, t / F_GROW); }
function randSpot(minD, margin) {
  for (let i = 0; i < 60; i++) {
    const x = PAPER.x + margin + Math.random() * (PAPER.w - margin * 2), y = PAPER.y + margin + Math.random() * (PAPER.h - margin * 2);
    if (!paper[(y / CELL | 0) * GW + (x / CELL | 0)]) continue;
    if (players.every(p => !p.alive || Math.hypot(p.x - x, p.y - y) > minD)) return [x, y];
  }
  return null;
}
function burnInk(f, r) {
  f.cleared = r;
  const x0 = Math.max(0, (f.x - r) / ICELL | 0), x1 = Math.min(IW - 1, (f.x + r) / ICELL | 0), y0 = Math.max(0, (f.y - r) / ICELL | 0), y1 = Math.min(IH - 1, (f.y + r) / ICELL | 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x * ICELL - f.x, dy = y * ICELL - f.y; if (dx * dx + dy * dy <= r * r) inkOwner[y * IW + x] = 0; }
  for (const c of inkCtx) { c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(f.x, f.y, r + 1, 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; }
}
function scorch(f) {              // what the fire leaves behind: singed paper you can draw on again
  const c = maskCtx, r = mulberry(f.seed);
  c.save(); c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(20,20,150,0.055)'; c.beginPath(); c.arc(f.x, f.y, FIRE_R, 0, 7); c.fill();
  c.fillStyle = 'rgba(10,10,110,0.4)';
  for (let i = 0; i < 520; i++) { const d = FIRE_R * Math.pow(r(), 0.35), a = r() * 7; c.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.8 + r() * 1.3, 0.8 + r() * 1.3); }
  c.strokeStyle = 'rgba(10,10,110,0.5)'; c.lineWidth = 1.5; c.beginPath();
  for (let i = 0; i <= 90; i++) { const a = i / 90 * Math.PI * 2, d = FIRE_R * (1 + vnoise(f.seed, i % 90 / 5) * 0.035); i ? c.lineTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d) : c.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d); }
  c.stroke(); c.restore();
}
function stepFire(dt) {
  if (!fire && !pill && !snipEv) { pillT -= dt; if (pillT <= 0) { const s = randSpot(150, 70); if (s) pill = { x: s[0], y: s[1], t: 0, kind: (nextKind = (nextKind + 1) % 3) }; else pillT = 1; } }
  if (pill) {
    pill.t += dt;
    for (const p of players) if (p.alive && !p.cutting && Math.hypot(p.x - pill.x, p.y - pill.y) < PILL_R) {
      if (pill.kind === 2) { for (const o of players) if (o !== p && o.alive) { o.ruler = RULER_TIME; o.rulerCd = 0; } pill = null; pillT = 3.5 + Math.random() * 3; sfx.ruler(); break; }
      if (pill.kind === 1) { startSnip(pill.x, pill.y, p.a); pill = null; sfx.snip(); break; }
      const s = randSpot(FIRE_R + 70, 115) || randSpot(0, 115) || [W / 2, H / 2];
      fire = { x: s[0], y: s[1], t: 0, seed: (Math.random() * 1e6) | 0, cleared: 0, scorched: false, by: p.id }; pill = null; sfx.strike(); break;
    }
  }
  if (fire) {
    const f = fire, was = f.t; f.t += dt; const r = fireRadius(f), end = F_WARN + F_GROW + F_HOLD;
    if (was < F_WARN && f.t >= F_WARN) sfx.whoosh();
    if (r > 0 && f.t < end) {
      if (r > f.cleared + 1.5) burnInk(f, r);
      for (const p of players) if (p.alive && Math.hypot(p.x - f.x, p.y - f.y) < r - 3) die(p, 'burn');
    }
    if (!f.scorched && f.t >= F_WARN + F_GROW) { burnInk(f, FIRE_R); scorch(f); f.scorched = true; }
    if (f.t >= end + F_OUT) { fire = null; pillT = 5 + Math.random() * 4; }
  }
}
// --- scissors: the page is cut clean across, and the smaller side drops away
const SNIP_WARN = 1.7;
function startSnip(x, y, a) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const walk = (s) => { let px = x, py = y; for (let i = 0; i < 900; i++) { const nx = px + dx * s * 3, ny = py + dy * s * 3; if (!paper[(ny / CELL | 0) * GW + (nx / CELL | 0)]) break; px = nx; py = ny; } return [px + dx * s * 7, py + dy * s * 7]; };
  const A = walk(-1), B = walk(1); let pos = 0, neg = 0;
  for (let i = 0; i < N; i++) if (paper[i]) { const cx = (i % GW + 0.5) * CELL, cy = ((i / GW | 0) + 0.5) * CELL; ((cx - x) * dy - (cy - y) * dx > 0) ? pos++ : neg++; }
  snipEv = { x, y, a, ax: A[0], ay: A[1], bx: B[0], by: B[1], t: 0, side: pos < neg ? 1 : -1, tick: 0 };
}
function stepSnip(dt) {
  const s = snipEv; if (!s) return;
  s.t += dt; s.tick -= dt; if (s.tick <= 0) { sfx.snip(); s.tick = 0.11; }
  if (s.t < SNIP_WARN) return;
  markCut(s.ax, s.ay, s.bx, s.by); cutDirty = true;
  const c = slitCtx; c.strokeStyle = '#c4c4ee'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(s.ax + 1.4, s.ay + 2); c.lineTo(s.bx + 1.4, s.by + 2); c.stroke();
  c.strokeStyle = NAVY; c.lineWidth = 1.5; c.beginPath(); c.moveTo(s.ax, s.ay); c.lineTo(s.bx, s.by); c.stroke();
  snipEv = null; pillT = 4 + Math.random() * 3;
}
function drawSnip() {
  const s = snipEv; if (!s) return;
  const k = Math.min(1, s.t / SNIP_WARN), dx = Math.cos(s.a), dy = Math.sin(s.a), nx = dy * s.side, ny = -dx * s.side;
  ctx.save(); ctx.beginPath(); ctx.rect(PAPER.x, PAPER.y, PAPER.w, PAPER.h); ctx.clip();          // the side that is about to go
  ctx.beginPath(); ctx.moveTo(s.ax - dx * 2000, s.ay - dy * 2000); ctx.lineTo(s.bx + dx * 2000, s.by + dy * 2000); ctx.lineTo(s.bx + dx * 2000 + nx * 3000, s.by + dy * 2000 + ny * 3000); ctx.lineTo(s.ax - dx * 2000 + nx * 3000, s.ay - dy * 2000 + ny * 3000); ctx.closePath(); ctx.clip();
  ctx.fillStyle = 'rgba(24,24,224,0.07)'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(24,24,224,' + (0.28 + 0.14 * Math.sin(clock * 10)) + ')'; ctx.lineWidth = 1.6; ctx.beginPath();
  for (let d = -H + (boil % 3) * 4; d < W; d += 15) { ctx.moveTo(d, H); ctx.lineTo(d + H, 0); }
  ctx.stroke(); ctx.restore();
  const sx = s.ax + (s.bx - s.ax) * k, sy = s.ay + (s.by - s.ay) * k;
  sline(ctx, s.ax, s.ay, sx, sy, 1.8, NAVY, 0.4);
  dashLine(ctx, sx, sy, s.bx, s.by, 11, 9, 2.2, INK);
  const open = REDUCED ? 0.6 : 0.5 + 0.5 * Math.sin(clock * 34);
  drawScissors(ctx, sx, sy, s.a, 78, open, PAPER_COL, 8); drawScissors(ctx, sx, sy, s.a, 78, open, INK, 3.2);
  const msg = 'THE SHADED SIDE IS ABOUT TO FALL', tw = textWidth(msg, 13);
  ctx.fillStyle = PAPER_COL; ctx.fillRect(W / 2 - tw / 2 - 12, PAPER.y + 12, tw + 24, 30); drawText(ctx, msg, W / 2, PAPER.y + 20, 13, { align: 'center', lw: 1.9 });
}
function drawRuler(c, x, y, ang, len, col, lw) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.fillStyle = PAPER_COL; c.fillRect(-len / 2, -4.5, len, 9);
  sRoundRect(c, -len / 2, -4.5, len, 9, 1.5, lw, col, 0.3);
  for (let i = 1; i < 6; i++) { const tx = -len / 2 + i * len / 6; sline(c, tx, -4.5, tx, i % 2 ? -1.5 : 0.5, lw * 0.7, col, 0.2); }
  c.restore();
}
function drawFire() {
  if (pill) {
    const b = REDUCED ? 0 : Math.sin(clock * 5) * 1.5;
    ctx.fillStyle = PAPER_COL; ctx.beginPath(); ctx.arc(pill.x, pill.y, PILL_R, 0, 7); ctx.fill();
    sEllipse(ctx, pill.x, pill.y, PILL_R, PILL_R, 2.2, INK);
    if (pill.kind === 2) drawRuler(ctx, pill.x, pill.y + b * 0.5, -0.6, 26, INK, 1.7);
    else if (pill.kind === 1) drawScissors(ctx, pill.x - 2, pill.y + b * 0.5, -0.5, 24, REDUCED ? 0.6 : 0.5 + 0.5 * Math.sin(clock * 6), INK, 1.9);
    else {
      sline(ctx, pill.x - 8, pill.y + 10 + b, pill.x + 2, pill.y - 1 + b, 2.6, INK, 0.3);
      flame(ctx, pill.x + 3, pill.y + 1 + b, 14, vnoise(boil, 0.5) * 3, INK, 1.8, PAPER_COL);
    }
  }
  if (!fire) return;
  const f = fire, r = fireRadius(f), end = F_WARN + F_GROW + F_HOLD;
  if (f.t < F_WARN + F_GROW) { ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.setLineDash([8, 7]); ctx.beginPath(); ctx.arc(f.x, f.y, FIRE_R, boil * 0.05, boil * 0.05 + 7); ctx.stroke(); ctx.setLineDash([]); }
  if (f.t < F_WARN) { const k = f.t / F_WARN; flame(ctx, f.x, f.y + 10, 14 + k * 22, vnoise(boil, 1.5) * 6, INK, 2.2, PAPER_COL); return; }
  ctx.save(); ctx.globalAlpha = f.t > end ? Math.max(0, 1 - (f.t - end) / F_OUT) : 1;
  ctx.save(); ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.clip();
  ctx.fillStyle = 'rgba(24,24,224,0.14)'; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.beginPath();
  for (let d = -r * 2 + (boil % 3) * 3; d < r * 2; d += 9) { ctx.moveTo(f.x + d - r, f.y + r); ctx.lineTo(f.x + d + r, f.y - r); }
  ctx.stroke(); ctx.restore();
  const R = mulberry(f.seed + boil * 13), list = [], n = Math.max(6, Math.round(r / 6.5));
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R() * 0.3; list.push([f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 17 + R() * 15, R()]); }
  for (let i = 0; i < r * r / 800; i++) { const d = Math.sqrt(R()) * r * 0.86, a = R() * 7; list.push([f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 15 + R() * 14, R()]); }
  list.sort((a, b) => a[1] - b[1]);
  for (const q of list) flame(ctx, q[0], q[1] + 5, q[2], (q[3] - 0.5) * q[2] * 0.55, INK, 2, PAPER_COL);
  ctx.restore();
}
function update(dt) {
  clock += dt; stateT += dt;
  for (const p of pieces) p.t += dt / 1.15;
  pieces = pieces.filter(p => p.t < 1);
  for (const p of players) if (!p.alive && p.death) p.deadT += dt;
  if (state === 'ready') {
    const cnt = Math.ceil((1.8 - stateT) / 0.6);
    if (cnt !== lastCount && cnt > 0) { sfx.tick(); lastCount = cnt; }
    for (const p of players) p.a += steer(p, dt);
    if (stateT >= 1.8) { state = 'play'; stateT = 0; sfx.go(); }
  } else if (state === 'play') {
    let acc = dt;
    while (acc > 1e-6 && state === 'play') {
      const h = Math.min(STEP, acc); acc -= h; time += h;
      stepPlayers(h); stepFire(h); stepSnip(h);
      if (cutDirty) { cutDirty = false; checkPieces(); for (const p of players) if (p.alive && !paper[(p.y / CELL | 0) * GW + (p.x / CELL | 0)]) die(p, 'fall'); }
      if (mode === 1 ? players.some(p => !p.alive) : players.filter(p => p.alive).length <= 1) endRound();
    }
  }
}

// ---------------------------------------------------------------- drawing
function drawHead(p) {
  if (!p.alive) {
    if (p.death === 'fall' && p.deadT < 0.6) { const k = 1 - p.deadT / 0.6; ctx.fillStyle = p.color; ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(p.x + p.deadT * 6, p.y + p.deadT * 30, 5 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    return;
  }
  if (p.cutting) {                // in the air: shadow stays on the page, the nib lifts off it
    ctx.fillStyle = 'rgba(10,10,110,0.28)'; ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, 6, 3.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = PAPER_COL; ctx.beginPath(); ctx.arc(p.x, p.y - 11, 8.6, 0, 7); ctx.fill();
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y - 11, 6.4, 0, 7); ctx.fill();
    ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(p.x, p.y - 11, 15, -Math.PI / 2 - p.meter / METER_MAX * 3, -Math.PI / 2 + p.meter / METER_MAX * 3); ctx.stroke(); ctx.setLineDash([]);
  } else if (p.snip > 0) {
    const open = REDUCED ? 0.6 : 0.5 + 0.5 * Math.sin(clock * 30);
    drawScissors(ctx, p.x, p.y, p.a, 30, open, PAPER_COL, 5.5); drawScissors(ctx, p.x, p.y, p.a, 30, open, p.color, 2.2);
    ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(p.x, p.y, 25, p.a + Math.PI - p.snip / SNIP_TIME * 2.4, p.a + Math.PI + p.snip / SNIP_TIME * 2.4); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.fillStyle = PAPER_COL; ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, 7); ctx.fill();
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 4.6, 0, 7); ctx.fill();
  }
}
function swatch(c, p, x, y, len) {
  c.lineCap = 'round';
  p.strands.forEach((s, k) => {
    c.strokeStyle = s.col; c.lineWidth = s.w; c.beginPath();
    for (let i = 0; i <= len; i += 3) { const yy = y + s.o + vnoise(p.id * 97 + (boil % 3) * 31 + k * 7, i * s.f * 1.6) * s.amp + Math.sin(i / len * Math.PI * 2) * 3; i ? c.lineTo(x + i, yy) : c.moveTo(x + i, yy); }
    c.stroke();
  });
}
function tally(c, x, y, n, col) {
  for (let i = 0; i < n; i++) {
    const g = Math.floor(i / 5) * 44, k = i % 5;
    if (k === 4) sline(c, x + g - 4, y + 15, x + g + 27, y + 3, 2.2, col, 0.7);
    else sline(c, x + g + k * 7.5, y, x + g + k * 7.5 + 1, y + 18, 2.2, col, 0.7);
  }
}
function meter(c, p, x, y) {
  const live = state === 'play' && p.alive, frac = p.meter / METER_MAX, n = 8, col = p.color;
  hopIcon(c, x + 11, y + 3, 20, col, 1.8);
  for (let i = 0; i < n; i++) {
    const f = Math.max(0, Math.min(1, frac * n - i)), dx = x + 34 + i * 13;
    if (f > 0.05) sline(c, dx, y, dx + 8 * f, y, 2.4, col, 0.35);
    else { c.fillStyle = '#b9b9d6'; c.beginPath(); c.arc(dx + 1, y, 1, 0, 7); c.fill(); }
  }
}
// --- margin doodles: someone bored is drawing in the margin while the game goes on
const DOODLES = (() => {
  const circ = (cx, cy, r, n = 16, a0 = -1.6, a1 = 4.9) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
  const L = (...p) => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
  const legs = []; for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const y = 3.8 + i * 0.9; legs.push([[5 + s * 2.3, y], [5 + s * 4.1, y - 1.9 + i * 1.1], [5 + s * 5.2, y + 0.4 + i * 1.3]]); }
  const star = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI * 4 / 5; return [5 + Math.cos(a) * 5, 5.4 + Math.sin(a) * 5]; });
  const spiral = Array.from({ length: 64 }, (_, i) => { const a = i * 0.36, r = 0.25 + i * 0.074; return [5 + Math.cos(a) * r, 5 + Math.sin(a) * r]; });
  const petals = Array.from({ length: 5 }, (_, i) => circ(5 + Math.cos(i * 1.257 - 1.57) * 2.3, 3.4 + Math.sin(i * 1.257 - 1.57) * 2.3, 1.25, 10));
  return [
    [L(5, -40, 5, 2.3), circ(5, 5, 2.7), circ(5, 8.7, 1.5, 10), ...legs, L(4.4, 8.5, 4.5, 8.6), L(5.5, 8.5, 5.6, 8.6)],                                                    // spider on its thread
    [L(2, 2.5, 2, 5), L(5, 2.5, 5, 5), L(8, 2.5, 8, 5), L(2, 7, 2, 9.5), L(5, 7, 5, 9.5), L(8, 7, 8, 9.5), L(2, 2.5, 5, 0, 8, 2.5), L(2, 9.5, 5, 12, 8, 9.5), L(2, 5, 5, 7), L(5, 5, 8, 7), L(8, 5, 6.5, 6), L(2, 7, 3.5, 6)],   // the S everyone drew
    [star],
    [spiral],
    [L(3.3, 0, 3.3, 10), L(6.6, 0, 6.6, 10), L(0, 3.3, 10, 3.3), L(0, 6.6, 10, 6.6), L(0.8, 0.8, 2.6, 2.6), L(2.6, 0.8, 0.8, 2.6), circ(5, 5, 1.1, 10), L(7.4, 7.4, 9.2, 9.2), L(9.2, 7.4, 7.4, 9.2), circ(8.3, 1.7, 1.1, 10), L(0.8, 7.4, 2.6, 9.2), L(2.6, 7.4, 0.8, 9.2)],
    [L(0, 3, 6, 3, 6, 9, 0, 9, 0, 3), L(0, 3, 3, 0, 9, 0, 9, 6, 6, 9), L(6, 3, 9, 0)],                                                                                       // the cube
    [circ(5, 5, 4.6, 22), L(3.4, 3.6, 3.5, 4.4), L(6.6, 3.6, 6.5, 4.4), circ(5, 5.2, 2.7, 9, 0.35, 2.8)],
    [circ(5, 3.4, 1.1, 10), ...petals, L(5, 5.9, 4.6, 8.2, 5.2, 11.4), L(5, 8.8, 7.4, 7.6, 5.1, 9.8)],
    [L(6, 0, 2, 5.6, 5, 5.6, 3, 11.4, 8.6, 4, 5.4, 4, 6, 0)],
  ];
})();
function drawDoodles() {
  const epoch = Math.floor(clock / 150), t = clock - epoch * 150, r = mulberry(900 + epoch);
  const order = [1, 2, 3, 4, 5, 6, 7, 8]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.unshift(0); order.length = 8;       // the spider always comes down first
  ctx.strokeStyle = '#5a6185'; ctx.fillStyle = '#5a6185'; ctx.lineWidth = 1.5;
  order.forEach((di, slot) => {
    let budget = (t - 3 - slot * 7) * 24; if (budget <= 0) return;
    const ox = 7, oy = 122 + slot * 81, S = 4.5, d = DOODLES[di]; let tip = null;
    d.forEach((st, k) => {
      if (budget <= 0) return;
      const rr = rngAt(di * 31 + k, slot, 7); ctx.beginPath();
      let lx = 0, ly = 0;
      for (let i = 0; i < st.length; i++) {
        let x = st[i][0], y = st[i][1];
        if (i) { const seg = Math.hypot(x - lx, y - ly) || 0.01; if (seg > budget) { const f = budget / seg; x = lx + (x - lx) * f; y = ly + (y - ly) * f; budget = 0; tip = [ox + x * S, oy + y * S]; } else budget -= seg; }
        const jx = ox + x * S + (rr() - 0.5) * 0.9, jy = oy + y * S + (rr() - 0.5) * 0.9;
        i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy);
        lx = st[i][0]; ly = st[i][1];
        if (tip) break;
      }
      ctx.stroke();
    });
    if (tip) { ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.2, 0, 7); ctx.fill(); }      // the pencil point, still at work
  });
}
function drawBox() {              // the hand-drawn box is the edge of the game: cross it and you are out
  sRoundRect(ctx, PAPER.x - 1, PAPER.y - 1, PAPER.w + 2, PAPER.h + 2, 9, 1.3, INK_SOFT, 2.6);
  sRoundRect(ctx, PAPER.x, PAPER.y, PAPER.w, PAPER.h, 9, 3.8, INK, 1);
}
function drawHUD() {              // written straight onto the page's header
  const n = players.length;
  if (n <= 2) {
    players.forEach((p, i) => {
      const w = 372, x = i ? PAPER.x + PAPER.w - w : PAPER.x;
      ctx.save(); ctx.translate(x, 22);
      swatch(ctx, p, 4, 26, 34);
      drawText(ctx, p.name, 50, 17, 18, { color: p.color, lw: 2.4 });
      if (mode === 0) tally(ctx, 50 + textWidth(p.name, 18) + 20, 17, p.score, p.color);
      meter(ctx, p, w - 142, 27);
      ctx.restore();
    });
    if (mode === 0) drawText(ctx, 'FIRST TO ' + WIN, W / 2, 41, 13, { align: 'center', lw: 1.7 });
    else { drawText(ctx, time.toFixed(1), W / 2, 30, 22, { align: 'center', lw: 2.5, jit: 0.3 }); drawText(ctx, 'BEST ' + best.toFixed(1), W / 2, 66, 8, { align: 'center', lw: 1.2 }); }
    return;
  }
  const slot = PAPER.w / n;         // a crowd: one narrow column each, name and score
  players.forEach((p, i) => {
    const cap = Math.min(13, (slot - (mode === 0 ? 66 : 40)) / (p.name.length * 0.95));
    ctx.save(); ctx.translate(PAPER.x + i * slot, 14);
    swatch(ctx, p, 2, 24, 22);
    if (cap >= 6.5) drawText(ctx, p.name, 30, 24 - cap / 2, cap, { color: p.color, lw: Math.max(1.3, cap * 0.13) });
    if (mode === 0) drawText(ctx, String(p.score), slot - 12, 14, 19, { align: 'right', color: p.color, lw: 2.5 });
    if (!p.alive && state !== 'ready') sline(ctx, 0, 25, 34 + (cap >= 6.5 ? textWidth(p.name, cap) : 0), 23, 1.8, p.color, 0.8);
    ctx.restore();
  });
  drawText(ctx, mode === 0 ? 'FIRST TO ' + WIN : time.toFixed(1) + '   BEST ' + best.toFixed(1), W / 2, 66, 9, { align: 'center', lw: 1.3 });
}
function drawReady() {
  for (const p of players) {
    const dx = Math.cos(p.a), dy = Math.sin(p.a);
    dashLine(ctx, p.x + dx * 14, p.y + dy * 14, p.x + dx * 74, p.y + dy * 74, 7, 6, 2, p.color);
    sline(ctx, p.x + dx * 84, p.y + dy * 84, p.x + dx * 72 - dy * 7, p.y + dy * 72 + dx * 7, 2, p.color, 0.4);
    sline(ctx, p.x + dx * 84, p.y + dy * 84, p.x + dx * 72 + dy * 7, p.y + dy * 72 - dx * 7, 2, p.color, 0.4);
    const below = p.y < PAPER.y + PAPER.h - 190, ky = below ? p.y + 96 : p.y - 150, kx = p.x - 62;
    if (p.id > 1 || seats[p.id]) { drawText(ctx, p.name, p.x, below ? p.y + 26 : p.y - 40, 12, { color: p.color, align: 'center', lw: 1.7 }); continue; }   // on a phone: just say whose dot this is
    keycap(ctx, kx, ky, 34, p.caps[0], p.color, held(p, 'l')); keycap(ctx, kx + 42, ky, 34, p.caps[1], p.color, held(p, 'r'));
    drawText(ctx, 'STEER', kx + 88, ky + 11, 11, { color: p.color, lw: 1.5 });
    keycap(ctx, kx + 21, ky + 48, 34, p.caps[2], p.color, held(p, 'c'));
    drawText(ctx, 'HOLD: JUMP', kx + 67, ky + 59, 11, { color: p.color, lw: 1.5 });
  }
  const cnt = Math.max(1, Math.ceil((1.8 - stateT) / 0.6));
  drawText(ctx, String(cnt), W / 2, PAPER.y + PAPER.h / 2 - 45, 90, { align: 'center', lw: 7, jit: 1.6 });
}
function drawOver() {
  const m = roundMsg, k = REDUCED ? 1 : Math.min(1, stateT / 0.22), e = 1 - Math.pow(1 - k, 3);
  const w = Math.max(540, textWidth(m.head, 30) + 110), h = 236, x = W / 2 - w / 2, y = PAPER.y + (m.low ? PAPER.h - h - 60 : 60) + (1 - e) * 26;
  ctx.globalAlpha = e;
  const done = scrap(ctx, x, y, w, h, -0.012, 301);
  drawText(ctx, m.head, w / 2, 34, 30, { align: 'center', color: m.color, lw: 3.4 });
  drawText(ctx, m.sub, w / 2, 86, 13, { align: 'center', color: INK, lw: 1.7 });
  if (mode === 0) {
    const n = players.length, gap = Math.min(76, (w - 90) / n);
    players.forEach((p, i) => drawText(ctx, String(p.score), w / 2 + (i - (n - 1) / 2) * gap, 114, 24, { align: 'center', color: p.color, lw: 2.8 }));
  } else drawText(ctx, m.extra, w / 2, 118, 18, { align: 'center', color: INK, lw: 2.2 });
  dashLine(ctx, 30, 156, w - 30, 156, 8, 7, 1.4, INK);
  drawText(ctx, m.next, w / 2, 174, 13, { align: 'center', color: INK, lw: 1.8 });
  drawText(ctx, m.tip, w / 2, 207, 8.5, { align: 'center', color: INK, lw: 1.2 });
  done(); ctx.globalAlpha = 1;
}
function drawPause() {
  const w = 440, h = 150, done = scrap(ctx, W / 2 - w / 2, PAPER.y + PAPER.h / 2 - h / 2, w, h, 0.01, 512);
  drawText(ctx, 'PAUSED', w / 2, 30, 30, { align: 'center', lw: 3.4 });
  drawText(ctx, 'SPACE - CARRY ON', w / 2, 88, 13, { align: 'center', lw: 1.8 });
  drawText(ctx, 'Q - BACK TO TITLE', w / 2, 114, 13, { align: 'center', lw: 1.8 });
  done();
}
function drawTitle() {
  const px = PAPER.x, py = PAPER.y;
  drawText(ctx, 'PEN, PAPER,', px + 78, py + 70, 62, { lw: 6.2, jit: 1.25 });
  drawText(ctx, 'FIRE', px + 78, py + 160, 62, { lw: 6.2, jit: 1.25 });
  // a fuse, burning its way across the page
  const ly = py + 268, sx = px + 78 + ((REDUCED ? 0.55 : (clock * 0.045) % 1) * 0.5 + 0.44) * (PAPER.w - 156);
  sline(ctx, px + 78, ly, sx - 6, ly, 1.5, NAVY, 0.4);
  dashLine(ctx, sx + 26, ly, px + PAPER.w - 78, ly, 11, 9, 2, INK);
  flame(ctx, sx + 10, ly + 5, 40, vnoise(boil, 0.3) * 9, INK, 2.8, PAPER_COL); flame(ctx, sx + 11, ly + 4, 18, vnoise(boil, 2.3) * 4, INK, 1.8, PAPER_COL);
  // the two instruments, mid-scribble
  const wave = (p, x0, y0, len, amp, ph) => p.strands.forEach((s, k) => {
    ctx.strokeStyle = s.col; ctx.lineWidth = s.w; ctx.beginPath();
    for (let i = 0; i <= len; i += 3) { const t = i / len, xx = x0 - i, yy = y0 + s.o + Math.sin(t * 7.5 + ph) * amp * (0.35 + t * 0.65) * (1 - t * 0.25) + vnoise(p.id * 97 + (boil % 3) * 31 + k * 7, i * s.f) * s.amp; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    ctx.stroke();
  });
  wave(ALL[0], px + 850, py + 139, 240, 26, 0.3); drawTool(ctx, px + 850, py + 139, -0.72, 170, false);
  wave(ALL[1], px + 960, py + 212, 290, 20, 2.4); drawTool(ctx, px + 960, py + 212, -0.55, 180, true);
  // seats: each player's keys on their own side of the page
  ALL.slice(0, 2).forEach((p, i) => {
    const x = i ? px + PAPER.w - 78 - 236 : px + 78, y = py + 318;
    swatch(ctx, p, x, y + 13, 44); drawText(ctx, p.name, x + 56, y, 26, { color: p.color, lw: 3 });
    keycap(ctx, x, y + 52, 40, p.caps[0], p.color, held(p, 'l')); keycap(ctx, x + 50, y + 52, 40, p.caps[1], p.color, held(p, 'r'));
    drawText(ctx, 'STEER', x + 106, y + 65, 14, { color: p.color, lw: 1.9 });
    keycap(ctx, x + 25, y + 110, 40, p.caps[2], p.color, held(p, 'c'));
    drawText(ctx, 'HOLD TO JUMP', x + 106, y + 123, 14, { color: p.color, lw: 1.9 });
    if (seats[i]) { sEllipse(ctx, x + 70, y + 181, 82, 17, 1.6, p.color); drawText(ctx, 'PHONE JOINED', x + 70, y + 176, 10, { color: p.color, align: 'center', lw: 1.5 }); }
  });
  const rules = ['TOUCH INK AND YOU ARE OUT.', 'JUMP TO HOP OVER LINES.', 'MATCH: A FIRE BURNS LINES AWAY.', 'SCISSORS: THE SMALL HALF FALLS.', 'RULER: OTHERS TURN ONLY SHARP.'];
  const rw = Math.max(...rules.map(t => textWidth(t, 6))), rcap = Math.min(13.5, 440 * 6 / rw);      // the gap between the two players' key columns is about 490 wide
  rules.forEach((t, i) => drawText(ctx, t, 686, py + 318 + i * 31, rcap, { align: 'center', lw: 1.9 }));
  // mode choice
  const my = py + 520, opts = [['DUEL', 'LAST LINE STANDING, FIRST TO ' + WIN], ['DUET', 'SHARE THE PAGE, SURVIVE TOGETHER']];
  opts.forEach((o, i) => {
    const cx = W / 2 + (i ? 190 : -190);
    drawText(ctx, o[0], cx, my, 30, { align: 'center', lw: 3.4 });
    drawText(ctx, o[1], cx, my + 62, 9.5, { align: 'center', lw: 1.35 });
    if (i === mode) { sEllipse(ctx, cx, my + 15, 86, 37, 2.4, INK); }
  });
  arrowGlyph(ctx, W / 2 - 16, my + 15, 'left', 7, INK, 2); arrowGlyph(ctx, W / 2 + 16, my + 15, 'right', 7, INK, 2);
  const blink = REDUCED || Math.sin(clock * 3.2) > -0.55;
  if (blink) drawText(ctx, 'SPACE TO START', W / 2, py + 614, 15, { align: 'center', lw: 2.1 });
  drawText(ctx, 'M: SOUND ' + (muted ? 'OFF' : 'ON') + '   N: MUSIC ' + (musicOn ? 'ON' : 'OFF') + '   ESC: PAUSE', px + PAPER.w - 78, py + 632, 8, { align: 'right', lw: 1.1 });
  if (best > 0) drawText(ctx, 'DUET BEST ' + best.toFixed(1), px + 78, py + 632, 8, { lw: 1.1 });
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(deskC, 0, 0);
  ctx.drawImage(shadowC, 6 * RS, 8 * RS);
  composePaper(); ctx.drawImage(tempC, 0, 0);
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  for (const p of pieces) {
    const t = p.t, e = t * t;
    ctx.save(); ctx.globalAlpha = 1 - e * e;
    ctx.translate(p.x + p.w / 2 + p.dir * t * 14, p.y + p.h / 2 + e * 70); ctx.rotate(p.dir * p.spin * e); ctx.scale(1 - 0.16 * t, 1 - 0.16 * t);
    ctx.drawImage(p.c, -p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
  }
  drawDoodles(); drawBox();
  if (state === 'title') { drawTitle(); if (retired) drawText(ctx, 'PHONES NOW FOLLOW ANOTHER TAB. CLOSE THIS ONE OR RELOAD IT', W / 2, 34, 13, { align: 'center', color: INK, lw: 1.8 });
    else if (joinUrl) drawText(ctx, 'PHONES AS CONTROLLERS: OPEN  ' + joinUrl, W / 2, 30, 15, { align: 'center', color: INK, lw: 2 });
    const extra = ALL.filter((p, i) => i > 1 && seats[i]);
    if (extra.length) { let x = W / 2 - extra.reduce((a, p) => a + textWidth(p.name, 9) + 22, textWidth('ALSO IN:', 9)) / 2; drawText(ctx, 'ALSO IN:', x, 56, 9, { lw: 1.3 }); x += textWidth('ALSO IN:', 9) + 14; for (const p of extra) { drawText(ctx, p.name, x, 56, 9, { color: p.color, lw: 1.4 }); x += textWidth(p.name, 9) + 22; } }
    if (!actx || actx.state !== 'running') drawText(ctx, 'PRESS ANY KEY ON THIS SCREEN TO TURN THE SOUND ON', W / 2, 78, 8, { align: 'center', color: INK, lw: 1.2 }); }
  else {
    drawFire(); drawSnip();
    for (const p of players) {
      drawHead(p);
      if (p.alive && p.ruler > 0 && state !== 'ready') {      // the ruler rides along with whoever is stuck with it
        drawRuler(ctx, p.x, p.y - 24, p.a, 30, p.color, 1.8);
        ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(p.x, p.y, 34, -Math.PI / 2 - p.ruler / RULER_TIME * 3, -Math.PI / 2 + p.ruler / RULER_TIME * 3); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawHUD();
    if (state === 'ready') drawReady();
    if (state === 'over' && stateT > 0.55) { ctx.save(); const t = stateT; stateT = t - 0.55; drawOver(); stateT = t; ctx.restore(); }
    if (paused) drawPause();
  }
}

// ---------------------------------------------------------------- input and loop
function confirm() {
  audio();
  if (paused) { paused = false; return; }
  if (state === 'title') startMatch();
  else if (state === 'over' && stateT > 0.7) (roundMsg && roundMsg.match) ? startMatch() : startRound();
}
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true; audio();
  if (e.code === 'Space' || e.code === 'Enter') confirm();
  else if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 1; }
  else if (e.code === 'KeyN') { musicOn = !musicOn; if (musicBus) musicBus.gain.value = musicOn ? 1 : 0; }
  else if (e.code === 'Escape') { if (state === 'over') toTitle(); else if (state === 'play' || state === 'ready') paused = !paused; }
  else if (e.code === 'KeyQ' && paused) toTitle();
  else if (e.code === 'KeyP' && (state === 'play' || state === 'ready')) paused = !paused;
  else if (state === 'title') {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { if (mode !== 0) { mode = 0; audio(); sfx.tick(); } }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') { if (mode !== 1) { mode = 1; audio(); sfx.tick(); } }
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if ((state === 'play' || state === 'ready') && !seats.some(Boolean)) paused = true; });
main.addEventListener('pointerdown', (e) => {
  main.focus();
  if (state !== 'title') { confirm(); return; }
  const r = main.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H, my = PAPER.y + 520;
  if (y > my - 30 && y < my + 85 && Math.abs(x - W / 2) < 300) { const m = x < W / 2 ? 0 : 1; if (m !== mode) { mode = m; audio(); sfx.tick(); return; } }
  confirm();
});

// ---------------------------------------------------------------- phones as controllers
const pad = Array.from({ length: MAXP }, () => ({ l: 0, r: 0, c: 0, aim: null })), seats = new Array(MAXP).fill(false);
let net = null, joinUrl = '', netT = 0, retired = false;
function held(p, k) { return !!(keys[p.keys[k]] || pad[p.id][k]); }
function steer(p, dt) {          // keys turn left/right; a phone stick points where to go and the line swings round to it
  const t = (held(p, 'r') ? 1 : 0) - (held(p, 'l') ? 1 : 0), aim = pad[p.id].aim;
  if (p.ruler > 0 && state === 'play') {     // ruled: no curves, only corners. A key press is one square turn; the stick asks for one square turn at a time
    const l = held(p, 'l'), r = held(p, 'r'); let step = 0;
    p.ruler -= dt; p.rulerCd -= dt;
    if (r && !p.wasR) step += Math.PI / 2; if (l && !p.wasL) step -= Math.PI / 2;
    p.wasL = l; p.wasR = r;
    if (!step && aim != null && p.rulerCd <= 0) {
      const d = Math.atan2(Math.sin(aim - p.a), Math.cos(aim - p.a));
      if (Math.abs(d) > Math.PI / 4) step = Math.sign(d) * Math.PI / 2;
    }
    if (step) { p.rulerCd = 0.22; sfx.tick(); }
    return step;
  }
  p.wasL = held(p, 'l'); p.wasR = held(p, 'r');
  if (t || aim == null) return t * TURN * dt;
  const d = Math.atan2(Math.sin(aim - p.a), Math.cos(aim - p.a));
  return Math.max(-TURN * dt, Math.min(TURN * dt, d));
}
function pickMode(m) { if (mode !== m) { mode = m; audio(); sfx.tick(); } }
function netState() {
  if (!net || net.readyState !== 1) return;
  net.send(JSON.stringify({ t: 'st', s: paused ? 'paused' : state, mode, match: !!(roundMsg && roundMsg.match), p: players.map(p => ({ i: p.id, m: Math.round(p.meter / METER_MAX * 100) / 100, a: p.alive === false ? 0 : 1, c: p.cutting ? 1 : 0, n: p.score })) }));
}
function netConnect() {
  if (!location.protocol.startsWith('http')) return;
  fetch('/info').then(r => r.json()).then(i => { joinUrl = i.join || ''; }).catch(() => { /* served by something other than server.js */ });
  const open = () => {
    try { net = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?role=host&v=2'); } catch (e) { return; }
    net.onopen = netState;
    net.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'bye') { retired = true; joinUrl = ''; }
      else if (m.t === 'seats') m.s.forEach((v, i) => { if (i >= MAXP) return; seats[i] = !!v; if (!v) pad[i].l = pad[i].r = pad[i].c = 0; pad[i].aim = null; });
      else if (m.t === 'in' && pad[m.p]) {
        const o = pad[m.p];
        if (state === 'title') { if (m.l && !o.l) pickMode(0); if (m.r && !o.r) pickMode(1); }
        o.l = m.l ? 1 : 0; o.r = m.r ? 1 : 0; o.c = m.c ? 1 : 0;
        const had = o.aim; o.aim = typeof m.a === 'number' ? m.a : null;
        if (state === 'title' && o.aim != null && had == null) pickMode(Math.cos(o.aim) < 0 ? 0 : 1);
      } else if (m.t === 'go') { if (state !== 'over' || stateT > 1.6) confirm(); netState(); }      // a thumb still mashing jump must not skip the result
    };
    net.onclose = () => { seats.fill(false); for (const o of pad) { o.l = o.r = o.c = 0; o.aim = null; } if (!retired) setTimeout(open, 1000); };
  };
  open();
}

let lastT = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
  if (!REDUCED) boil = Math.floor(t / 1000 * 7);
  if (!paused) update(dt);
  updateAudio(dt);
  netT += dt; if (netT > 0.1) { netT = 0; netState(); }
  render();
  requestAnimationFrame(frame);
}
buildDesk(); freshPaper(); netConnect();
requestAnimationFrame(frame);

// test hooks
window.__pps = { get players() { return players; }, ALL, get fire() { return fire; }, get snip() { return snipEv; }, RULER_TIME, get pill() { return pill; }, forcePill(x, y, kind = 0) { pill = { x, y, t: 0, kind }; }, pad, seats, sim(fn, steps) { paused = true; for (let i = 0; i < steps && state === 'play'; i++) { fn(i); update(1 / 60); } }, skipReady() { state = 'play'; stateT = 0; }, frailBand: BAND, keys, get state() { return state; }, get time() { return time; }, update, render, startMatch, setMode: (m) => { mode = m; }, paper, cut, checkPieces, set boil(v) { boil = v; } };
})();
