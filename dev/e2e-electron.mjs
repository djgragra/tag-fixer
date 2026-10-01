// End-to-end check of the real app: starts Electron with a debugging port, drops files on the
// window, edits cells, saves, restores, and checks the files on disk.
// Run: node dev/e2e-electron.mjs   (needs `npm install`; opens a window for a few seconds)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readBwf } from '../src/bwf.js';
import { readId3 } from '../src/id3.js';
import { makeWav, frame, text, tag, audioBytes } from './fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(root, 'node_modules', '.bin', 'electron');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-ud-'));
const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-bk-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ backupDir: backups }));

const wavA = makeWav({ bext: { description: 'old description', originator: 'OLD', date: '2020-01-01', time: '01-02-03' } });
const wavB = makeWav();
const mp3C = Buffer.concat([tag(3, [frame(3, 'TIT2', text(0, 'Old title')), frame(3, 'TPE1', text(0, 'Old artist')), frame(3, 'PRIV', Buffer.from('owner\0data'))], { padding: 300 }), audioBytes(4)]);
fs.writeFileSync(path.join(dir, 'a.wav'), wavA);
fs.writeFileSync(path.join(dir, 'b.wav'), wavB);
fs.writeFileSync(path.join(dir, 'c.mp3'), mp3C);
fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');

const port = 9800 + Math.floor(Math.random() * 500);
const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(100); }
}

let ws, id = 0;
const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; pending.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
// Sets a cell the way a user would: focus, set the value, fire an input event.
const typeCell = (name, field, value) => js(`(() => { const inp = [...document.querySelectorAll('.body .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(name)}).children[[...document.querySelectorAll('#head > div')].findIndex(h => h.textContent === ${JSON.stringify(field)})].querySelector('input'); inp.focus(); inp.value = ${JSON.stringify(value)}; inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);

try {
  const page = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('renderer/index.html')); } catch { return null; } }, 'window');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } });
  await sleep(500);

  // 1. drop three files (and a text file that must be ignored) on the window
  const files = ['a.wav', 'b.wav', 'c.mp3', 'notes.txt'].map((n) => path.join(dir, n));
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp('Input.dispatchDragEvent', { type, x: 300, y: 300, data: { items: [], files, dragOperationsMask: 1 } });
  await until(() => js(`document.getElementById('countMp3').textContent === '1' && document.getElementById('countWav').textContent === '2'`), 'files listed');
  await until(() => js(`[...document.querySelectorAll('.c-status')].every(s => !/reading/.test(s.textContent))`), 'tags read');

  // 2. the WAV tab shows what is in the file
  await click('#tabWav');
  const cells = await js(`[...document.querySelectorAll('.body .row')].map(r => ({ name: r.querySelector('.name').textContent, v: [...r.querySelectorAll('input.cell')].map(i => i.value) }))`);
  assert.deepEqual(cells.find((c) => c.name === 'a.wav').v, ['old description', 'OLD', '', '2020-01-01', '01-02-03']);
  assert.deepEqual(cells.find((c) => c.name === 'b.wav').v, ['', '', '', '', '']);

  // 3. an invalid edit blocks saving; a non-ASCII edit is fixed with "Convert to ASCII"
  await typeCell('a.wav', 'Date', '2026-02-30');
  await until(() => js(`document.querySelector('#saveBtn').disabled && document.querySelector('.cell--err')`), 'invalid date blocks save');
  await typeCell('a.wav', 'Date', '2026-10-01');
  await typeCell('a.wav', 'Description', 'Città nuova');
  await until(() => js(`!document.querySelector('#asciiBtn').hidden`), 'ascii button');
  await click('#asciiBtn');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'Citta nuova'`), 'converted');

  // 4. "set for all checked rows": originator on both WAV files
  await js(`(() => { const inp = document.querySelectorAll('#applyRow input')[1]; inp.value = 'OnAir Garage'; document.querySelectorAll('#applyRow button')[1].click(); })()`);
  await until(() => js(`!document.querySelector('#saveBtn').disabled`), 'save enabled');
  assert.match(await js(`document.querySelector('#saveBtn').textContent`), /2/);

  // 5. MP3 tab: edit the title
  await click('#tabMp3');
  await typeCell('c.mp3', 'Title', 'New title');
  await click('#tabWav');

  // 6. save everything (3 files): confirm dialog, backups, results
  assert.match(await js(`document.querySelector('#saveBtn').textContent`), /3/);
  await click('#saveBtn');
  await until(() => js(`document.getElementById('confirmDlg').open && !document.getElementById('confirmOk').disabled`), 'confirm dialog');
  assert.equal(await js(`document.getElementById('confirmDir').textContent`), backups);
  await click('#confirmOk');
  await until(() => js(`document.getElementById('resultDlg').open`), 'result dialog');
  assert.match(await js(`document.getElementById('resultText').textContent`), /3 saved/);
  await click('#resultClose');

  // 7. the files on disk
  const a = await readBwf(path.join(dir, 'a.wav')), b = await readBwf(path.join(dir, 'b.wav'));
  assert.deepEqual(a.fields, { description: 'Citta nuova', originator: 'OnAir Garage', originatorReference: '', date: '2026-10-01', time: '01-02-03' });
  assert.equal(b.hasBext, true);
  assert.equal(b.fields.originator, 'OnAir Garage');
  const c = await readId3(path.join(dir, 'c.mp3'));
  assert.equal(c.fields.title, 'New title');
  assert.equal(c.fields.artist, 'Old artist');
  assert.ok(c.frames.some((f) => f.id === 'PRIV'));
  assert.ok(fs.readFileSync(path.join(dir, 'c.mp3')).subarray(c.audioOffset).equals(audioBytes(4)));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.wav', 'b.wav', 'c.mp3', 'notes.txt'], 'no temporary files left');

  // 8. the backup holds the originals
  const batch = fs.readdirSync(backups).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}/.test(n));
  assert.equal(batch.length, 1);
  const mf = JSON.parse(fs.readFileSync(path.join(backups, batch[0], 'manifest.json'), 'utf8'));
  assert.equal(mf.entries.length, 3);
  assert.ok(fs.readFileSync(path.join(backups, batch[0], mf.entries.find((e) => e.path.endsWith('a.wav')).backup)).equals(wavA));

  // 9. restore the batch: the original bytes come back
  await until(() => js(`!document.getElementById('restoreBtn').disabled`), 'restore enabled');
  await click('#restoreBtn');
  await until(() => js(`document.getElementById('restoreDlg').open && !document.getElementById('restoreOk').disabled`), 'restore dialog');
  await click('#restoreOk');
  await until(() => fs.readFileSync(path.join(dir, 'a.wav')).equals(wavA) && fs.readFileSync(path.join(dir, 'b.wav')).equals(wavB) && fs.readFileSync(path.join(dir, 'c.mp3')).equals(mp3C), 'originals restored');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'old description'`), 'table refreshed');
  console.log('e2e OK');
} finally {
  ws?.close();
  child.kill();
  for (const d of [dir, userData, backups]) fs.rmSync(d, { recursive: true, force: true });
}
