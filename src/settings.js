import fs from 'node:fs';
import path from 'node:path';

// The settings of the app (settings.json in the user data folder): language, theme, what was last used, saved
// patterns, update memory. No passwords, tokens or keys exist in this app, so the file is plain JSON.
export const LANGS = ['en', 'it', 'es'];
export const MAX_PRESETS = 50;
export const PRESET_KINDS = ['fill', 'read', 'rename'];
const TABS = ['mp3', 'wav', 'flac'];
const WAV_SETS = ['bwf', 'ixml', 'cart'];
// kept on this PC only: not part of a backup file
export const RUNTIME_KEYS = ['updateState', 'lastSeenVersion', 'backupDir', 'migrated'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizePreset(p) {
  if (!isObj(p) || !PRESET_KINDS.includes(p.kind)) return null;
  const pattern = str(p.pattern, 300);
  const name = str(p.name, 60).trim();
  if (!pattern || !name) return null;
  const id = /^[\w-]{1,40}$/.test(p.id || '') ? p.id : null;
  return { id, name, kind: p.kind, field: str(p.field, 40), pattern };
}

export function sanitizeSettings(raw, { defaultBackupDir = null } = {}) {
  const r = isObj(raw) ? raw : {};
  const seen = new Set();
  const presets = [];
  for (const p of Array.isArray(r.presets) ? r.presets : []) {
    const s = sanitizePreset(p);
    if (!s) continue;
    if (!s.id || seen.has(s.id)) s.id = 'p' + Math.random().toString(36).slice(2, 10);
    seen.add(s.id);
    presets.push(s);
    if (presets.length >= MAX_PRESETS) break;
  }
  const us = isObj(r.updateState) ? r.updateState : {};
  const lc = isObj(us.lastCheck) ? us.lastCheck : null;
  return {
    language: LANGS.includes(r.language) ? r.language : 'en', // the app always opens in English until the user changes it
    theme: ['auto', 'light', 'dark'].includes(r.theme) ? r.theme : 'auto',
    recursive: r.recursive === true,
    checkUpdates: r.checkUpdates !== false,
    tab: TABS.includes(r.tab) ? r.tab : 'mp3',
    wavSet: WAV_SETS.includes(r.wavSet) ? r.wavSet : 'bwf',
    logRetentionDays: Number.isInteger(r.logRetentionDays) && r.logRetentionDays >= 1 && r.logRetentionDays <= 90 ? r.logRetentionDays : 7,
    presets,
    backupDir: typeof r.backupDir === 'string' && path.isAbsolute(r.backupDir) ? r.backupDir : defaultBackupDir,
    lastSeenVersion: str(r.lastSeenVersion, 40),
    migrated: r.migrated === true,
    updateState: {
      skipVersion: str(us.skipVersion, 40),
      remindUntil: Number.isFinite(us.remindUntil) ? us.remindUntil : 0,
      lastCheck: lc ? { at: Number.isFinite(lc.at) ? lc.at : 0, ok: lc.ok === true, error: str(lc.error, 200) } : null
    }
  };
}

// A small store: read at start, written a moment after every change (and on flush).
export function createStore(file, { defaultBackupDir = null, delay = 200 } = {}) {
  let hadFile = false;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); hadFile = true; } catch { data = {}; }
  let cur = sanitizeSettings(data, { defaultBackupDir });
  let timer = null;
  const write = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cur, null, 1), 'utf8');
      fs.renameSync(tmp, file);
    } catch { /* the app keeps working with the values in memory */ }
  };
  return {
    hadFile,
    get: () => cur,
    update(patch) { cur = sanitizeSettings({ ...cur, ...patch }, { defaultBackupDir }); clearTimeout(timer); timer = setTimeout(write, delay); timer.unref?.(); return cur; },
    flush() { if (timer) { clearTimeout(timer); write(); } }
  };
}
