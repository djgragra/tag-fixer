import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

// Broadcast Wave Format "bext" chunk. Layout read in EBU Tech 3285 v2.0 (May 2011), clause 2.3:
//   Description[256] Originator[32] OriginatorReference[32] OriginationDate[10] OriginationTime[8]
//   TimeReference (2 x DWORD) Version (WORD) UMID[64] Loudness (5 x WORD) Reserved[180] CodingHistory[]
// All text fields are ASCII, shorter strings end with a NUL. The fixed part is 602 bytes.
export const BEXT_FIXED = 602;
export const BEXT_EDITABLE_END = 338; // the five editable fields live in the first 338 bytes

export const FIELDS = {
  description: { offset: 0, length: 256 },
  originator: { offset: 256, length: 32 },
  originatorReference: { offset: 288, length: 32 },
  date: { offset: 320, length: 10 },
  time: { offset: 330, length: 8 }
};
export const FIELD_NAMES = Object.keys(FIELDS);

const MAX_CHUNKS = 20000;
const MAX_HISTORY = 1 << 20;

// ---- Validation (pure) ----------------------------------------------------------------------

export function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

// Replaces what ASCII cannot hold: accents are stripped (è→e), a few letters are spelled out,
// anything else becomes "?". The result is shown to the user before saving.
export function toAscii(s) {
  const map = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'Th', 'ð': 'd', 'Ð': 'D',
    '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '…': '...', '€': 'EUR', ' ': ' ' };
  let out = '';
  for (const ch of s.normalize('NFD')) {
    const c = ch.charCodeAt(0);
    if (c < 128) out += ch;
    else if (c >= 0x300 && c <= 0x36f) continue; // combining accents
    else out += map[ch] !== undefined ? map[ch] : '?';
  }
  return out;
}

const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

