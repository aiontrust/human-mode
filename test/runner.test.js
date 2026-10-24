/* End to end: start the runner, use the API, stop it, start it again, and check the machine picked up where it left off. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-run-'));
const PORT = 8090 + Math.floor(Math.random() * 500), base = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b || {}) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());

function start() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'run.js')], {
    env: Object.assign({}, process.env, { DATA_DIR: dir, PORT: String(PORT), DAY_MS: '2000' }), stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const t = setInterval(() => { if (out.includes('listening')) { clearInterval(t); resolve({ child, log: () => out }); } }, 50);
    child.on('exit', (c) => { clearInterval(t); reject(new Error('runner exited early: ' + out)); });
  });
}
function stop(r) { return new Promise((res) => { r.child.on('exit', res); r.child.kill('SIGTERM'); }); }

(async () => {
  let r = await start();
  assert.strictEqual((await post('/api/sense', { x: 0.4, y: 0.5 })).ok, true);
  assert.strictEqual((await post('/api/code', { code: 'heron' })).outcome, 'new');
  assert.strictEqual((await post('/api/sense', { x: 2, y: 0.5 })).error !== undefined, true, 'out-of-range input is rejected');
  await sleep(6500);                                                           // a few two-second days
  const s1 = await get('/api/state');
  assert(s1.day >= 3, 'the day clock should have advanced, got ' + s1.day);
  assert(s1.lines.length > 0 && Buffer.from(s1.heat, 'base64').length === 40 * 26);
  await stop(r);

  for (const f of ['state.json', 'archive.ndjson', 'meta.json']) assert(fs.existsSync(path.join(dir, f)), f + ' missing');
  const archive = fs.readFileSync(path.join(dir, 'archive.ndjson'), 'utf8');
  assert(archive.trim().split('\n').length > 3);
  assert(!/heron/i.test(archive), 'the code must never reach the archive');
  console.log('first run ok: day', s1.day, ',', archive.trim().split('\n').length, 'archive lines on disk');

  r = await start();
  assert(r.log().includes('restored: day'), 'second start should restore: ' + r.log());
  const h = await get('/api/health');
  assert(h.day >= s1.day, 'the day must not go backwards after a reboot');
  await post('/api/sense', { x: 0.4, y: 0.5 });
  assert.strictEqual((await post('/api/code', { code: 'heron' })).outcome, 'match', 'a code entered before the reboot still matches');
  await stop(r);
  console.log('restart ok: day', h.day, 'and the code still matched');
  console.log('runner test ok');
})().catch((e) => { console.error(e); process.exit(1); });
