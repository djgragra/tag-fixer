import path from 'node:path';
import { renderTemplate, extractFromName, parseTemplate, SPECIAL } from './patterns.js';
import { applyToValues } from './textops.js';
import { fromName, fromMtime, format } from './datefile.js';
import { checkRenames } from './batch.js';

// The jobs behind the table tools: each takes plain data from the window and returns the new values, so the window
// only shows a preview and applies the result. No file is written here.
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
export const safeBase = (s) => String(s).replace(FORBIDDEN, '_').replace(/\s+/g, ' ').replace(/[ .]+$/, '').replace(/^ +/, '');

// params: { mode: 'fill' | 'read' | 'rename', pattern, field, known: [field names], startAt, rows: [{ id, path, name, dir, fields, mtimeMs }] }
// -> { error?, token?, results: [{ id, value?, values?, error?, problem? }], bad }
export async function patternJob({ mode, pattern, field, known, startAt = 1, rows }) {
  const parsed = parseTemplate(pattern, known);
  if (parsed.error) return { error: parsed.error, token: parsed.token, results: [], bad: 0 };
  if (!String(pattern).trim()) return { error: 'empty', results: [], bad: 0 };
  if (mode === 'fill' && !known.includes(field)) return { error: 'no-field', results: [], bad: 0 };
  const results = [];
  let bad = 0;
  rows.forEach((r, index) => {
    const ctx = { fields: r.fields, name: r.name, folder: path.basename(r.dir || ''), index, startAt, mtimeMs: r.mtimeMs };
    if (mode === 'read') {
      const base = r.name.replace(/\.[^.]*$/, '');
      const x = extractFromName(pattern, base, known);
      if (x.error) { results.push({ id: r.id, error: x.error }); bad++; return; }
      if (!x.values) { results.push({ id: r.id, error: 'no-match' }); bad++; return; }
      results.push({ id: r.id, values: x.values });
      return;
    }
    const out = renderTemplate(pattern, ctx, known);
    if (out.error) { results.push({ id: r.id, error: out.error }); bad++; return; }
    if (mode === 'rename') {
      const ext = path.extname(r.name);
      const base = safeBase(out.value);
      // a file whose tags are all empty would get a name made of separators: it is flagged instead
      const used = parsed.parts.filter((x) => x.name && !SPECIAL.includes(x.name));
      const empty = used.length > 0 && used.every((x) => !String(r.fields[x.name] ?? '').trim());
      results.push({ id: r.id, value: base && !empty ? base + ext : '', empty });
    } else results.push({ id: r.id, value: out.value });
  });
  if (mode === 'read' && results.length && results.every((r) => r.error === 'ambiguous' || r.error === 'not-readable' || r.error === 'nothing-to-read')) return { error: results[0].error, results: [], bad: results.length };
  if (mode === 'rename') {
    const problems = await checkRenames(results.map((x, i) => ({ path: rows[i].path, rename: x.value && x.value !== rows[i].name ? x.value : null })));
    results.forEach((x, i) => {
      if (!x.value) { x.problem = x.empty ? 'fields-empty' : 'name-empty'; bad++; return; }
      if (x.value === rows[i].name) x.same = true;
      if (problems[rows[i].path]) { x.problem = problems[rows[i].path]; bad++; }
    });
  }
  return { results, bad };
}

// params: { op, rows: [{ id, value }] } -> { error?, results: [{ id, value, changed }], changed }
export function textJob({ op, rows }) {
  const r = applyToValues(rows.map((x) => x.value), op);
  if (r.error) return { error: r.error, results: [], changed: 0 };
  return { results: rows.map((x, i) => ({ id: x.id, value: r.values[i], changed: r.values[i] !== x.value })), changed: r.changed };
}

// params: { source: 'name' | 'mtime' | 'birthtime', target: 'bext' | 'cart-start' | 'cart-end', withTime, rows: [{ id, name, mtimeMs, birthtimeMs }] }
// source 'name' falls back to the modification time when the name holds no date.
// -> { results: [{ id, date, time, from: 'name' | 'mtime' | 'birthtime' }] }
export function dateJob({ source = 'name', target = 'bext', withTime = true, rows }) {
  const kind = target === 'bext' ? 'bext' : 'cart';
  const results = rows.map((r) => {
    let p = null;
    let from = source;
    if (source === 'name') { p = fromName(r.name); from = 'name'; if (!p) { p = fromMtime(r.mtimeMs); from = 'mtime'; } }
    else if (source === 'birthtime') p = fromMtime(r.birthtimeMs || r.mtimeMs);
    else p = fromMtime(r.mtimeMs);
    const f = format(p, kind);
    return { id: r.id, date: f.date, time: withTime ? (f.time ?? null) : null, from };
  });
  return { results };
}
