import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyBatch, checkRestore, runRestore, expandPaths, mirrorPath, preflight, readTags } from '../src/batch.js';
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
  const p = await preflight([{ path: w }], path.join(bk, 'not', 'yet'));
  assert.ok(p.bytes > 100000);
  assert.ok(p.free > 0 && p.enough === true);
});
