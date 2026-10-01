import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBwf, writeBwf, validateField, toAscii, isAscii } from '../src/bwf.js';
import { makeWav, chunk, exiftool, haveExiftool } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bwf-'));
const put = (dir, name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('validate: ascii, length, date, time', () => {
  assert.equal(validateField('description', 'ok'), null);
  assert.equal(validateField('description', 'x'.repeat(256)), null);
  assert.equal(validateField('description', 'x'.repeat(257)), 'too-long');
  assert.equal(validateField('originator', 'y'.repeat(33)), 'too-long');
  assert.equal(validateField('description', 'città'), 'non-ascii');
  assert.equal(validateField('date', '2026-10-01'), null);
  assert.equal(validateField('date', '2026:10:01'), null);
  assert.equal(validateField('date', '2026-02-29'), 'bad-date');
  assert.equal(validateField('date', '2028-02-29'), null);
  assert.equal(validateField('date', '2026-13-01'), 'bad-date');
  assert.equal(validateField('date', '26-10-01'), 'bad-date');
  assert.equal(validateField('time', '23-59-59'), null);
  assert.equal(validateField('time', '24:00:00'), 'bad-time');
  assert.equal(validateField('time', '12:60:00'), 'bad-time');
  assert.equal(validateField('date', ''), null);
});

test('toAscii', () => {
  assert.equal(toAscii('Città è più né Ñandú'), 'Citta e piu ne Nandu');
  assert.equal(toAscii('Straße – “x” €'), 'Strasse - "x" EUR');
  assert.equal(toAscii('日本'), '??');
  assert.ok(isAscii(toAscii('Ünïcödé ✓')));
});

test('read: fields, info, version 2 loudness, coding history', async () => {
  const d = tmp();
  const p = put(d, 'a.wav', makeWav({ bext: { description: 'Morning jingle', originator: 'OnAir', originatorReference: 'REF123', date: '2026-09-30', time: '07:30:15', version: 2, history: 'A=PCM,F=48000,W=16,M=stereo\r\n', loudness: { i: -23.0, r: 5.5, t: -1.2, m: -18.4, s: -20.1 }, timeReference: 4800000n } }));
  const r = await readBwf(p);
  assert.ok(r.ok && r.writable);
  assert.deepEqual(r.fields, { description: 'Morning jingle', originator: 'OnAir', originatorReference: 'REF123', date: '2026-09-30', time: '07:30:15' });
  assert.equal(r.bext.version, 2);
  assert.equal(r.bext.timeReference, '4800000');
  assert.deepEqual(r.bext.loudness, { integrated: -23, range: 5.5, truePeak: -1.2, momentary: -18.4, shortTerm: -20.1 });
  assert.equal(r.bext.codingHistory, 'A=PCM,F=48000,W=16,M=stereo\r\n');
  assert.equal(r.info.sampleRate, 48000);
  assert.equal(r.info.channels, 2);
  assert.equal(r.info.bits, 16);
  assert.equal(Math.round(r.info.seconds * 1000), 25);
});

test('read: non-ASCII bytes are flagged, no bext gives empty fields', async () => {
  const d = tmp();
  const buf = makeWav({ bext: { description: 'café' } }); // latin1 byte 0xE9
  const r = await readBwf(put(d, 'a.wav', buf));
  assert.equal(r.nonAscii.description, true);
  assert.equal(r.nonAscii.originator, false);
  const n = await readBwf(put(d, 'b.wav', makeWav()));
  assert.equal(n.hasBext, false);
  assert.equal(n.fields.description, '');
  assert.ok(n.writable);
});

test('read: RF64, not wav, truncated are not writable', async () => {
  const d = tmp();
  const rf = makeWav(); rf.write('RF64', 0, 'latin1');
  assert.equal((await readBwf(put(d, 'rf.wav', rf))).error, 'rf64');
  assert.equal((await readBwf(put(d, 'x.wav', Buffer.from('hello world, not a wave file')))).error, 'not-wav');
  const full = makeWav({ bext: { description: 'x' } });
  const t = await readBwf(put(d, 't.wav', full.subarray(0, full.length - 100)));
  assert.ok(t.ok);
  assert.equal(t.writable, false);
  assert.equal(t.readOnlyReason, 'truncated');
});

test('write: patch in place changes only the chosen field bytes', async () => {
  const d = tmp();
  const orig = makeWav({ bext: { description: 'Old', originator: 'KEEP', date: '2020-01-01', time: '01-02-03', version: 2, history: 'H\r\n', loudness: { i: -20, r: 4, t: -2, m: -15, s: -17 }, timeReference: 99n }, extra: [['LIST', Buffer.from('INFOabcd')], ['junk', Buffer.from([1, 2, 3])]] });
  const p = put(d, 'a.wav', orig);
  const res = await writeBwf(p, { description: 'New description', date: '2026-10-01' });
  assert.equal(res.mode, 'patch');
  const after = fs.readFileSync(p);
  assert.equal(after.length, orig.length);
  const diff = [];
  for (let i = 0; i < orig.length; i++) if (orig[i] !== after[i]) diff.push(i);
  const r = await readBwf(p);
  const base = r.bext.dataOffset;
  assert.ok(diff.every((i) => (i >= base && i < base + 256) || (i >= base + 320 && i < base + 330)), 'only description and date bytes differ');
  assert.equal(r.fields.description, 'New description');
  assert.equal(r.fields.originator, 'KEEP');
  assert.equal(r.fields.date, '2026-10-01');
  assert.equal(r.fields.time, '01-02-03');
  assert.equal(r.bext.version, 2);
  assert.equal(r.bext.timeReference, '99');
  assert.equal(r.bext.codingHistory, 'H\r\n');
  assert.equal(r.bext.loudness.integrated, -20);
});

test('write: a shorter text is NUL padded, an empty text clears the field', async () => {
  const d = tmp();
  const p = put(d, 'a.wav', makeWav({ bext: { description: 'A very long description here', originator: 'X' } }));
  await writeBwf(p, { description: 'Hi', originator: '' });
  const r = await readBwf(p);
  assert.equal(r.fields.description, 'Hi');
  assert.equal(r.fields.originator, '');
  const raw = fs.readFileSync(p).subarray(r.bext.dataOffset, r.bext.dataOffset + 256);
  assert.ok(raw.subarray(2).every((b) => b === 0));
});

test('write: a full-length field has no terminator and is read back whole', async () => {
  const d = tmp();
  const p = put(d, 'a.wav', makeWav({ bext: {} }));
  await writeBwf(p, { originator: 'o'.repeat(32), description: 'd'.repeat(256) });
  const r = await readBwf(p);
  assert.equal(r.fields.originator.length, 32);
  assert.equal(r.fields.description.length, 256);
  assert.equal(r.fields.originatorReference, '');
});

test('write: refuses invalid values and leaves the file untouched', async () => {
  const d = tmp();
  const buf = makeWav({ bext: { description: 'x' } });
  const p = put(d, 'a.wav', buf);
  await assert.rejects(writeBwf(p, { description: 'perché' }), { code: 'non-ascii' });
  await assert.rejects(writeBwf(p, { date: '2026-02-30' }), { code: 'bad-date' });
  await assert.rejects(writeBwf(p, { originator: 'z'.repeat(40) }), { code: 'too-long' });
  assert.equal(sha(fs.readFileSync(p)), sha(buf));
});

test('write: no bext inserts a Version 0 chunk after fmt, audio and other chunks identical', async () => {
  const d = tmp();
  const orig = makeWav({ extra: [['LIST', Buffer.from('INFOabcdefg')]], dataBytes: 10001, tail: Buffer.from('TAGtrailing') });
  const p = put(d, 'a.wav', orig);
  const res = await writeBwf(p, { description: 'Brand new', originator: 'OnAir', date: '2026-10-01', time: '12-00-00' });
  assert.equal(res.mode, 'rewrite');
  const r = await readBwf(p);
  assert.ok(r.ok);
  assert.deepEqual(r.chunks.map((c) => c.id), ['fmt ', 'bext', 'LIST', 'data']);
  assert.equal(r.bext.size, 602);
  assert.equal(r.bext.version, 0);
  assert.equal(r.fields.description, 'Brand new');
  assert.equal(r.riffSize, orig.readUInt32LE(4) + 610);
  const after = fs.readFileSync(p);
  assert.equal(after.length, orig.length + 610);
  const at = r.chunks[1].offset;
  assert.ok(Buffer.concat([after.subarray(8, at), after.subarray(at + 610)]).equals(orig.subarray(8)));
  assert.equal(fs.readdirSync(d).length, 1, 'no temporary file left behind');
});

test('write: chunk order and padding are preserved with an odd-sized chunk before bext', async () => {
  const d = tmp();
  const orig = makeWav({ bext: { description: 'x' }, bextFirst: true, extra: [['odd ', Buffer.from([1, 2, 3])]] });
  const p = put(d, 'a.wav', orig);
  await writeBwf(p, { description: 'changed' });
  const r = await readBwf(p);
  assert.deepEqual(r.chunks.map((c) => c.id), ['bext', 'fmt ', 'odd ', 'data']);
  assert.equal(r.fields.description, 'changed');
});

test('cross-check with exiftool (independent reader)', { skip: !haveExiftool }, async () => {
  const d = tmp();
  const p = put(d, 'a.wav', makeWav());
  await writeBwf(p, { description: 'Cross check', originator: 'Orig', originatorReference: 'Ref9', date: '2026-10-01', time: '08-09-10' });
  const out = JSON.parse(exiftool(p, '-j', '-RIFF:all'))[0];
  assert.equal(out.Description, 'Cross check');
  assert.equal(out.Originator, 'Orig');
  assert.equal(out.OriginatorReference, 'Ref9');
  assert.equal(out.DateTimeOriginal, '2026:10:01 08:09:10');
  const w = JSON.parse(exiftool(p, '-j', '-Warning'))[0];
  assert.equal(w.Warning, undefined);
});
