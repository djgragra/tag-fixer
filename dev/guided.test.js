// 26.10.2: settings, backup, guided update, logs, the repository pointer. Same checks as the other OnAir Garage apps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, createStore, MAX_PRESETS } from '../src/settings.js';
import { buildExport, prepareImport, backupFileName } from '../src/backup.js';
import { checkForUpdate, downloadInstaller, pickInstaller, isNewer, bannerState, remindLaterState, skipVersionState, makeSafetyCopy, installPlan, whatsNew, startupKind, releaseNotesSummary } from '../src/updater.js';
import { createLogger, LOG_FILE_RE } from '../src/logger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'tf-g-'));

// ---- settings and backup ----------------------------------------------------------------------------

const sample = () => sanitizeSettings({
  language: 'it', theme: 'dark', recursive: true, checkUpdates: false, tab: 'wav', wavSet: 'cart', backupDir: '/data/backups', lastSeenVersion: '26.10.1',
  updateState: { skipVersion: '26.10.9', remindUntil: 5, lastCheck: { at: 1, ok: true, error: '' } },
  presets: [{ id: 'a1', name: 'Artist - Title', kind: 'read', pattern: '{artist} - {title}' }, { id: 'a2', name: 'Name from tags', kind: 'rename', pattern: '{n:2} {artist}' }]
}, { defaultBackupDir: '/home/me/TagFixer Backups' });

test('settings: defaults, the app opens in English, bad values fall back', () => {
  const d = sanitizeSettings({}, { defaultBackupDir: '/b' });
  assert.deepEqual([d.language, d.theme, d.checkUpdates, d.tab, d.wavSet, d.backupDir, d.recursive, d.logRetentionDays], ['en', 'auto', true, 'mp3', 'bwf', '/b', false, 7]);
  const bad = sanitizeSettings({ language: 'fr', theme: 'x', tab: 'ogg', wavSet: 9, backupDir: 'relative/path', logRetentionDays: 500, presets: [{ kind: 'zzz', name: 'x', pattern: 'y' }, null, { kind: 'fill', name: '', pattern: 'y' }] }, { defaultBackupDir: '/b' });
  assert.deepEqual([bad.language, bad.theme, bad.tab, bad.wavSet, bad.backupDir, bad.logRetentionDays, bad.presets.length], ['en', 'auto', 'mp3', 'bwf', '/b', 7, 0]);
  // an old settings.json had only the backup folder
  assert.equal(sanitizeSettings({ backupDir: '/old' }).backupDir, '/old');
  const many = sanitizeSettings({ presets: Array.from({ length: 80 }, (_, i) => ({ id: 'p' + i, name: 'n' + i, kind: 'fill', pattern: '{title}' })) });
  assert.equal(many.presets.length, MAX_PRESETS);
  const dup = sanitizeSettings({ presets: [{ id: 'same', name: 'a', kind: 'fill', pattern: 'x' }, { id: 'same', name: 'b', kind: 'fill', pattern: 'y' }] });
  assert.notEqual(dup.presets[0].id, dup.presets[1].id);
});

test('store: written after a change, read back, flush writes at once; an old file is accepted', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'settings.json');
  await fs.writeFile(file, JSON.stringify({ backupDir: '/old/place' }));
  const s = createStore(file, { defaultBackupDir: '/x', delay: 5 });
  assert.equal(s.hadFile, true);
  assert.equal(s.get().backupDir, '/old/place');
  s.update({ language: 'es', presets: sample().presets });
  s.flush();
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(raw.language, 'es');
  assert.equal(raw.presets.length, 2);
  assert.equal(createStore(file).get().language, 'es');
  assert.equal(createStore(path.join(dir, 'none.json')).hadFile, false);
});

test('backup: the file has the common shape, nothing that stays on this PC, no secrets', () => {
  const s = sample();
  const f = buildExport(s, { now: Date.UTC(2026, 9, 13) });
  assert.equal(f.app, 'tag-fixer');
  assert.equal(f.version, 1);
  assert.equal(f.exportedAt, '2026-10-13T00:00:00.000Z');
  assert.equal(f.includesSecrets, false);
  assert.equal(f.emptiedSecrets, undefined);
  assert.equal(backupFileName(Date.UTC(2026, 9, 13)), 'tag-fixer-backup-2026-10-13.json');
  for (const k of ['lastSeenVersion', 'updateState', 'backupDir', 'migrated', 'presets']) assert.ok(!(k in f.settings), k);
  assert.equal(f.settings.language, 'it');
  assert.equal(f.presets.length, 2);
});

