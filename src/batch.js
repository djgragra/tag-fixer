import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBwf, writeBwf } from './bwf.js';
import { readId3, writeId3 } from './id3.js';

export const TYPE_BY_EXT = { mp3: 'mp3', wav: 'wav', bwf: 'wav' };
const MAX_FILES = 20000;

export const typeOf = (file) => TYPE_BY_EXT[path.extname(file).slice(1).toLowerCase()] || null;

export async function describeFile(p) {
  const type = typeOf(p);
  if (!type) return null;
  const st = await fsp.lstat(p);
  if (!st.isFile()) return null;
  return { path: p, name: path.basename(p), dir: path.dirname(p), size: st.size, mtimeMs: Math.round(st.mtimeMs), type };
}

export async function expandPaths(paths, { recursive = false } = {}) {
  const out = { files: [], skipped: 0, unreadable: 0, truncated: false };
  const walk = async (dir) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { out.unreadable++; return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      if (out.files.length >= MAX_FILES) { out.truncated = true; return; }
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (recursive) await walk(full); }
      else if (e.isFile()) {
        const d = await describeFile(full).catch(() => null);
        if (d) out.files.push(d); else out.skipped++;
      }
    }
  };
  for (const p of paths) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    let st;
    try { st = await fsp.lstat(p); } catch { out.unreadable++; continue; }
    if (st.isDirectory()) await walk(p);
    else if (st.isFile()) {
      const d = await describeFile(p).catch(() => null);
      if (d) out.files.push(d); else out.skipped++;
    }
    if (out.files.length >= MAX_FILES) { out.truncated = true; break; }
  }
  return out;
}

// What the window needs, without the raw frame bytes.
export async function readTags(p) {
  const type = typeOf(p);
  try {
    if (type === 'mp3') {
      const r = await readId3(p);
      return { kind: 'mp3', path: p, ok: true, version: r.version, source: r.source, fields: r.fields, locked: r.locked, multi: r.multi, writable: r.writable, readOnlyReason: r.readOnlyReason || null, hasTag: r.hasTag, hasV1: !!r.v1 };
    }
    if (type === 'wav') {
      const r = await readBwf(p);
      if (!r.ok) return { kind: 'wav', path: p, ok: false, error: r.error };
      return { kind: 'wav', path: p, ok: true, fields: r.fields, nonAscii: r.nonAscii, writable: r.writable, readOnlyReason: r.readOnlyReason || null, hasBext: r.hasBext, warnings: r.warnings, info: r.info, bext: r.bext ? { version: r.bext.version, timeReference: r.bext.timeReference, umidPresent: r.bext.umidPresent, loudness: r.bext.loudness, codingHistoryLength: r.bext.codingHistoryLength || 0 } : null };
    }
    return { kind: null, path: p, ok: false, error: 'unsupported' };
  } catch (err) {
    return { kind: type, path: p, ok: false, error: err.code || err.message };
  }
}

// ---- Backup folder --------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
export const batchName = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

// /Users/me/a.wav -> Users/me/a.wav ; C:\Audio\a.wav -> C/Audio/a.wav ; \\srv\share\a.wav -> srv_share/a.wav
export function mirrorPath(file) {
  const { root } = path.parse(file);
  const rootPart = root.replace(/[:\\/]+/g, '_').replace(/^_+|_+$/g, '');
  return path.join(rootPart, path.relative(root, file));
}

async function nearestExisting(dir) {
  let d = dir;
  for (;;) {
    try { await fsp.access(d); return d; } catch { const up = path.dirname(d); if (up === d) return d; d = up; }
  }
}

