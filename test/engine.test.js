const assert = require('assert');
const crypto = require('crypto');
const HM = require('../src/engine.js');

// 1. SHA-256 matches a trusted implementation
['', 'abc', 'heron', 'salt\u0000nine-oh-two', 'x'.repeat(200)].forEach(s =>
  assert.strictEqual(HM.sha256(s), crypto.createHash('sha256').update(s).digest('hex'), 'sha256 mismatch for ' + s.slice(0, 12)));
console.log('sha256 ok');

// 2. exact matching, salt rotation, no plain code kept
{
  const m = HM.createMachine({ seed: 5, saltEveryDays: 3 });
  m.sense(0.4, 0.5, 0.1);
  assert.strictEqual(m.enterCode('heron').outcome, 'new');
  assert.strictEqual(m.enterCode('heron').outcome, 'match');
  assert.strictEqual(m.enterCode('Heron').outcome, 'new', 'case must matter');
  assert.strictEqual(m.enterCode('heron ').outcome, 'new', 'whitespace must matter');
  const blob = JSON.stringify(m.archive) + JSON.stringify([...m.memory.keys()]);
  assert(!/heron/i.test(blob), 'plain code leaked');
  m.visitorLeave();
  m.advanceDay(); m.advanceDay(); m.advanceDay();      // salt rotates on the 3rd
  m.sense(0.4, 0.5, 0.1);
  assert.strictEqual(m.memory.size, 0, 'memory should be forgotten after rotation');
  assert.strictEqual(m.enterCode('heron').outcome, 'new', 'forgotten after rotation');
  assert(m.archive.some(e => e.kind === 'forgot_all'));
  console.log('memory ok');
}

// 3. full run: arc, archive audit, flat voice
{
  const m = HM.createMachine({ seed: 11 });
  const rows = [];
  for (let d = 1; d <= 42; d++) {
    const c0 = m.charge();
    const s = m.simulateDay();
    rows.push([d, c0.toFixed(2), s.wins, s.visitors, s.revisions, s.lines]);
  }
  console.log('day charge wins visitors revisions lines');
  rows.filter(r => r[0] % 4 === 1 || r[0] === 42).forEach(r => console.log(r.join('\t')));
  assert(m.ended);
  assert.deepStrictEqual(m.auditArchive(), [], 'archive audit failed');
  const first = parseFloat(rows[0][1]), last = m.days[41].charge;
  console.log('charge day1', first, 'end', last);
  assert(first > 0.95 && last < 0.2, 'arc out of range');
  const gestures = m.archive.filter(e => e.kind === 'gesture');
  const early = gestures.slice(0, 8).reduce((a, e) => a + e.amp, 0) / 8;
  const late = gestures.slice(-8).reduce((a, e) => a + e.amp, 0) / 8;
  console.log('gestures', gestures.length, 'early amp', early.toFixed(2), 'late amp', late.toFixed(2));
  assert(late < early * 0.5, 'gestures should shrink');
  const lateLines = m.archive.filter(e => e.kind === 'line' && e.day >= 38);
  const earlyLines = m.archive.filter(e => e.kind === 'line' && e.day <= 3);
  const avg = a => a.reduce((s, e) => s + e.text.length, 0) / a.length;
  console.log('avg line length early', avg(earlyLines).toFixed(0), 'late', avg(lateLines).toFixed(0));
  assert(avg(lateLines) < avg(earlyLines), 'late lines should be shorter');
  assert(m.lines.length <= 4, 'room should show few lines when flat');
  const floorMax = Math.max(...m.heat);
  assert(floorMax > 0, 'floor should keep some residual heat');
  console.log('floor max at end', floorMax.toFixed(2), 'lines shown', m.lines.length);
}
console.log('all ok');
