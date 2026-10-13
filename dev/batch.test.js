import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyBatch, checkRestore, runRestore, expandPaths, mirrorPath, preflight, readTags, checkFileName, checkRenames } from '../src/batch.js';
import { makeWav, frame, text, tag, audioBytes } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-batch-'));
const put = (dir, name, buf, mtime) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); if (mtime) fs.utimesSync(p, mtime, mtime); return p; };
const mp3 = () => Buffer.concat([tag(3, [frame(3, 'TIT2', text(0, 'Old'))], { padding: 200 }), audioBytes(4)]);

test('mirrorPath', () => {
  assert.equal(mirrorPath('/Users/me/a.wav'), path.join('Users', 'me', 'a.wav'));
});

test('expand: types, hidden files, recursion', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'sub'));
  put(d, 'a.WAV', makeWav()); put(d, 'b.mp3', mp3()); put(d, 'c.txt', 'x'); put(d, '.hidden.wav', makeWav()); put(path.join(d, 'sub'), 'd.bwf', makeWav());
  const flat = await expandPaths([d]);
  assert.deepEqual(flat.files.map((f) => [f.name, f.type]), [['a.WAV', 'wav'], ['b.mp3', 'mp3']]);
  assert.equal(flat.skipped, 1);
  const deep = await expandPaths([d], { recursive: true });
  assert.equal(deep.files.length, 3);
});

test('apply: backup holds the original, file is edited, restore brings it back exactly', async () => {
  const d = tmp(), bk = tmp();
  const t0 = new Date(2024, 0, 2, 3, 4, 5);
  const wavBuf = makeWav({ bext: { description: 'orig', originator: 'ORIG' } });
  const mp3Buf = mp3();
  const w = put(d, 'a.wav', wavBuf, t0);
  const m = put(d, 'b.mp3', mp3Buf, t0);
  const out = await applyBatch([{ path: w, changes: { description: 'edited', date: '2026-10-01' } }, { path: m, changes: { title: 'Edited title', artist: 'Someone' } }], { backupRoot: bk });
  assert.ok(out.results.every((r) => r.ok), JSON.stringify(out.results));
  assert.equal((await readTags(w)).fields.description, 'edited');
  assert.equal((await readTags(m)).fields.artist, 'Someone');
  const mf = JSON.parse(fs.readFileSync(path.join(out.dir, 'manifest.json'), 'utf8'));
  assert.equal(mf.entries.length, 2);
  const bw = path.join(out.dir, mf.entries[0].backup);
  assert.ok(fs.readFileSync(bw).equals(wavBuf));
  assert.equal(Math.round(fs.statSync(bw).mtimeMs), t0.getTime(), 'backup keeps the modification time');

  const chk = await checkRestore(out.dir);
  assert.equal(chk.todo.length, 2);
  const rr = await runRestore(out.dir);
  assert.ok(rr.results.every((r) => r.ok));
  assert.equal(rr.pending, 0);
  assert.ok(fs.readFileSync(w).equals(wavBuf));
  assert.ok(fs.readFileSync(m).equals(mp3Buf));
  assert.equal(Math.round(fs.statSync(w).mtimeMs), t0.getTime(), 'original modification time restored');
  assert.deepEqual(fs.readdirSync(d).sort(), ['a.wav', 'b.mp3']);
});

test('restore leaves alone a file changed after the batch', async () => {
  const d = tmp(), bk = tmp();
  const w = put(d, 'a.wav', makeWav({ bext: { description: 'orig' } }));
  const out = await applyBatch([{ path: w, changes: { description: 'edited' } }], { backupRoot: bk });
  fs.appendFileSync(w, 'more');
  const chk = await checkRestore(out.dir);
  assert.equal(chk.todo.length, 0);
  assert.deepEqual(chk.problems.map((p) => p.error), ['changed']);
});

test('a file that cannot be edited is reported, not touched, and leaves no backup', async () => {
  const d = tmp(), bk = tmp();
  const full = makeWav({ bext: { description: 'x' } });
  const bad = put(d, 'trunc.wav', full.subarray(0, full.length - 50));
  const good = put(d, 'ok.wav', makeWav({ bext: { description: 'x' } }));
  const before = fs.readFileSync(bad);
  const out = await applyBatch([{ path: bad, changes: { description: 'y' } }, { path: good, changes: { description: 'y' } }], { backupRoot: bk });
  assert.equal(out.results[0].ok, false);
  assert.equal(out.results[0].error, 'truncated');
  assert.ok(out.results[1].ok);
  assert.ok(fs.readFileSync(bad).equals(before));
  const mf = JSON.parse(fs.readFileSync(path.join(out.dir, 'manifest.json'), 'utf8'));
  assert.equal(mf.entries.length, 1);
  assert.equal(fs.readdirSync(path.join(out.dir, 'files'), { recursive: true }).filter((f) => f.endsWith('.wav')).length, 1);
});

