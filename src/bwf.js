import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as ixml from './ixml.js';
import * as cart from './cart.js';

// WAV metadata: the BWF "bext" chunk, its CodingHistory, the "iXML" chunk and the "cart" chunk (AES46), in
// RIFF and RF64/BW64 files. Layout of bext read in EBU Tech 3285 v2.0 (May 2011), clause 2.3:
//   Description[256] Originator[32] OriginatorReference[32] OriginationDate[10] OriginationTime[8]
//   TimeReference (2 x DWORD) Version (WORD) UMID[64] Loudness (5 x WORD) Reserved[180] CodingHistory[]
// All text fields are ASCII, shorter strings end with a NUL. The fixed part is 602 bytes.
// RF64/BW64: the first chunk after "WAVE" is "ds64" (riffSize, dataSize, sampleCount as 64 bit, table of
// chunks over 4 GB); a size of 0xFFFFFFFF in a chunk header means "see ds64". Cross-checked with FFmpeg's wavdec.c.
export const BEXT_FIXED = 602;
export const BEXT_EDITABLE_END = 338; // the five editable fields live in the first 338 bytes

export const FIELDS = {
  description: { offset: 0, length: 256 },
  originator: { offset: 256, length: 32 },
  originatorReference: { offset: 288, length: 32 },
  date: { offset: 320, length: 10 },
  time: { offset: 330, length: 8 }
};
export const BEXT_FIELD_NAMES = Object.keys(FIELDS);
export const HISTORY = 'codingHistory';
export const IXML_FIELD_NAMES = ixml.FIELD_NAMES;
export const CART_FIELD_NAMES = cart.FIELD_NAMES;
export const FIELD_NAMES = [...BEXT_FIELD_NAMES, HISTORY, ...IXML_FIELD_NAMES, ...CART_FIELD_NAMES];

const MAX_CHUNKS = 20000;
const MAX_HISTORY = 1 << 20;
const MAX_EDITABLE_CHUNK = 16 << 20;
const MAX_HISTORY_EDIT = 32768;
const RF64_MAGICS = ['RF64', 'BW64'];

// ---- Validation (pure) ----------------------------------------------------------------------

export function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

