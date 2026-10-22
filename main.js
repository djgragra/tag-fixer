import { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme, shell, net, Notification } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandPaths, readTags, preflight, applyBatch, checkRestore, runRestore, typeOf, checkRenames } from './src/batch.js';
import * as bwf from './src/bwf.js';
import * as id3 from './src/id3.js';
import * as flac from './src/flac.js';
import { patternJob, textJob, dateJob } from './src/toolops.js';
import { runChecks } from './src/checks.js';
import { toCsv, parseCsv, planImport } from './src/csv.js';
import { createStore, sanitizeSettings } from './src/settings.js';
import { buildExport, prepareImport, backupFileName } from './src/backup.js';
import { checkForUpdate, pageUrl, downloadInstaller, sweepPartials, bannerState, remindLaterState, skipVersionState, makeSafetyCopy, installPlan, whatsNew, startupKind } from './src/updater.js';
import { createLogger } from './src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERNAL_OK = /^https:\/\/(onairgarage\.com|github\.com\/djgragra)(\/|$)/;
const EXTS = ['wav', 'bwf', 'mp3', 'flac'];
const ALL_FIELDS = { mp3: id3.FIELD_NAMES, wav: bwf.FIELD_NAMES, flac: flac.FIELD_NAMES };

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let store = null;
let logger = null;
let lastUpdateInfo = null;
let downloadedFile = null;
let downloadedFor = null;
let downloadAbort = null;
let dirty = false;
let quitting = false;
let fileBusy = false; // a save or a restore is running
let startKind = 'same';
let pendingBackup = null; // the file chosen for import, waiting for the answer "replace or add"

const userData = () => app.getPath('userData');
const settingsFile = () => path.join(userData(), 'settings.json');
const pointerFile = () => path.join(userData(), 'last-batch.json');
const defaultBackupDir = () => path.join(app.getPath('home'), 'TagFixer Backups');
const settings = () => store.get();
const send = (channel, ...args) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args); };

// The few texts the main process shows itself (native dialogs, notices). The window has all the others.
const TEXT = {
  en: { unsavedTitle: 'Unsaved edits', unsavedDetail: 'The edits in the table have not been saved. Quit anyway?', cancel: 'Cancel', discard: 'Discard edits and quit', installTitle: 'Install the update', installDetail: 'The edits in the table have not been saved and will be lost. Install anyway?', installAnyway: 'Install anyway', updatedTo: (v) => `Updated to ${v}` },
  it: { unsavedTitle: 'Modifiche non salvate', unsavedDetail: 'Le modifiche nella tabella non sono state salvate. Uscire comunque?', cancel: 'Annulla', discard: 'Scarta le modifiche ed esci', installTitle: "Installa l'aggiornamento", installDetail: "Le modifiche nella tabella non sono state salvate e andranno perse. Installare comunque?", installAnyway: 'Installa comunque', updatedTo: (v) => `Aggiornato alla versione ${v}` },
  es: { unsavedTitle: 'Cambios sin guardar', unsavedDetail: 'Los cambios de la tabla no se han guardado. ¿Salir de todos modos?', cancel: 'Cancelar', discard: 'Descartar los cambios y salir', installTitle: 'Instalar la actualización', installDetail: 'Los cambios de la tabla no se han guardado y se perderán. ¿Instalar de todos modos?', installAnyway: 'Instalar de todos modos', updatedTo: (v) => `Actualizado a la versión ${v}` }
};
const txt = () => TEXT[settings()?.language] || TEXT.en;

// ---- Window ---------------------------------------------------------------------------------