// Returns null when valid, otherwise a code. Empty means "not set" and is accepted.
export function validateField(name, value) {
  const v = String(value ?? '');
  const spec = FIELDS[name];
  if (!spec) return 'unknown-field';
  if (v === '') return null;
  if (!isAscii(v)) return 'non-ascii';
  if (v.length > spec.length) return 'too-long';
  if (/[\u0000]/.test(v)) return 'invalid-char';
  if (name === 'date') {
    const m = /^(\d{4})\D(\d{2})\D(\d{2})$/.exec(v);
    if (!m) return 'bad-date';
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return 'bad-date';
  }
  if (name === 'time') {
    const m = /^(\d{2})\D(\d{2})\D(\d{2})$/.exec(v);
    if (!m) return 'bad-time';
    if (Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return 'bad-time';
  }
  return null;
}

function fieldBytes(name, value) {
  const spec = FIELDS[name];
  const buf = Buffer.alloc(spec.length); // zero filled: NUL terminator and padding
  buf.write(String(value ?? ''), 0, spec.length, 'latin1');
  return buf;
}

// ---- Reading --------------------------------------------------------------------------------

const readFully = async (fh, length, position) => {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
};

function cstring(buf) {
  const z = buf.indexOf(0);
  return buf.toString('latin1', 0, z === -1 ? buf.length : z);
}

// Walks the chunk headers only (no audio is read).
export async function readBwf(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const head = await readFully(fh, 12, 0);
    const res = { kind: 'wav', path: file, size, ok: false, writable: false, warnings: [], chunks: [], hasBext: false, fields: null, nonAscii: {}, info: null, bext: null };
    if (head.length < 12) { res.error = 'not-wav'; return res; }
    const magic = head.toString('latin1', 0, 4);
    if (magic === 'RF64' || magic === 'BW64') { res.error = 'rf64'; return res; }
    if (magic !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') { res.error = 'not-wav'; return res; }
    const riffSize = head.readUInt32LE(4);
    if (riffSize === 0xffffffff) { res.error = 'rf64'; return res; }
    const declaredEnd = 8 + riffSize;
    res.riffSize = riffSize;
    res.declaredEnd = declaredEnd;
    let truncated = declaredEnd > size;
    if (truncated) res.warnings.push('riff-truncated');
    else if (declaredEnd < size) res.warnings.push('trailing-data');

    let offset = 12;
    const limit = Math.min(size, declaredEnd);
    while (offset + 8 <= limit && res.chunks.length < MAX_CHUNKS) {
      const h = await readFully(fh, 8, offset);
      if (h.length < 8) break;
      const id = h.toString('latin1', 0, 4);
      const csize = h.readUInt32LE(4);
      const dataOffset = offset + 8;
      const chunk = { id, offset, size: csize, dataOffset };
      res.chunks.push(chunk);
      if (dataOffset + csize > size) { truncated = true; res.warnings.push('chunk-truncated'); break; }
      offset = dataOffset + csize + (csize & 1);
    }
    res.truncated = truncated;

    const fmt = res.chunks.find((c) => c.id === 'fmt ');
    const data = res.chunks.find((c) => c.id === 'data');
    if (fmt && fmt.size >= 16) {
      const f = await readFully(fh, 16, fmt.dataOffset);
      const info = { formatTag: f.readUInt16LE(0), channels: f.readUInt16LE(2), sampleRate: f.readUInt32LE(4), byteRate: f.readUInt32LE(8), bits: f.readUInt16LE(14) };
      if (data && info.byteRate) info.seconds = Math.min(data.size, Math.max(0, size - data.dataOffset)) / info.byteRate;
      res.info = info;
    }
    if (!fmt) res.warnings.push('no-fmt');

    const bexts = res.chunks.filter((c) => c.id === 'bext');
    if (bexts.length > 1) res.warnings.push('several-bext');
    if (bexts.length) {
      const b = bexts[0];
      res.hasBext = true;
      res.bext = { dataOffset: b.dataOffset, size: b.size };
      const want = Math.min(b.size, BEXT_FIXED + MAX_HISTORY);
      const raw = Buffer.alloc(Math.max(BEXT_FIXED, 0));
      const got = await readFully(fh, Math.min(want, BEXT_FIXED), b.dataOffset);
      got.copy(raw);
      const fields = {};
      for (const name of FIELD_NAMES) {
        const spec = FIELDS[name];
        const bytes = raw.subarray(spec.offset, spec.offset + spec.length);
        const z = bytes.indexOf(0);
        const used = z === -1 ? bytes : bytes.subarray(0, z);
        fields[name] = used.toString('latin1');
        res.nonAscii[name] = used.some((c) => c > 127);
      }
      res.fields = fields;
      res.bext.short = b.size < BEXT_FIXED;
      if (b.size >= 348) {
        res.bext.version = raw.readUInt16LE(346);
        const low = raw.readUInt32LE(338), high = raw.readUInt32LE(342);
        res.bext.timeReference = ((BigInt(high) << 32n) | BigInt(low)).toString();
        res.bext.umidPresent = res.bext.version >= 1 && raw.subarray(348, 412).some((c) => c !== 0);
        if (res.bext.version >= 2 && b.size >= 422) {
          const s = (o) => raw.readInt16LE(o);
          res.bext.loudness = { integrated: s(412) / 100, range: s(414) / 100, truePeak: s(416) / 100, momentary: s(418) / 100, shortTerm: s(420) / 100 };
        }
      }
      if (b.size > BEXT_FIXED) {
        const hist = await readFully(fh, Math.min(b.size - BEXT_FIXED, MAX_HISTORY), b.dataOffset + BEXT_FIXED);
        res.bext.codingHistoryLength = b.size - BEXT_FIXED;
        res.bext.codingHistory = hist.toString('latin1').replace(/\0+$/, '');
      }
      if (b.size < BEXT_EDITABLE_END) res.warnings.push('bext-short');
    } else {
      res.fields = Object.fromEntries(FIELD_NAMES.map((n) => [n, '']));
      for (const n of FIELD_NAMES) res.nonAscii[n] = false;
    }

    res.ok = true;
    // Writing needs a well-formed file; a chunk that runs past the end could be anything.
    if (truncated) res.readOnlyReason = 'truncated';
    else if (res.hasBext && res.bext.size < BEXT_EDITABLE_END) res.readOnlyReason = 'bext-short';
    else if (!res.hasBext && !fmt) res.readOnlyReason = 'no-fmt';
    else if (!res.hasBext && riffSize + 8 + BEXT_FIXED > 0xfffffffe) res.readOnlyReason = 'too-big';
    res.writable = !res.readOnlyReason;
    return res;
  } finally {
    await fh.close();
  }
}

// ---- Writing --------------------------------------------------------------------------------

function newBextChunk(changes) {
  const data = Buffer.alloc(BEXT_FIXED); // Version 0: UMID, loudness and reserved bytes all zero
  for (const [name, value] of Object.entries(changes)) fieldBytes(name, value).copy(data, FIELDS[name].offset);
  const head = Buffer.alloc(8);
  head.write('bext', 0, 'latin1');
  head.writeUInt32LE(BEXT_FIXED, 4);
  return Buffer.concat([head, data]);
}

async function hashRanges(file, ranges) {
  const h = crypto.createHash('sha256');
  for (const [start, end] of ranges) {
    if (end <= start) continue;
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(file, { start, end: end - 1 });
      s.on('data', (d) => h.update(d));
      s.on('end', resolve);
      s.on('error', reject);
    });
  }
  return h.digest('hex');
}

