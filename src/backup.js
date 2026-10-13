// garage-common: backup 1
// Configuration backup: build the file, read it back. Electron-free and file-free (the main process asks for the
// file and applies the plan), so it can be tested. This app keeps no passwords, tokens or keys, so there is no
// "include passwords" box and nothing is ever left out of the file for that reason.
import { sanitizeSettings, RUNTIME_KEYS, MAX_PRESETS } from './settings.js';

export const BACKUP_APP = 'tag-fixer';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 2_000_000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const dateStamp = (ms) => new Date(ms).toISOString().slice(0, 10);

export const backupFileName = (now = Date.now()) => `${BACKUP_APP}-backup-${dateStamp(now)}.json`;

// settings: the settings of the app. Returns the object to write as JSON.
export function buildExport(settings, { now = Date.now() } = {}) {
  const s = structuredClone(settings);
  for (const k of RUNTIME_KEYS) delete s[k];
  const presets = Array.isArray(s.presets) ? s.presets : [];
  delete s.presets;
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), includesSecrets: false, settings: s, presets };
}

// raw: the text or the parsed object of the file. current: the settings now in use.
// mode: 'replace' (settings and presets from the file) | 'add' (only presets this PC does not have, settings untouched).
// Returns { ok, settings, missing, added, mode } or { ok:false, error }. `missing` is the list of secrets to type
// again: always empty here, kept so every app answers the same way.
export function prepareImport(raw, current, { mode = 'replace' } = {}) {
  let file = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_BACKUP_BYTES) return { ok: false, error: 'too-big' };
    try { file = JSON.parse(raw); } catch { return { ok: false, error: 'invalid' }; }
  }
  if (!isObj(file) || !isObj(file.settings)) return { ok: false, error: 'invalid' };
  if (file.app !== BACKUP_APP) return { ok: false, error: 'wrong-app' };

  const fromFile = structuredClone({ ...file.settings, presets: Array.isArray(file.presets) ? file.presets : file.settings.presets });
  for (const k of RUNTIME_KEYS) delete fromFile[k];
  const incoming = sanitizeSettings({ ...fromFile, backupDir: current.backupDir });

  let result;
  let added = null;
  if (mode === 'add') {
    const have = new Set(current.presets.map((p) => p.id));
    const haveKey = new Set(current.presets.map((p) => `${p.kind}|${p.name.toLowerCase()}|${p.pattern}`));
    const extra = incoming.presets.filter((p) => !have.has(p.id) && !haveKey.has(`${p.kind}|${p.name.toLowerCase()}|${p.pattern}`)).slice(0, Math.max(0, MAX_PRESETS - current.presets.length));
    result = sanitizeSettings({ ...structuredClone(current), presets: [...structuredClone(current.presets), ...extra] }, { defaultBackupDir: current.backupDir });
    added = extra.length;
  } else {
    result = incoming;
    for (const k of RUNTIME_KEYS) result[k] = current[k];
  }
  return { ok: true, settings: result, missing: [], added, mode };
}
