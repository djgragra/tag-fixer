import { validateField as validateBwf, FIELD_NAMES as WAV_FIELDS } from './bwf.js';
import { validateField as validateId3, TEXT_FIELDS as ID3_FIELDS } from './id3.js';
import { validateField as validateFlac, FIELD_NAMES as FLAC_FIELDS } from './flac.js';

// Consistency checks over the files in the table, on the values as they are now (edits included).
// Pure. files: [{ id, name, kind, ok, writable, fields, meta }] -> [{ id, severity, code, field? }]
//   severity 'error' (the value cannot be saved), 'warn' (probably a mistake), 'info' (worth a look)
export const CODES = [
  'unreadable', 'read-only', 'invalid-value', 'no-bext', 'empty-description', 'empty-originator', 'empty-reference', 'date-future', 'date-missing',
  'no-tag', 'v1-only', 'missing-title', 'missing-artist', 'missing-album', 'no-cover', 'spaces', 'duplicate', 'duplicate-reference', 'non-ascii', 'damaged'
];

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function runChecks(files, { now = Date.now() } = {}) {
  const out = [];
  const add = (f, severity, code, field) => out.push({ id: f.id, severity, code, ...(field ? { field } : {}) });
  const horizon = now + 36 * 3600_000;

  for (const f of files) {
    if (!f.ok) { add(f, 'error', 'unreadable'); continue; }
    if (!f.writable) add(f, 'warn', 'read-only');
    const v = f.fields || {};
    const m = f.meta || {};
    const names = f.kind === 'wav' ? WAV_FIELDS : f.kind === 'flac' ? FLAC_FIELDS : [...ID3_FIELDS, 'cover'];
    for (const name of names) {
      const value = v[name] ?? '';
      if (value === '') continue;
      let code = null;
      if (f.kind === 'wav') code = validateBwf(name, value);
      else if (f.kind === 'flac') code = validateFlac(name, value);
      else if (name !== 'cover') code = validateId3(name, value, Number(String(m.version || '2.3').slice(2)) === 4 ? 4 : 3);
      if (code === 'non-ascii') add(f, 'warn', 'non-ascii', name);
      else if (code) add(f, 'error', 'invalid-value', name);
      if (name !== 'cover' && name !== 'codingHistory' && name !== 'ixmlNote' && value !== value.trim()) add(f, 'info', 'spaces', name);
    }
    if ((m.warnings || []).some((w) => w === 'riff-truncated' || w === 'chunk-truncated' || w === 'no-fmt')) add(f, 'error', 'damaged');
    if (f.kind === 'wav') {
      if (!m.hasBext) add(f, 'warn', 'no-bext');
      else {
        if (!norm(v.description)) add(f, 'warn', 'empty-description', 'description');
        if (!norm(v.originator)) add(f, 'info', 'empty-originator', 'originator');
        if (!norm(v.originatorReference)) add(f, 'info', 'empty-reference', 'originatorReference');
        if (!norm(v.date)) add(f, 'info', 'date-missing', 'date');
      }
      const dm = /^(\d{4})\D(\d{2})\D(\d{2})$/.exec(v.date || '');
      if (dm && validateBwf('date', v.date) === null && Date.UTC(+dm[1], +dm[2] - 1, +dm[3]) > horizon) add(f, 'warn', 'date-future', 'date');
    } else {
      if (f.kind === 'mp3') {
        if (m.source === 'none') add(f, 'warn', 'no-tag');
        else if (m.source === 'v1') add(f, 'info', 'v1-only');
        if (!m.pictures && !v.cover) add(f, 'info', 'no-cover', 'cover');
      }
      if (!norm(v.title)) add(f, 'warn', 'missing-title', 'title');
      if (!norm(v.artist)) add(f, 'warn', 'missing-artist', 'artist');
      if (!norm(v.album)) add(f, 'info', 'missing-album', 'album');
    }
  }

  // the same title and artist (or the same originator reference) in several files of one kind
  const group = (key, code, kinds) => {
    const seen = new Map();
    for (const f of files) {
      if (!f.ok || !kinds.includes(f.kind)) continue;
      const k = key(f);
      if (!k) continue;
      seen.set(k, [...(seen.get(k) || []), f]);
    }
    for (const list of seen.values()) if (list.length > 1) for (const f of list) out.push({ id: f.id, severity: 'warn', code, field: code === 'duplicate-reference' ? 'originatorReference' : 'title' });
  };
  group((f) => (norm(f.fields?.title) && norm(f.fields?.artist) ? `${f.kind}|${norm(f.fields.title)}|${norm(f.fields.artist)}` : ''), 'duplicate', ['mp3', 'flac']);
  group((f) => (norm(f.fields?.originatorReference) ? `${norm(f.fields.originatorReference)}` : ''), 'duplicate-reference', ['wav']);
  return out;
}
