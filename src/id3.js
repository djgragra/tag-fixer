import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

// ID3v2.3 / v2.4 editor that keeps every frame it does not edit byte for byte.
// Edited fields: title TIT2, artist TPE1, album TALB, track TRCK, genre TCON, comment COMM
// (the one with an empty description), year TYER (v2.3) or TDRC (v2.4).
// Not editable (shown read-only): ID3v2.2, tag-level unsynchronisation, unreadable frames.
export const FIELD_NAMES = ['title', 'artist', 'album', 'year', 'track', 'genre', 'comment'];
const TEXT_FRAME = { title: 'TIT2', artist: 'TPE1', album: 'TALB', track: 'TRCK', genre: 'TCON' };
const MAX_TAG = 32 << 20;
const PADDING = 1024;

const ss = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
const toSs = (n) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
const yearFrame = (version) => (version === 4 ? 'TDRC' : 'TYER');

// ---- Validation (pure) ----------------------------------------------------------------------

export function validateField(field, value, version = 3) {
  const v = String(value ?? '');
  if (v === '') return null;
  if (v.includes('\u0000')) return 'invalid-char';
  if (field === 'year') {
    if (version === 4) return /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2})?)?)?)?)?$/.test(v) ? null : 'bad-year';
    return /^\d{4}$/.test(v) ? null : 'bad-year';
  }
  if (field === 'track') return /^\d{1,5}(\/\d{1,5})?$/.test(v) ? null : 'bad-track';
  return null;
}

// ---- Text encoding --------------------------------------------------------------------------

function decodeText(enc, buf) {
  if (enc === 0) return buf.toString('latin1');
  if (enc === 3) return buf.toString('utf8');
  if (enc === 1 || enc === 2) {
    if (enc === 1 && buf.length >= 2) {
      if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
      if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
    }
    return enc === 2 ? Buffer.from(buf).swap16().toString('utf16le') : buf.toString('utf16le');
  }
  return buf.toString('latin1');
}

// Splits at NUL terminators of the right width. Returns the list of strings.
function splitTerminated(enc, buf) {
  const wide = enc === 1 || enc === 2;
  const out = [];
  let start = 0;
  for (let i = 0; i + (wide ? 1 : 0) < buf.length; i += wide ? 2 : 1) {
    if (buf[i] === 0 && (!wide || buf[i + 1] === 0)) { out.push(buf.subarray(start, i)); start = i + (wide ? 2 : 1); }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

function encodeText(version, s) {
  if ([...s].every((c) => c.charCodeAt(0) <= 0xff)) return { enc: 0, bytes: Buffer.from(s, 'latin1') };
  if (version === 4) return { enc: 3, bytes: Buffer.from(s, 'utf8') };
  return { enc: 1, bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]) };
}

function buildFrame(version, id, body) {
  const h = Buffer.alloc(10);
  h.write(id, 0, 'latin1');
  if (version === 4) toSs(body.length).copy(h, 4); else h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}

function buildTextFrame(version, id, s) {
  const { enc, bytes } = encodeText(version, s);
  return buildFrame(version, id, Buffer.concat([Buffer.from([enc]), bytes]));
}

function buildCommentFrame(version, s, language = 'eng') {
  const { enc, bytes } = encodeText(version, s);
  const descriptor = enc === 1 ? Buffer.from([0xff, 0xfe, 0, 0]) : enc === 0 || enc === 3 ? Buffer.from([0]) : Buffer.from([0, 0]);
  return buildFrame(version, 'COMM', Buffer.concat([Buffer.from([enc]), Buffer.from(language, 'latin1'), descriptor, bytes]));
}

// ---- Reading --------------------------------------------------------------------------------

const GENRE_V1 = (n) => (n === 255 ? '' : `(${n})`);

function readV1(buf) {
  if (buf.length !== 128 || buf.toString('latin1', 0, 3) !== 'TAG') return null;
  const s = (a, b) => buf.toString('latin1', a, b).replace(/\0.*$/s, '').trimEnd();
  const out = { title: s(3, 33), artist: s(33, 63), album: s(63, 93), year: s(93, 97), comment: s(97, 127), track: '', genre: GENRE_V1(buf[127]) };
  if (buf[125] === 0 && buf[126] !== 0) { out.track = String(buf[126]); out.comment = s(97, 125); }
  return out;
}

// Frame list of a v2.3 / v2.4 tag body (after the extended header). Returns { frames, problem }.
function parseFrames(version, body, from, end) {
  const frames = [];
  let pos = from;
  while (pos + 10 <= end) {
    if (body[pos] === 0) {
      if (body.subarray(pos, end).some((b) => b !== 0)) return { frames, problem: 'tag-garbage' };
      return { frames, padding: end - pos };
    }
    const id = body.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) return { frames, problem: 'tag-garbage' };
    let size;
    if (version === 4) {
      if ((body[pos + 4] | body[pos + 5] | body[pos + 6] | body[pos + 7]) & 128) return { frames, problem: 'tag-corrupt' };
      size = ss(body, pos + 4);
    } else size = body.readUInt32BE(pos + 4);
    if (pos + 10 + size > end) return { frames, problem: 'tag-corrupt' };
    frames.push({ id, flags: [body[pos + 8], body[pos + 9]], raw: body.subarray(pos, pos + 10 + size), data: body.subarray(pos + 10, pos + 10 + size) });
    pos += 10 + size;
  }
  return { frames, padding: end - pos };
}

