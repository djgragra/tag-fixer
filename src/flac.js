import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

// FLAC: the VORBIS_COMMENT metadata block (title, artist, album, date, track number, genre, comment).
// Layout read in RFC 9639 (FLAC): "fLaC", then metadata blocks with a 4-byte header (last-block flag + 7-bit type,
// 24-bit big-endian length); VORBIS_COMMENT = vendor string and a list of "NAME=value" UTF-8 strings, all lengths
// 32-bit little-endian. Every other block (STREAMINFO, SEEKTABLE, PICTURE, CUESHEET, APPLICATION) and the audio
// frames are copied byte for byte; fields not edited keep their entries as they were.
export const FIELD_NAMES = ['title', 'artist', 'album', 'year', 'track', 'genre', 'comment'];
const VORBIS = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', year: 'DATE', track: 'TRACKNUMBER', genre: 'GENRE', comment: 'COMMENT' };
const T_STREAMINFO = 0, T_PADDING = 1, T_VORBIS = 4;
const MAX_BLOCK = 0xffffff;
const NEW_PADDING = 4096;
const VENDOR = 'Tag Fixer';
const MAX_META = 64 << 20;

const ss = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);

export function validateField(field, value) {
  const v = String(value ?? '');
  if (v === '') return null;
  if (v.includes('\u0000')) return 'invalid-char';
  if (field === 'year') return /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2})?)?)?)?)?$/.test(v) ? null : 'bad-year';
  if (field === 'track') return /^\d{1,5}(\/\d{1,5})?$/.test(v) ? null : 'bad-track';
  return null;
}

const readFully = async (fh, length, position) => {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
};

// -> { ok:false, error } or { vendor: Buffer, entries: [Buffer] } (the raw UTF-8 strings)
function parseVorbis(data) {
  if (data.length < 8) return null;
  const vlen = data.readUInt32LE(0);
  if (4 + vlen + 4 > data.length) return null;
  const vendor = data.subarray(4, 4 + vlen);
  const count = data.readUInt32LE(4 + vlen);
  let o = 8 + vlen;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (o + 4 > data.length) return null;
    const len = data.readUInt32LE(o);
    if (o + 4 + len > data.length) return null;
    entries.push(data.subarray(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return { vendor, entries, trailing: data.length - o };
}

function buildVorbis(vendor, entries) {
  const parts = [Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendor.length);
  parts[2].writeUInt32LE(entries.length);
  for (const e of entries) { const l = Buffer.alloc(4); l.writeUInt32LE(e.length); parts.push(l, e); }
  return Buffer.concat(parts);
}

const entryName = (e) => { const i = e.indexOf(0x3d); return (i === -1 ? e : e.subarray(0, i)).toString('latin1').toUpperCase(); };
const entryValue = (e) => { const i = e.indexOf(0x3d); return i === -1 ? '' : e.subarray(i + 1).toString('utf8'); };

export async function readFlac(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const res = { kind: 'flac', path: file, size, ok: false, writable: false, fields: Object.fromEntries(FIELD_NAMES.map((n) => [n, ''])), locked: {}, multi: {}, blocks: [], warnings: [], info: null };
    const head = await readFully(fh, 10, 0);
    let base = 0;
    if (head.length === 10 && head.toString('latin1', 0, 3) === 'ID3' && ((head[6] | head[7] | head[8] | head[9]) & 128) === 0) {
      base = 10 + ss(head, 6) + (head[3] === 4 && head[5] & 0x10 ? 10 : 0);
      res.id3Prefix = base;
    }
    const mark = await readFully(fh, 4, base);
    if (mark.toString('latin1') !== 'fLaC') { res.error = 'not-flac'; return res; }
    res.base = base;
    let pos = base + 4;
    for (let n = 0; n < 4096; n++) {
      const h = await readFully(fh, 4, pos);
      if (h.length < 4) { res.error = 'flac-bad'; return res; }
      const last = (h[0] & 0x80) !== 0;
      const type = h[0] & 0x7f;
      const length = h.readUIntBE(1, 3);
      if (type === 127 || pos + 4 + length > size) { res.error = 'flac-bad'; return res; }
      res.blocks.push({ type, last, offset: pos, length });
      pos += 4 + length;
      if (last) break;
      if (n === 4095) { res.error = 'flac-bad'; return res; }
    }
    if (!res.blocks.length || !res.blocks[res.blocks.length - 1].last || res.blocks[0].type !== T_STREAMINFO || res.blocks[0].length !== 34) { res.error = 'flac-bad'; return res; }
    if (pos - base > MAX_META) { res.error = 'flac-bad'; return res; }
    res.audioOffset = pos;

    const si = await readFully(fh, 34, res.blocks[0].offset + 4);
    const sampleRate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
    const total = (si[13] & 0xf) * 2 ** 32 + si.readUInt32BE(14);
    res.info = { sampleRate, channels: ((si[12] >> 1) & 7) + 1, bits: (((si[12] & 1) << 4) | (si[13] >> 4)) + 1, seconds: sampleRate && total ? total / sampleRate : undefined };

    const vcs = res.blocks.filter((b) => b.type === T_VORBIS);
    if (vcs.length > 1) res.warnings.push('several-vorbis');
    res.ok = true;
    if (vcs.length) {
      const vb = vcs[0];
      const parsed = parseVorbis(await readFully(fh, vb.length, vb.offset + 4));
      if (!parsed) { res.readOnlyReason = 'vorbis-corrupt'; return res; }
      res.vorbis = { block: vb, entries: parsed.entries.length };
      for (const f of FIELD_NAMES) {
        const vals = parsed.entries.filter((e) => entryName(e) === VORBIS[f]).map(entryValue);
        if (vals.length) { res.fields[f] = vals.join(' / '); if (vals.length > 1) res.multi[f] = true; }
      }
    }
    res.writable = true;
    return res;
  } finally {
    await fh.close();
  }
}

const tempNameFor = (file) => path.join(path.dirname(file), `.tagfixer-${crypto.randomBytes(5).toString('hex')}.tmp`);

async function hashRange(file, start, end) {
  const h = crypto.createHash('sha256');
  if (end > start) {
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(file, { start, end: end - 1 });
      s.on('data', (d) => h.update(d));
      s.on('end', resolve);
      s.on('error', reject);
    });
  }
  return h.digest('hex');
}

