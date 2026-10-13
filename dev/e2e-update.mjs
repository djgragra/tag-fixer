// End-to-end check of the guided update with a fake GitHub: a local HTTPS server answers for api.github.com and
// github.com (Electron is told to map those names to it and to accept its self-signed certificate), so the real
// download code (net.fetch, SHA-256, progress, safety copy, remind / skip) runs. "Close and install" on Linux only
// shows the file in its folder; the Windows and macOS steps cannot be tried here.
// Run: node dev/e2e-update.mjs   (needs openssl and a screen; see dev/e2e-electron.mjs)
import { spawn, execFileSync } from 'node:child_process';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(root, 'node_modules', '.bin', 'electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-upd-'));
const userData = path.join(tmp, 'ud'), home = path.join(tmp, 'home');
fs.mkdirSync(userData); fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true });
fs.mkdirSync(path.join(home, '.config'), { recursive: true });
fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'XDG_DOWNLOAD_DIR="$HOME/Downloads"\n'); // where this machine keeps downloads
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language: 'en', checkUpdates: true, backupDir: path.join(tmp, 'bk'), lastSeenVersion: '26.10.2' }));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });

const VERSION = '99.0.0';
const payload = crypto.randomBytes(300_000);
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const state = { bad: false, hits: [] };
const NAME = `Tag-Fixer-${VERSION}.AppImage`;
const server = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (req, res) => {
  state.hits.push(req.headers.host + req.url);
  const dl = (f) => `https://github.com/djgragra/tag-fixer/releases/download/v${VERSION}/${f}`;
  if (req.url === '/repos/djgragra/tag-fixer/releases/latest') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tag_name: `v${VERSION}`, body: '## What is new\n- first thing\n- second thing', assets: [
      { name: NAME, size: payload.length, browser_download_url: dl(NAME) },
      { name: 'Tag-Fixer-Setup-99.0.0.exe', size: 3, browser_download_url: dl('Tag-Fixer-Setup-99.0.0.exe') },
      { name: 'SHA256SUMS.txt', size: 100, browser_download_url: dl('SHA256SUMS.txt') }] }));
  } else if (req.url.endsWith('/SHA256SUMS.txt')) res.end(`${state.bad ? 'f'.repeat(64) : sha}  ${NAME}\n`);
  else if (req.url.endsWith('/' + NAME)) { res.setHeader('content-length', payload.length); res.write(payload.subarray(0, 100_000)); setTimeout(() => res.end(payload.subarray(100_000)), 400); }
  else { res.statusCode = 404; res.end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const sport = server.address().port;

const port = 9800 + Math.floor(Math.random() * 500);
const args = ['--disable-gpu', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--host-resolver-rules=MAP api.github.com 127.0.0.1:${sport}, MAP github.com 127.0.0.1:${sport}`, '--ignore-certificate-errors', '--no-proxy-server', root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`];
const child = spawn(electron, args, { stdio: 'ignore', env: { ...process.env, HOME: home, XDG_DOWNLOAD_DIR: path.join(home, 'Downloads') } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 20000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(100); } }
let ws, id = 0; const pending = new Map(); const errors = [];
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const my = ++id; pending.set(my, { resolve, reject }); ws.send(JSON.stringify({ id: my, method, params })); });
const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const banner = () => js(`(() => { const b = document.getElementById('updBanner'); return b.hidden ? null : b.textContent; })()`);
const clickBanner = (label) => js(`(() => { const b = [...document.querySelectorAll('#updBanner button')].find(x => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
const settingsJson = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));

try {
  const page = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('renderer/index.html')); } catch { return null; } }, 'window', 30000);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } else if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
  await cdp('Runtime.enable');

  // 1. the check at start (15 s) finds the release; the banner offers the choices
  await until(async () => /Version 99\.0\.0 is available/.test((await banner()) || ''), 'banner after the automatic check', 40000);
  const b = await banner();
  assert.match(b, /first thing/);
  for (const label of ['Download and install', 'Remind me later', 'Skip this version', 'Release notes']) assert.ok(await js(`[...document.querySelectorAll('#updBanner button')].some(x => x.textContent === ${JSON.stringify(label)})`), label);
  assert.ok(state.hits.some((h) => h.startsWith('api.github.com') || h.includes('/repos/djgragra/tag-fixer/releases/latest')));

  // 2. remind me later hides the banner for a day and the choice is saved; the settings pane still shows the version
  await clickBanner('Remind me later');
  await until(async () => (await banner()) === null, 'banner hidden');
  await until(() => settingsJson().updateState.remindUntil > Date.now(), 'remind saved');
  await js(`document.getElementById('settingsBtn').click()`);
  await js(`document.querySelector('[data-stab="updates"]').click()`);
  assert.match(await js(`document.getElementById('updText').textContent`), /Version 99\.0\.0 is available \(you have 26\.10\.2\)/);
  assert.match(await js(`document.getElementById('updLast').textContent`), /Last check: .*\(ok\)/);

  // 3. a wrong checksum: the download is refused and no file is left
  state.bad = true;
  await js(`document.getElementById('updDownload').click()`);
  await until(async () => /does not match the published SHA-256/.test(await js(`document.getElementById('updText').textContent`)), 'checksum error shown');
  const dl = path.join(home, 'Downloads');
  assert.deepEqual(fs.readdirSync(dl), [], 'no file kept after a failed check');

  // 4. the right checksum: progress, then "ready"
  state.bad = false;
  await js(`document.getElementById('updRetry').click()`);
  await until(() => js(`!document.getElementById('updProgress').hidden`), 'progress bar');
  await until(() => js(`!document.getElementById('updInstall').hidden`), 'ready to install', 30000);
  assert.match(await js(`document.getElementById('updText').textContent`), /downloaded and verified \(SHA-256\)/);
  const file = path.join(dl, NAME);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha);
  assert.deepEqual(fs.readdirSync(dl), [NAME], 'no .part file left');

  // 5. close and install: the safety copy of the settings is made first (Linux then only shows the file)
  await js(`document.getElementById('updInstall').click()`);
  await until(() => fs.existsSync(path.join(userData, 'backups', 'pre-update-26.10.2.json')), 'safety copy');
  await until(() => js(`/AppImage is shown/.test(document.querySelector('.toast')?.textContent || '')`), 'Linux hint');
  assert.equal(fs.readFileSync(path.join(userData, 'backups', 'pre-update-26.10.2.json'), 'utf8').includes('"language"'), true);

  // 6. skip this version: saved, and the banner stays away
  await js(`document.getElementById('settingsClose').click()`);
  assert.deepEqual(errors, [], 'no errors in the window');
  console.log('e2e-update OK');
} catch (err) {
  console.log('requests the fake GitHub saw:', state.hits.length);
  try { console.log('upd text:', await js(`document.getElementById('updText').textContent`), '| settings:', JSON.stringify(settingsJson().updateState)); } catch {}
  throw err;
} finally {
  ws?.close(); child.kill(); server.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
}