// Flags that change how the frame data is stored: we do not edit such frames.
const frameLocked = (version, f) => {
  if (version === 4) return f.flags[1] & 0x4f ? 'frame-flags' : null; // grouping, compression, encryption, unsync, length indicator
  return f.flags[1] & 0xe0 ? 'frame-flags' : null; // compression, encryption, grouping
};

function readTextValue(frame) {
  const d = frame.data;
  if (!d.length) return { value: '', multi: false };
  const parts = splitTerminated(d[0], d.subarray(1)).map((b) => decodeText(d[0], b));
  return { value: parts.join(' / '), multi: parts.length > 1 };
}

function readCommentFrame(frame) {
  const d = frame.data;
  if (d.length < 4) return null;
  const enc = d[0];
  const rest = d.subarray(4);
  const wide = enc === 1 || enc === 2;
  let i = 0;
  while (i + (wide ? 1 : 0) < rest.length && !(rest[i] === 0 && (!wide || rest[i + 1] === 0))) i += wide ? 2 : 1;
  const description = decodeText(enc, rest.subarray(0, i));
  const text = decodeText(enc, rest.subarray(Math.min(rest.length, i + (wide ? 2 : 1))));
  return { language: d.toString('latin1', 1, 4), description, text: text.replace(/\0+$/, '') };
}

export async function readId3(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const res = { kind: 'mp3', path: file, size, ok: true, version: null, hasTag: false, fields: Object.fromEntries(FIELD_NAMES.map((n) => [n, ''])), locked: {}, multi: {}, source: 'none', frames: [], writable: true };
    let tail = Buffer.alloc(0);
    if (size >= 128) { tail = Buffer.alloc(128); await fh.read(tail, 0, 128, size - 128); }
    res.v1 = readV1(tail);
    const head = Buffer.alloc(10);
    const { bytesRead } = await fh.read(head, 0, 10, 0);
    if (bytesRead === 10 && head.toString('latin1', 0, 3) === 'ID3' && head[3] >= 2 && head[3] <= 4 && ((head[6] | head[7] | head[8] | head[9]) & 128) === 0) {
      const major = head[3], flags = head[5], tagSize = ss(head, 6);
      const footer = major === 4 && flags & 0x10 ? 10 : 0;
      res.hasTag = true;
      res.version = `2.${major}`;
      res.tagSize = tagSize;
      res.audioOffset = 10 + tagSize + footer;
      res.footer = !!footer;
      res.flags = flags;
      if (tagSize > MAX_TAG || res.audioOffset > size) { res.readOnlyReason = 'tag-corrupt'; res.writable = false; return res; }
      const body = Buffer.alloc(tagSize);
      await fh.read(body, 0, tagSize, 10);
      res.source = 'v2';
      if (major === 2) return readV22(res, body);
      if (flags & 0x80) res.readOnlyReason = 'unsync';
      let from = 0;
      if (flags & 0x40) { // extended header (dropped when the tag is rewritten)
        const ext = major === 4 ? ss(body, 0) : 4 + body.readUInt32BE(0);
        from = Math.min(ext, tagSize);
        res.extendedHeader = true;
      }
      const parsed = parseFrames(major, body, from, tagSize);
      res.frames = parsed.frames;
      res.padding = parsed.padding || 0;
      if (parsed.problem) res.readOnlyReason = res.readOnlyReason || parsed.problem;
      fillFields(res, major);
      if (res.readOnlyReason) res.writable = false;
      return res;
    }
    if (res.v1) { // no ID3v2: show the ID3v1 values; saving creates an ID3v2.3 tag
      res.source = 'v1';
      for (const n of FIELD_NAMES) res.fields[n] = res.v1[n] || '';
    }
    return res;
  } finally {
    await fh.close();
  }
}

function fillFields(res, major) {
  const byId = (id) => res.frames.find((f) => f.id === id);
  for (const [field, id] of Object.entries(TEXT_FRAME)) {
    const f = byId(id);
    if (!f) continue;
    const lock = frameLocked(major, f);
    if (lock) { res.locked[field] = lock; continue; }
    const { value, multi } = readTextValue(f);
    res.fields[field] = value;
    if (multi) res.multi[field] = true;
  }
  const y = byId(yearFrame(major));
  if (y) {
    const lock = frameLocked(major, y);
    if (lock) res.locked.year = lock; else res.fields.year = readTextValue(y).value;
  }
  const comm = res.frames.filter((f) => f.id === 'COMM');
  for (const f of comm) {
    const c = readCommentFrame(f);
    if (c && c.description === '') {
      const lock = frameLocked(major, f);
      if (lock) res.locked.comment = lock; else res.fields.comment = c.text;
      break;
    }
  }
}