const bg = () => (nativeTheme.shouldUseDarkColors ? '#0d0f12' : '#f3f4f6');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 820, minWidth: 820, minHeight: 540, title: 'Tag Fixer',
    backgroundColor: bg(),
    icon: process.platform === 'linux' ? path.join(__dirname, 'assets', 'icon.png') : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (EXTERNAL_OK.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Edits that are not saved yet: ask before the window closes.
  mainWindow.on('close', (e) => {
    if (!dirty || quitting) return;
    const t = txt();
    const choice = dialog.showMessageBoxSync(mainWindow, { type: 'warning', buttons: [t.cancel, t.discard], defaultId: 0, cancelId: 0, message: t.unsavedTitle, detail: t.unsavedDetail });
    if (choice === 0) e.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function applyTheme() {
  nativeTheme.themeSource = settings().theme === 'auto' ? 'system' : settings().theme;
  if (mainWindow) mainWindow.setBackgroundColor(bg());
}

app.whenReady().then(() => {
  const hadSettingsFile = fs.existsSync(settingsFile());
  store = createStore(settingsFile(), { defaultBackupDir: defaultBackupDir() });
  logger = createLogger({ dir: path.join(userData(), 'logs'), retentionDays: settings().logRetentionDays });
  logger.prune();
  logger.log('info', `Tag Fixer ${app.getVersion()} started (${process.platform} ${process.arch}, Electron ${process.versions.electron})`);
  const stale = sweepPartials(app.getPath('downloads'));
  if (stale.length) logger.log('info', `removed ${stale.length} unfinished installer download(s) left by an earlier run`);
  startKind = startupKind(settings().lastSeenVersion, app.getVersion(), hadSettingsFile);
  if (startKind === 'first') store.update({ lastSeenVersion: app.getVersion() });
  else if (startKind === 'updated' && Notification.isSupported()) new Notification({ title: 'Tag Fixer', body: txt().updatedTo(app.getVersion()) }).show();
  applyTheme();
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []), { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  // update check: 15 s after the start, then every 24 hours (only when the switch is on)
  setTimeout(() => updateTick().catch(() => {}), 15_000).unref();
  setInterval(() => updateTick().catch(() => {}), 24 * 3600_000).unref();
});
nativeTheme.on('updated', () => { if (mainWindow && store) mainWindow.setBackgroundColor(bg()); });
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { store?.flush(); });

ipcMain.on('dirty:set', (_e, v) => { dirty = !!v; });

// ---- Files and tags -------------------------------------------------------------------------

ipcMain.handle('files:expand', (_e, paths, opts) => expandPaths(Array.isArray(paths) ? paths : [], { recursive: !!opts?.recursive }));

ipcMain.handle('files:pick', async (_e, kind, opts = {}) => {
  const folder = kind === 'folder';
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    filters: folder ? undefined : [{ name: 'MP3 / WAV / BWF / FLAC', extensions: EXTS }]
  });
  if (res.canceled) return { files: [], skipped: 0, unreadable: 0, truncated: false };
  return expandPaths(res.filePaths, { recursive: !!opts.recursive });
});

const okPath = (p) => typeof p === 'string' && path.isAbsolute(p) && typeOf(p);

ipcMain.handle('tags:read', async (_e, paths) => {
  const out = [];
  for (const p of Array.isArray(paths) ? paths : []) out.push(okPath(p) ? await readTags(p) : { path: p, ok: false, error: 'unsupported' });
  return out;
});

// items: [{ kind, version, fields: { name: value } }] -> [{ name: code }]
ipcMain.handle('tags:validate', async (_e, items) => {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const errors = {};
    for (const [name, value] of Object.entries(it?.fields || {})) {
      let code;
      if (it.kind === 'mp3' && id3.FIELD_NAMES.includes(name)) {
        code = id3.validateField(name, value, Number(it.version) === 4 ? 4 : Number(it.version) === 2 ? 2 : 3);
        if (!code && name === 'cover' && value) { try { await id3.readCoverFile(value); } catch (err) { code = err.code || 'bad-cover'; } }
      } else if (it.kind === 'wav' && bwf.FIELD_NAMES.includes(name)) code = bwf.validateField(name, value);
      else if (it.kind === 'flac' && flac.FIELD_NAMES.includes(name)) code = flac.validateField(name, value);
      else code = 'unknown-field';
      if (code) errors[name] = code;
    }
    out.push(errors);
  }
  return out;
});

