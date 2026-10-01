import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readId3, writeId3, validateField } from '../src/id3.js';
import { frame, text, tag, audioBytes, syncsafe, exiftool, ffprobeTags, haveExiftool, haveFfprobe } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-id3-'));
const put = (dir, name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const AUDIO = audioBytes(6);
const comm = (v, enc, lang, desc, body) => frame(v, 'COMM', Buffer.concat([Buffer.from([enc]), Buffer.from(lang), Buffer.from(desc, 'latin1'), Buffer.from(body, 'latin1')]));
const PRIV = (v) => frame(v, 'PRIV', Buffer.concat([Buffer.from('owner@x\0'), Buffer.from([1, 2, 3, 250, 251])]));
const XYZW = (v) => frame(v, 'XYZW', Buffer.from([9, 8, 7, 6]));
const APIC = (v) => frame(v, 'APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3]), Buffer.from('cover\0'), Buffer.alloc(300, 0xab)]));
const audioOf = (file, info) => fs.readFileSync(file).subarray(info.audioOffset);

function v3Tag(opts = {}) {
  return tag(3, [frame(3, 'TIT2', text(0, 'Old title')), frame(3, 'TPE1', text(1, 'Artista è')), frame(3, 'TALB', text(0, 'Album')), frame(3, 'TYER', text(0, '2019')), frame(3, 'TRCK', text(0, '3/12')),
    frame(3, 'TCON', text(0, '(13)Pop')), comm(3, 0, 'ita', '\0', 'Un commento'), PRIV(3), XYZW(3), APIC(3)], opts);
}

test('validate', () => {
  assert.equal(validateField('year', '2026', 3), null);
  assert.equal(validateField('year', '2026-10-01', 3), 'bad-year');
  assert.equal(validateField('year', '2026-10-01', 4), null);
  assert.equal(validateField('year', '20', 4), 'bad-year');
  assert.equal(validateField('track', '3/12'), null);
  assert.equal(validateField('track', 'three'), 'bad-track');
  assert.equal(validateField('title', 'a\0b'), 'invalid-char');
});

test('read: v2.3 latin1 and utf16, comment, genre, year', async () => {
  const d = tmp();
  const r = await readId3(put(d, 'a.mp3', Buffer.concat([v3Tag(), AUDIO])));
  assert.equal(r.version, '2.3');
  assert.deepEqual(r.fields, { title: 'Old title', artist: 'Artista è', album: 'Album', year: '2019', track: '3/12', genre: '(13)Pop', comment: 'Un commento' });
  assert.ok(r.writable);
});

test('read: v2.4 utf8, TDRC, several values', async () => {
  const d = tmp();
  const t4 = tag(4, [frame(4, 'TIT2', text(3, 'Città')), frame(4, 'TPE1', Buffer.concat([Buffer.from([3]), Buffer.from('A\0B')])), frame(4, 'TDRC', text(3, '2019-05-06'))]);
  const r = await readId3(put(d, 'a.mp3', Buffer.concat([t4, AUDIO])));
  assert.equal(r.version, '2.4');
  assert.equal(r.fields.title, 'Città');
  assert.equal(r.fields.artist, 'A / B');
  assert.equal(r.multi.artist, true);
  assert.equal(r.fields.year, '2019-05-06');
});

test('write in place: only the tag region changes, other frames byte-identical', async () => {
  const d = tmp();
  const orig = Buffer.concat([v3Tag({ padding: 500 }), AUDIO]);
  const p = put(d, 'a.mp3', orig);
  const before = await readId3(p);
  const res = await writeId3(p, { title: 'New title', year: '2026' });
  assert.equal(res.mode, 'in-place');
  const after = fs.readFileSync(p);
  assert.equal(after.length, orig.length);
  const r = await readId3(p);
  assert.equal(r.fields.title, 'New title');
  assert.equal(r.fields.year, '2026');
  assert.equal(r.fields.artist, 'Artista è');
  for (const id of ['PRIV', 'XYZW', 'APIC', 'TALB', 'TPE1', 'COMM', 'TCON', 'TRCK']) {
    const a = before.frames.find((f) => f.id === id).raw, b = r.frames.find((f) => f.id === id).raw;
    assert.ok(a.equals(b), id + ' unchanged');
  }
  assert.ok(audioOf(p, r).equals(AUDIO));
  assert.equal(r.tagSize, before.tagSize);
});

test('write that does not fit: tag rewritten with padding, audio identical, unknown frames kept', async () => {
  const d = tmp();
  const orig = Buffer.concat([v3Tag(), AUDIO]);
  const p = put(d, 'a.mp3', orig);
  const before = await readId3(p);
  const long = 'L'.repeat(3000);
  const res = await writeId3(p, { comment: long });
  assert.equal(res.mode, 'rewrite');
  const r = await readId3(p);
  assert.equal(r.fields.comment, long);
  assert.ok(r.padding >= 1000);
  assert.ok(audioOf(p, r).equals(AUDIO));
  for (const id of ['PRIV', 'XYZW', 'APIC', 'TIT2', 'TPE1']) assert.ok(before.frames.find((f) => f.id === id).raw.equals(r.frames.find((f) => f.id === id).raw), id);
  assert.equal(fs.readdirSync(d).length, 1);
});

test('version is kept: v2.4 file gets TDRC, v2.3 file gets TYER', async () => {
  const d = tmp();
  const p4 = put(d, '4.mp3', Buffer.concat([tag(4, [frame(4, 'TIT2', text(3, 'x'))], { padding: 200 }), AUDIO]));
  await writeId3(p4, { year: '2024-02-03' });
  const r4 = await readId3(p4);
  assert.equal(r4.version, '2.4');
  assert.ok(r4.frames.some((f) => f.id === 'TDRC') && !r4.frames.some((f) => f.id === 'TYER'));
  assert.equal(r4.fields.year, '2024-02-03');
  await assert.rejects(writeId3(put(d, '3.mp3', Buffer.concat([v3Tag({ padding: 100 }), AUDIO])), { year: '2024-02-03' }), { code: 'bad-year' });
});

test('text encodings: latin1 when possible, UTF-16 (v2.3) or UTF-8 (v2.4) otherwise', async () => {
  const d = tmp();
  const p3 = put(d, '3.mp3', Buffer.concat([v3Tag({ padding: 300 }), AUDIO]));
  await writeId3(p3, { title: 'Perché', artist: '日本語' });
  const r3 = await readId3(p3);
  assert.equal(r3.fields.title, 'Perché');
  assert.equal(r3.fields.artist, '日本語');
  assert.equal(r3.frames.find((f) => f.id === 'TIT2').data[0], 0);
  assert.equal(r3.frames.find((f) => f.id === 'TPE1').data[0], 1);
  const p4 = put(d, '4.mp3', Buffer.concat([tag(4, [frame(4, 'TIT2', text(3, 'x'))], { padding: 300 }), AUDIO]));
  await writeId3(p4, { artist: '日本語' });
  const r4 = await readId3(p4);
  assert.equal(r4.fields.artist, '日本語');
  assert.equal(r4.frames.find((f) => f.id === 'TPE1').data[0], 3);
});

test('empty value removes the frame', async () => {
  const d = tmp();
  const p = put(d, 'a.mp3', Buffer.concat([v3Tag({ padding: 100 }), AUDIO]));
  await writeId3(p, { album: '', comment: '' });
  const r = await readId3(p);
  assert.equal(r.fields.album, '');
  assert.equal(r.fields.comment, '');
  assert.ok(!r.frames.some((f) => f.id === 'TALB' || f.id === 'COMM'));
  assert.equal(r.fields.title, 'Old title');
});

test('no tag: a v2.3 tag is created, ID3v1 at the end is left alone', async () => {
  const d = tmp();
  const v1 = Buffer.alloc(128); v1.write('TAG', 0, 'latin1'); v1.write('V1 title', 3, 'latin1'); v1.write('V1 artist', 33, 'latin1'); v1.write('1999', 93, 'latin1'); v1[127] = 13;
  const p = put(d, 'a.mp3', Buffer.concat([AUDIO, v1]));
  const before = await readId3(p);
  assert.equal(before.source, 'v1');
  assert.equal(before.fields.title, 'V1 title');
  assert.equal(before.fields.genre, '(13)');
  await writeId3(p, { album: 'New album' });
  const r = await readId3(p);
  assert.equal(r.version, '2.3');
  assert.equal(r.source, 'v2');
  assert.equal(r.fields.album, 'New album');
  assert.equal(r.fields.title, 'V1 title', 'v1 values are carried into the new tag');
  const out = fs.readFileSync(p);
  assert.ok(out.subarray(out.length - 128).equals(v1));
  assert.ok(out.subarray(r.audioOffset, out.length - 128).equals(AUDIO));
});

test('a file with neither tag: create from scratch', async () => {
  const d = tmp();
  const p = put(d, 'a.mp3', AUDIO);
  await writeId3(p, { title: 'T', track: '1/9' });
  const r = await readId3(p);
  assert.equal(r.fields.title, 'T');
  assert.equal(r.fields.track, '1/9');
  assert.ok(fs.readFileSync(p).subarray(r.audioOffset).equals(AUDIO));
});

test('extended header is dropped, frames kept', async () => {
  const d = tmp();
  const extHeader = Buffer.concat([Buffer.from([0, 0, 0, 6, 0, 0]), Buffer.from([0, 0, 0, 0])]); // v2.3: size 6, flags, padding size
  const frames = [frame(3, 'TIT2', text(0, 'Ext')), PRIV(3)];
  const body = Buffer.concat([extHeader, ...frames, Buffer.alloc(100)]);
  const t = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0x40]), syncsafe(body.length), body]);
  const p = put(d, 'a.mp3', Buffer.concat([t, AUDIO]));
  const before = await readId3(p);
  assert.equal(before.fields.title, 'Ext');
  await writeId3(p, { title: 'Ext2' });
  const r = await readId3(p);
  assert.equal(r.fields.title, 'Ext2');
  assert.ok(r.frames.find((f) => f.id === 'PRIV').raw.equals(frames[1]));
  assert.equal(r.flags & 0x40, 0);
});

