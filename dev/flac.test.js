import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFlac, writeFlac, validateField } from '../src/flac.js';
import { haveFfprobe, ffprobeTags, syncsafe } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-flac-'));
const put = (d, n, b) => { const p = path.join(d, n); fs.writeFileSync(p, b); return p; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const block = (type, last, data) => { const h = Buffer.alloc(4); h[0] = (last ? 0x80 : 0) | type; h.writeUIntBE(data.length, 1, 3); return Buffer.concat([h, data]); };
function vorbis(vendor, entries) { return Buffer.concat([le32(Buffer.byteLength(vendor)), Buffer.from(vendor), le32(entries.length), ...entries.flatMap((e) => [le32(Buffer.byteLength(e)), Buffer.from(e)])]); }
function streamInfo() { // 44100 Hz, 2 channels, 16 bit, 88200 samples
  const b = Buffer.alloc(34);
  b.writeUInt16BE(4096, 0); b.writeUInt16BE(4096, 2);
  const rate = 44100, ch = 2, bps = 16, total = 88200;
  b[10] = rate >> 12; b[11] = (rate >> 4) & 0xff; b[12] = ((rate & 0xf) << 4) | ((ch - 1) << 1) | ((bps - 1) >> 4); b[13] = (((bps - 1) & 0xf) << 4) | Math.floor(total / 2 ** 32);
  b.writeUInt32BE(total % 2 ** 32, 14);
  return b;
}
const AUDIO = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 13 + 5) & 0xff));
const flac = ({ entries = ['TITLE=Old title', 'ARTIST=Band', 'artist=Second', 'MYTAG=kept'], padding = 200, extra = [], prefix = Buffer.alloc(0) } = {}) => {
  const blocks = [block(0, false, streamInfo()), ...extra.map((e) => block(e[0], false, e[1])), block(4, padding === null, vorbis('ref libFLAC', entries))];
  if (padding !== null) blocks.push(block(1, true, Buffer.alloc(padding)));
  return Buffer.concat([prefix, Buffer.from('fLaC'), ...blocks, AUDIO]);
};

test('validate', () => {
  assert.equal(validateField('year', '2026'), null);
  assert.equal(validateField('year', '2026-10-13'), null);
  assert.equal(validateField('year', 'x'), 'bad-year');
  assert.equal(validateField('track', '3/12'), null);
  assert.equal(validateField('track', 'a'), 'bad-track');
});

test('read: fields, several values joined, stream info', async () => {
  const d = tmp();
  const r = await readFlac(put(d, 'a.flac', flac()));
  assert.ok(r.ok && r.writable);
  assert.equal(r.fields.title, 'Old title');
  assert.equal(r.fields.artist, 'Band / Second');
  assert.equal(r.multi.artist, true);
  assert.equal(r.info.sampleRate, 44100);
  assert.equal(r.info.channels, 2);
  assert.equal(r.info.bits, 16);
  assert.equal(r.info.seconds, 2);
  assert.equal((await readFlac(put(d, 'x.flac', Buffer.from('nope nope nope')))).error, 'not-flac');
  assert.equal((await readFlac(put(d, 'y.flac', flac().subarray(0, 60)))).error, 'flac-bad');
});

test('write in place: padding absorbs the change, other entries and audio untouched', async () => {
  const d = tmp();
  const orig = flac({ extra: [[3, Buffer.alloc(36, 7)], [6, Buffer.alloc(80, 9)]] });
  const p = put(d, 'a.flac', orig);
  const res = await writeFlac(p, { title: 'A new and longer title', album: 'Album', year: '2026' });
  assert.equal(res.mode, 'in-place');
  const out = fs.readFileSync(p);
  assert.equal(out.length, orig.length);
  const r = await readFlac(p);
  assert.deepEqual([r.fields.title, r.fields.album, r.fields.year, r.fields.artist], ['A new and longer title', 'Album', '2026', 'Band / Second']);
  assert.ok(out.includes('MYTAG=kept'));
  assert.ok(out.subarray(r.audioOffset).equals(AUDIO));
  assert.deepEqual(r.blocks.map((b) => b.type), [0, 3, 6, 4, 1]);
});

