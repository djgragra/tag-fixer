// CSV in and out for the table. UTF-8 with a BOM (Excel reads it right), CR LF lines, fields in quotes when they must be.
// A cell that starts with = + - @ would be run as a formula by a spreadsheet: it is written with a leading ' and the
// ' is removed again when the file is read back.
export const MAX_BYTES = 50 << 20;
export const MAX_ROWS = 200000;
const DANGER = /^[=+\-@\t\r]/;

export function toCsv(headers, rows, delimiter = ',') {
  const cell = (v) => {
    let s = String(v ?? '');
    if (DANGER.test(s)) s = "'" + s;
    return /[",;\t\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(delimiter)).join('\r\n') + '\r\n';
}

function detectDelimiter(text) {
  const first = [];
  let q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    if (!q && (ch === '\n' || ch === '\r')) break;
    first.push(ch);
  }
  const line = first.join('');
  const count = (d) => (line.match(new RegExp(d === '\t' ? '\\t' : `\\${d}`, 'g')) || []).length;
  const best = [',', ';', '\t'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ',';
}

// -> { ok, headers, rows, delimiter } | { ok:false, error }
export function parseCsv(input, delimiter) {
  let text = String(input ?? '');
  if (text.length > MAX_BYTES) return { ok: false, error: 'too-big' };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], cur = '', q = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      continue;
    }
    if (c === '"' && cur === '') { q = true; any = true; continue; }
    if (c === delim) { row.push(cur); cur = ''; any = true; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (any || cur !== '') { row.push(cur); rows.push(row); }
      row = []; cur = ''; any = false;
      if (rows.length > MAX_ROWS) return { ok: false, error: 'too-many-rows' };
      continue;
    }
    cur += c; any = true;
  }
  if (q) return { ok: false, error: 'bad-quotes' };
  if (any || cur !== '') { row.push(cur); rows.push(row); }
  if (!rows.length) return { ok: false, error: 'empty' };
  const unprotect = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
  const headers = rows[0].map((h) => h.trim());
  return { ok: true, headers, rows: rows.slice(1).map((r) => r.map(unprotect)), delimiter: delim };
}

// Which column is which. Headers are field names (as written by the export), in any case. Rows are matched by the
// full path ("path" column) or, failing that, by the file name ("file" or "name" column) when it is unique.
// opts: { known: [field names of the tab], files: [{ path, name }], emptyMeansClear }
export function planImport(parsed, { known, files, emptyMeansClear = false }) {
  const lower = new Map(known.map((k) => [k.toLowerCase(), k]));
  const cols = parsed.headers.map((h) => lower.get(h.toLowerCase()) || null);
  const pathCol = parsed.headers.findIndex((h) => h.toLowerCase() === 'path');
  const nameCol = parsed.headers.findIndex((h) => ['file', 'name', 'filename'].includes(h.toLowerCase()));
  if (pathCol === -1 && nameCol === -1) return { ok: false, error: 'no-key-column' };
  if (!cols.some(Boolean)) return { ok: false, error: 'no-known-columns' };
  const byPath = new Map(files.map((f) => [f.path, f]));
  const byName = new Map();
  for (const f of files) byName.set(f.name.toLowerCase(), byName.has(f.name.toLowerCase()) ? null : f);
  const updates = [];
  const unmatched = [];
  const ambiguous = [];
  for (const r of parsed.rows) {
    let f = pathCol !== -1 ? byPath.get(r[pathCol] ?? '') : null;
    if (!f && nameCol !== -1) {
      const key = String(r[nameCol] ?? '').toLowerCase();
      if (byName.has(key)) { f = byName.get(key); if (f === null) { ambiguous.push(r[nameCol]); continue; } }
    }
    if (!f) { unmatched.push(r[pathCol !== -1 ? pathCol : nameCol] ?? ''); continue; }
    const values = {};
    cols.forEach((k, i) => {
      if (!k) return;
      const v = r[i] ?? '';
      if (v === '' && !emptyMeansClear) return;
      values[k] = v;
    });
    if (Object.keys(values).length) updates.push({ path: f.path, values });
  }
  return { ok: true, updates, unmatched, ambiguous, columns: cols.filter(Boolean) };
}