test('backup import: replace takes settings and presets, keeps this PC\'s own memory and backup folder', () => {
  const file = buildExport(sample());
  const cur = sanitizeSettings({ language: 'en', lastSeenVersion: '26.10.2', backupDir: '/mine' });
  const r = prepareImport(JSON.stringify(file), cur);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.settings.language, 'it');
  assert.equal(r.settings.wavSet, 'cart');
  assert.equal(r.settings.presets.length, 2);
  assert.equal(r.settings.backupDir, '/mine');
  assert.equal(r.settings.lastSeenVersion, '26.10.2');
});

test('backup import: add-only adds the presets this PC does not have and touches nothing else; wrong files refused', () => {
  const file = buildExport(sample());
  const cur = sanitizeSettings({ language: 'es', presets: [{ id: 'a1', name: 'Artist - Title', kind: 'read', pattern: '{artist} - {title}' }] });
  const r = prepareImport(file, cur, { mode: 'add' });
  assert.equal(r.added, 1);
  assert.equal(r.settings.language, 'es');
  assert.deepEqual(r.settings.presets.map((p) => p.name), ['Artist - Title', 'Name from tags']);
  assert.equal(prepareImport(file, r.settings, { mode: 'add' }).added, 0);
  // same content under another id is not added twice
  const other = structuredClone(file); other.presets[0].id = 'zzz';
  assert.equal(prepareImport(other, cur, { mode: 'add' }).added, 1);
  assert.equal(prepareImport({ app: 'g-clock', settings: {} }, cur).error, 'wrong-app');
  assert.equal(prepareImport('{nope', cur).error, 'invalid');
  assert.equal(prepareImport('x'.repeat(2_100_000), cur).error, 'too-big');
  assert.equal(prepareImport({ app: 'tag-fixer' }, cur).error, 'invalid');
});

// ---- guided update -------------------------------------------------------------------------------------

const asset = (name, size = 3) => ({ name, size, browser_download_url: `https://github.com/djgragra/tag-fixer/releases/download/v26.10.2/${name}` });
function releaseFetch({ body = 'payload', sums, status = 200 } = {}) {
  const bytes = Buffer.from(body);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.includes('api.github.com')) {
      return { ok: status === 200, status, json: async () => ({ tag_name: 'v26.10.2', body: '## What\n- one\n- two', assets: [asset('Tag-Fixer-Setup-26.10.2.exe'), asset('Tag-Fixer-26.10.2-arm64.dmg'), asset('Tag-Fixer-26.10.2-x64.dmg'), asset('Tag-Fixer-26.10.2.AppImage'), asset('SHA256SUMS.txt'), { name: 'evil.exe', browser_download_url: 'https://evil.test/evil.exe' }] }) };
    }
    if (url.endsWith('SHA256SUMS.txt')) return { ok: true, status: 200, text: async () => `${sums ?? sha}  Tag-Fixer-Setup-26.10.2.exe\n` };
    return { ok: true, status: 200, headers: new Map([['content-length', String(bytes.length)]]), body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
  };
  return { fn, calls };
}