ipcMain.handle('tags:to-ascii', (_e, texts) => (Array.isArray(texts) ? texts : []).map((t) => bwf.toAscii(String(t))));

// ---- Cover pictures -------------------------------------------------------------------------

const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

ipcMain.handle('cover:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JPEG / PNG', extensions: ['jpg', 'jpeg', 'png'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  try {
    const pic = await id3.readCoverFile('file:' + res.filePaths[0]);
    return { ok: true, token: 'file:' + res.filePaths[0], name: path.basename(res.filePaths[0]), mime: pic.mime, size: pic.bytes.length, preview: pic.bytes.length <= 4 << 20 ? dataUrl(pic.mime, pic.bytes) : null };
  } catch (err) { return { ok: false, error: err.code || err.message, name: path.basename(res.filePaths[0]) }; }
});

ipcMain.handle('cover:preview', async (_e, p) => {
  if (!okPath(p) || typeOf(p) !== 'mp3') return null;
  try {
    const c = await id3.extractCover(p, 4 << 20);
    return c ? { mime: c.mime, preview: dataUrl(c.mime, c.bytes) } : null;
  } catch { return null; }
});

// ---- Table tools ----------------------------------------------------------------------------

const cleanRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && okPath(r.path)).map((r) => ({
  id: r.id, path: r.path, name: path.basename(r.path), dir: path.dirname(r.path), fields: r.fields && typeof r.fields === 'object' ? r.fields : {}, mtimeMs: Number(r.mtimeMs) || 0, birthtimeMs: Number(r.birthtimeMs) || 0
}));

ipcMain.handle('tools:pattern', (_e, p) => patternJob({ mode: p?.mode, pattern: String(p?.pattern ?? ''), field: String(p?.field ?? ''), known: Array.isArray(p?.known) ? p.known.map(String) : [], startAt: Number.isInteger(p?.startAt) ? p.startAt : 1, rows: cleanRows(p?.rows) }));
ipcMain.handle('tools:text', (_e, p) => textJob({ op: p?.op, rows: (Array.isArray(p?.rows) ? p.rows : []).map((r) => ({ id: r.id, value: String(r.value ?? '') })) }));
ipcMain.handle('tools:datetime', (_e, p) => dateJob({ source: p?.source, target: p?.target, withTime: p?.withTime !== false, rows: cleanRows(p?.rows) }));
ipcMain.handle('tools:checks', (_e, files) => runChecks(Array.isArray(files) ? files : []));
ipcMain.handle('rename:check', (_e, items) => checkRenames((Array.isArray(items) ? items : []).filter((i) => okPath(i?.path) && typeof i.rename === 'string')));