async function copyRange(src, dstHandle, start, end) {
  if (end <= start) return;
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(src, { start, end: end - 1 });
    s.on('data', (d) => { s.pause(); dstHandle.write(d).then(() => s.resume(), reject); });
    s.on('end', resolve);
    s.on('error', reject);
  });
}

const tempNameFor = (file) => path.join(path.dirname(file), `.tagfixer-${crypto.randomBytes(5).toString('hex')}.tmp`);

// changes: { description?, originator?, originatorReference?, date?, time? } (only the fields to change).
// Existing bext: the changed fields are patched in place, the rest of the file is not touched.
// No bext: a new chunk (Version 0) is inserted after "fmt " by writing a temporary copy that
// replaces the original only when complete and verified.
export async function writeBwf(file, changes) {
  for (const [name, value] of Object.entries(changes)) {
    const err = validateField(name, value);
    if (err) throw Object.assign(new Error(`${name}: ${err}`), { code: err });
  }
  const info = await readBwf(file);
  if (!info.ok) throw Object.assign(new Error(info.error), { code: info.error });
  if (!info.writable) throw Object.assign(new Error(info.readOnlyReason), { code: info.readOnlyReason });

  if (info.hasBext) {
    const fh = await fsp.open(file, 'r+');
    try {
      for (const [name, value] of Object.entries(changes)) {
        const buf = fieldBytes(name, value);
        await fh.write(buf, 0, buf.length, info.bext.dataOffset + FIELDS[name].offset);
      }
      await fh.sync();
    } finally {
      await fh.close();
    }
    return { mode: 'patch' };
  }

  const fmt = info.chunks.find((c) => c.id === 'fmt ');
  const insertAt = fmt.dataOffset + fmt.size + (fmt.size & 1);
  const chunk = newBextChunk(changes);
  const tmp = tempNameFor(file);
  const stat = await fsp.stat(file);
  const dst = await fsp.open(tmp, 'wx', stat.mode);
  try {
    const head = Buffer.alloc(8);
    await fsp.open(file, 'r').then(async (src) => { try { await src.read(head, 0, 8, 0); } finally { await src.close(); } });
    head.writeUInt32LE(info.riffSize + chunk.length, 4);
    await dst.write(head, 0, 8);
    await copyRange(file, dst, 8, insertAt);
    await dst.write(chunk);
    await copyRange(file, dst, insertAt, info.size);
    await dst.sync();
  } catch (err) {
    await dst.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await dst.close();
  // Everything but the RIFF size and the new chunk must be byte-identical to the original.
  const same = (await hashRanges(file, [[8, info.size]])) === (await hashRanges(tmp, [[8, insertAt], [insertAt + chunk.length, info.size + chunk.length]]));
  if (!same) {
    await fsp.rm(tmp, { force: true });
    throw Object.assign(new Error('verify-failed'), { code: 'verify-failed' });
  }
  await fsp.rename(tmp, file);
  return { mode: 'rewrite' };
}
