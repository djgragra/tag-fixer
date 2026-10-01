// Dev helper: opens the app on sample files and saves a screenshot. node dev/shot.mjs out.png [tab] [light|dark]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWav, frame, text, tag, audioBytes } from './fixtures.js';

const [out = 'shot.png', tab = 'wav', scheme = 'dark'] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-shot-'));
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-shot-ud-'));
const W = (n, b, extra) => fs.writeFileSync(path.join(dir, n), extra ? makeWav(b) : b);
W('2026-09-30_morning_jingle.wav', { bext: { description: 'Morning jingle 7s', originator: 'OnAir Garage', originatorReference: 'OAG20260930001', date: '2026-09-30', time: '07:30:15', version: 2 } }, true);
W('news_open_v3.wav', { bext: { description: 'News opener, final mix', originator: 'Radio Uno', date: '2025-11-02', time: '18:00:00', version: 1 } }, true);
W('legacy_cafe.wav', { bext: { description: 'café society', originator: 'OLD' } }, true);
W('no_metadata.wav', {}, true);
W('promo_spring.wav', { bext: { description: 'Spring promo', originator: 'Radio Uno', date: '2024-04-01', time: '10:00:00' } }, true);
const t3 = (t) => tag(3, [frame(3, 'TIT2', text(0, t[0])), frame(3, 'TPE1', text(0, t[1])), frame(3, 'TALB', text(0, t[2])), frame(3, 'TYER', text(0, t[3])), frame(3, 'TRCK', text(0, t[4])), frame(3, 'TCON', text(0, t[5]))], { padding: 200 });
W('track01.mp3', Buffer.concat([t3(['Morning Show Intro', 'OnAir Garage', 'Jingles 2026', '2026', '1/12', 'Jingle']), audioBytes(3)]));
W('track02.mp3', Buffer.concat([t3(['Evening Drive', 'OnAir Garage', 'Jingles 2026', '2026', '2/12', 'Jingle']), audioBytes(3)]));
W('untagged.mp3', audioBytes(3));

const port = 9300 + Math.floor(Math.random() * 400);
const child = spawn(path.join(root, 'node_modules/.bin/electron'), [root, `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; pending.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); });
try {
  let page; for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} await sleep(250); }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await sleep(400);
  const files = fs.readdirSync(dir).map((n) => path.join(dir, n));
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp('Input.dispatchDragEvent', { type, x: 300, y: 300, data: { items: [], files, dragOperationsMask: 1 } });
  await sleep(1200);
  const ev = (e) => cdp('Runtime.evaluate', { expression: e, awaitPromise: true });
  await ev(`document.getElementById('tab${tab === 'mp3' ? 'Mp3' : 'Wav'}').click()`);
  // a few edits so the highlights show
  const type = (n, col, v) => ev(`(() => { const r = [...document.querySelectorAll('.body .row')].find(r => r.querySelector('.name').textContent === ${JSON.stringify(n)}); const i = r.children[[...document.querySelectorAll('#head > div')].findIndex(h => h.textContent === ${JSON.stringify(col)})].querySelector('input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
  if (tab === 'wav') { await type('news_open_v3.wav', 'Originator', 'Radio Uno Milano'); await type('no_metadata.wav', 'Date', '2026-13-45'); await type('no_metadata.wav', 'Description', 'Intervista è pronta'); await type('promo_spring.wav', 'Description', 'Spring promo 2026'); }
  else { await type('track01.mp3', 'Title', 'Morning Show Intro (new)'); await type('untagged.mp3', 'Year', '20x6'); }
  await sleep(500);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
} finally { ws?.close(); child.kill(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ud, { recursive: true, force: true }); }