test('write: removing, replacing several entries of a field with one, unicode', async () => {
  const d = tmp();
  const p = put(d, 'a.flac', flac());
  await writeFlac(p, { artist: 'Solo ☃', title: '' });
  const r = await readFlac(p);
  assert.equal(r.fields.artist, 'Solo ☃');
  assert.equal(r.multi.artist, undefined);
  assert.equal(r.fields.title, '');
  assert.ok(!fs.readFileSync(p).includes('Second'));
});

test('write that does not fit: rewritten with new padding; audio identical; no-padding file', async () => {
  const d = tmp();
  const orig = flac({ padding: null });
  const p = put(d, 'a.flac', orig);
  const res = await writeFlac(p, { comment: 'x'.repeat(3000) });
  assert.equal(res.mode, 'rewrite');
  const r = await readFlac(p);
  assert.equal(r.fields.comment.length, 3000);
  assert.ok(fs.readFileSync(p).subarray(r.audioOffset).equals(AUDIO));
  assert.equal(r.blocks.at(-1).type, 1);
  assert.equal(r.blocks.at(-1).length, 4096);
  // then a small change fits in the new padding
  assert.equal((await writeFlac(p, { comment: 'short' })).mode, 'in-place');
});

test('write: no vorbis comment block yet — one is added after STREAMINFO', async () => {
  const d = tmp();
  const bare = Buffer.concat([Buffer.from('fLaC'), block(0, true, streamInfo()), AUDIO]);
  const p = put(d, 'b.flac', bare);
  assert.equal((await writeFlac(p, { title: 'Hello' })).mode, 'rewrite');
  const r = await readFlac(p);
  assert.equal(r.fields.title, 'Hello');
  assert.deepEqual(r.blocks.map((b) => b.type), [0, 4, 1]);
  assert.ok(fs.readFileSync(p).subarray(r.audioOffset).equals(AUDIO));
});

test('an ID3v2 tag in front of a FLAC file is kept', async () => {
  const d = tmp();
  const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(30), Buffer.alloc(30, 0x41)]);
  const orig = flac({ prefix: id3 });
  const p = put(d, 'p.flac', orig);
  await writeFlac(p, { title: 'With prefix' });
  const out = fs.readFileSync(p);
  assert.ok(out.subarray(0, id3.length).equals(id3));
  assert.equal((await readFlac(p)).fields.title, 'With prefix');
});

test('corrupt vorbis block is read only; nothing written', async () => {
  const d = tmp();
  const bad = Buffer.concat([Buffer.from('fLaC'), block(0, false, streamInfo()), block(4, true, Buffer.from([255, 255, 0, 0, 1, 2])), AUDIO]);
  const p = put(d, 'c.flac', bad);
  const r = await readFlac(p);
  assert.equal(r.readOnlyReason, 'vorbis-corrupt');
  await assert.rejects(writeFlac(p, { title: 'x' }), { code: 'vorbis-corrupt' });
  assert.ok(fs.readFileSync(p).equals(bad));
});

test('real FLAC from ffmpeg: edit, decoded audio identical (md5), ffprobe sees the new values', { skip: !haveFfprobe }, async () => {
  const d = tmp();
  const p = path.join(d, 'real.flac');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-metadata', 'title=From ffmpeg', '-metadata', 'artist=Sine', '-metadata', 'custom=kept', '-c:a', 'flac', p]);
  const md5 = () => execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
  const before = md5();
  const r0 = await readFlac(p);
  assert.equal(r0.fields.title, 'From ffmpeg');
  await writeFlac(p, { title: 'Edited título', album: 'Alb', year: '2026', track: '2/9', genre: 'Test', comment: 'C' });
  const t = ffprobeTags(p);
  assert.equal(t.TITLE ?? t.title, 'Edited título');
  assert.equal((t.ALBUM ?? t.album), 'Alb');
  assert.equal((t.custom ?? t.CUSTOM), 'kept');
  assert.equal(md5(), before, 'decoded audio identical');
  execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'null', '-']); // decodes without errors
  await writeFlac(p, { comment: 'y'.repeat(20000) });
  assert.equal(md5(), before);
  assert.equal(sha(fs.readFileSync(p).subarray((await readFlac(p)).audioOffset)), sha(fs.readFileSync(p).subarray((await readFlac(p)).audioOffset)));
});