test('updater: finds the release, the installer of this system and never follows foreign URLs', async () => {
  const { fn } = releaseFetch();
  const info = await checkForUpdate({ current: '26.10.1', fetchFn: fn });
  assert.equal(info.ok, true);
  assert.equal(info.available, true);
  assert.equal(info.latest, '26.10.2');
  assert.equal(info.notes, 'What\none\ntwo');
  assert.equal(info.url, 'https://github.com/djgragra/tag-fixer/releases/tag/v26.10.2');
  const all = [asset('Tag-Fixer-Setup-26.10.2.exe'), asset('Tag-Fixer-26.10.2-arm64.dmg'), asset('Tag-Fixer-26.10.2-x64.dmg'), asset('Tag-Fixer-26.10.2.AppImage')];
  assert.equal(info.installer?.name, pickInstaller(all)?.name);
  assert.equal(pickInstaller(all, 'win32', 'x64').name, 'Tag-Fixer-Setup-26.10.2.exe');
  assert.equal(pickInstaller(all, 'darwin', 'arm64').name, 'Tag-Fixer-26.10.2-arm64.dmg');
  assert.equal(pickInstaller(all, 'darwin', 'x64').name, 'Tag-Fixer-26.10.2-x64.dmg');
  assert.equal(pickInstaller(all, 'linux', 'arm64'), null);
  assert.equal((await checkForUpdate({ current: '26.10.2', fetchFn: fn })).available, false);
  assert.equal((await checkForUpdate({ current: '26.11.1', fetchFn: fn })).available, false);
  assert.equal(isNewer('26.10.2', '26.10.1'), true);
  assert.equal((await checkForUpdate({ current: '1', fetchFn: async () => ({ ok: false, status: 404 }) })).noRelease, true);
});

test('updater: the download is checked against SHA256SUMS.txt; a wrong hash or a broken download leaves nothing', async () => {
  const dir = await tmp();
  const ok = releaseFetch();
  const info = { installer: { name: 'Tag-Fixer-Setup-26.10.2.exe', url: 'https://github.com/djgragra/tag-fixer/releases/download/v26.10.2/Tag-Fixer-Setup-26.10.2.exe', size: 7 }, sumsUrl: 'https://github.com/x/SHA256SUMS.txt' };
  const seen = [];
  const file = await downloadInstaller({ info, dir, fetchFn: ok.fn, current: '1', onProgress: (a, b) => seen.push([a, b]) });
  assert.equal(await fs.readFile(file, 'utf8'), 'payload');
  assert.deepEqual(seen.at(-1), [7, 7]);
  await assert.rejects(downloadInstaller({ info, dir: path.join(dir, 'b'), fetchFn: releaseFetch({ sums: 'a'.repeat(64) }).fn, current: '1' }), /checksum-mismatch/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'b')), []);
  await assert.rejects(downloadInstaller({ info: { installer: info.installer }, dir, fetchFn: ok.fn, current: '1' }), /no-checksums/);
  const broken = async (url) => (url.endsWith('SHA256SUMS.txt') ? ok.fn(url) : { ok: true, status: 200, headers: new Map(), body: new ReadableStream({ start(c) { c.enqueue(Buffer.from('ab')); c.error(new Error('connection lost')); } }) });
  await assert.rejects(downloadInstaller({ info, dir: path.join(dir, 'c'), fetchFn: broken, current: '1' }), /connection lost/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'c')), []);
});

test('updater: remind later (24 h), skip this version (until a newer one), nothing when equal', () => {
  const info = { ok: true, available: true, latest: '26.10.2' };
  const t0 = 1_000_000;
  assert.equal(bannerState(info, {}, t0), 'show');
  const later = remindLaterState({}, t0);
  assert.equal(bannerState(info, later, t0 + 3_600_000), 'snoozed');
  assert.equal(bannerState(info, later, t0 + 86_400_001), 'show');
  const skipped = skipVersionState({}, '26.10.2');
  assert.equal(bannerState(info, skipped, t0), 'skipped');
  assert.equal(bannerState({ ...info, latest: '26.10.3' }, skipped, t0), 'show');
  assert.equal(bannerState({ ok: true, available: false }, {}, t0), 'none');
  assert.equal(bannerState({ ok: false }, {}, t0), 'none');
});

test('safety copy before the install: a plain copy of the settings file, the last 3 are kept', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'settings.json');
  await fs.writeFile(file, '{"language":"it"}');
  const out = path.join(dir, 'backups');
  for (const v of ['26.10.6', '26.10.7', '26.10.8', '26.10.9']) {
    const target = makeSafetyCopy({ file, dir: out, version: v });
    assert.equal(await fs.readFile(target, 'utf8'), '{"language":"it"}');
    const d = new Date(Date.UTC(2026, 9, Number(v.split('.')[2])));
    await fs.utimes(target, d, d);
  }
  assert.deepEqual((await fs.readdir(out)).sort(), ['pre-update-26.10.7.json', 'pre-update-26.10.8.json', 'pre-update-26.10.9.json']);
  assert.equal(makeSafetyCopy({ file: path.join(dir, 'missing.json'), dir: out, version: 'x' }), null);
});