// Replaces what ASCII cannot hold: accents are stripped (è→e), a few letters are spelled out,
// anything else becomes "?". The result is shown to the user before saving.
export function toAscii(s) {
  const map = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'Th', 'ð': 'd', 'Ð': 'D',
    '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '…': '...', '€': 'EUR', ' ': ' ' };
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

// CodingHistory lines end with CR LF in the file; the window shows and edits them with a plain line break.
export function normalizeHistory(v) {
  const lines = String(v ?? '').split(/\r\n|\r|\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}
export const historyBytes = (v) => {
  const n = normalizeHistory(v);
  return n === '' ? Buffer.alloc(0) : Buffer.from(n.split('\n').join('\r\n') + '\r\n', 'latin1');
};
// What a field looks like after it was written and read back (used to compare).
export const normalizeField = (name, value) => (name === HISTORY ? normalizeHistory(value) : String(value ?? ''));

// Returns null when valid, otherwise a code. Empty means "not set" and is accepted.
export function validateField(name, value) {
  const v = String(value ?? '');
  if (name === HISTORY) {
    if (v === '') return null;
    if (!isAscii(v)) return 'non-ascii';
    if (/\u0000/.test(v)) return 'invalid-char';
    return historyBytes(v).length > MAX_HISTORY_EDIT ? 'too-long' : null;
  }
  if (ixml.FIELD_NAMES.includes(name)) return ixml.validateField(name, v);
  if (cart.FIELD_NAMES.includes(name)) return cart.validateField(name, v);
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
export function limitOf(name) {
  if (FIELDS[name]) return FIELDS[name].length;
  if (cart.FIELDS[name]) return cart.limitOf(name);
  if (ixml.FIELD_NAMES.includes(name)) return ixml.limitOf(name);
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

const safeNumber = (big) => (big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : null);

function parseDs64(buf) {
  if (buf.length < 28) return null;
  const riffSize = safeNumber(buf.readBigUInt64LE(0));
  const dataSize = safeNumber(buf.readBigUInt64LE(8));
  const tableLength = buf.readUInt32LE(24);
  if (riffSize === null || dataSize === null || 28 + tableLength * 12 > buf.length) return null;
  const table = {};
  for (let i = 0; i < tableLength; i++) {
    const o = 28 + i * 12;
    const s = safeNumber(buf.readBigUInt64LE(o + 4));
    if (s === null) return null;
    table[buf.toString('latin1', o, o + 4)] = s;
  }
  return { riffSize, dataSize, table };
}

// Walks the chunk headers only (no audio is read).
export async function readBwf(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const head = await readFully(fh, 12, 0);
    const res = { kind: 'wav', path: file, size, ok: false, writable: false, warnings: [], chunks: [], hasBext: false, fields: null, nonAscii: {}, locked: {}, info: null, bext: null, rf64: false };
    if (head.length < 12) { res.error = 'not-wav'; return res; }
    const magic = head.toString('latin1', 0, 4);
    const rf64 = RF64_MAGICS.includes(magic);
    if (!rf64 && magic !== 'RIFF') { res.error = 'not-wav'; return res; }
    if (head.toString('latin1', 8, 12) !== 'WAVE') { res.error = 'not-wav'; return res; }
    const riffSize32 = head.readUInt32LE(4);
    let ds64 = null;
    if (rf64) {
      res.rf64 = true;
      res.rf64Kind = magic;
      const h = await readFully(fh, 8, 12);
      if (h.length < 8 || h.toString('latin1', 0, 4) !== 'ds64') { res.error = 'rf64-bad'; return res; }
      const dsSize = h.readUInt32LE(4);
      if (dsSize < 28 || dsSize > 1 << 20) { res.error = 'rf64-bad'; return res; }
      ds64 = parseDs64(await readFully(fh, dsSize, 20));
      if (!ds64) { res.error = 'rf64-bad'; return res; }
      res.ds64 = ds64;
    } else if (riffSize32 === 0xffffffff) { res.error = 'rf64-bad'; return res; }
    const riffSize = rf64 ? ds64.riffSize : riffSize32;
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
      let csize = h.readUInt32LE(4);
      if (rf64 && csize === 0xffffffff) {
        csize = id === 'data' ? ds64.dataSize : ds64.table[id];
        if (csize === undefined) { res.error = 'rf64-bad'; return res; }
      }
      const dataOffset = offset + 8;
      const chunk = { id, offset, size: csize, dataOffset };
      res.chunks.push(chunk);
      if (dataOffset + csize > size) { truncated = true; res.warnings.push('chunk-truncated'); break; }
      offset = dataOffset + csize + (csize & 1);
    }
    res.walkEnd = Math.min(offset, size);
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

    const fields = {};
    for (const n of FIELD_NAMES) { fields[n] = ''; res.nonAscii[n] = false; }
    res.fields = fields;

    // ---- bext and CodingHistory
    const bexts = res.chunks.filter((c) => c.id === 'bext');
    if (bexts.length > 1) res.warnings.push('several-bext');
    if (bexts.length) {
      const b = bexts[0];
      res.hasBext = true;
      res.bext = { dataOffset: b.dataOffset, size: b.size };
      const raw = Buffer.alloc(BEXT_FIXED);
      const got = await readFully(fh, Math.min(b.size, BEXT_FIXED), b.dataOffset);
      got.copy(raw);
      for (const name of BEXT_FIELD_NAMES) {
        const spec = FIELDS[name];
        const bytes = raw.subarray(spec.offset, spec.offset + spec.length);
        const z = bytes.indexOf(0);
        const used = z === -1 ? bytes : bytes.subarray(0, z);
        fields[name] = used.toString('latin1');
        res.nonAscii[name] = used.some((c) => c > 127);
      }
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
        fields[HISTORY] = normalizeHistory(res.bext.codingHistory.replace(/\0/g, ''));
        res.nonAscii[HISTORY] = hist.some((c) => c > 127);
        if (b.size - BEXT_FIXED > MAX_HISTORY_EDIT) res.locked[HISTORY] = 'history-big';
      }
      if (b.size < BEXT_FIXED) res.locked[HISTORY] = 'bext-short';
      if (b.size < BEXT_EDITABLE_END) res.warnings.push('bext-short');
    }

    // ---- iXML
    const ixmls = res.chunks.filter((c) => c.id === 'iXML');
    if (ixmls.length > 1) res.warnings.push('several-ixml');
    if (ixmls.length) {
      const c = ixmls[0];
      res.hasIxml = true;
      const lock = (code) => { for (const n of IXML_FIELD_NAMES) res.locked[n] = code; };
      if (c.size > ixml.MAX_BYTES || c.dataOffset + c.size > size) lock('ixml-too-big');
      else {
        const dec = ixml.decodeChunk(await readFully(fh, c.size, c.dataOffset));
        if (!dec.ok) lock(dec.error);
        else {
          const p = ixml.parseIxml(dec.text);
          if (!p.ok) lock(p.error === 'not-ixml' ? 'ixml-not-ixml' : 'ixml-bad-xml');
          else {
            for (const n of IXML_FIELD_NAMES) { fields[n] = p.fields[n]; if (p.complex[n]) res.locked[n] = p.complex[n]; }
          }
        }
      }
    }

    // ---- cart
    const carts = res.chunks.filter((c) => c.id === 'cart');
    if (carts.length > 1) res.warnings.push('several-cart');
    if (carts.length) {
      const c = carts[0];
      res.hasCart = true;
      if (c.size < cart.CART_FIXED || c.dataOffset + c.size > size) for (const n of CART_FIELD_NAMES) res.locked[n] = 'cart-short';
      else {
        const p = cart.parseCart(await readFully(fh, cart.CART_FIXED, c.dataOffset));
        for (const n of CART_FIELD_NAMES) { fields[n] = p.fields[n]; res.nonAscii[n] = p.nonAscii[n]; }
        res.cartVersion = p.version;
      }
    }

    res.ok = true;
    // Writing needs a well-formed file; a chunk that runs past the end could be anything.
    if (truncated) res.readOnlyReason = 'truncated';
    else if (res.hasBext && res.bext.size < BEXT_EDITABLE_END) res.readOnlyReason = 'bext-short';
    else if (!res.hasBext && !fmt) res.readOnlyReason = 'no-fmt';
    else if (!rf64 && !res.hasBext && riffSize + 8 + BEXT_FIXED > 0xfffffffe) res.readOnlyReason = 'too-big';
    res.writable = !res.readOnlyReason;
    return res;
  } finally {
    await fh.close();
  }
}

// ---- Writing --------------------------------------------------------------------------------

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

const chunkBytes = (id, data) => {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return data.length & 1 ? Buffer.concat([head, data, Buffer.alloc(1)]) : Buffer.concat([head, data]);
};
const paddedSize = (n) => 8 + n + (n & 1);

// The ranges where two buffers of the same length differ, joined when they are close.
function diffRanges(a, b, gap = 16) {
  const out = [];
  let i = 0;
  while (i < a.length) {
    if (a[i] === b[i]) { i++; continue; }
    let j = i + 1;
    let lastDiff = i;
    while (j < a.length && j - lastDiff <= gap) { if (a[j] !== b[j]) lastDiff = j; j++; }
    out.push([i, lastDiff + 1]);
    i = lastDiff + 1;
  }
  return out;
}

async function readBody(file, chunk) {
  const fh = await fsp.open(file, 'r');
  try { return await readFully(fh, chunk.size, chunk.dataOffset); } finally { await fh.close(); }
}

// changes: { description?, originator?, …, codingHistory?, ixmlNote?, cartTitle?, … } (only the fields to change).
// Same size as before: only the bytes that differ are written in place. Otherwise (a new chunk, a longer
// CodingHistory or iXML) a temporary copy is written and replaces the original only when complete and verified:
// everything except the touched chunks and the sizes must be byte-identical to the original.
export async function writeBwf(file, changes) {
  for (const [name, value] of Object.entries(changes)) {
    const err = FIELD_NAMES.includes(name) ? validateField(name, value) : 'unknown-field';
    if (err) throw Object.assign(new Error(`${name}: ${err}`), { code: err });
  }
  const info = await readBwf(file);
  if (!info.ok) throw Object.assign(new Error(info.error), { code: info.error });
  if (!info.writable) throw Object.assign(new Error(info.readOnlyReason), { code: info.readOnlyReason });
  for (const name of Object.keys(changes)) if (info.locked[name]) throw Object.assign(new Error(`${name}: ${info.locked[name]}`), { code: info.locked[name] });

  const bextCh = {}, ixmlCh = {}, cartCh = {};
  let hist;
  for (const [n, v] of Object.entries(changes)) {
    if (BEXT_FIELD_NAMES.includes(n)) bextCh[n] = v;
    else if (n === HISTORY) hist = v;
    else if (ixml.FIELD_NAMES.includes(n)) ixmlCh[n] = v;
    else cartCh[n] = v;
  }

  // The new body of every chunk that changes: { old: chunk|null, body: Buffer }
  const edits = {};
  const bextChunk = info.chunks.find((c) => c.id === 'bext');
  if (Object.keys(bextCh).length || hist !== undefined) {
    if (bextChunk && bextChunk.size > MAX_EDITABLE_CHUNK) throw Object.assign(new Error('bext-big'), { code: 'history-big' });
    const old = bextChunk ? await readBody(file, bextChunk) : null;
    const body = old ? Buffer.from(old) : Buffer.alloc(BEXT_FIXED);
    for (const [n, v] of Object.entries(bextCh)) fieldBytes(n, v).copy(body, FIELDS[n].offset);
    let next = body;
    if (hist !== undefined) next = Buffer.concat([body.subarray(0, BEXT_FIXED), historyBytes(hist)]);
    edits.bext = { old: bextChunk || null, oldBody: old, body: next };
  }
  const cartChunk = info.chunks.find((c) => c.id === 'cart');
  if (Object.keys(cartCh).length) {
    const old = cartChunk ? await readBody(file, cartChunk) : null;
    edits.cart = { old: cartChunk || null, oldBody: old, body: cart.applyCart(old, cartCh) };
  }
  const ixmlChunk = info.chunks.find((c) => c.id === 'iXML');
  if (Object.keys(ixmlCh).length) {
    let text = null;
    if (ixmlChunk) {
      const dec = ixml.decodeChunk(await readBody(file, ixmlChunk));
      if (!dec.ok) throw Object.assign(new Error(dec.error), { code: dec.error });
      text = dec.text;
    }
    const next = ixml.encodeChunk(text === null ? ixml.newIxml(ixmlCh) : ixml.applyIxml(text, ixmlCh));
    edits.ixml = { old: ixmlChunk || null, oldBody: ixmlChunk ? await readBody(file, ixmlChunk) : null, body: next };
  }

  const list = Object.values(edits);
  const inPlace = list.every((e) => e.old && e.oldBody && e.oldBody.length === e.body.length);
  if (inPlace) {
    const fh = await fsp.open(file, 'r+');
    try {
      for (const e of list) for (const [a, b] of diffRanges(e.oldBody, e.body)) await fh.write(e.body, a, b - a, e.old.dataOffset + a);
      await fh.sync();
    } finally { await fh.close(); }
    return { mode: 'patch' };
  }
  return rewrite(file, info, edits);
}

async function rewrite(file, info, edits) {
  const stat = await fsp.stat(file);
  const order = ['bext', 'cart', 'ixml'];
  const idOf = { bext: 'bext', cart: 'cart', ixml: 'iXML' };
  const segs = []; // { src: [start, end] } | { buf } | { ds64, src }
  let delta = 0;
  // new chunks go after the first bext when there is one, otherwise after fmt (bext, then cart, then iXML)
  const inserts = order.filter((k) => edits[k] && !edits[k].old);
  let placed = false;
  const anchor = info.chunks.find((c) => c.id === 'bext') || info.chunks.find((c) => c.id === 'fmt ');
  for (const c of info.chunks) {
    const end = c.dataOffset + c.size + (c.size & 1);
    const key = order.find((k) => edits[k]?.old && edits[k].old.offset === c.offset);
    if (key) {
      const nb = chunkBytes(idOf[key], edits[key].body);
      segs.push({ buf: nb });
      delta += nb.length - (end - c.offset);
    } else if (c.id === 'ds64') segs.push({ ds64: c, src: [c.offset, end] });
    else segs.push({ src: [c.offset, end] });
    if (!placed && inserts.length && c === anchor) {
      placed = true;
      for (const k of inserts) { const nb = chunkBytes(idOf[k], edits[k].body); segs.push({ buf: nb }); delta += nb.length; }
    }
  }
  if (inserts.length && !placed) throw Object.assign(new Error('no-fmt'), { code: 'no-fmt' });
  const tailStart = info.walkEnd;
  if (tailStart < info.size) segs.push({ src: [tailStart, info.size] });

  const newRiff = info.riffSize + delta;
  if (!info.rf64 && newRiff > 0xfffffffe) throw Object.assign(new Error('too-big'), { code: 'too-big' });

  const header = Buffer.alloc(12);
  await (async () => { const fh = await fsp.open(file, 'r'); try { await fh.read(header, 0, 12, 0); } finally { await fh.close(); } })();
  if (!info.rf64) header.writeUInt32LE(newRiff, 4);

  const tmp = tempNameFor(file);
  const dst = await fsp.open(tmp, 'wx', stat.mode);
  const keptSrc = [];
  const keptDst = [];
  try {
    await dst.write(header, 0, 12);
    let pos = 12;
    for (const s of segs) {
      if (s.buf) { await dst.write(s.buf); pos += s.buf.length; continue; }
      if (s.ds64) {
        const b = await readBody(file, s.ds64);
        const out = Buffer.from(b);
        out.writeBigUInt64LE(BigInt(newRiff), 0);
        await dst.write(chunkBytes('ds64', out));
        // same length as before; only riffSize (the 8 bytes after the chunk header) differs
        keptSrc.push([s.src[0], s.src[0] + 8], [s.src[0] + 16, s.src[1]]);
        keptDst.push([pos, pos + 8], [pos + 16, pos + (s.src[1] - s.src[0])]);
        pos += s.src[1] - s.src[0];
        continue;
      }
      await copyRange(file, dst, s.src[0], s.src[1]);
      keptSrc.push(s.src);
      keptDst.push([pos, pos + (s.src[1] - s.src[0])]);
      pos += s.src[1] - s.src[0];
    }
    await dst.sync();
  } catch (err) {
    await dst.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await dst.close();
  const same = (await hashRanges(file, keptSrc)) === (await hashRanges(tmp, keptDst));
  let readable = false;
  if (same) { try { readable = (await readBwf(tmp)).ok; } catch { readable = false; } }
  if (!same || !readable) {
    await fsp.rm(tmp, { force: true });
    throw Object.assign(new Error('verify-failed'), { code: 'verify-failed' });
  }
  await fsp.rename(tmp, file);
  return { mode: 'rewrite' };
}
