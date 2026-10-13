import { toAscii } from './bwf.js';

// Find / replace and clean-up applied to the values of one column. Pure: a value goes in, a value comes out.
//   { type: 'find', find, replace, regex, caseSensitive, wholeWord }
//   { type: 'trim' | 'spaces' | 'upper' | 'lower' | 'title' | 'sentence' | 'ascii' | 'accents' }
export const CLEAN = ['trim', 'spaces', 'upper', 'lower', 'title', 'sentence', 'ascii', 'accents'];
export const MAX_FIND = 200;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// -> { fn } or { error }
export function compileOp(op) {
  if (!op || typeof op !== 'object') return { error: 'bad-op' };
  if (op.type === 'find') {
    const find = String(op.find ?? '');
    if (!find) return { error: 'find-empty' };
    if (find.length > MAX_FIND) return { error: 'find-long' };
    let src = op.regex ? find : escapeRe(find);
    if (op.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    let re;
    try { re = new RegExp(src, `g${op.caseSensitive ? '' : 'i'}u`); } catch { return { error: 'bad-regex' }; }
    // plain text: "$" in the replacement means a dollar sign; with a pattern it keeps its regular meaning ($1, $&)
    const rep = String(op.replace ?? '');
    return { fn: (v) => (op.regex ? v.replace(re, rep) : v.replace(re, () => rep)) };
  }
  switch (op.type) {
    case 'trim': return { fn: (v) => v.trim() };
    case 'spaces': return { fn: (v) => v.replace(/[ \t ]+/g, ' ').trim() };
    case 'upper': return { fn: (v) => v.toUpperCase() };
    case 'lower': return { fn: (v) => v.toLowerCase() };
    case 'title': return { fn: (v) => v.toLowerCase().replace(/(^|[\s\-/(["“])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) };
    case 'sentence': return { fn: (v) => { const l = v.toLowerCase(); return l.replace(/\p{L}/u, (c) => c.toUpperCase()); } };
    case 'ascii': return { fn: (v) => toAscii(v) };
    case 'accents': return { fn: (v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC') };
    default: return { error: 'bad-op' };
  }
}

// values: [string]. -> { values: [string], changed: n } or { error }
export function applyToValues(values, op) {
  const c = compileOp(op);
  if (c.error) return { error: c.error };
  let changed = 0;
  const out = values.map((v) => { const n = c.fn(String(v ?? '')); if (n !== v) changed++; return n; });
  return { values: out, changed };
}
