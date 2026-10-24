/* Persistence for the venue machine. Three things live here:
   1. saveState / loadState: the machine's state on the SSD, written atomically (temp file, fsync, rename)
      with one previous generation kept, so a power cut never leaves a half-written file as the only copy.
   2. ArchiveWriter: an append-only NDJSON file on the SSD. This is the record. It is written locally first
      and never depends on the network.
   3. NeonSync: copies new archive lines to Neon, in order, over HTTPS. It remembers how far it got, so it
      resumes after a reboot or a long network outage. It reads only the archive file and refuses any line
      that holds a field outside the machine's own state. state.json (hashed codes, salt) is never read here. */
const fs = require('fs');
const path = require('path');
const HM = require('../src/engine.js');

function writeFileSynced(file, text) {
  const fd = fs.openSync(file, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  writeFileSynced(tmp, text);
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.prev');
  fs.renameSync(tmp, file);
}

function saveState(dir, machine) { atomicWrite(path.join(dir, 'state.json'), JSON.stringify(machine.serialize())); }
function loadState(dir) {
  for (const name of ['state.json', 'state.json.prev']) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (s && s.v === 1) return s;
    } catch (e) { /* missing or corrupt: try the previous generation */ }
  }
  return null;
}

class ArchiveWriter {
  constructor(dir) {
    this.file = path.join(dir, 'archive.ndjson');
    this.buffer = [];
    this.seq = this.repair();
  }
  /* A crash can leave a half-written last line. Cut the file back to the last complete line and return the line count. */
  repair() {
    if (!fs.existsSync(this.file)) return 0;
    const text = fs.readFileSync(this.file, 'utf8');
    let end = text.lastIndexOf('\n') + 1;
    if (end !== text.length) fs.truncateSync(this.file, Buffer.byteLength(text.slice(0, end)));
    let n = 0; for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }
  push(entry) { this.buffer.push(entry); }
  flush() {
    if (!this.buffer.length) return 0;
    const lines = this.buffer.map((e) => JSON.stringify(Object.assign({ seq: ++this.seq }, e)));
    this.buffer = [];
    const fd = fs.openSync(this.file, 'a');
    try { fs.writeSync(fd, lines.join('\n') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return lines.length;
  }
}

const INSERT_SQL =
  'INSERT INTO archive_entries (run_id, seq, t, day, kind, data) ' +
  'SELECT $2::text, x.seq, x.t, x.day, x.kind, x.data ' +
  'FROM jsonb_to_recordset($1::jsonb) AS x(seq bigint, t double precision, day integer, kind text, data jsonb) ' +
  'ON CONFLICT (run_id, seq) DO NOTHING';

class NeonSync {
  constructor({ dir, databaseUrl, runId, fetchImpl, batch }) {
    this.archiveFile = path.join(dir, 'archive.ndjson');
    this.cursorFile = path.join(dir, 'sync.json');
    this.databaseUrl = databaseUrl;
    this.runId = runId;
    this.fetch = fetchImpl || fetch;
    this.batch = batch || 500;
    this.cursor = { seq: 0, offset: 0 };
    try { this.cursor = JSON.parse(fs.readFileSync(this.cursorFile, 'utf8')); } catch (e) { /* first run */ }
  }
  /* Neon's SQL over HTTP: POST https://<host>/sql, connection string in a header. No driver to install. */
  async post(query, params) {
    const host = new URL(this.databaseUrl).host;
    const res = await this.fetch('https://' + host + '/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': this.databaseUrl },
      body: JSON.stringify({ query, params })
    });
    if (!res.ok) throw new Error('neon http ' + res.status);
    return res.json();
  }
  readNew() {
    if (!fs.existsSync(this.archiveFile)) return { entries: [], offset: this.cursor.offset };
    const fd = fs.openSync(this.archiveFile, 'r');
    try {
      const size = fs.fstatSync(fd).size, want = Math.min(size - this.cursor.offset, 2 * 1024 * 1024);
      if (want <= 0) return { entries: [], offset: this.cursor.offset };
      const buf = Buffer.alloc(want);
      fs.readSync(fd, buf, 0, want, this.cursor.offset);
      const text = buf.toString('utf8'), end = text.lastIndexOf('\n') + 1;
      const entries = [], lines = text.slice(0, end).split('\n'); let used = 0;
      lines.pop();                                   /* the empty piece after the last newline */
      for (const line of lines) {
        if (entries.length >= this.batch) break;
        used += Buffer.byteLength(line) + 1;
        if (line) entries.push(JSON.parse(line));
      }
      return { entries, offset: this.cursor.offset + used };
    } finally { fs.closeSync(fd); }
  }
  async syncOnce() {
    const { entries, offset } = this.readNew();
    if (!entries.length) return 0;
    const bad = entries.find((e) => !HM.auditEntry(e));
    if (bad) throw new Error('refusing to sync: archive line ' + bad.seq + ' holds a field outside the machine\'s own state');
    const rows = entries.map((e) => {
      const { seq, t, day, kind, ...data } = e;
      return { seq, t, day, kind, data };
    });
    await this.post(INSERT_SQL, [JSON.stringify(rows), this.runId]);
    this.cursor = { seq: entries[entries.length - 1].seq, offset };
    atomicWrite(this.cursorFile, JSON.stringify(this.cursor));
    return entries.length;
  }
  async drain(maxBatches) {
    let total = 0;
    for (let i = 0; i < (maxBatches || 20); i++) { const n = await this.syncOnce(); if (!n) break; total += n; }
    return total;
  }
}

module.exports = { saveState, loadState, ArchiveWriter, NeonSync, atomicWrite, INSERT_SQL };