function readV22(res, body) {
  const map = { TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'year', TRK: 'track', TCO: 'genre' };
  let pos = 0;
  while (pos + 6 <= body.length && body[pos] !== 0) {
    const id = body.toString('latin1', pos, pos + 3);
    const size = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    if (pos + 6 + size > body.length) break;
    const d = body.subarray(pos + 6, pos + 6 + size);
    if (map[id] && d.length) res.fields[map[id]] = splitTerminated(d[0], d.subarray(1)).map((b) => decodeText(d[0], b)).join(' / ');
    if (id === 'COM' && d.length > 4) {
      const enc = d[0], rest = d.subarray(4), wide = enc === 1 || enc === 2;
      let i = 0;
      while (i + (wide ? 1 : 0) < rest.length && !(rest[i] === 0 && (!wide || rest[i + 1] === 0))) i += wide ? 2 : 1;
      if (i === 0) res.fields.comment = decodeText(enc, rest.subarray(wide ? 2 : 1)).replace(/\0+$/, '');
    }
    pos += 6 + size;
  }
  res.readOnlyReason = 'id3v2.2';
  res.writable = false;
  return res;
}

// ---- Writing --------------------------------------------------------------------------------

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

// changes: { field: newValue } for the fields to change ('' removes the frame).
export async function writeId3(file, changes) {
  const info = await readId3(file);
  if (!info.writable) throw Object.assign(new Error(info.readOnlyReason), { code: info.readOnlyReason });
  const version = info.hasTag ? Number(info.version.slice(2)) : 3;
  for (const [field, value] of Object.entries(changes)) {
    if (!FIELD_NAMES.includes(field)) throw Object.assign(new Error(field), { code: 'unknown-field' });
    const err = validateField(field, value, version);
    if (err) throw Object.assign(new Error(`${field}: ${err}`), { code: err });
    if (info.locked[field]) throw Object.assign(new Error(`${field}: ${info.locked[field]}`), { code: info.locked[field] });
  }

  // Starting from the v1 values (no v2 tag yet), every field is written, not only the changed ones.
  let frames = info.frames.map((f) => f.raw);
  const ids = info.frames.map((f) => f.id);
  const full = info.source === 'v1' ? { ...info.fields, ...changes } : changes;
  const replace = (matchIdx, built) => {
    if (matchIdx >= 0) { if (built) frames[matchIdx] = built; else frames[matchIdx] = null; } else if (built) frames.push(built);
  };
  for (const [field, value] of Object.entries(full)) {
    if (field === 'comment') {
      const idx = info.frames.findIndex((f) => f.id === 'COMM' && readCommentFrame(f)?.description === '');
      const lang = idx >= 0 ? readCommentFrame(info.frames[idx])?.language || 'eng' : 'eng';
      replace(idx, value === '' ? null : buildCommentFrame(version, value, /^[a-z]{3}$/.test(lang) ? lang : 'eng'));
    } else {
      const id = field === 'year' ? yearFrame(version) : TEXT_FRAME[field];
      replace(ids.indexOf(id), value === '' ? null : buildTextFrame(version, id, value));
    }
  }
  frames = frames.filter(Boolean);
  const framesBytes = Buffer.concat(frames);
  const capacity = info.hasTag ? info.tagSize : 0;
  const header = (bodySize) => {
    const h = Buffer.alloc(10);
    h.write('ID3', 0, 'latin1');
    h[3] = version; h[4] = 0; h[5] = 0; // no unsynchronisation, extended header or footer after our rewrite
    toSs(bodySize).copy(h, 6);
    return h;
  };

  if (info.hasTag && !info.footer && framesBytes.length <= capacity) {
    // Fits in the space the tag already had: only the tag region is rewritten.
    const out = Buffer.concat([header(capacity), framesBytes, Buffer.alloc(capacity - framesBytes.length)]);
    const fh = await fsp.open(file, 'r+');
    try { await fh.write(out, 0, out.length, 0); await fh.sync(); } finally { await fh.close(); }
    return { mode: 'in-place' };
  }

  const bodySize = framesBytes.length + PADDING;
  const newTag = Buffer.concat([header(bodySize), framesBytes, Buffer.alloc(PADDING)]);
  const audioStart = info.hasTag ? info.audioOffset : 0;
  const tmp = tempNameFor(file);
  const stat = await fsp.stat(file);
  const dst = await fsp.open(tmp, 'wx', stat.mode);
  try {
    await dst.write(newTag);
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(file, { start: audioStart });
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
  const same = (await hashRange(file, audioStart, info.size)) === (await hashRange(tmp, newTag.length, newTag.length + info.size - audioStart));
  if (!same) { await fsp.rm(tmp, { force: true }); throw Object.assign(new Error('verify-failed'), { code: 'verify-failed' }); }
  await fsp.rename(tmp, file);
  return { mode: 'rewrite' };
}