test('nothing edited: no backup folder is left behind', async () => {
  const d = tmp(), bk = tmp();
  const bad = put(d, 'x.wav', Buffer.from('not a wave file at all'));
  const out = await applyBatch([{ path: bad, changes: { description: 'y' } }], { backupRoot: bk });
  assert.equal(out.dir, null);
  assert.deepEqual(fs.readdirSync(bk), []);
});

test('preflight reports bytes and free space', async () => {
  const d = tmp(), bk = tmp();
  const w = put(d, 'a.wav', makeWav({ dataBytes: 100000 }));
  const p = await preflight([{ path: w, changes: { description: 'x' } }], path.join(bk, 'not', 'yet'));
  assert.ok(p.bytes > 100000);
  assert.ok(p.free > 0 && p.enough === true);
});

// ---- renaming, FLAC, new fields -------------------------------------------------------------------

test('checkFileName: characters, reserved names, extension, length', () => {
  assert.equal(checkFileName('/a/x.wav', 'Good name.wav'), null);
  assert.equal(checkFileName('/a/x.wav', 'bad/name.wav'), 'name-chars');
  assert.equal(checkFileName('/a/x.wav', 'what?.wav'), 'name-chars');
  assert.equal(checkFileName('/a/x.wav', 'trail.wav '), 'name-end');
  assert.equal(checkFileName('/a/x.wav', 'CON.wav'), 'name-reserved');
  assert.equal(checkFileName('/a/x.wav', 'nul.txt.wav'), 'name-reserved');
  assert.equal(checkFileName('/a/x.wav', 'x.mp3'), 'name-ext');
  assert.equal(checkFileName('/a/x.wav', 'X.WAV'), null);
  assert.equal(checkFileName('/a/x.wav', ''), 'name-empty');
  assert.equal(checkFileName('/a/x.wav', 'é'.repeat(140) + '.wav'), 'name-long');
});

test('checkRenames: a taken name and two files to one name', async () => {
  const d = tmp();
  const a = put(d, 'a.wav', makeWav()), b = put(d, 'b.wav', makeWav()), c = put(d, 'c.wav', makeWav());
  const r = await checkRenames([{ path: a, rename: 'c.wav' }, { path: b, rename: 'new.wav' }, { path: c, rename: 'new.wav' }]);
  assert.equal(r[a], 'name-taken');
  assert.equal(r[b], 'name-duplicate');
  assert.equal(r[c], 'name-duplicate');
});

test('rename with tag changes: tags written, file renamed, restore brings back name and content', async () => {
  const d = tmp(), bk = tmp();
  const orig = makeWav({ bext: { description: 'orig' } });
  const t0 = new Date(2024, 0, 2, 3, 4, 5);
  const w = put(d, 'old name.wav', orig, t0);
  const out = await applyBatch([{ path: w, changes: { description: 'edited' }, rename: 'new name.wav' }], { backupRoot: bk });
  assert.ok(out.results[0].ok, JSON.stringify(out.results));
  const np = path.join(d, 'new name.wav');
  assert.equal(out.results[0].newPath, np);
  assert.deepEqual(fs.readdirSync(d), ['new name.wav']);
  assert.equal((await readTags(np)).fields.description, 'edited');
  const chk = await checkRestore(out.dir);
  assert.equal(chk.todo.length, 1);
  const rr = await runRestore(out.dir);
  assert.ok(rr.results[0].ok);
  assert.deepEqual(fs.readdirSync(d), ['old name.wav']);
  assert.ok(fs.readFileSync(w).equals(orig));
  assert.equal(Math.round(fs.statSync(w).mtimeMs), t0.getTime());
});

