// End-to-end check of the real app: starts Electron with a debugging port, drops files on the window, edits cells,
// uses the tools (patterns, find & replace, date, history, check, undo), saves, renames, restores, and checks the
// files on disk.
// Run: node dev/e2e-electron.mjs   (needs `npm install`; opens a window for a few seconds; on a machine without a
// screen start Xvfb first and set DISPLAY, for example: Xvfb :77 & DISPLAY=:77 node dev/e2e-electron.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readBwf } from '../src/bwf.js';
import { readId3 } from '../src/id3.js';
import { readFlac } from '../src/flac.js';
import { makeWav, frame, text, tag, audioBytes, cartData } from './fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(root, 'node_modules', '.bin', 'electron');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-ud-'));
const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-bk-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ backupDir: backups, checkUpdates: false }));

const wavA = makeWav({ bext: { description: 'old description', originator: 'OLD', date: '2020-01-01', time: '01-02-03' } });
const wavB = makeWav();
const wavC = makeWav({ rf64: 'RF64', bext: { description: 'big file' }, extra: [['cart', cartData({ title: 'Cart one', cutId: '7' })]] });
const mp3D = Buffer.concat([tag(3, [frame(3, 'TIT2', text(0, 'Old title')), frame(3, 'TPE1', text(0, 'Old artist')), frame(3, 'PRIV', Buffer.from('owner\0data'))], { padding: 300 }), audioBytes(4)]);
const flacE = (() => {
  const le32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x; };
  const blk = (t, last, data) => { const h = Buffer.alloc(4); h[0] = (last ? 0x80 : 0) | t; h.writeUIntBE(data.length, 1, 3); return Buffer.concat([h, data]); };
  const si = Buffer.alloc(34); si[10] = 0x0a; si[11] = 0xc4; si[12] = 0x42; si[13] = 0xf0;
  const vc = Buffer.concat([le32(3), Buffer.from('abc'), le32(2), le32(11), Buffer.from('TITLE=Hello'), le32(12), Buffer.from('ARTIST=Bandy')]);
  return Buffer.concat([Buffer.from('fLaC'), blk(0, false, si), blk(4, false, vc), blk(1, true, Buffer.alloc(200)), Buffer.alloc(900, 3)]);
})();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 0x42), Buffer.from([0xff, 0xd9])]);
const apic = frame(3, 'APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3]), Buffer.from('\0'), Buffer.alloc(200, 0x11)]));
const mp3E = Buffer.concat([tag(3, [frame(3, 'TIT2', text(0, 'Has cover')), apic], { padding: 100 }), audioBytes(4)]);
const names = { 'a.wav': wavA, 'b.wav': wavB, 'c.wav': wavC, 'd.mp3': mp3D, 'e.mp3': mp3E, 'Band - Song.flac': flacE };
for (const [n, b] of Object.entries(names)) fs.writeFileSync(path.join(dir, n), b);
fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
const picFile = path.join(os.tmpdir(), `tf-e2e-pic-${process.pid}.jpg`);
fs.writeFileSync(picFile, JPEG);
const csvFile = path.join(os.tmpdir(), `tf-e2e-${process.pid}.csv`);
const cfgFile = path.join(os.tmpdir(), `tf-e2e-cfg-${process.pid}.json`);
const times = new Date(2024, 4, 6, 7, 8, 9);
fs.utimesSync(path.join(dir, 'b.wav'), times, times);

const port = 9800 + Math.floor(Math.random() * 500);
const answersFile = path.join(os.tmpdir(), `tf-e2e-answers-${process.pid}.json`);
fs.writeFileSync(answersFile, '[]');
const args = ['--disable-gpu', '--require', path.join(root, 'dev', 'test-dialogs.cjs'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`];
const child = spawn(electron, args, { stdio: 'ignore', env: { ...process.env, TF_DIALOG_ANSWERS: answersFile } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(100); }
}

let ws, id = 0;
const pending = new Map();
const errors = [];
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; pending.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
// Sets a cell the way a user would: focus, set the value, fire an input event.
const typeCell = (name, field, value) => js(`(() => { const inp = [...document.querySelectorAll('.body .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(name)} || r.querySelector('.meta').textContent.startsWith('was: ' + ${JSON.stringify(name)})).children[[...document.querySelectorAll('#head > div')].findIndex(h => h.textContent === ${JSON.stringify(field)})].querySelector('input'); inp.focus(); inp.value = ${JSON.stringify(value)}; inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const cellValues = () => js(`[...document.querySelectorAll('.body .row')].map(r => ({ name: r.querySelector('.name').textContent, v: [...r.querySelectorAll('input.cell')].map(i => i.value) }))`);
// The native file dialogs answer from a queue (dev/test-dialogs.cjs)
const answerDialog = async (answer) => fs.writeFileSync(answersFile, JSON.stringify([...JSON.parse(fs.readFileSync(answersFile, 'utf8')), answer]));
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setVal = (sel, v, ev = 'input') => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); })()`);
const settle = () => until(() => js(`[...document.querySelectorAll('.c-status')].every(s => !/reading/.test(s.textContent))`), 'tags read');

try {
  const page = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('renderer/index.html')); } catch { return null; } }, 'window', 20000);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 500));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(JSON.stringify(d.params.args.map((a) => a.value || a.description)).slice(0, 500));
  });
  await cdp('Runtime.enable');
  await sleep(600);

  // 1. drop the files (and a text file that must be ignored) on the window
  const files = [...Object.keys(names), 'notes.txt'].map((n) => path.join(dir, n));
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp('Input.dispatchDragEvent', { type, x: 300, y: 300, data: { items: [], files, dragOperationsMask: 1 } });
  await until(() => js(`document.getElementById('countMp3').textContent === '2' && document.getElementById('countWav').textContent === '3' && document.getElementById('countFlac').textContent === '1'`), 'files listed');
  await settle();
  assert.match(await js(`document.getElementById('pill').textContent`), /6 files/);

  // 2. the WAV tab: three views
  await click('#tabWav');
  let cells = await cellValues();
  assert.deepEqual(cells.find((c) => c.name === 'a.wav').v, ['old description', 'OLD', '', '2020-01-01', '01-02-03', '']);
  assert.equal(cells.find((c) => c.name === 'c.wav').v[0], 'big file');
  assert.match(await js(`[...document.querySelectorAll('.c-info')].map(i => i.textContent).join('|')`), /RF64/);
  await click('[data-set="cart"]');
  cells = await cellValues();
  assert.equal(cells.find((c) => c.name === 'c.wav').v[0], 'Cart one');
  assert.equal(cells.find((c) => c.name === 'c.wav').v[2], '7');
  await click('[data-set="ixml"]');
  await click('[data-set="bwf"]');

  // 3. an invalid edit blocks saving; a non-ASCII edit is fixed with "Convert to ASCII"
  await typeCell('a.wav', 'Date', '2026-02-30');
  await until(() => js(`document.querySelector('#saveBtn').disabled && document.querySelector('.cell--err')`), 'invalid date blocks save');
  await typeCell('a.wav', 'Date', '2026-10-01');
  await typeCell('a.wav', 'Description', 'Città nuova');
  await until(() => js(`!document.querySelector('#asciiBtn').hidden`), 'ascii button');
  await click('#asciiBtn');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'Citta nuova'`), 'converted');

  // 4. undo and redo
  await click('#undoBtn');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'Città nuova'`), 'undo of the conversion');
  await click('#redoBtn');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'Citta nuova'`), 'redo');

  // 5. "set for all checked rows": originator on all WAV files
  await js(`(() => { const inp = document.querySelectorAll('#applyRow input')[1]; inp.value = 'OnAir Garage'; document.querySelectorAll('#applyRow button')[1].click(); })()`);
  await until(() => js(`!document.querySelector('#saveBtn').disabled`), 'save enabled');

  // 6. date tool: b.wav has no date in the name, so its modification time is used; a.wav is unchecked first
  await js(`(() => { const r = [...document.querySelectorAll('.body .row')][0]; r.querySelector('input[type=checkbox]').click(); })()`);
  await click('#toolDate');
  await until(() => js(`document.getElementById('dateDlg').open && document.querySelectorAll('#datePreview tr').length > 1`), 'date preview');
  await setVal('#dateSource', 'mtime', 'change');
  await until(() => js(`/2024-05-06/.test(document.getElementById('datePreview').textContent)`), 'date from mtime');
  await click('#dateApply');
  await until(() => js(`!document.getElementById('dateDlg').open`), 'date applied');
  cells = await cellValues();
  assert.equal(cells.find((c) => c.name === 'b.wav').v[3], '2024-05-06');
  assert.equal(cells.find((c) => c.name === 'b.wav').v[4], '07-08-09');
  assert.equal(cells.find((c) => c.name === 'a.wav').v[3], '2026-10-01', 'the unchecked file was not touched by the tool');
  await js(`document.querySelectorAll('.body .row')[0].querySelector('input[type=checkbox]').click()`);

  // 7. coding history: add a line to all checked WAV files
  await click('#toolHistory');
  await setVal('#histText', 'A=PCM,F=48000,W=16,M=stereo');
  await setVal('#histMode', 'append', 'change');
  await click('#histApply');
  await until(() => js(`!document.getElementById('historyDlg').open`), 'history applied');
  assert.match(await js(`[...document.querySelectorAll('.body .row')][1].querySelectorAll('input.cell')[5].value`), /A=PCM/);

  // 8. find & replace on the cart title and iXML scene via the view's fields
  await click('[data-set="ixml"]');
  await typeCell('b.wav', 'Scene', '12A');
  await typeCell('b.wav', 'Note', 'two  spaces');
  await click('#toolFind');
  await setVal('#findField', 'ixmlNote', 'change');
  await setVal('#findOp', 'spaces', 'change');
  await until(() => js(`!document.getElementById('findApply').disabled`), 'find preview');
  await click('#findApply');
  await until(() => js(`!document.getElementById('findDlg').open`), 'find applied');
  cells = await cellValues();
  assert.equal(cells.find((c) => c.name === 'b.wav').v[4], 'two spaces');
  await click('[data-set="bwf"]');

  // 9. FLAC tab: pattern that reads artist and title from the file name; rename from tags
  await click('#tabFlac');
  await click('#toolPattern');
  await setVal('#patMode', 'read', 'change');
  await setVal('#patPattern', '{artist} - {title}');
  await until(() => js(`!document.getElementById('patApply').disabled`), 'pattern preview');
  assert.match(await js(`document.getElementById('patPreview').textContent`), /Bandy|Band/);
  await click('#patApply');
  await until(() => js(`!document.getElementById('patternDlg').open`), 'pattern applied');
  cells = await cellValues();
  assert.deepEqual(cells[0].v.slice(0, 2), ['Song', 'Band']);
  await click('#toolPattern');
  await setVal('#patMode', 'rename', 'change');
  await setVal('#patPattern', '{artist} - {title} ({n:2})');
  await until(() => js(`!document.getElementById('patApply').disabled`), 'rename preview');
  await click('#patApply');
  await until(() => js(`!document.getElementById('patternDlg').open`), 'rename applied');
  assert.match(await js(`document.querySelector('.body .row .name').textContent`), /^Band - Song \(01\)\.flac$/);

  // 10. MP3 tab: edit the title; choose a cover for all checked files; the table out to CSV and back; a saved pattern in the configuration backup
  await click('#tabMp3');
  await typeCell('d.mp3', 'Title', 'New title');
  await click('#toolCover');
  await answerDialog({ canceled: false, filePaths: [picFile] });
  await click('#coverPick');
  await until(() => js(`!document.getElementById('coverUseAll').disabled`), 'cover chosen');
  await click('#coverUseAll');
  await until(() => js(`!document.getElementById('coverDlg').open`), 'cover applied');
  cells = await cellValues();
  assert.match(cells.find((c) => c.name === 'd.mp3').v[7], /^→ tf-e2e-pic/);
  assert.match(cells.find((c) => c.name === 'e.mp3').v[7], /^→ tf-e2e-pic/);

  await click('#toolCsvOut');
  await answerDialog({ canceled: false, filePath: csvFile });
  await click('#csvGo');
  await until(() => fs.existsSync(csvFile), 'csv written');
  const csvText = fs.readFileSync(csvFile, 'utf8');
  assert.ok(csvText.startsWith('\uFEFFpath,title,artist,album,year,track,genre,comment'));
  assert.ok(csvText.includes('New title') && csvText.includes('Has cover'));
  fs.writeFileSync(csvFile, csvText.replace('New title', 'Title from CSV'));
  await click('#toolCsvIn');
  await answerDialog({ canceled: false, filePaths: [csvFile] });
  await click('#csvGo');
  await until(() => js(`document.getElementById('csvGo').textContent === 'Apply'`), 'csv plan');
  assert.match(await js(`document.getElementById('csvList').textContent`), /2 files will be updated/);
  await click('#csvGo');
  await until(() => js(`!document.getElementById('csvDlg').open`), 'csv applied');
  assert.equal((await cellValues()).find((c) => c.name === 'd.mp3').v[0], 'Title from CSV');

  await click('#toolPattern');
  await setVal('#patPattern', '{artist} - {title}');
  await setVal('#patPresetName', 'Artist and title');
  await click('#patPresetSave');
  await until(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).presets?.length === 1, 'preset saved');
  await click('#patCancel');
  await click('#settingsBtn');
  await click('[data-stab="backup"]');
  await answerDialog({ canceled: false, filePath: cfgFile });
  await click('#cfgExport');
  await until(() => fs.existsSync(cfgFile), 'configuration exported');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.deepEqual([cfg.app, cfg.version, cfg.includesSecrets, cfg.presets.length, 'backupDir' in cfg.settings], ['tag-fixer', 1, false, 1, false]);
  await click('#settingsClose');
  await click('#toolPattern'); // delete the preset again, then bring it back by importing the file
  await setVal('#patPresets', cfg.presets[0].id, 'change');
  await click('#patPresetDel');
  await until(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).presets.length === 0, 'preset deleted');
  await click('#patCancel');
  await click('#settingsBtn');
  await click('[data-stab="backup"]');
  await answerDialog({ canceled: false, filePaths: [cfgFile] });
  await click('#cfgImport');
  await until(() => js(`!document.getElementById('cfgChoose').hidden`), 'import choice');
  await click('#cfgApply');
  await until(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).presets.length === 1, 'preset imported');
  await click('#settingsClose');

  // 11. check files: lists problems, clicking a line goes to the file
  await click('#toolCheck');
  await until(() => js(`document.getElementById('checkDlg').open && document.querySelectorAll('#checkList tr').length > 1`), 'check list');
  await click('#checkClose');

  // 12. save everything: confirm dialog, backups, results (5 files)
  assert.match(await js(`document.querySelector('#saveBtn').textContent`), /6/);
  await click('#saveBtn');
  await until(() => js(`document.getElementById('confirmDlg').open && !document.getElementById('confirmOk').disabled`), 'confirm dialog');
  assert.equal(await js(`document.getElementById('confirmDir').textContent`), backups);
  await click('#confirmOk');
  await until(() => js(`document.getElementById('resultDlg').open`), 'result dialog');
  assert.match(await js(`document.getElementById('resultText').textContent`), /6 saved/);
  await click('#resultClose');

  // 13. the files on disk
  const a = await readBwf(path.join(dir, 'a.wav')), b = await readBwf(path.join(dir, 'b.wav')), c = await readBwf(path.join(dir, 'c.wav'));
  assert.equal(a.fields.description, 'Citta nuova');
  assert.equal(a.fields.originator, 'OnAir Garage');
  assert.equal(a.fields.date, '2026-10-01');
  assert.equal(b.hasBext, true);
  assert.equal(b.fields.date, '2024-05-06');
  assert.equal(b.fields.ixmlScene, '12A');
  assert.equal(b.fields.ixmlNote, 'two spaces');
  assert.equal(b.fields.codingHistory, 'A=PCM,F=48000,W=16,M=stereo');
  assert.equal(c.rf64, true);
  assert.equal(c.fields.originator, 'OnAir Garage');
  assert.equal(c.fields.cartTitle, 'Cart one');
  assert.equal(c.fields.codingHistory, 'A=PCM,F=48000,W=16,M=stereo');
  const d = await readId3(path.join(dir, 'd.mp3'));
  assert.equal(d.fields.title, 'Title from CSV');
  assert.equal(d.fields.artist, 'Old artist');
  assert.equal(d.cover.size, JPEG.length);
  assert.equal((await readId3(path.join(dir, 'e.mp3'))).cover.size, JPEG.length, 'the front cover of the other file was replaced');
  assert.ok(d.frames.some((f) => f.id === 'PRIV'));
  assert.ok(fs.readFileSync(path.join(dir, 'd.mp3')).subarray(d.audioOffset).equals(audioBytes(4)));
  assert.ok(fs.existsSync(path.join(dir, 'Band - Song (01).flac')), 'the FLAC file was renamed');
  assert.ok(!fs.existsSync(path.join(dir, 'Band - Song.flac')));
  const f = await readFlac(path.join(dir, 'Band - Song (01).flac'));
  assert.deepEqual([f.fields.title, f.fields.artist], ['Song', 'Band']);
  assert.ok(fs.readFileSync(path.join(dir, 'Band - Song (01).flac')).subarray(f.audioOffset).equals(flacE.subarray(flacE.length - 900)), 'FLAC audio untouched');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Band - Song (01).flac', 'a.wav', 'b.wav', 'c.wav', 'd.mp3', 'e.mp3', 'notes.txt'], 'no temporary files left');

  // 14. the backup holds the originals
  const batch = fs.readdirSync(backups).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}/.test(n));
  assert.equal(batch.length, 1);
  const mf = JSON.parse(fs.readFileSync(path.join(backups, batch[0], 'manifest.json'), 'utf8'));
  assert.equal(mf.entries.length, 6);
  assert.ok(fs.readFileSync(path.join(backups, batch[0], mf.entries.find((e) => e.path.endsWith('a.wav')).backup)).equals(wavA));

  // 15. restore the batch: the original bytes and names come back
  await until(() => js(`!document.getElementById('restoreBtn').disabled`), 'restore enabled');
  await click('#restoreBtn');
  await until(() => js(`document.getElementById('restoreDlg').open && !document.getElementById('restoreOk').disabled`), 'restore dialog');
  await click('#restoreOk');
  await until(() => ['a.wav', 'b.wav', 'c.wav', 'd.mp3', 'e.mp3', 'Band - Song.flac'].every((n) => fs.existsSync(path.join(dir, n)) && fs.readFileSync(path.join(dir, n)).equals(names[n])), 'originals restored');
  await click('#tabWav');
  await until(() => js(`[...document.querySelectorAll('.body .row')][0].querySelector('input.cell').value === 'old description'`), 'table refreshed');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Band - Song.flac', 'a.wav', 'b.wav', 'c.wav', 'd.mp3', 'e.mp3', 'notes.txt']);

  // 16. settings: the tabs, the language, the configuration backup box, About
  await click('#settingsBtn');
  await until(() => js(`document.getElementById('settingsDlg').open`), 'settings');
  for (const tab of ['updates', 'backup', 'about', 'general']) {
    await click(`[data-stab="${tab}"]`);
    assert.equal(await js(`[...document.querySelectorAll('[data-spane]')].filter(p => !p.hidden).map(p => p.getAttribute('data-spane')).join()`), tab);
  }
  await setVal('#langSel', 'it', 'change');
  await until(() => js(`document.querySelector('[data-stab="about"]').textContent === 'Aiuto e informazioni'`), 'Italian');
  await setVal('#langSel', 'en', 'change');
  await click('#settingsClose');
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).language, 'en');

  assert.deepEqual(errors, [], 'no errors in the window');
  console.log('e2e OK');
} finally {
  ws?.close();
  child.kill();
  await sleep(300);
  for (const f of [picFile, csvFile, cfgFile, answersFile]) fs.rmSync(f, { force: true });
  for (const d of [dir, userData, backups]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}
