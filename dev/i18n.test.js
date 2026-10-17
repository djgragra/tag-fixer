import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer', 'i18n.js'), 'utf8'), ctx);
const { STRINGS, LANGS, make } = ctx.I18N;
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('the same keys in English, Italian and Spanish, and the same {placeholders}', () => {
  assert.deepEqual(Object.keys(LANGS), ['en', 'it', 'es']);
  const en = Object.keys(STRINGS.en).sort();
  for (const l of ['it', 'es']) {
    assert.deepEqual(Object.keys(STRINGS[l]).sort(), en, l);
    for (const k of en) {
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      // the help texts quote patterns such as {artist} - {title}: only compare short UI strings
      if (!k.startsWith('help.') && !k.startsWith('pat.hint')) assert.equal(ph(STRINGS[l][k]), ph(STRINGS.en[k]), `${l} ${k}`);
    }
  }
  for (const l of Object.keys(STRINGS)) for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(v && v.trim(), `${l} ${k} is empty`);
});

test('every key the window uses exists (static keys, and the families built from a code)', () => {
  const keys = new Set([...app.matchAll(/\bt\("([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => !k.endsWith('.') && !(k in STRINGS.en));
  assert.deepEqual(missing, []);
  // families: the code is only known at run time, so every code the engine can return must have its text
  const families = {
    'err.': ['non-ascii', 'too-long', 'bad-date', 'bad-time', 'bad-year', 'bad-track', 'invalid-char', 'no-newline', 'bad-cover', 'cover-missing', 'cover-format', 'cover-too-big', 'verify-failed', 'backup-failed', 'missing', 'changed', 'no-backup', 'name-taken', 'name-empty', 'name-chars', 'name-end', 'name-long', 'name-reserved', 'name-ext', 'name-duplicate', 'fields-empty', 'rename-failed', 'EACCES', 'EPERM', 'ENOENT', 'EBUSY', 'ENOSPC', 'EEXIST', 'frame-too-big', 'vorbis-too-big', 'unknown-field'],
    'ro.': ['truncated', 'bext-short', 'no-fmt', 'too-big', 'rf64-bad', 'not-wav', 'not-flac', 'flac-bad', 'vorbis-corrupt', 'unsync', 'tag-corrupt', 'tag-garbage', 'tag-compressed', 'frame-flags', 'unsupported', 'unreadable', 'read-only', 'history-big', 'ixml-bad-xml', 'ixml-not-ixml', 'ixml-complex', 'ixml-several', 'ixml-encoding', 'ixml-too-big', 'cart-short'],
    'warn.': ['riff-truncated', 'chunk-truncated', 'trailing-data', 'no-fmt', 'several-bext', 'several-ixml', 'several-cart', 'several-vorbis', 'bext-short'],
    'pat.err.': ['empty', 'too-long', 'unclosed', 'bad-token', 'unknown-token', 'unknown-filter', 'no-field', 'ambiguous', 'not-readable', 'nothing-to-read', 'no-match'],
    'find.err.': ['bad-regex', 'find-empty', 'find-long', 'bad-op'],
    'csv.err.': ['too-big', 'too-many-rows', 'bad-quotes', 'empty', 'no-key-column', 'no-known-columns', 'unreadable'],
    'cfg.err.': ['invalid', 'wrong-app', 'too-big', 'unreadable', 'no-file'],
    'date.from.': ['name', 'mtime', 'birthtime'],
    'check.sev.': ['error', 'warn', 'info'],
    'pat.hint.': ['fill', 'read', 'rename']
  };
  const miss = [];
  for (const [prefix, codes] of Object.entries(families)) for (const c of codes) if (!((prefix + c) in STRINGS.en)) miss.push(prefix + c);
  assert.deepEqual(miss, []);
});

test('texts for every field column and every check code', async () => {
  const { FIELD_NAMES: wav } = await import('../src/bwf.js');
  const { FIELD_NAMES: id3 } = await import('../src/id3.js');
  const { FIELD_NAMES: flac } = await import('../src/flac.js');
  const { CODES } = await import('../src/checks.js');
  const miss = [...new Set([...wav, ...id3, ...flac])].filter((f) => !(`col.${f}` in STRINGS.en)).map((f) => `col.${f}`);
  for (const c of CODES) if (!(`chk.${c}` in STRINGS.en)) miss.push(`chk.${c}`);
  assert.deepEqual(miss, []);
});

test('plural form and placeholders', () => {
  const t = make('en');
  assert.equal(t('pill.edit', { n: 3 }), '3 to save');
  assert.equal(t('nonexistent.key'), 'nonexistent.key');
  assert.equal(make('it')('sum.files', { n: 2 }), 'file: 2');
});

test('every error code the engine can throw has a text', async () => {
  // codes found in the source of the engine: code: 'xyz' and { code: 'xyz' }
  const files = ['bwf.js', 'id3.js', 'flac.js', 'batch.js', 'ixml.js', 'cart.js'];
  const codes = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    for (const m of src.matchAll(/code: '([\w.-]+)'/g)) codes.add(m[1]);
    for (const m of src.matchAll(/return '([a-z][\w.-]+-[\w.-]+)'/g)) codes.add(m[1]);
  }
  const known = (c) => ['err', 'ro', 'warn'].some((g) => `${g}.${c}` in STRINGS.en);
  const missing = [...codes].filter((c) => !known(c) && !['unknown-field', 'tag-corrupt'].includes(c));
  assert.deepEqual(missing, []);
});

test('tip jar box: text, button and the support page in the app\'s language; the link is allowed to open; the image ships', () => {
  const urls = { en: 'https://onairgarage.com/support/', it: 'https://onairgarage.com/it/support/', es: 'https://onairgarage.com/es/support/' };
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const allowed = new RegExp(main.match(/const EXTERNAL_OK = \/(.*)\/;/)[1]);
  for (const l of ['en', 'it', 'es']) {
    assert.equal(STRINGS[l]['about.tipUrl'], urls[l]);
    assert.match(STRINGS[l]['about.tip'], /\S/);
    assert.match(STRINGS[l]['about.tipBtn'], /\S/);
    assert.ok(allowed.test(urls[l]), `${l} link is allowed by EXTERNAL_OK`);
  }
  assert.ok(html.includes('id="aboutTip"') && html.includes('src="img/tip-jar.png"'));
  assert.ok(app.includes('api.openExternal(t("about.tipUrl"))'));
  assert.ok(fs.existsSync(path.join(root, 'renderer', 'img', 'tip-jar.png')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files.includes('renderer/**/*'));
});
