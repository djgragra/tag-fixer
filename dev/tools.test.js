import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplate, renderTemplate, extractFromName } from '../src/patterns.js';
import { applyToValues, compileOp } from '../src/textops.js';
import { fromName, fromMtime, format } from '../src/datefile.js';
import { toCsv, parseCsv, planImport } from '../src/csv.js';
import { runChecks } from '../src/checks.js';

const KNOWN = ['title', 'artist', 'album', 'description', 'originator'];
const ctx = (over = {}) => ({ fields: { title: 'Song', artist: 'Band', album: 'LP' }, name: 'My Song.mp3', folder: 'Jingles', index: 4, startAt: 1, mtimeMs: new Date(2026, 9, 13, 8, 30, 5).getTime(), now: new Date(2026, 9, 14).getTime(), ...over });

test('pattern: fields, file name, folder, counter, dates, filters', () => {
  const r = (p, c = ctx()) => renderTemplate(p, c, KNOWN);
  assert.equal(r('{artist} - {title}').value, 'Band - Song');
  assert.equal(r('{filename}').value, 'My Song');
  assert.equal(r('{ext}|{folder}').value, 'mp3|Jingles');
  assert.equal(r('{n}').value, '5');
  assert.equal(r('{n:3}_{title|upper}').value, '005_SONG');
  assert.equal(r('{mdate} {mtime}').value, '2026-10-13 08-30-05');
  assert.equal(r('{today}').value, '2026-10-14');
  assert.equal(r('{filename|lower|nospace}').value, 'mysong');
  assert.equal(r('{title|title}', ctx({ fields: { title: 'the DARK side' } })).value, 'The Dark Side');
  assert.equal(r('{title|ascii}', ctx({ fields: { title: 'Perché' } })).value, 'Perche');
  assert.equal(r('no tokens').value, 'no tokens');
  assert.equal(r('{n}', ctx({ startAt: 10, index: 0 })).value, '10');
});

test('pattern: errors', () => {
  assert.equal(parseTemplate('{nope}', KNOWN).error, 'unknown-token');
  assert.equal(parseTemplate('{title', KNOWN).error, 'unclosed');
  assert.equal(parseTemplate('title}', KNOWN).error, 'unclosed');
  assert.equal(parseTemplate('{title|shout}', KNOWN).error, 'unknown-filter');
  assert.equal(parseTemplate('{title:3}', KNOWN).error, 'bad-token');
  assert.equal(parseTemplate('x'.repeat(400), KNOWN).error, 'too-long');
});

test('pattern: reading fields out of a file name', () => {
  const e = (p, n) => extractFromName(p, n, KNOWN);
  assert.deepEqual(e('{artist} - {title}', 'Band - Song - Live').values, { artist: 'Band', title: 'Song - Live' });
  assert.deepEqual(e('{n} {artist} - {title}', '07 Band - Song').values, { artist: 'Band', title: 'Song' });
  assert.deepEqual(e('{title|title}', 'the DARK side').values, { title: 'The Dark Side' });
  assert.equal(e('{artist} - {title}', 'no separator here').values, null);
  assert.equal(e('{artist}{title}', 'ab').error, 'ambiguous');
  assert.equal(e('{folder}', 'x').error, 'not-readable');
  assert.equal(e('{n}', '1').error, 'nothing-to-read');
  assert.deepEqual(e('({album}) {title}', '(LP) Song').values, { album: 'LP', title: 'Song' });
});

