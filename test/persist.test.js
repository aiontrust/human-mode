const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HM = require('../src/engine.js');
const P = require('../server/persist.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hm-'));

// 1. A restored machine keeps the arc, the memory, and the salt
{
  const dir = tmp(), m = HM.createMachine({ seed: 3 });
  for (let i = 0; i < 9; i++) m.simulateDay();
  m.sense(0.4, 0.5, 0.1); m.enterCode('heron'); m.visitorLeave();
  P.saveState(dir, m);
  const r = HM.createMachine({ seed: 99 }).restore(P.loadState(dir));
  assert.strictEqual(r.day, m.day);
  assert.strictEqual(r.charge(), m.charge());
  assert.strictEqual(r.memory.size, m.memory.size);
  assert.strictEqual(r.lines.length, m.lines.length);
  r.sense(0.4, 0.5, 0.1);
  assert.strictEqual(r.enterCode('heron').outcome, 'match', 'a code entered before the reboot must still match');
  assert.strictEqual(r.enterCode('Heron').outcome, 'new');
  console.log('restore ok: day', r.day, 'charge', r.charge().toFixed(2));
}

// 2. A corrupt state file falls back to the previous generation; nothing at all gives null
{
  const dir = tmp(), m = HM.createMachine({ seed: 4 });
  P.saveState(dir, m); m.simulateDay(); P.saveState(dir, m);
  fs.writeFileSync(path.join(dir, 'state.json'), '{"v":1,"day":');            // power cut mid-write
  assert.strictEqual(P.loadState(dir).day, 1, 'should fall back to state.json.prev');
  assert.strictEqual(P.loadState(tmp()), null);
  console.log('fallback ok');
}

// 3. The archive is append-only, numbers continue across a restart, and a torn last line is cut off
{
  const dir = tmp();
  let w = new P.ArchiveWriter(dir);
  const m = HM.createMachine({ seed: 5, archiveLimit: 100, onLog: (e) => w.push(e) });
  for (let i = 0; i < 40; i++) m.tick(5);
  m.sense(0.3, 0.5, 0.1); m.visitorLeave();
  const n1 = w.flush();
  assert(n1 > 5);
  fs.appendFileSync(w.file, '{"seq":999,"t":1,"da');                           // crash mid-line
  w = new P.ArchiveWriter(dir);
  assert.strictEqual(w.seq, n1, 'torn line should be discarded');
  w.push({ t: 1, day: 1, kind: 'line', id: 1, ver: 0, text: 'x' }); w.flush();
  const lines = fs.readFileSync(w.file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(lines.length, n1 + 1);
  lines.forEach((e, i) => { assert.strictEqual(e.seq, i + 1); assert(HM.auditEntry(e), 'entry failed audit: ' + JSON.stringify(e)); });
  assert(m.archive.length <= 100, 'in-memory window must stay small');
  console.log('archive ok:', lines.length, 'entries');
}

// 4. Neon sync: batched, resumable, offline-tolerant, and never sends anything outside the allow-list
(async () => {
  const dir = tmp(), w = new P.ArchiveWriter(dir);
  for (let i = 0; i < 1200; i++) w.push({ t: i, day: 1, kind: 'revision', id: i, ver: 1, text: 'line ' + i });
  w.flush();

  const sent = []; let fail = false;
  const fakeFetch = async (url, init) => {
    if (fail) throw new Error('network blocked');
    sent.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({}) };
  };
  const make = () => new P.NeonSync({ dir, databaseUrl: 'postgresql://u:pw@ep-test-pooler.us-east-2.aws.neon.tech/neondb', runId: 'run-test', fetchImpl: fakeFetch, batch: 500 });

  let s = make();
  fail = true;
  await assert.rejects(s.drain(), /network blocked/);
  assert.strictEqual(s.cursor.seq, 0, 'a failed sync must not advance the cursor');
  fail = false;
  assert.strictEqual(await s.drain(), 1200);
  assert.strictEqual(sent.length, 3, 'three batches of at most 500');
  assert.strictEqual(sent[0].url, 'https://ep-test-pooler.us-east-2.aws.neon.tech/sql');
  assert.strictEqual(sent[0].init.headers['Neon-Connection-String'].startsWith('postgresql://'), true);
  assert.strictEqual(sent[0].body.params[1], 'run-test');
  const rows = sent.flatMap((r) => JSON.parse(r.body.params[0]));
  assert.deepStrictEqual(rows.map((r) => r.seq), Array.from({ length: 1200 }, (_, i) => i + 1), 'in order, no gaps, no repeats');
  assert(rows.every((r) => Object.keys(r).sort().join() === 'data,day,kind,seq,t'));

  s = make();                                                                  // reboot
  assert.strictEqual(s.cursor.seq, 1200);
  assert.strictEqual(await s.drain(), 0, 'nothing is sent twice after a restart');
  w.push({ t: 1, day: 2, kind: 'gesture', amp: 0.5, flavor: 1, source: 'code' }); w.flush();
  assert.strictEqual(await s.drain(), 1, 'new entries after the restart are picked up');

  // a line holding anything outside the machine's own state stops the sync and sends nothing
  fs.appendFileSync(w.file, JSON.stringify({ seq: 1202, t: 2, day: 2, kind: 'recognition', outcome: 'code_match', hash: 'a'.repeat(64) }) + '\n');
  const before = sent.length;
  await assert.rejects(s.drain(), /refusing to sync/);
  assert.strictEqual(sent.length, before);

  // state.json (hashed codes and salt) is never read by the sync
  const m = HM.createMachine({ seed: 8 }); m.sense(0.4, 0.5, 0.1); m.enterCode('heron');
  P.saveState(dir, m);
  const secret = m.salt;
  assert(!sent.some((r) => r.init.body.includes(secret)), 'salt must never leave the machine');
  console.log('neon sync ok');
  console.log('all persistence tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
