#!/usr/bin/env node
/* Venue runner: keeps the machine alive, writes the archive to the SSD, syncs it to Neon when it can,
   and exposes a small local API for the sensor bridge and the displays. No dependencies.

   Environment:
     DATA_DIR       where state and archive live (default ./data). Put this on the SSD.
     PORT, HOST     default 8080 on 127.0.0.1. The API has no login, so keep it on localhost or a private network.
     DATABASE_URL   Neon connection string. Optional: without it the archive stays on the SSD only.
     RUN_ID         names this run in Neon (default: the start date). Set it per venue.
     DAY_MS         length of one exhibition day in milliseconds (default 86400000). Shorten it to demo the arc.
     SALT_DAYS      forget all codes every N days (default 14, 0 = never).  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const HM = require('../src/engine.js');
const P = require('./persist.js');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT) || 8080, HOST = process.env.HOST || '127.0.0.1';
const DAY_MS = Number(process.env.DAY_MS) || 86400000;
const SENSOR_TIMEOUT_MS = 5000, SAVE_MS = 60000, FLUSH_MS = 2000, SYNC_MS = 60000, TICK_MS = 250;
fs.mkdirSync(DATA, { recursive: true });

/* meta.json: when the exhibition started and the run name. Written once. */
let meta;
try { meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8')); } catch (e) {
  const now = new Date();
  meta = { startMs: now.getTime(), runId: process.env.RUN_ID || 'run-' + now.toISOString().slice(0, 10) };
  P.atomicWrite(path.join(DATA, 'meta.json'), JSON.stringify(meta));
}
if (process.env.RUN_ID) meta.runId = process.env.RUN_ID;

const writer = new P.ArchiveWriter(DATA);
const m = HM.createMachine({
  saltEveryDays: process.env.SALT_DAYS != null ? Number(process.env.SALT_DAYS) : 14,
  archiveLimit: 2000, onLog: (e) => writer.push(e)
});
const saved = P.loadState(DATA);
if (saved) { m.restore(saved); console.log('restored: day', m.day, 'of', HM.DAYS); } else console.log('starting a new run:', meta.runId);

const sync = process.env.DATABASE_URL ? new P.NeonSync({ dir: DATA, databaseUrl: process.env.DATABASE_URL, runId: meta.runId }) : null;
console.log(sync ? 'neon sync on, run ' + meta.runId : 'neon sync off (no DATABASE_URL), archive stays on the SSD');

/* ---------- the loop ---------- */
let last = Date.now(), lastSenseAt = 0;
setInterval(() => {
  const now = Date.now(), dt = Math.min(5, (now - last) / 1000); last = now;
  if (m.visitor && now - lastSenseAt > SENSOR_TIMEOUT_MS) m.visitorLeave();    /* the sensors stopped seeing someone */
  const target = Math.min(HM.DAYS, Math.floor((now - meta.startMs) / DAY_MS) + 1);
  while (!m.ended && m.day < target) m.advanceDay({ overnight: false });
  m.tick(dt);
}, TICK_MS);

function saveNow() { try { P.saveState(DATA, m); } catch (e) { console.error('save failed:', e.message); } }
setInterval(saveNow, SAVE_MS);
setInterval(() => { try { writer.flush(); } catch (e) { console.error('archive flush failed:', e.message); } }, FLUSH_MS);

let syncDelay = SYNC_MS, nextSync = Date.now() + SYNC_MS;
setInterval(async () => {
  if (!sync || Date.now() < nextSync) return;
  try { const n = await sync.drain(); if (n) console.log('synced', n, 'archive entries to neon'); syncDelay = SYNC_MS; }
  catch (e) { syncDelay = Math.min(syncDelay * 2, 15 * 60000); console.error('neon sync waiting, retry in', syncDelay / 1000, 's:', e.message); }
  nextSync = Date.now() + syncDelay;
}, 5000);

/* ---------- API ---------- */
function mood(c) { return c > 0.66 ? 'charged' : c > 0.3 ? 'wearing down' : 'flat'; }
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 4096) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  });
}
const unit = (v) => typeof v === 'number' && v >= 0 && v <= 1;
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && (url === '/' || url === '/human-mode.html')) {
      const file = path.join(__dirname, '..', 'dist', 'human-mode.html');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'run node build.js first' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && url === '/api/health') return send(res, 200, { ok: true, day: m.day, ended: m.ended, sync: !!sync });
    if (req.method === 'GET' && url === '/api/state') {
      const c = m.charge();
      return send(res, 200, {
        day: m.day, days: HM.DAYS, charge: Math.round(c * 1000) / 1000, mood: mood(c), visitor: !!m.visitor,
        lines: m.lines.map((l) => ({ id: l.id, text: l.text })),
        heat: Buffer.from(Uint8Array.from(m.heat, (v) => Math.min(255, Math.round(v * 255)))).toString('base64')
      });
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    const b = await body(req);
    if (url === '/api/sense') {
      if (!unit(b.x) || !unit(b.y)) return send(res, 400, { error: 'x and y must be numbers from 0 to 1' });
      const now = Date.now(), dt = lastSenseAt ? Math.min(1, (now - lastSenseAt) / 1000) : 0.1; lastSenseAt = now;
      m.sense(b.x, b.y, dt); return send(res, 200, { ok: true });
    }
    if (url === '/api/leave') { m.visitorLeave(); return send(res, 200, { ok: true }); }
    if (url === '/api/event') {
      if (b.kind !== 'phone' && b.kind !== 'cough') return send(res, 400, { error: 'kind must be phone or cough' });
      m.visitorEvent(b.kind); return send(res, 200, { ok: true });
    }
    if (url === '/api/code') {                       /* the code is hashed in the engine and never logged or stored */
      if (typeof b.code !== 'string' || !b.code || b.code.length > 40) return send(res, 400, { error: 'code must be 1 to 40 characters' });
      return send(res, 200, { outcome: m.enterCode(b.code).outcome });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 400, { error: 'bad request' }); }
});
server.listen(PORT, HOST, () => console.log('listening on http://' + HOST + ':' + PORT));

/* ---------- shutdown: write everything before exiting ---------- */
function shutdown() {
  try { writer.flush(); } catch (e) { /* nothing more to do */ }
  saveNow(); server.close(); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
