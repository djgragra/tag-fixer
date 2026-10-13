// Takes the README / site screenshots of the real app (1240 x 800, fictitious data only).
// Run: node dev/make-screenshots.mjs   (needs `npm install` and a screen; see dev/e2e-electron.mjs)
// Writes docs/screenshots/{wav-bwf,mp3-cover,patterns,cart-check}.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWav, frame, text, tag, audioBytes, cartData } from './fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const parent = path.join(os.tmpdir(), 'Studio');
fs.rmSync(parent, { recursive: true, force: true });
const dir = path.join(parent, 'Jingles');
fs.mkdirSync(dir, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-shot-ud-'));
const pic = path.join(os.tmpdir(), 'cover.jpg');
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ checkUpdates: false, lastSeenVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, backupDir: path.join(os.tmpdir(), 'TagFixer Backups') }));

const W = (n, b) => fs.writeFileSync(path.join(dir, n), makeWav(b));
W('2026-10-13_0830_morning_jingle.wav', { bext: { description: 'Morning jingle 7s', originator: 'OnAir Garage', originatorReference: 'OAG20261013001', date: '2026-10-13', time: '08-30-00', version: 2, history: 'A=PCM,F=48000,W=24,M=stereo,T=Recorder\r\n' }, extra: [['cart', cartData({ title: 'Morning jingle', artist: 'OnAir Garage', cutId: '00123', startDate: '2026/10/13', endDate: '2099/12/31' })]] });
W('news_open_v3.wav', { bext: { description: 'News opener, final mix', originator: 'Radio Uno', date: '2025-11-02', time: '18-00-00', version: 1 }, extra: [['cart', cartData({ title: 'News opener', artist: 'Radio Uno', cutId: '00124' })]] });
W('legacy_cafe.wav', { bext: { description: 'café society', originator: 'OLD' } });
W('no_metadata.wav', {});
W('promo_spring.wav', { bext: { description: 'Spring promo', originator: 'Radio Uno', date: '2024-04-01', time: '10-00-00' } });
const t3 = (t) => tag(3, [frame(3, 'TIT2', text(0, t[0])), frame(3, 'TPE1', text(0, t[1])), frame(3, 'TALB', text(0, t[2])), frame(3, 'TYER', text(0, t[3])), frame(3, 'TRCK', text(0, t[4])), frame(3, 'TCON', text(0, t[5]))], { padding: 200 });
const mp3 = (n, t, withPic) => fs.writeFileSync(path.join(dir, n), Buffer.concat([withPic ? tag(3, [frame(3, 'TIT2', text(0, t[0])), frame(3, 'TPE1', text(0, t[1])), frame(3, 'TALB', text(0, t[2])), frame(3, 'TYER', text(0, t[3])), frame(3, 'TRCK', text(0, t[4])), frame(3, 'TCON', text(0, t[5])), frame(3, 'APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), Buffer.alloc(34000, 7)]))], { padding: 100 }) : t3(t), audioBytes(3)]));
mp3('track01.mp3', ['Morning Show Intro', 'OnAir Garage', 'Jingles 2026', '2026', '1/12', 'Jingle'], true);
mp3('track02.mp3', ['Evening Drive', 'OnAir Garage', 'Jingles 2026', '2026', '2/12', 'Jingle'], false);
mp3('track03.mp3', ['Weather Bed', 'Radio Uno', 'Beds', '2025', '3/12', 'Ambient'], true);
fs.writeFileSync(path.join(dir, 'untagged.mp3'), audioBytes(3));
fs.writeFileSync(pic, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 1)]));

const port = 9300 + Math.floor(Math.random() * 400);
const child = spawn(path.join(root, 'node_modules/.bin/electron'), ['--disable-gpu', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), root, `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; pending.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { if (await ev(fn)) return; await sleep(100); } throw new Error('timeout: ' + what); };
const type = (n, col, v) => ev(`(() => { const r = [...document.querySelectorAll('.body .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(n)}); const i = r.children[[...document.querySelectorAll('#head > div')].findIndex(h => h.textContent === ${JSON.stringify(col)})].querySelector('input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setVal = (sel, v, e = 'input') => ev(`(() => { const x = document.querySelector(${JSON.stringify(sel)}); x.value = ${JSON.stringify(v)}; x.dispatchEvent(new Event(${JSON.stringify(e)}, { bubbles: true })); })()`);
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name), Buffer.from(s.data, 'base64')); console.log('saved', name); };
const scheme = (v) => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });

try {
  let page; for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('renderer')); } catch { /* wait */ } await sleep(250); }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1240, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const files = fs.readdirSync(dir).map((n) => path.join(dir, n));
  for (const t of ['dragEnter', 'dragOver', 'drop']) await cdp('Input.dispatchDragEvent', { type: t, x: 300, y: 300, data: { items: [], files, dragOperationsMask: 1 } });
  await until(`document.getElementById('countMp3').textContent === '4' && [...document.querySelectorAll('.c-status')].every(s => !/reading/.test(s.textContent))`, 'files');

  // 1. WAV · BWF, dark: edits, an invalid date, a non-ASCII text
  await scheme('dark');
  await click('#tabWav');
  await type('news_open_v3.wav', 'Originator', 'Radio Uno Milano');
  await type('no_metadata.wav', 'Date', '2026-13-45');
  await type('no_metadata.wav', 'Description', 'Intervista è pronta');
  await type('promo_spring.wav', 'Description', 'Spring promo 2026');
  await sleep(500);
  await shot('wav-bwf.png');

  // 2. MP3, light: edited title, a cover to replace, an invalid year
  await scheme('light');
  await click('#tabMp3');
  await type('track01.mp3', 'Title', 'Morning Show Intro (new)');
  await type('untagged.mp3', 'Year', '20x6');
  await type('untagged.mp3', 'Title', 'Studio idents');
  await sleep(500);
  await shot('mp3-cover.png');

  // 3. Patterns, dark: reading artist and title out of file names is shown on the FLAC-less MP3 tab with a pattern
  await scheme('dark');
  await click('#toolPattern');
  await setVal('#patMode', 'rename', 'change');
  await setVal('#patPattern', '{n:2} - {artist} - {title}');
  await until(`!document.getElementById('patApply').disabled || document.getElementById('patPreview').rows.length > 1`, 'pattern preview');
  await sleep(500);
  await shot('patterns.png');
  await click('#patCancel');

  // 4. Cart view and the check list, light
  await scheme('light');
  await click('#tabWav');
  await click('[data-set="cart"]');
  await sleep(300);
  await click('#toolCheck');
  await until(`document.querySelectorAll('#checkList tr').length > 2`, 'check list');
  await sleep(400);
  await shot('cart-check.png');
} finally { ws?.close(); child.kill(); await sleep(300); fs.rmSync(parent, { recursive: true, force: true }); fs.rmSync(ud, { recursive: true, force: true }); fs.rmSync(pic, { force: true }); }