const blockBytes = (type, last, data) => {
  const h = Buffer.alloc(4);
  h[0] = (last ? 0x80 : 0) | type;
  h.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([h, data]);
};

// changes: { title?, artist?, … } ('' removes every entry of that field).
export async function writeFlac(file, changes) {
  const info = await readFlac(file);
  if (!info.ok) throw Object.assign(new Error(info.error), { code: info.error });
  if (!info.writable) throw Object.assign(new Error(info.readOnlyReason), { code: info.readOnlyReason });
  for (const [field, value] of Object.entries(changes)) {
    if (!FIELD_NAMES.includes(field)) throw Object.assign(new Error(field), { code: 'unknown-field' });
    const err = validateField(field, value);
    if (err) throw Object.assign(new Error(`${field}: ${err}`), { code: err });
  }

  const fh = await fsp.open(file, 'r');
  let blocks;
  try {
    blocks = [];
    for (const b of info.blocks) blocks.push({ type: b.type, data: await readFully(fh, b.length, b.offset + 4) });
  } finally { await fh.close(); }

  // the entries
  let vcIndex = blocks.findIndex((b) => b.type === T_VORBIS);
  let vendor = Buffer.from(VENDOR, 'utf8');
  let entries = [];
  if (vcIndex >= 0) { const p = parseVorbis(blocks[vcIndex].data); vendor = p.vendor; entries = [...p.entries]; }
  for (const [field, value] of Object.entries(changes)) {
    const name = VORBIS[field];
    const at = entries.findIndex((e) => entryName(e) === name);
    entries = entries.filter((e) => entryName(e) !== name);
    if (value === '') continue;
    const entry = Buffer.from(`${name}=${value}`, 'utf8');
    entries.splice(at === -1 ? entries.length : at, 0, entry);
  }
  const vcData = buildVorbis(vendor, entries);
  if (vcData.length > MAX_BLOCK) throw Object.assign(new Error('vorbis-too-big'), { code: 'vorbis-too-big' });
  if (vcIndex >= 0) blocks[vcIndex] = { type: T_VORBIS, data: vcData };
  else { blocks.splice(1, 0, { type: T_VORBIS, data: vcData }); vcIndex = 1; }

  const regionOld = info.audioOffset - (info.base + 4);
  const size = (bl) => bl.reduce((n, b) => n + 4 + b.data.length, 0);
  const serialise = (bl) => Buffer.concat(bl.map((b, i) => blockBytes(b.type, i === bl.length - 1, b.data)));

  // same space: the padding block absorbs the difference
  const fit = (() => {
    const bl = blocks.map((b) => ({ ...b }));
    const padIdx = bl.findIndex((b) => b.type === T_PADDING);
    const need = regionOld - size(bl);
    if (need === 0) return bl;
    if (padIdx >= 0) {
      const len = bl[padIdx].data.length + need;
      if (len < 0 || len > MAX_BLOCK) return null;
      bl[padIdx] = { type: T_PADDING, data: Buffer.alloc(len) };
      return bl;
    }
    if (need >= 4) { bl.push({ type: T_PADDING, data: Buffer.alloc(need - 4) }); return bl; }
    return null;
  })();

  if (fit) {
    const out = serialise(fit);
    if (out.length !== regionOld) throw Object.assign(new Error('size'), { code: 'verify-failed' });
    const wfh = await fsp.open(file, 'r+');
    try { await wfh.write(out, 0, out.length, info.base + 4); await wfh.sync(); } finally { await wfh.close(); }
    return { mode: 'in-place' };
  }

  const bl = blocks.filter((b) => b.type !== T_PADDING);
  bl.push({ type: T_PADDING, data: Buffer.alloc(NEW_PADDING) });
  const region = serialise(bl);
  const tmp = tempNameFor(file);
  const stat = await fsp.stat(file);
  const dst = await fsp.open(tmp, 'wx', stat.mode);
  try {
    const src = await fsp.open(file, 'r');
    try { await dst.write(await readFully(src, info.base + 4, 0)); } finally { await src.close(); }
    await dst.write(region);
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(file, { start: info.audioOffset });
      s.on('data', (d) => { s.pause(); dst.write(d).then(() => s.resume(), reject); });
      s.on('end', resolve);
      s.on('error', reject);
    });
    await dst.sync();
  } catch (err) {
    await dst.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await dst.close();
  const newAudio = info.base + 4 + region.length;
  const same = (await hashRange(file, info.audioOffset, info.size)) === (await hashRange(tmp, newAudio, newAudio + info.size - info.audioOffset));
  if (!same) { await fsp.rm(tmp, { force: true }); throw Object.assign(new Error('verify-failed'), { code: 'verify-failed' }); }
  await fsp.rename(tmp, file);
  return { mode: 'rewrite' };
}
