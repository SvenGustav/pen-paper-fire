#!/usr/bin/env node
'use strict';
// Pen, Paper, Fire - local wifi server. No dependencies: `node server.js`.
// Serves the game to the big screen and a controller page to phones, and relays
// phone input to the game over a small hand-rolled WebSocket.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { execFileSync } = require('child_process');

const PORT = +process.env.PORT || 4747;
const FILES = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
  '/pad': ['pad.html', 'text/html'], '/pad.html': ['pad.html', 'text/html'],
  '/game.js': ['game.js', 'text/javascript'], '/sketch.js': ['sketch.js', 'text/javascript'],
};

// ---------------------------------------------------------------- addresses
const isWSL = os.release().toLowerCase().includes('microsoft');
function localIps() {             // real wifi/ethernet first, virtual adapters (WSL, Hyper-V, VPNs) last
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
    const virtual = /vethernet|wsl|virtual|vmware|hyper-v|docker|tailscale|vpn|loopback/i.test(name);
    const home = /^(192\.168\.|10\.)/.test(a.address);
    out.push({ ip: a.address, rank: (virtual ? 10 : 0) + (home ? 0 : 1) + (/wi-?fi|wlan/i.test(name) ? -1 : 0) });
  }
  return out.sort((a, b) => a.rank - b.rank).map(o => o.ip);
}
function windowsIp() {          // under WSL the address phones can reach belongs to Windows, not to this Linux VM
  try {
    const cmd = '(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway }).IPv4Address.IPAddress';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { timeout: 6000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\s+/).find(s => /^\d+\.\d+\.\d+\.\d+$/.test(s)) || '';
  } catch (e) { return ''; }
}
const mine = localIps();
const winIp = isWSL && !process.env.PUBLIC_HOST ? windowsIp() : '';
const publicHost = process.env.PUBLIC_HOST || winIp || mine[0] || 'localhost';
const join = publicHost + (PORT === 80 ? '' : ':' + PORT) + '/pad';

// ---------------------------------------------------------------- http
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/info') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ join })); return; }
  const f = FILES[url];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not here. The game is at / and the phone controller at /pad'); return; }
  fs.readFile(path.join(__dirname, f[0]), (err, data) => {
    if (err) { res.writeHead(500); res.end('Could not read ' + f[0]); return; }
    res.writeHead(200, { 'Content-Type': f[1] + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(data);
  });
});

// ---------------------------------------------------------------- websocket
const MAXP = 12;                  // one seat per drawing instrument
const hosts = new Set(), pads = new Array(MAXP).fill(null);
function wsFrame(str) {
  const b = Buffer.from(str), n = b.length;
  return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]);
}
const send = (c, obj) => { if (c && !c.sock.destroyed) c.sock.write(wsFrame(typeof obj === 'string' ? obj : JSON.stringify(obj))); };
const toHosts = (obj) => { for (const h of hosts) send(h, obj); };
function tellSeats() {
  const s = pads.map(Boolean);
  toHosts({ t: 'seats', s });
  pads.forEach((p, i) => send(p, { t: 'you', seat: i, s }));
}
function onMessage(c, text) {
  c.seen = Date.now();
  if (c.role === 'host') { for (const p of pads) send(p, text); return; }    // game state goes out to the phones as is
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (c.seat < 0) return;
  if (m.t === 'in') toHosts({ t: 'in', p: c.seat, l: m.l ? 1 : 0, r: m.r ? 1 : 0, c: m.c ? 1 : 0, a: typeof m.a === 'number' && isFinite(m.a) ? m.a : null });
  else if (m.t === 'go') toHosts({ t: 'go', p: c.seat });
}
function drop(c) {
  if (c.gone) return; c.gone = true;
  if (c.role === 'host') hosts.delete(c);
  else if (c.seat >= 0 && pads[c.seat] === c) { pads[c.seat] = null; tellSeats(); }
  c.sock.destroy();
}
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'], q = new URL(req.url, 'http://x').searchParams;
  if (!key || !req.url.startsWith('/ws')) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, role: q.get('role') === 'host' ? 'host' : 'pad', seat: -1, seen: Date.now(), gone: false };
  if (c.role === 'host' && q.get('v') !== '2') { sock.end(); return; }      // a tab still running an older copy of the game
  if (c.role === 'host') {
    // one big screen at a time: a second tab would send the phones a second, conflicting game
    for (const old of [...hosts]) { send(old, { t: 'bye' }); hosts.delete(old); old.gone = true; old.sock.end(); }
    hosts.add(c); send(c, { t: 'seats', s: pads.map(Boolean) });
  }
  else {
    const want = parseInt(q.get('seat'), 10);
    c.seat = want >= 0 && want < MAXP && !pads[want] ? want : pads.indexOf(null);      // your old seat if it is still free, else the first empty one
    if (c.seat < 0) send(c, { t: 'full' }); else { pads[c.seat] = c; tellSeats(); }
  }
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, masked = buf[1] & 128; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      if (len === 127 || len > 8192) { drop(c); return; }
      const start = off + (masked ? 4 : 0), need = start + len;
      if (buf.length < need) return;
      const payload = Buffer.from(buf.subarray(start, need));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[off + (i & 3)];
      buf = buf.subarray(need);
      if (op === 8) { drop(c); return; }
      if (op === 9) sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      else if (op === 1) onMessage(c, payload.toString());
    }
  });
  sock.on('close', () => drop(c));
  sock.on('error', () => drop(c));
});
// a phone that walks out of wifi range never says goodbye: free its seat when it goes quiet
setInterval(() => { const now = Date.now(); for (const p of pads) if (p && now - p.seen > 5000) drop(p); }, 1000);

server.on('error', (e) => {
  console.log(e.code === 'EADDRINUSE' ? '\n  Port ' + PORT + ' is already in use by another program. Close it, or set PORT to another number.\n' : '\n  Could not start: ' + e.message + '\n');
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  if (process.platform === 'win32' && !process.env.NO_OPEN) require('child_process').exec('start "" http://localhost:' + PORT);
  console.log('\n  Pen, Paper, Fire\n');
  console.log('  Big screen (this computer):  http://localhost:' + PORT);
  console.log('  Phones (same wifi):          http://' + join);
  if (mine.length > 1 && !process.env.PUBLIC_HOST) console.log('  (if that address does not work, try: ' + mine.filter(i => i !== publicHost).join(', ') + ')');
  if (process.platform === 'win32') console.log('\n  If Windows asks about the firewall, allow Node.js on private networks.');
  console.log('');
  if (isWSL && mine[0] && publicHost !== mine[0]) {
    console.log('  You are running inside WSL. Phones reach Windows (' + publicHost + '), which has to pass the port');
    console.log('  on to WSL (' + mine[0] + '). Run these once in an Administrator PowerShell:\n');
    console.log('    netsh interface portproxy add v4tov4 listenport=' + PORT + ' listenaddress=0.0.0.0 connectport=' + PORT + ' connectaddress=' + mine[0]);
    console.log('    netsh advfirewall firewall add rule name="Pen Paper Scissors" dir=in action=allow protocol=TCP localport=' + PORT + '\n');
    console.log('  The WSL address changes when Windows restarts; rerun the first line if phones stop connecting.\n');
  } else if (isWSL && !winIp && !process.env.PUBLIC_HOST) {
    console.log('  Running inside WSL and could not read the Windows wifi address.');
    console.log('  Start with PUBLIC_HOST=<your Windows IPv4> node server.js so the join address is right.\n');
  }
});