// CSV: the window sends the rows as they are on screen; the main process asks where to save and writes.
ipcMain.handle('csv:export', async (_e, p) => {
  const headers = Array.isArray(p?.headers) ? p.headers.map(String) : [];
  const rows = Array.isArray(p?.rows) ? p.rows.map((r) => (Array.isArray(r) ? r.map((v) => String(v ?? '')) : [])) : [];
  const delimiter = [',', ';', '\t'].includes(p?.delimiter) ? p.delimiter : ',';
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), `tag-fixer-${String(p?.tab || 'table').replace(/[^\w-]/g, '')}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fsp.writeFile(res.filePath, toCsv(headers, rows, delimiter), 'utf8');
  logger.log('info', `table exported to CSV (${rows.length} rows)`);
  return { ok: true, count: rows.length, name: path.basename(res.filePath) };
});

ipcMain.handle('csv:import', async (_e, p) => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt', 'tsv'] }] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  let text;
  try {
    const st = await fsp.stat(res.filePaths[0]);
    if (st.size > 50 << 20) return { ok: false, error: 'too-big' };
    text = await fsp.readFile(res.filePaths[0], 'utf8');
  } catch (err) { return { ok: false, error: err.code || 'unreadable' }; }
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const files = (Array.isArray(p?.files) ? p.files : []).filter((f) => okPath(f?.path)).map((f) => ({ path: f.path, name: path.basename(f.path) }));
  const plan = planImport(parsed, { known: Array.isArray(p?.known) ? p.known.map(String) : [], files, emptyMeansClear: !!p?.emptyMeansClear });
  return plan.ok ? { ok: true, name: path.basename(res.filePaths[0]), rows: parsed.rows.length, ...plan } : { ok: false, error: plan.error };
});

// ---- Save and restore -----------------------------------------------------------------------

function cleanItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!okPath(it?.path)) continue;
    const type = typeOf(it.path);
    const allowed = ALL_FIELDS[type];
    const changes = {};
    for (const [k, v] of Object.entries(it.changes && typeof it.changes === 'object' ? it.changes : {})) {
      if (!allowed.includes(k) || typeof v !== 'string') continue;
      if (k === 'cover' && v !== '' && !(v.startsWith('file:') && path.isAbsolute(v.slice(5)))) continue;
      changes[k] = v;
    }
    const rename = typeof it.rename === 'string' && it.rename ? it.rename : null;
    if (Object.keys(changes).length || rename) out.push({ path: it.path, changes, rename });
  }
  return out;
}

ipcMain.handle('save:preflight', async (_e, items) => {
  const { backupDir } = settings();
  return { backupDir, ...(await preflight(cleanItems(items), backupDir)) };
});

ipcMain.handle('save:run', async (_e, items) => {
  const { backupDir } = settings();
  const clean = cleanItems(items);
  fileBusy = true;
  logger.log('info', `saving ${clean.length} files`);
  try {
    const out = await applyBatch(clean, { backupRoot: backupDir, onProgress: (p) => send('save:progress', p) });
    if (out.dir) await fsp.writeFile(pointerFile(), JSON.stringify({ dir: out.dir }), 'utf8').catch(() => {});
    const failed = out.results.filter((r) => !r.ok);
    logger.log(failed.length ? 'warn' : 'info', `saved ${out.results.length - failed.length} of ${out.results.length} files${failed.length ? '; errors: ' + [...new Set(failed.map((r) => r.error))].join(', ') : ''}`);
    return { backupDir: out.dir, results: out.results };
  } finally { fileBusy = false; }
});

async function lastBatchDir() {
  try { const p = JSON.parse(await fsp.readFile(pointerFile(), 'utf8')); return typeof p.dir === 'string' ? p.dir : null; } catch { return null; }
}

ipcMain.handle('restore:info', async () => {
  const dir = await lastBatchDir();
  const c = dir && await checkRestore(dir);
  const pending = c ? c.manifest.entries.filter((e) => !e.restored).length : 0;
  return pending ? { available: true, count: pending, createdAt: c.createdAt, dir } : { available: false };
});

ipcMain.handle('restore:check', async () => {
  const dir = await lastBatchDir();
  const c = dir && await checkRestore(dir);
  return c ? { todo: c.todo.length, problems: c.problems, dir } : { todo: 0, problems: [], dir };
});

ipcMain.handle('restore:run', async () => {
  const dir = await lastBatchDir();
  if (!dir) return { results: [], problems: [], pending: 0 };
  fileBusy = true;
  try {
    const out = (await runRestore(dir)) || { results: [], problems: [], pending: 0 };
    logger.log('info', `restored ${out.results.filter((r) => r.ok).length} files`);
    return out;
  } finally { fileBusy = false; }
});

// ---- Settings, backup of the configuration --------------------------------------------------

ipcMain.handle('settings:get', () => settings());

ipcMain.handle('settings:update', (_e, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return settings();
  const allowed = ['language', 'theme', 'recursive', 'checkUpdates', 'tab', 'wavSet', 'logRetentionDays', 'presets', 'migrated'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  const next = store.update(clean);
  if ('theme' in clean) applyTheme();
  if ('logRetentionDays' in clean) logger.setRetention(next.logRetentionDays);
  return next;
});

ipcMain.handle('settings:choose-backup-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (!res.canceled && res.filePaths[0]) store.update({ backupDir: res.filePaths[0] });
  return settings();
});

ipcMain.handle('settings:open-backup-dir', async () => {
  const { backupDir } = settings();
  await fsp.mkdir(backupDir, { recursive: true });
  await shell.openPath(backupDir);
});

ipcMain.handle('backup:export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('documents'), backupFileName()), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fsp.writeFile(res.filePath, JSON.stringify(buildExport(settings()), null, 1), 'utf8');
  logger.log('info', 'configuration exported');
  return { ok: true, name: path.basename(res.filePath) };
});

ipcMain.handle('backup:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  let text;
  try { text = await fsp.readFile(res.filePaths[0], 'utf8'); } catch (err) { return { ok: false, error: err.code || 'unreadable' }; }
  const check = prepareImport(text, settings());
  if (!check.ok) return { ok: false, error: check.error };
  pendingBackup = text;
  return { ok: true, name: path.basename(res.filePaths[0]), presets: check.settings.presets.length };
});

ipcMain.handle('backup:apply', (_e, mode) => {
  if (!pendingBackup) return { ok: false, error: 'no-file' };
  const r = prepareImport(pendingBackup, settings(), { mode: mode === 'add' ? 'add' : 'replace' });
  pendingBackup = null;
  if (!r.ok) return r;
  const next = store.update(r.settings);
  applyTheme();
  logger.log('info', `configuration imported (${r.mode})`);
  return { ok: true, added: r.added, missing: r.missing, settings: next };
});

// ---- App info, support info, logs -----------------------------------------------------------

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, logsDir: path.join(userData(), 'logs') }));
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && EXTERNAL_OK.test(url)) shell.openExternal(url); });
ipcMain.handle('logs:open-folder', async () => { const d = path.join(userData(), 'logs'); await fsp.mkdir(d, { recursive: true }); return shell.openPath(d); });

// Help & About: what to send to whoever helps. Never settings values, file names or paths the user chose.
ipcMain.handle('app:support-info', () => {
  const u = settings().updateState.lastCheck;
  const lastError = logger.entries().filter((e) => e.level === 'error').at(-1);
  const home = os.homedir();
  const tidy = (s) => String(s || '').split(home).join('~');
  return [
    `Tag Fixer ${app.getVersion()}`,
    `Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
    `System: ${process.platform} ${os.release()} ${process.arch}`,
    `Language: ${settings().language} · Theme: ${settings().theme}`,
    `Last update check: ${u ? `${new Date(u.at).toISOString()} (${u.ok ? 'ok' : tidy(u.error || 'failed')})` : 'never'}`,
    `Last error: ${lastError ? `${new Date(lastError.t).toISOString()} ${tidy(lastError.message).slice(0, 160)}` : 'none'}`
  ].join('\n');
});