test('not editable: v2.2, unsynchronised tag, compressed frame; file untouched', async () => {
  const d = tmp();
  const body22 = Buffer.concat([Buffer.from('TT2'), Buffer.from([0, 0, 6]), Buffer.from([0]), Buffer.from('Hello')]);
  const t22 = Buffer.concat([Buffer.from('ID3'), Buffer.from([2, 0, 0]), syncsafe(body22.length), body22]);
  const p22 = put(d, '22.mp3', Buffer.concat([t22, AUDIO]));
  const r22 = await readId3(p22);
  assert.equal(r22.fields.title, 'Hello');
  assert.equal(r22.writable, false);
  await assert.rejects(writeId3(p22, { title: 'x' }), { code: 'id3v2.2' });

  const un = tag(3, [frame(3, 'TIT2', text(0, 'U'))], { flags: 0x80, padding: 50 });
  const pun = put(d, 'un.mp3', Buffer.concat([un, AUDIO]));
  assert.equal((await readId3(pun)).readOnlyReason, 'unsync');

  const comp = tag(3, [frame(3, 'TIT2', text(0, 'C'), [0, 0x80]), frame(3, 'TPE1', text(0, 'Artist'))], { padding: 100 });
  const pc = put(d, 'c.mp3', Buffer.concat([comp, AUDIO]));
  const rc = await readId3(pc);
  assert.equal(rc.locked.title, 'frame-flags');
  const bytes = fs.readFileSync(pc);
  await assert.rejects(writeId3(pc, { title: 'new' }), { code: 'frame-flags' });
  assert.ok(fs.readFileSync(pc).equals(bytes));
  await writeId3(pc, { artist: 'Other' }); // other fields of the same tag still editable
  assert.equal((await readId3(pc)).fields.artist, 'Other');
});

