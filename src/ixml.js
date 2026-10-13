// iXML chunk (the XML text a field recorder or editor puts in a WAV file). Only a handful of
// top-level elements are edited: PROJECT, SCENE, TAPE, TAKE, NOTE. Everything else in the text
// (track lists, user data, sync points, comments, the XML declaration) is kept character for character.
// Pure: strings in, strings out. Written without an XML library on purpose: the text is cut and
// pasted at the exact places, nothing is re-serialised.
export const FIELD_NAMES = ['ixmlProject', 'ixmlScene', 'ixmlTape', 'ixmlTake', 'ixmlNote'];
const ELEMENT = { ixmlProject: 'PROJECT', ixmlScene: 'SCENE', ixmlTape: 'TAPE', ixmlTake: 'TAKE', ixmlNote: 'NOTE' };
const ORDER = ['IXML_VERSION', 'PROJECT', 'SCENE', 'TAPE', 'TAKE'];
export const MAX_BYTES = 8 << 20;
const MAX_LEN = { ixmlProject: 256, ixmlScene: 256, ixmlTape: 256, ixmlTake: 64, ixmlNote: 8192 };
export const NEW_VERSION = '1.5';

export function validateField(name, value) {
  const v = String(value ?? '');
  if (!ELEMENT[name]) return 'unknown-field';
  if (v === '') return null;
  // XML 1.0 does not allow control characters; the note may have line breaks
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/.test(v)) return 'invalid-char';
  if (name !== 'ixmlNote' && /[\r\n]/.test(v)) return 'no-newline';
  if (v.length > MAX_LEN[name]) return 'too-long';
  return null;
}
export const limitOf = (name) => MAX_LEN[name];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()];
  });
}
export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A small scanner that only follows the tags: returns the direct children of the root element
// with the positions of their text. { ok, root, children: [{ name, start, end, innerStart, innerEnd, simple, selfClosing }] }
export function scan(text) {
  let i = 0;
  const n = text.length;
  const stack = [];
  const children = [];
  let root = null;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e === -1) return { ok: false, error: 'xml' }; i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e === -1) return { ok: false, error: 'xml' }; i = e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); if (e === -1) return { ok: false, error: 'xml' }; i = e + 2; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt + 2); if (e === -1) return { ok: false, error: 'xml' }; i = e + 1; continue; }
    // a tag: find its end, skipping quoted attribute values
    let j = lt + 1;
    let quote = '';
    for (; j < n; j++) {
      const c = text[j];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (j >= n) return { ok: false, error: 'xml' };
    const raw = text.slice(lt + 1, j);
    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (!open || open.name !== name) return { ok: false, error: 'xml' };
      open.innerEnd = lt;
      open.end = j + 1;
      if (!stack.length) { root.end = j + 1; root.innerEnd = lt; }
    } else {
      const selfClosing = raw.endsWith('/');
      const name = /^[^\s/>]+/.exec(raw)?.[0];
      if (!name) return { ok: false, error: 'xml' };
      const el = { name, start: lt, innerStart: j + 1, innerEnd: j + 1, end: j + 1, selfClosing, simple: true };
      if (!stack.length) {
        if (root) return { ok: false, error: 'xml' }; // second root element
        root = el;
      } else {
        stack[stack.length - 1].simple = false;
        if (stack.length === 1) children.push(el);
      }
      if (!selfClosing) stack.push(el);
    }
    i = j + 1;
  }
  if (stack.length || !root) return { ok: false, error: 'xml' };
  return { ok: true, root, children };
}

// text: the chunk as a string. -> { ok, fields, complex: { ixmlNote: true, … }, error }
export function parseIxml(text) {
  const empty = Object.fromEntries(FIELD_NAMES.map((f) => [f, '']));
  const s = scan(text);
  if (!s.ok) return { ok: false, error: s.error, fields: empty, complex: {} };
  if (s.root.name !== 'BWFXML') return { ok: false, error: 'not-ixml', fields: empty, complex: {} };
  const fields = { ...empty };
  const complex = {};
  for (const f of FIELD_NAMES) {
    const els = s.children.filter((c) => c.name === ELEMENT[f]);
    if (!els.length) continue;
    const el = els[0];
    if (els.length > 1) complex[f] = 'ixml-several';
    if (!el.simple) { complex[f] = 'ixml-complex'; continue; }
    let inner = text.slice(el.innerStart, el.innerEnd);
    const cd = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(inner);
    inner = cd ? cd[1] : unescapeXml(inner);
    fields[f] = inner;
  }
  return { ok: true, fields, complex };
}

