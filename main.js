import { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expandPaths, readTags, preflight, applyBatch, checkRestore, runRestore, typeOf } from './src/batch.js';
import { validateField as validateBwf, toAscii, FIELD_NAMES as BWF_FIELDS } from './src/bwf.js';
import { validateField as validateId3, FIELD_NAMES as ID3_FIELDS } from './src/id3.js';
import { checkForUpdate, downloadInstaller } from './src/updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERNAL_OK = /^https:\/\/(onairgarage\.com|github\.com\/djgragra)(\/|$)/;
const EXTS = ['wav', 'bwf', 'mp3'];

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let lastUpdateInfo = null;
let dirty = false;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const pointerFile = () => path.join(app.getPath('userData'), 'last-batch.json');
const defaultBackupDir = () => path.join(app.getPath('home'), 'TagFixer Backups');

async function getSettings() {
  try {
    const s = JSON.parse(await fsp.readFile(settingsFile(), 'utf8'));
    return { backupDir: typeof s.backupDir === 'string' && path.isAbsolute(s.backupDir) ? s.backupDir : defaultBackupDir() };
  } catch { return { backupDir: defaultBackupDir() }; }
}
const setSettings = (s) => fsp.writeFile(settingsFile(), JSON.stringify(s), 'utf8');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 760, minHeight: 520, title: 'Tag Fixer',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1311' : '#f4f6f4',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (EXTERNAL_OK.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Edits that are not saved yet: ask before the window closes.
  mainWindow.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, { type: 'warning', buttons: ['Cancel', 'Discard edits and quit'], defaultId: 0, cancelId: 0, message: 'Unsaved edits', detail: 'The edits in the table have not been saved. Quit anyway?' });
    if (choice === 0) e.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []), { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.on('window-all-closed', () => app.quit());

ipcMain.on('dirty:set', (_e, v) => { dirty = !!v; });

// ---- Files and tags -------------------------------------------------------------------------

ipcMain.handle('files:expand', (_e, paths, opts) => expandPaths(Array.isArray(paths) ? paths : [], { recursive: !!opts?.recursive }));

ipcMain.handle('files:pick', async (_e, kind, opts = {}) => {
  const folder = kind === 'folder';
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    filters: folder ? undefined : [{ name: 'MP3 / WAV / BWF', extensions: EXTS }]
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
ipcMain.handle('tags:validate', (_e, items) => (Array.isArray(items) ? items : []).map((it) => {
  const errors = {};
  for (const [name, value] of Object.entries(it?.fields || {})) {
    const code = it.kind === 'mp3' && ID3_FIELDS.includes(name) ? validateId3(name, value, Number(it.version) === 4 ? 4 : 3)
      : it.kind === 'wav' && BWF_FIELDS.includes(name) ? validateBwf(name, value) : 'unknown-field';
    if (code) errors[name] = code;
  }
  return errors;
}));

ipcMain.handle('tags:to-ascii', (_e, texts) => (Array.isArray(texts) ? texts : []).map((t) => toAscii(String(t))));

// ---- Save and restore -----------------------------------------------------------------------

function cleanItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!okPath(it?.path) || !it.changes || typeof it.changes !== 'object') continue;
    const allowed = typeOf(it.path) === 'mp3' ? ID3_FIELDS : BWF_FIELDS;
    const changes = {};
    for (const [k, v] of Object.entries(it.changes)) if (allowed.includes(k) && typeof v === 'string') changes[k] = v;
    if (Object.keys(changes).length) out.push({ path: it.path, changes });
  }
  return out;
}

ipcMain.handle('save:preflight', async (_e, items) => {
  const { backupDir } = await getSettings();
  return { backupDir, ...(await preflight(cleanItems(items), backupDir)) };
});

ipcMain.handle('save:run', async (_e, items) => {
  const { backupDir } = await getSettings();
  const clean = cleanItems(items);
  const out = await applyBatch(clean, { backupRoot: backupDir, onProgress: (p) => mainWindow?.webContents.send('save:progress', p) });
  if (out.dir) await fsp.writeFile(pointerFile(), JSON.stringify({ dir: out.dir }), 'utf8').catch(() => {});
  return { backupDir: out.dir, results: out.results };
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
  return dir ? (await runRestore(dir)) || { results: [], problems: [], pending: 0 } : { results: [], problems: [], pending: 0 };
});

// ---- Settings, app, updates -----------------------------------------------------------------

ipcMain.handle('settings:get', getSettings);

ipcMain.handle('settings:choose-backup-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return getSettings();
  await setSettings({ backupDir: res.filePaths[0] });
  return getSettings();
});

ipcMain.handle('settings:open-backup-dir', async () => {
  const { backupDir } = await getSettings();
  await fsp.mkdir(backupDir, { recursive: true });
  await shell.openPath(backupDir);
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && EXTERNAL_OK.test(url)) shell.openExternal(url); });

ipcMain.handle('update:check', async () => {
  const info = await checkForUpdate();
  lastUpdateInfo = info.ok ? info : null;
  return { ...info, installer: info.installer ? { name: info.installer.name, size: info.installer.size } : null };
});

ipcMain.handle('update:download', async () => {
  if (!lastUpdateInfo?.available) return { ok: false, error: 'no-update' };
  try {
    const file = await downloadInstaller(lastUpdateInfo, app.getPath('downloads'), (received, total) => mainWindow?.webContents.send('update:progress', received, total));
    return { ok: true, file };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('update:reveal', (_e, file) => { if (typeof file === 'string' && path.dirname(file) === app.getPath('downloads')) shell.showItemInFolder(file); });