// ---- Guided update (apps/COMMON-FEATURES.md, section 4) --------------------------------------

// what the page may know: the installer's name and size, never a URL
const publicInfo = (info) => info && { ...info, installer: info.installer ? { name: info.installer.name, size: info.installer.size } : null, sumsUrl: undefined };
const updateView = (info) => ({ info: publicInfo(info), banner: bannerState(info, settings().updateState), lastCheck: settings().updateState.lastCheck, downloaded: downloadedFile && info?.available ? path.basename(downloadedFile) : null });
const setUpdateState = (patch) => store.update({ updateState: { ...settings().updateState, ...patch } });

async function doCheck() {
  const info = await checkForUpdate({ current: app.getVersion(), fetchFn: net.fetch });
  lastUpdateInfo = info.ok ? info : null;
  if (downloadedFor && (!info.ok || info.latest !== downloadedFor)) { downloadedFile = null; downloadedFor = null; } // a newer release came out: download again
  setUpdateState({ lastCheck: { at: Date.now(), ok: !!info.ok, error: info.ok ? '' : String(info.error || '') } });
  logger.log(info.ok ? 'info' : 'warn', info.ok ? `update check: ${info.available ? 'version ' + info.latest + ' available' : 'up to date'}` : `update check failed: ${info.error}`);
  return updateView(info);
}
async function updateTick() {
  if (!settings().checkUpdates) return;
  send('update:view', await doCheck());
}