test('rename only: no backup copy, restore renames back; a taken original name blocks the restore', async () => {
  const d = tmp(), bk = tmp();
  const w = put(d, 'a.mp3', mp3());
  const out = await applyBatch([{ path: w, changes: {}, rename: 'b.mp3' }], { backupRoot: bk });
  assert.ok(out.results[0].ok);
  assert.deepEqual(fs.readdirSync(d), ['b.mp3']);
  assert.deepEqual(fs.readdirSync(path.join(out.dir, 'files'), { recursive: true }).filter((f) => f.endsWith('.mp3')), [], 'no copy');
  put(d, 'a.mp3', 'someone else');
  const c1 = await checkRestore(out.dir);
  assert.deepEqual(c1.problems.map((p) => p.error), ['name-taken']);
  fs.rmSync(path.join(d, 'a.mp3'));
  const rr = await runRestore(out.dir);
  assert.ok(rr.results[0].ok);
  assert.deepEqual(fs.readdirSync(d), ['a.mp3']);
});

test('rename problems are reported before anything is written', async () => {
  const d = tmp(), bk = tmp();
  const a = put(d, 'a.wav', makeWav({ bext: { description: 'orig' } }));
  put(d, 'b.wav', makeWav());
  const before = fs.readFileSync(a);
  const out = await applyBatch([{ path: a, changes: { description: 'new' }, rename: 'b.wav' }], { backupRoot: bk });
  assert.equal(out.results[0].error, 'name-taken');
  assert.ok(fs.readFileSync(a).equals(before));
});

test('a case-only rename works', async () => {
  const d = tmp(), bk = tmp();
  const a = put(d, 'song.mp3', mp3());
  const out = await applyBatch([{ path: a, changes: {}, rename: 'Song.mp3' }], { backupRoot: bk });
  assert.ok(out.results[0].ok, JSON.stringify(out.results));
  assert.deepEqual(fs.readdirSync(d), ['Song.mp3']);
});

test('apply: FLAC, history, iXML, cart and cover in one batch; restore returns every byte', async () => {
  const d = tmp(), bk = tmp();
  const flacBuf = (() => {
    const le32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x; };
    const blk = (t, last, data) => { const h = Buffer.alloc(4); h[0] = (last ? 0x80 : 0) | t; h.writeUIntBE(data.length, 1, 3); return Buffer.concat([h, data]); };
    const si = Buffer.alloc(34); si[10] = 0x0a; si[11] = 0xc4; si[12] = 0x42; si[13] = 0xf0;
    const vc = Buffer.concat([le32(3), Buffer.from('abc'), le32(1), le32(11), Buffer.from('TITLE=Hello')]);
    return Buffer.concat([Buffer.from('fLaC'), blk(0, false, si), blk(4, false, vc), blk(1, true, Buffer.alloc(100)), Buffer.alloc(500, 3)]);
  })();
  const f = put(d, 'a.flac', flacBuf);
  const wavBuf = makeWav({ bext: { description: 'x' } });
  const w = put(d, 'a.wav', wavBuf);
  const m3 = mp3();
  const m = put(d, 'a.mp3', m3);
  const jpg = put(d, 'c.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]));
  const out = await applyBatch([
    { path: f, changes: { title: 'Edited', year: '2026' } },
    { path: w, changes: { codingHistory: 'A=PCM', ixmlNote: 'n', cartTitle: 'T', description: 'd' } },
    { path: m, changes: { cover: 'file:' + jpg, title: 'T' } }
  ], { backupRoot: bk });
  assert.ok(out.results.every((r) => r.ok), JSON.stringify(out.results));
  assert.equal((await readTags(f)).fields.title, 'Edited');
  assert.equal((await readTags(w)).fields.cartTitle, 'T');
  assert.match((await readTags(m)).fields.cover, /^image\/jpeg/);
  const rr = await runRestore(out.dir);
  assert.ok(rr.results.every((r) => r.ok));
  assert.ok(fs.readFileSync(f).equals(flacBuf));
  assert.ok(fs.readFileSync(w).equals(wavBuf));
  assert.ok(fs.readFileSync(m).equals(m3));
});

test('a locked field stops the file before any backup is made', async () => {
  const d = tmp(), bk = tmp();
  const w = put(d, 'l.wav', makeWav({ extra: [['iXML', Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><BWFXML></BWFXML>', 'latin1')]] }));
  const out = await applyBatch([{ path: w, changes: { ixmlNote: 'x' } }], { backupRoot: bk });
  assert.equal(out.results[0].error, 'ixml-encoding');
  assert.equal(out.dir, null);
});
