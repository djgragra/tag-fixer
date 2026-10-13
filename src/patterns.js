import { toAscii } from './bwf.js';

// Patterns such as "{artist} - {title}" or "{date} {n:3} {filename|lower}": fill a field from other fields and the
// file name, read fields out of a file name, or build a new file name from the tags. Pure.
//   {field}              any field of the tab (title, artist, description, cartCutId …), the value as it is on screen
//   {filename} {ext} {folder}   the file name without extension, the extension, the name of the folder
//   {n} {n:3}            counter 1, 2, 3 … over the files taken in table order (padded to 3 digits)
//   {mdate} {mtime}      date and time the file was last modified: yyyy-mm-dd and hh-mm-ss
//   {today}              today's date, yyyy-mm-dd
//   {x|upper} {x|lower} {x|title} {x|trim} {x|ascii} {x|nospace}   filters, one after the other
export const FILTERS = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.toLowerCase().replace(/(^|[\s\-/(["“])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
  trim: (s) => s.trim(),
  ascii: (s) => toAscii(s),
  nospace: (s) => s.replace(/\s+/g, '')
};
export const SPECIAL = ['filename', 'ext', 'folder', 'n', 'mdate', 'mtime', 'today'];
export const MAX_PATTERN = 300;

const pad2 = (n) => String(n).padStart(2, '0');
export const dateOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const timeOf = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`; };

// -> { parts: [{ lit } | { name, arg, filters }] } or { error, at }
export function parseTemplate(pattern, known = []) {
  const src = String(pattern ?? '');
  if (src.length > MAX_PATTERN) return { error: 'too-long' };
  const parts = [];
  let lit = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end === -1) return { error: 'unclosed', at: i };
      const inner = src.slice(i + 1, end);
      const [head, ...filters] = inner.split('|').map((x) => x.trim());
      const m = /^([A-Za-z][A-Za-z0-9]*)(?::(\d{1,2}))?$/.exec(head);
      if (!m) return { error: 'bad-token', at: i, token: inner };
      const name = m[1];
      if (!SPECIAL.includes(name) && !known.includes(name)) return { error: 'unknown-token', at: i, token: name };
      if (m[2] && name !== 'n') return { error: 'bad-token', at: i, token: inner };
      for (const f of filters) if (!FILTERS[f]) return { error: 'unknown-filter', at: i, token: f };
      if (lit) { parts.push({ lit }); lit = ''; }
      parts.push({ name, arg: m[2] ? Number(m[2]) : 0, filters });
      i = end;
    } else if (c === '}') return { error: 'unclosed', at: i };
    else lit += c;
  }
  if (lit) parts.push({ lit });
  return { parts };
}

// ctx: { fields, name (file name with extension), folder, index (0-based, among the files taken), startAt, mtimeMs, now }
export function renderTemplate(pattern, ctx, known = Object.keys(ctx.fields || {})) {
  const t = parseTemplate(pattern, known);
  if (t.error) return { error: t.error, token: t.token };
  const dot = ctx.name.lastIndexOf('.');
  const base = dot > 0 ? ctx.name.slice(0, dot) : ctx.name;
  const ext = dot > 0 ? ctx.name.slice(dot + 1) : '';
  let out = '';
  for (const p of t.parts) {
    if (p.lit !== undefined) { out += p.lit; continue; }
    let v;
    switch (p.name) {
      case 'filename': v = base; break;
      case 'ext': v = ext; break;
      case 'folder': v = ctx.folder || ''; break;
      case 'n': v = String((ctx.startAt ?? 1) + (ctx.index ?? 0)).padStart(p.arg || 1, '0'); break;
      case 'mdate': v = ctx.mtimeMs ? dateOf(ctx.mtimeMs) : ''; break;
      case 'mtime': v = ctx.mtimeMs ? timeOf(ctx.mtimeMs) : ''; break;
      case 'today': v = dateOf(ctx.now ?? Date.now()); break;
      default: v = String(ctx.fields?.[p.name] ?? '');
    }
    for (const f of p.filters) v = FILTERS[f](v);
    out += v;
  }
  return { value: out };
}

// The other way: "01 - Band - Song" with "{n} - {artist} - {title}" -> { artist: 'Band', title: 'Song' }.
// Only field tokens and {n} (skipped) can be read; two tokens side by side with nothing between them are refused.
export function extractFromName(pattern, base, known) {
  const t = parseTemplate(pattern, known);
  if (t.error) return { error: t.error, token: t.token };
  let re = '^';
  const order = [];
  for (let i = 0; i < t.parts.length; i++) {
    const p = t.parts[i];
    if (p.lit !== undefined) { re += p.lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (SPECIAL.includes(p.name) && p.name !== 'n') return { error: 'not-readable', token: p.name };
    if (t.parts[i + 1] && t.parts[i + 1].lit === undefined) return { error: 'ambiguous' };
    re += p.name === 'n' ? '\\d+' : '(.+?)';
    if (p.name !== 'n') order.push(p);
  }
  re += '$';
  if (!order.length) return { error: 'nothing-to-read' };
  const m = new RegExp(re, 'su').exec(base);
  if (!m) return { values: null };
  const values = {};
  order.forEach((p, i) => {
    let v = m[i + 1].trim();
    for (const f of p.filters) v = FILTERS[f](v);
    if (!(p.name in values)) values[p.name] = v;
  });
  return { values };
}