// changes: { ixmlNote: 'text', … } ('' removes the element). Returns the new text.
export function applyIxml(text, changes) {
  let out = text;
  for (const [name, value] of Object.entries(changes)) {
    const tag = ELEMENT[name];
    if (!tag) throw Object.assign(new Error(name), { code: 'unknown-field' });
    const err = validateField(name, value);
    if (err) throw Object.assign(new Error(`${name}: ${err}`), { code: err });
    const s = scan(out);
    if (!s.ok) throw Object.assign(new Error('xml'), { code: 'ixml-bad-xml' });
    if (s.root.name !== 'BWFXML') throw Object.assign(new Error('not-ixml'), { code: 'ixml-bad-xml' });
    const el = s.children.find((c) => c.name === tag);
    if (el) {
      if (!el.simple) throw Object.assign(new Error(name), { code: 'ixml-complex' });
      if (value === '') {
        // take the line with it: the white space before the element and the line break after it
        let a = el.start;
        while (a > 0 && (out[a - 1] === ' ' || out[a - 1] === '\t')) a--;
        let b = el.end;
        if (out[b] === '\r') b++;
        if (out[b] === '\n') b++;
        if (a > 0 && out[a - 1] !== '\n' && b === el.end) a = el.start; // inline element: only itself
        out = out.slice(0, a) + out.slice(b);
      } else {
        out = out.slice(0, el.innerStart) + escapeXml(value) + out.slice(el.innerEnd);
        if (el.selfClosing) out = out.slice(0, el.start) + `<${tag}>${escapeXml(value)}</${tag}>` + out.slice(el.end);
      }
      continue;
    }
    if (value === '') continue;
    // insert after the nearest earlier element (IXML_VERSION, PROJECT, SCENE, TAPE, TAKE), else first in the root
    const rank = ORDER.indexOf(tag);
    let anchor = null;
    if (tag === 'NOTE') anchor = [...s.children].reverse().find((c) => ORDER.includes(c.name)) || null;
    else for (let k = rank - 1; k >= 0 && !anchor; k--) anchor = s.children.find((c) => c.name === ORDER[k]) || null;
    const nl = out.includes('\r\n') ? '\r\n' : '\n';
    const indent = (() => {
      const first = s.children[0];
      if (!first) return '  ';
      const lineStart = out.lastIndexOf('\n', first.start) + 1;
      const pre = out.slice(lineStart, first.start);
      return /^[ \t]*$/.test(pre) ? pre : '  ';
    })();
    const piece = `${indent}<${tag}>${escapeXml(value)}</${tag}>`;
    if (anchor) {
      const at = anchor.end;
      out = out.slice(0, at) + nl + piece + out.slice(at);
    } else if (s.root.selfClosing) {
      out = out.slice(0, s.root.start) + `<${s.root.name}>${nl}${piece}${nl}</${s.root.name}>` + out.slice(s.root.end);
    } else {
      const at = s.root.innerStart;
      out = out.slice(0, at) + nl + piece + out.slice(at);
    }
  }
  return out;
}

export function newIxml(changes) {
  const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<BWFXML>', `  <IXML_VERSION>${NEW_VERSION}</IXML_VERSION>`, '</BWFXML>'].join('\n') + '\n';
  return applyIxml(body, changes);
}

// The bytes of an iXML chunk: UTF-8 text, a trailing NUL is dropped, a BOM is kept as it was.
export function decodeChunk(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, end)); } catch { return { ok: false, error: 'ixml-encoding' }; }
  const decl = /^﻿?\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(text);
  if (decl && !/^utf-?8$/i.test(decl[1])) return { ok: false, error: 'ixml-encoding' };
  return { ok: true, text };
}
export const encodeChunk = (text) => Buffer.from(text, 'utf8');