test('garbage after the frames makes the tag read-only (nothing is overwritten)', async () => {
  const d = tmp();
  const t = tag(3, [frame(3, 'TIT2', text(0, 'G'))], { padding: 0 });
  const body = Buffer.concat([t.subarray(10), Buffer.from([0, 0, 0, 0, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7])]);
  const withGarbage = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length), body]);
  const p = put(d, 'g.mp3', Buffer.concat([withGarbage, AUDIO]));
  const r = await readId3(p);
  assert.equal(r.writable, false);
  assert.equal(r.readOnlyReason, 'tag-garbage');
});

test('cross-check with ffprobe and exiftool (independent readers)', { skip: !(haveFfprobe && haveExiftool) }, async () => {
  const d = tmp();
  const p = put(d, 'a.mp3', Buffer.concat([v3Tag({ padding: 50 }), AUDIO]));
  await writeId3(p, { title: 'Titolo nuovo', artist: 'Perché 日本', album: 'Album X', year: '2027', track: '5/10', genre: 'Jazz', comment: 'Nota di prova ' + 'z'.repeat(2000) });
  const f = ffprobeTags(p);
  assert.equal(f.title, 'Titolo nuovo');
  assert.equal(f.artist, 'Perché 日本');
  assert.equal(f.album, 'Album X');
  assert.equal(f.date, '2027');
  assert.equal(f.track, '5/10');
  assert.equal(f.genre, 'Jazz');
  assert.match(f.comment, /^Nota di prova z+$/);
  assert.equal(f.owner, undefined);
  const e = JSON.parse(exiftool(p, '-j', '-charset', 'exif=utf8'))[0];
  assert.equal(e.Title, 'Titolo nuovo');
  assert.equal(e.Artist, 'Perché 日本');
  assert.equal(String(e.Year), '2027');
  assert.equal(e.Warning, undefined);
  // the frames we did not touch survive for the independent reader too
  assert.ok(f['id3v2_priv.owner@x'] !== undefined);
});
