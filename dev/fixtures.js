// Builds small test files by hand (no audio libraries), so the tests can control every byte.
import { execFileSync } from 'node:child_process';

export function chunk(id, data) {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

export function fmtChunk({ rate = 48000, channels = 2, bits = 16 } = {}) {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(1, 0); b.writeUInt16LE(channels, 2); b.writeUInt32LE(rate, 4);
  b.writeUInt32LE(rate * channels * bits / 8, 8); b.writeUInt16LE(channels * bits / 8, 12); b.writeUInt16LE(bits, 14);
  return chunk('fmt ', b);
}

export function bextData({ description = '', originator = '', originatorReference = '', date = '', time = '', version = 0, history = '', loudness = null, timeReference = 0n } = {}) {
  const b = Buffer.alloc(602);
  b.write(description, 0, 256, 'latin1'); b.write(originator, 256, 32, 'latin1'); b.write(originatorReference, 288, 32, 'latin1');
  b.write(date, 320, 10, 'latin1'); b.write(time, 330, 8, 'latin1');
  b.writeUInt32LE(Number(timeReference & 0xffffffffn), 338); b.writeUInt32LE(Number(timeReference >> 32n), 342);
  b.writeUInt16LE(version, 346);
  if (version >= 1) for (let i = 0; i < 64; i++) b[348 + i] = i + 1; // a recognisable UMID
  if (loudness) [loudness.i, loudness.r, loudness.t, loudness.m, loudness.s].forEach((v, k) => b.writeInt16LE(Math.round(v * 100), 412 + 2 * k));
  return Buffer.concat([b, Buffer.from(history, 'latin1')]);
}

// opts: bext (object or null), extra: [[id, Buffer]] placed after fmt, dataBytes, tail (bytes after the RIFF)
export function makeWav({ bext = null, extra = [], dataBytes = 4800, tail = null, bextFirst = false } = {}) {
  const audio = Buffer.alloc(dataBytes);
  for (let i = 0; i < dataBytes; i++) audio[i] = (i * 7 + 3) & 0xff;
  const parts = [];
  if (bext && bextFirst) parts.push(chunk('bext', bextData(bext)));
  parts.push(fmtChunk());
  if (bext && !bextFirst) parts.push(chunk('bext', bextData(bext)));
  for (const [id, data] of extra) parts.push(chunk(id, data));
  parts.push(chunk('data', audio));
  const body = Buffer.concat([Buffer.from('WAVE'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, tail || Buffer.alloc(0)]);
}

// ---- MP3 and ID3 -----------------------------------------------------------------------------
export const syncsafe = (n) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
export const MPEG_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]); // MPEG-1 Layer III 128 kbit/s 44.1 kHz
export const audioBytes = (n = 6) => Buffer.concat(Array.from({ length: n }, () => MPEG_FRAME));

export function frame(version, id, body, flags = [0, 0]) {
  const size = version === 4 ? syncsafe(body.length) : (() => { const b = Buffer.alloc(4); b.writeUInt32BE(body.length); return b; })();
  return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from(flags), body]);
}
export const text = (enc, s) => {
  const encode = { 0: (x) => Buffer.from(x, 'latin1'), 1: (x) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(x, 'utf16le')]), 3: (x) => Buffer.from(x, 'utf8') }[enc];
  return Buffer.concat([Buffer.from([enc]), encode(s)]);
};
export function tag(version, frames, { padding = 0, flags = 0 } = {}) {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, flags]), syncsafe(body.length), body]);
}

export function exiftool(file, ...args) {
  try { return execFileSync('exiftool', [...args, file], { encoding: 'utf8' }); } catch (e) { return null; }
}
export function ffprobeTags(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file], { encoding: 'utf8' });
    return JSON.parse(out).format?.tags || {};
  } catch (e) { return null; }
}
export const haveExiftool = (() => { try { execFileSync('exiftool', ['-ver']); return true; } catch { return false; } })();
export const haveFfprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