ipcMain.handle('update:check', () => doCheck());
ipcMain.handle('update:state', () => updateView(lastUpdateInfo));

ipcMain.handle('update:download', async () => {
  if (!lastUpdateInfo?.available) return { ok: false, error: 'no-update' };
  if (downloadAbort) return { ok: false, error: 'busy' };
  downloadAbort = new AbortController();
  sweepPartials(app.getPath('downloads')); // a .part left by a download that was cut off earlier goes first
  try {
    downloadedFile = await downloadInstaller({ info: lastUpdateInfo, dir: app.getPath('downloads'), fetchFn: net.fetch, current: app.getVersion(), signal: downloadAbort.signal, onProgress: (received, total) => send('update:progress', received, total) });
    downloadedFor = lastUpdateInfo.latest;
    logger.log('info', `update ${lastUpdateInfo.latest} downloaded and verified (SHA-256)`);
    return { ok: true, file: path.basename(downloadedFile) };
  } catch (err) {
    downloadedFile = null;
    downloadedFor = null;
    const cancelled = downloadAbort?.signal.aborted || err.cancelled;
    if (!cancelled) logger.log('warn', `update download failed: ${err.message}`);
    return { ok: false, error: cancelled ? 'cancelled' : err.message };
  } finally { downloadAbort = null; }
});
// "Release notes" and "What's new" open the app's page on the site (installer, changelog, hashes), in the app's language.
ipcMain.handle('update:page', () => { shell.openExternal(pageUrl(undefined, settings().language)); });
ipcMain.handle('update:cancel', () => { downloadAbort?.abort(); return true; });
ipcMain.handle('update:remind', () => { setUpdateState(remindLaterState(settings().updateState)); return updateView(lastUpdateInfo); });
ipcMain.handle('update:skip', () => { setUpdateState(skipVersionState(settings().updateState, lastUpdateInfo?.latest)); return updateView(lastUpdateInfo); });

// "Close and install": refused while a save or a restore is running; a safety copy of the settings first
ipcMain.handle('update:install', () => {
  if (!downloadedFile || !fs.existsSync(downloadedFile)) return { ok: false, error: 'no-file' };
  if (fileBusy) return { ok: false, error: 'busy' };
  if (dirty) {
    const t = txt();
    const choice = dialog.showMessageBoxSync(mainWindow, { type: 'warning', buttons: [t.cancel, t.installAnyway], defaultId: 0, cancelId: 0, message: t.installTitle, detail: t.installDetail });
    if (choice === 0) return { ok: false, error: 'cancelled' };
    dirty = false;
  }
  store.flush();
  try {
    makeSafetyCopy({ file: settingsFile(), dir: path.join(userData(), 'backups'), version: lastUpdateInfo?.current || app.getVersion() });
  } catch (err) { return { ok: false, error: `safety copy: ${err.message}` }; }
  const plan = installPlan(process.platform, downloadedFile);
  logger.log('info', `installing update ${lastUpdateInfo?.latest || ''} (${plan.kind})`);
  if (plan.kind === 'run-installer') {
    spawn(plan.file, [], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 300);
  } else if (plan.kind === 'open-image') shell.openPath(plan.file);
  else shell.showItemInFolder(plan.file);
  return { ok: true, kind: plan.kind, hint: plan.hint || null, quit: plan.quit };
});

ipcMain.handle('update:reveal', () => { if (downloadedFile && fs.existsSync(downloadedFile)) shell.showItemInFolder(downloadedFile); });

// After a start of a newer version: the window with what changed (once)
ipcMain.handle('whatsnew:get', () => {
  if (startKind !== 'updated') return null;
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch { /* not packaged */ }
  return whatsNew(text, app.getVersion()) || { version: app.getVersion(), date: '', bullets: [] };
});
ipcMain.handle('whatsnew:seen', () => { startKind = 'same'; store.update({ lastSeenVersion: app.getVersion() }); return true; });
