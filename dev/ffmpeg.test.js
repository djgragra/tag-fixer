// Files produced by a real encoder (ffmpeg) instead of our own fixtures. The audio is decoded
// before and after the edit and the two must be identical (md5 of the decoded samples).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBwf, writeBwf } from '../src/bwf.js';
import { readId3, writeId3 } from '../src/id3.js';
import { ffprobeTags, exiftool, haveFfprobe, haveExiftool } from './fixtures.js';

const haveFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const haveLame = haveFfmpeg && execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libmp3lame');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-ff-'));
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const md5 = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
const SRC = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];

test('WAV with a bext chunk written by ffmpeg: read, edit in place, audio unchanged', { skip: !haveFfmpeg }, async () => {
  const f = path.join(tmp(), 'bext.wav');
  ff(...SRC, '-c:a', 'pcm_s24le', '-ar', '48000', '-write_bext', '1',
    '-metadata', 'description=Made by ffmpeg', '-metadata', 'originator=FFMPEG', '-metadata', 'origination_date=2020-01-02', '-metadata', 'origination_time=03:04:05', f);
  const before = await readBwf(f);
  assert.ok(before.ok && before.hasBext, JSON.stringify(before.chunks.map((c) => c.id)));
  assert.equal(before.fields.description, 'Made by ffmpeg');
  assert.equal(before.fields.originator, 'FFMPEG');
  assert.equal(before.fields.date, '2020-01-02');
  assert.equal(before.fields.time, '03:04:05');
  assert.equal(before.info.sampleRate, 48000);
  assert.equal(before.info.bits, 24);
  const sum = md5(f);
  const size = fs.statSync(f).size;
  const res = await writeBwf(f, { description: 'Edited by Tag Fixer', date: '2026-10-01' });
  assert.equal(res.mode, 'patch');
  assert.equal(fs.statSync(f).size, size);
  assert.equal(md5(f), sum, 'decoded audio identical');
  if (haveExiftool) {
    const e = JSON.parse(exiftool(f, '-j'))[0];
    assert.equal(e.Description, 'Edited by Tag Fixer');
    assert.equal(e.Originator, 'FFMPEG');
    assert.equal(e.DateTimeOriginal, '2026:10:01 03:04:05');
    assert.equal(e.Warning, undefined);
  }
});

test('WAV without bext (plain ffmpeg output with LIST INFO): new chunk inserted, audio unchanged', { skip: !haveFfmpeg }, async () => {
  const f = path.join(tmp(), 'plain.wav');
  ff(...SRC, '-c:a', 'pcm_s16le', '-metadata', 'title=Has an INFO title', f);
  const before = await readBwf(f);
  assert.equal(before.hasBext, false);
  const sum = md5(f);
  const res = await writeBwf(f, { description: 'Added', originator: 'Tag Fixer', date: '2026-10-01', time: '12-00-00' });
  assert.equal(res.mode, 'rewrite');
  const after = await readBwf(f);
  assert.equal(after.hasBext, true);
  assert.deepEqual(after.chunks.map((c) => c.id).filter((i) => i !== 'bext'), before.chunks.map((c) => c.id));
  assert.equal(md5(f), sum, 'decoded audio identical');
  if (haveFfprobe) assert.equal(ffprobeTags(f).title, 'Has an INFO title', 'the LIST INFO chunk survived');
  if (haveFfprobe) assert.equal(ffprobeTags(f).comment, 'Added', 'ffprobe shows the bext Description as "comment"');
});

for (const v of [3, 4]) {
  test(`MP3 with an ID3v2.${v} tag written by ffmpeg (with ID3v1): edit, audio unchanged`, { skip: !haveLame }, async () => {
    const f = path.join(tmp(), `v${v}.mp3`);
    ff(...SRC, '-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', String(v), '-write_id3v1', '1',
      '-metadata', 'title=Original title', '-metadata', 'artist=Original artist', '-metadata', 'album=Original album', '-metadata', 'date=2019',
      '-metadata', 'track=2/9', '-metadata', 'genre=Jazz', '-metadata', 'encoded_by=ffmpeg test', '-metadata', 'mykey=kept as TXXX', f);
    const before = await readId3(f);
    assert.equal(before.version, `2.${v}`);
    assert.equal(before.fields.title, 'Original title');
    assert.equal(before.fields.track, '2/9');
    assert.equal(before.fields.comment, '', 'no COMM frame: ffmpeg writes custom tags as TXXX');
    assert.equal(before.fields.year, '2019');
    assert.ok(before.v1, 'ID3v1 tag present');
    const v1Bytes = fs.readFileSync(f).subarray(-128);
    const sum = md5(f);
    const res = await writeId3(f, { title: 'Edited título', year: v === 4 ? '2026-10-01' : '2026', comment: 'Edited comment' });
    assert.ok(['in-place', 'rewrite'].includes(res.mode));
    const after = await readId3(f);
    assert.equal(after.version, `2.${v}`);
    assert.equal(after.fields.title, 'Edited título');
    assert.equal(after.fields.artist, 'Original artist');
    assert.equal(after.fields.comment, 'Edited comment');
    assert.equal(md5(f), sum, 'decoded audio identical');
    assert.ok(fs.readFileSync(f).subarray(-128).equals(v1Bytes), 'ID3v1 tag untouched');
    for (const id of before.frames.map((x) => x.id)) if (!['TIT2', 'COMM', 'TYER', 'TDRC'].includes(id)) {
      assert.ok(before.frames.find((x) => x.id === id).raw.equals(after.frames.find((x) => x.id === id).raw), id + ' unchanged');
    }
    if (haveFfprobe) {
      const t = ffprobeTags(f);
      assert.equal(t.title, 'Edited título');
      assert.equal(t.artist, 'Original artist');
      assert.equal(t.comment, 'Edited comment');
      assert.equal(t.encoded_by, 'ffmpeg test');
      assert.equal(t.mykey, 'kept as TXXX', 'the TXXX frame survived');
    }
    if (haveExiftool) assert.equal(JSON.parse(exiftool(f, '-j'))[0].Warning, undefined);
  });
}