test('textops: find / replace, regex, whole word, case, clean-ups', () => {
  const f = (values, op) => applyToValues(values, op);
  assert.deepEqual(f(['a.b.c'], { type: 'find', find: '.', replace: '-' }).values, ['a-b-c']);
  assert.deepEqual(f(['Cost $5'], { type: 'find', find: '$5', replace: '$$' }).values, ['Cost $$'], 'plain text: $ is a dollar');
  assert.deepEqual(f(['Hello hello'], { type: 'find', find: 'hello', replace: 'x' }).values, ['x x']);
  assert.deepEqual(f(['Hello hello'], { type: 'find', find: 'hello', replace: 'x', caseSensitive: true }).values, ['Hello x']);
  assert.deepEqual(f(['cat concat cat.'], { type: 'find', find: 'cat', replace: 'dog', wholeWord: true }).values, ['dog concat dog.']);
  assert.deepEqual(f(['2026-10-13'], { type: 'find', find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3/$2/$1', regex: true }).values, ['13/10/2026']);
  assert.equal(compileOp({ type: 'find', find: '(', regex: true }).error, 'bad-regex');
  assert.equal(compileOp({ type: 'find', find: '' }).error, 'find-empty');
  assert.deepEqual(f(['  a   b  '], { type: 'spaces' }).values, ['a b']);
  assert.deepEqual(f(['  a '], { type: 'trim' }).values, ['a']);
  assert.deepEqual(f(['heLLo woRLD', 'ÈCCO'], { type: 'title' }).values, ['Hello World', 'Ècco']);
  assert.deepEqual(f(['heLLo woRLD'], { type: 'sentence' }).values, ['Hello world']);
  assert.deepEqual(f(['Perché è già'], { type: 'accents' }).values, ['Perche e gia']);
  assert.deepEqual(f(['x'], { type: 'upper' }).values, ['X']);
  const n = f(['a', 'A', 'b'], { type: 'lower' });
  assert.equal(n.changed, 1);
});

test('datefile: from the name in several shapes, from the modification time, formats', () => {
  assert.deepEqual(fromName('2026-10-13_0830_morning.wav'), { y: 2026, mo: 10, d: 13, h: 8, mi: 30, s: 0 });
  assert.deepEqual(fromName('20261013-083045.wav'), { y: 2026, mo: 10, d: 13, h: 8, mi: 30, s: 45 });
  assert.deepEqual(fromName('rec 13.10.2026 08.30.wav'), { y: 2026, mo: 10, d: 13, h: 8, mi: 30, s: 0 });
  assert.deepEqual(fromName('jingle_2026_10_13.wav'), { y: 2026, mo: 10, d: 13 });
  assert.equal(fromName('2026-13-45.wav'), null);
  assert.equal(fromName('track 12345.wav'), null);
  assert.deepEqual(fromName('2026-02-30 x 2026-02-28.wav'), { y: 2026, mo: 2, d: 28 }, 'skips an impossible date');
  assert.deepEqual(fromMtime(new Date(2026, 9, 13, 8, 30, 5).getTime()), { y: 2026, mo: 10, d: 13, h: 8, mi: 30, s: 5 });
  assert.deepEqual(format({ y: 2026, mo: 1, d: 5, h: 8, mi: 3, s: 0 }, 'bext'), { date: '2026-01-05', time: '08-03-00' });
  assert.deepEqual(format({ y: 2026, mo: 1, d: 5, h: 8, mi: 3, s: 0 }, 'cart'), { date: '2026/01/05', time: '08:03:00' });
  assert.equal(format({ y: 2026, mo: 1, d: 5 }).time, null);
});

test('csv: round trip with quotes, line breaks, delimiter, BOM, formula protection', () => {
  const rows = [['/a/x.mp3', 'He said "hi"', 'two\nlines', '=SUM(A1)', ' padded '], ['/a/y.mp3', 'a;b', 'a,b', '-5', '@x']];
  for (const d of [',', ';', '\t']) {
    const text = toCsv(['path', 'title', 'comment', 'album', 'artist'], rows, d);
    assert.equal(text.charCodeAt(0), 0xfeff);
    const p = parseCsv(text);
    assert.ok(p.ok);
    assert.equal(p.delimiter, d);
    assert.deepEqual(p.headers, ['path', 'title', 'comment', 'album', 'artist']);
    assert.deepEqual(p.rows, rows);
  }
  assert.ok(toCsv(['a'], [['=1+1']]).includes("'=1+1"));
  assert.equal(parseCsv('a,b\n"x').error, 'bad-quotes');
  assert.equal(parseCsv('').error, 'empty');
  assert.deepEqual(parseCsv('a;b\r\n1;2\r\n\r\n3;4').rows, [['1', '2'], ['3', '4']]);
});

test('csv import plan: by path, by unique file name, empty cells, unknown columns, ambiguity', () => {
  const files = [{ path: '/a/one.mp3', name: 'one.mp3' }, { path: '/a/two.mp3', name: 'two.mp3' }, { path: '/b/two.mp3', name: 'two.mp3' }];
  const known = ['title', 'artist'];
  const text = 'path,Title,artist,junk\n/a/one.mp3,T1,,x\n/zzz/none.mp3,T2,A2,x\n';
  const plan = planImport(parseCsv(text), { known, files });
  assert.deepEqual(plan.updates, [{ path: '/a/one.mp3', values: { title: 'T1' } }]);
  assert.deepEqual(plan.unmatched, ['/zzz/none.mp3']);
  assert.deepEqual(plan.columns, ['title', 'artist']);
  const clear = planImport(parseCsv(text), { known, files, emptyMeansClear: true });
  assert.deepEqual(clear.updates[0].values, { title: 'T1', artist: '' });
  const byName = planImport(parseCsv('file,title\none.mp3,A\ntwo.mp3,B\n'), { known, files });
  assert.deepEqual(byName.updates, [{ path: '/a/one.mp3', values: { title: 'A' } }]);
  assert.deepEqual(byName.ambiguous, ['two.mp3']);
  assert.equal(planImport(parseCsv('title\nx\n'), { known, files }).error, 'no-key-column');
  assert.equal(planImport(parseCsv('path,zzz\n/a/one.mp3,1\n'), { known, files }).error, 'no-known-columns');
});

test('checks: wav, mp3, flac and duplicates', () => {
  const NOW = new Date(2026, 9, 13).getTime();
  const files = [
    { id: 1, name: 'a.wav', kind: 'wav', ok: true, writable: true, fields: { description: '', originator: 'X', originatorReference: 'R1', date: '2030-01-01' }, meta: { hasBext: true, warnings: [] } },
    { id: 2, name: 'b.wav', kind: 'wav', ok: true, writable: true, fields: { description: 'd', originatorReference: 'R1', date: '2026-13-01' }, meta: { hasBext: true, warnings: [] } },
    { id: 3, name: 'c.wav', kind: 'wav', ok: true, writable: true, fields: {}, meta: { hasBext: false, warnings: ['riff-truncated'] } },
    { id: 4, name: 'd.mp3', kind: 'mp3', ok: true, writable: true, fields: { title: 'T', artist: 'A', album: 'Al ', year: 'abcd', cover: '' }, meta: { source: 'v2', version: '2.3', pictures: 0 } },
    { id: 5, name: 'e.mp3', kind: 'mp3', ok: true, writable: true, fields: { title: 't', artist: 'a ' }, meta: { source: 'none', pictures: 0 } },
    { id: 6, name: 'f.flac', kind: 'flac', ok: true, writable: false, fields: { title: '', artist: 'A' }, meta: {} },
    { id: 7, name: 'g.wav', kind: 'wav', ok: false, error: 'not-wav' }
  ];
  const r = runChecks(files, { now: NOW });
  const has = (id, code, severity) => r.some((x) => x.id === id && x.code === code && (!severity || x.severity === severity));
  assert.ok(has(1, 'empty-description', 'warn'));
  assert.ok(has(1, 'date-future', 'warn'));
  assert.ok(has(1, 'duplicate-reference') && has(2, 'duplicate-reference'));
  assert.ok(has(2, 'invalid-value', 'error'));
  assert.ok(has(3, 'no-bext') && has(3, 'damaged', 'error'));
  assert.ok(has(4, 'invalid-value', 'error') && has(4, 'spaces', 'info') && has(4, 'no-cover', 'info'));
  assert.ok(has(4, 'duplicate') && has(5, 'duplicate'), 'same title and artist, case and spaces ignored');
  assert.ok(has(5, 'no-tag'));
  assert.ok(has(6, 'read-only') && has(6, 'missing-title') && has(6, 'missing-album'));
  assert.ok(has(7, 'unreadable', 'error'));
  assert.ok(!has(2, 'empty-description'));
});