export async function freeSpace(dir) {
  try {
    const s = await fsp.statfs(await nearestExisting(dir));
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

export async function preflight(items, backupRoot) {
  let bytes = 0;
  for (const it of items) { try { bytes += (await fsp.stat(it.path)).size; } catch { /* reported when applying */ } }
  const free = await freeSpace(backupRoot);
  return { bytes, free, enough: free === null ? null : free > bytes * 1.05 + (16 << 20) };
}

async function copyKeepTimes(src, dst, flags = 0) {
  const st = await fsp.stat(src);
  await fsp.copyFile(src, dst, flags);
  await fsp.utimes(dst, st.atime, st.mtime);
  return st;
}

// ---- Apply ----------------------------------------------------------------------------------

async function precheck(item) {
  const type = typeOf(item.path);
  if (!type) return 'unsupported';
  const r = type === 'mp3' ? await readId3(item.path) : await readBwf(item.path);
  if (!r.ok) return r.error || 'unreadable';
  if (!r.writable) return r.readOnlyReason || 'read-only';
  if (type === 'mp3') for (const f of Object.keys(item.changes)) if (r.locked[f]) return r.locked[f];
  return null;
}

function matches(read, changes) {
  return Object.entries(changes).every(([k, v]) => (read.fields[k] ?? '') === v);
}

const tempFor = (file) => path.join(path.dirname(file), `.tagfixer-${crypto.randomBytes(5).toString('hex')}.tmp`);

export async function restoreFile(backup, target, original) {
  const tmp = tempFor(target);
  try {
    await copyKeepTimes(backup, tmp, fs.constants.COPYFILE_EXCL);
    if (original?.mtimeMs) await fsp.utimes(tmp, new Date(original.atimeMs ?? original.mtimeMs), new Date(original.mtimeMs));
    try { await fsp.chmod(tmp, (await fsp.stat(target)).mode); } catch { /* target missing */ }
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

// items: [{ path, changes }] ; creates <backupRoot>/<batch>/files/<mirror> and manifest.json.
export async function applyBatch(items, { backupRoot, onProgress, now = new Date() }) {
  let dir = path.join(backupRoot, batchName(now));
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(backupRoot, `${batchName(now)}-${n}`);
  await fsp.mkdir(path.join(dir, 'files'), { recursive: true });
  const manifest = { version: 1, createdAt: now.toISOString(), entries: [] };
  const save = () => fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  await save();

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.({ index: i, total: items.length, path: item.path });
    const res = { path: item.path, ok: false, error: null, mode: null };
    results.push(res);
    let backup = null, before = null, wrote = false;
    try {
      const why = await precheck(item);
      if (why) { res.error = why; continue; }
      const st = await fsp.stat(item.path);
      before = { size: st.size, mtimeMs: Math.round(st.mtimeMs), atimeMs: Math.round(st.atimeMs) };
      backup = path.join(dir, 'files', mirrorPath(item.path));
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await copyKeepTimes(item.path, backup, fs.constants.COPYFILE_EXCL);
      if ((await fsp.stat(backup)).size !== before.size) throw Object.assign(new Error('backup-size'), { code: 'backup-failed' });

      wrote = true;
      const w = typeOf(item.path) === 'mp3' ? await writeId3(item.path, item.changes) : await writeBwf(item.path, item.changes);
      res.mode = w.mode;
      const after = typeOf(item.path) === 'mp3' ? await readId3(item.path) : await readBwf(item.path);
      if (!after.ok || !matches(after, item.changes)) throw Object.assign(new Error('verify-failed'), { code: 'verify-failed' });
      const stAfter = await fsp.stat(item.path);
      manifest.entries.push({ path: item.path, backup: path.relative(dir, backup), before, after: { size: stAfter.size, mtimeMs: Math.round(stAfter.mtimeMs) }, mode: w.mode, restored: false });
      await save();
      res.ok = true;
    } catch (err) {
      res.error = err.code || err.message;
      if (wrote && backup) { // the file may be half written: put the original back
        try { await restoreFile(backup, item.path, before); res.restored = true; } catch (e2) { res.error += ' (restore failed: ' + (e2.code || e2.message) + ')'; }
      }
    }
    if (!res.ok && backup) await fsp.rm(backup, { force: true }).catch(() => {});
  }
  if (!manifest.entries.length) await fsp.rm(dir, { recursive: true, force: true });
  return { dir: manifest.entries.length ? dir : null, results };
}

// ---- Restore --------------------------------------------------------------------------------

export async function readManifest(dir) {
  try {
    const m = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    return m && m.version === 1 && Array.isArray(m.entries) ? m : null;
  } catch { return null; }
}

// Files that were edited again (or replaced) after the batch are left alone.
export async function checkRestore(dir) {
  const m = await readManifest(dir);
  if (!m) return null;
  const todo = [], problems = [];
  for (const e of m.entries) {
    if (e.restored) continue;
    let st;
    try { st = await fsp.stat(e.path); } catch { problems.push({ path: e.path, error: 'missing' }); continue; }
    if (st.size !== e.after.size || Math.round(st.mtimeMs) !== e.after.mtimeMs) { problems.push({ path: e.path, error: 'changed' }); continue; }
    if (!fs.existsSync(path.join(dir, e.backup))) { problems.push({ path: e.path, error: 'no-backup' }); continue; }
    todo.push(e);
  }
  return { manifest: m, todo, problems, createdAt: m.createdAt };
}

export async function runRestore(dir) {
  const c = await checkRestore(dir);
  if (!c) return null;
  const results = [];
  for (const e of c.todo) {
    try {
      await restoreFile(path.join(dir, e.backup), e.path, e.before);
      e.restored = true;
      results.push({ path: e.path, ok: true });
    } catch (err) {
      results.push({ path: e.path, ok: false, error: err.code || err.message });
    }
  }
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(c.manifest, null, 1), 'utf8');
  const pending = c.manifest.entries.filter((e) => !e.restored).length;
  return { results, problems: c.problems, pending };
}