test('install plan per system, what\'s new from the changelog, first start after an update', async () => {
  assert.deepEqual(installPlan('win32', 'C:\\x\\a.exe'), { kind: 'run-installer', file: 'C:\\x\\a.exe', quit: true });
  assert.equal(installPlan('darwin', '/a.dmg').kind, 'open-image');
  assert.equal(installPlan('linux', '/a.AppImage').kind, 'reveal');
  const log = '# Changelog\n\n## 26.10.2 — 2026-10-13\n\n- **A**: first.\n- B second.\n\n## 26.10.1 — 2026-10-01\n\n- old\n';
  assert.deepEqual(whatsNew(log, '26.10.2'), { version: '26.10.2', date: '2026-10-13', bullets: ['**A**: first.', 'B second.'] });
  assert.equal(whatsNew(log, '26.10.3'), null);
  assert.equal(startupKind('', '26.10.2', false), 'first');
  assert.equal(startupKind('', '26.10.2', true), 'updated'); // the previous version did not remember anything
  assert.equal(startupKind('26.10.1', '26.10.2'), 'updated');
  assert.equal(startupKind('26.10.2', '26.10.2'), 'same');
  assert.equal(releaseNotesSummary('# T\n\n- a\n- b', 1), 'T');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const real = whatsNew(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), pkg.version);
  assert.ok(real && real.bullets.length > 0, `CHANGELOG.md has no entry for ${pkg.version}`);
  assert.ok(pkg.build.files.includes('CHANGELOG.md'), 'the changelog is packaged with the app');
});

// ---- logs ----------------------------------------------------------------------------------------------

test('logs: one file per day, a file that reaches the limit is closed and a new one starts, old days are removed', async () => {
  const dir = await tmp();
  let day = new Date(2026, 9, 13, 12, 0, 0);
  const log = createLogger({ dir, retentionDays: 7, maxBytes: 200, now: () => day });
  for (let i = 0; i < 12; i++) log.log('info', `line number ${i} ${'x'.repeat(40)}`);
  await log.flush();
  const names = (await fs.readdir(dir)).sort();
  assert.ok(names.every((n) => LOG_FILE_RE.test(n)), names.join());
  assert.ok(names.includes('tag-fixer_13-10-2026.log'));
  assert.ok(names.length >= 2 && names.length <= 4, `${names.length} files for one day`);
  for (const n of names) assert.ok((await fs.stat(path.join(dir, n))).size <= 400, n);
  day = new Date(2026, 9, 25, 12, 0, 0);
  assert.ok(log.prune() >= 1);
  assert.deepEqual(await fs.readdir(dir), []);
});

// ---- the repository points to the hub ------------------------------------------------------------------

test('CLAUDE.md points to the hub and is not ignored by git; shared modules carry their garage-common line', async () => {
  const text = await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(text, /djgragra\/garage-hub/);
  assert.ok(!/^CLAUDE\.md$/m.test(await fs.readFile(path.join(root, '.gitignore'), 'utf8')));
  for (const [file, name] of [['updater.js', 'updater'], ['backup.js', 'backup'], ['logger.js', 'logger']]) {
    assert.match((await fs.readFile(path.join(root, 'src', file), 'utf8')).split('\n')[0], new RegExp(`^// garage-common: ${name} \\d+$`), file);
  }
});

// ---- macOS: ad-hoc signature ---------------------------------------------------------------------------

test('macOS: the ad-hoc signature hook is wired into the build and only acts on a Mac app', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.afterPack, 'dev/sign-adhoc.cjs');
  await fs.access(path.join(root, pkg.build.afterPack));
  const { createRequire } = await import('node:module');
  const hook = createRequire(import.meta.url)('./sign-adhoc.cjs').default;
  assert.equal(await hook({ electronPlatformName: 'win32' }), undefined);
  assert.equal(await hook({ electronPlatformName: 'linux' }), undefined);
  const wf = await fs.readFile(path.join(root, '.github/workflows/build-installers.yml'), 'utf8');
  assert.match(wf, /codesign --verify --deep --strict/, 'the workflow checks the apps inside the disk images');
});
