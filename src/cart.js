// Cart chunk (AES46, "cart"), the radio automation metadata of a WAV file: title, artist, cut number,
// client, category, out cue, start/end date and time. Fixed part of 2048 bytes, then TagText.
// Layout cross-checked against libsndfile's SF_CART_INFO (include/sndfile.h): Version[4] Title[64] Artist[64]
// CutID[64] ClientID[64] Category[64] Classification[64] OutCue[64] StartDate[10] StartTime[8] EndDate[10]
// EndTime[8] ProducerAppID[64] ProducerAppVersion[64] UserDef[64] LevelReference(int32) PostTimer[8 x (usage[4], value int32)]
// Reserved[276] URL[1024] TagText[]. Fixed part = 2048 bytes. Pure: Buffers in and out.
export const CART_FIXED = 2048;
export const FIELDS = {
  cartTitle: { offset: 4, length: 64 },
  cartArtist: { offset: 68, length: 64 },
  cartCutId: { offset: 132, length: 64 },
  cartClientId: { offset: 196, length: 64 },
  cartCategory: { offset: 260, length: 64 },
  cartClassification: { offset: 324, length: 64 },
  cartOutCue: { offset: 388, length: 64 },
  cartStartDate: { offset: 452, length: 10 },
  cartStartTime: { offset: 462, length: 8 },
  cartEndDate: { offset: 470, length: 10 },
  cartEndTime: { offset: 480, length: 8 },
  cartUserDef: { offset: 552, length: 64 }
};
export const FIELD_NAMES = Object.keys(FIELDS);
export const NEW_VERSION = '0101'; // AES46-2002: version 1.01
const isAscii = (s) => { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false; return true; };
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

// null when valid. Empty means "not set".
export function validateField(name, value) {
  const v = String(value ?? '');
  const spec = FIELDS[name];
  if (!spec) return 'unknown-field';
  if (v === '') return null;
  if (!isAscii(v)) return 'non-ascii';
  if (/[\u0000-\u001f]/.test(v)) return 'invalid-char';
  if (v.length > spec.length) return 'too-long';
  if (name.endsWith('Date')) {
    const m = /^(\d{4})\D(\d{2})\D(\d{2})$/.exec(v);
    if (!m) return 'bad-date';
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return 'bad-date';
  }
  if (name.endsWith('Time')) {
    const m = /^(\d{2})\D(\d{2})\D(\d{2})$/.exec(v);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return 'bad-time';
  }
  return null;
}
export const limitOf = (name) => FIELDS[name].length;

function cstring(buf) {
  const z = buf.indexOf(0);
  return buf.toString('latin1', 0, z === -1 ? buf.length : z);
}

// data: the chunk body (at least CART_FIXED bytes).
export function parseCart(data) {
  const fields = {};
  const nonAscii = {};
  for (const [name, spec] of Object.entries(FIELDS)) {
    const bytes = data.subarray(spec.offset, spec.offset + spec.length);
    const z = bytes.indexOf(0);
    const used = z === -1 ? bytes : bytes.subarray(0, z);
    fields[name] = used.toString('latin1');
    nonAscii[name] = used.some((c) => c > 127);
  }
  return { fields, nonAscii, version: cstring(data.subarray(0, 4)) };
}

// existing: the chunk body or null (a new one, all zero except the version). Returns the new body.
export function applyCart(existing, changes) {
  const data = existing ? Buffer.from(existing) : Buffer.alloc(CART_FIXED);
  if (!existing) data.write(NEW_VERSION, 0, 4, 'latin1');
  for (const [name, value] of Object.entries(changes)) {
    const spec = FIELDS[name];
    if (!spec) throw Object.assign(new Error(name), { code: 'unknown-field' });
    const err = validateField(name, value);
    if (err) throw Object.assign(new Error(`${name}: ${err}`), { code: err });
    data.fill(0, spec.offset, spec.offset + spec.length);
    data.write(String(value ?? ''), spec.offset, spec.length, 'latin1');
  }
  return data;
}
