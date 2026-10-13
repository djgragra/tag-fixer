import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readBwf, writeBwf, validateField, normalizeHistory, historyBytes } from '../src/bwf.js';
import { parseIxml, applyIxml, newIxml, escapeXml, scan } from '../src/ixml.js';
import { parseCart, applyCart, validateField as cartValidate, CART_FIXED } from '../src/cart.js';
import { makeWav, chunk, ds64Chunk, cartData, bextData, haveFfprobe } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-ext-'));
const put = (d, n, b) => { const p = path.join(d, n); fs.writeFileSync(p, b); return p; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const audioOf = (buf) => { const i = buf.indexOf('data'); return buf.subarray(i + 8, i + 8 + (buf.readUInt32LE(i + 4) === 0xffffffff ? buf.length : buf.readUInt32LE(i + 4))); };

// ---- CodingHistory --------------------------------------------------------------------------------

test('history: normalised on the way in, CR LF in the file, read back with plain line breaks', () => {
  assert.equal(normalizeHistory('A=PCM\r\nB=MPEG\r\n\r\n'), 'A=PCM\nB=MPEG');
  assert.equal(historyBytes('A\nB').toString('latin1'), 'A\r\nB\r\n');
  assert.equal(historyBytes('').length, 0);
  assert.equal(validateField('codingHistory', 'caffè'), 'non-ascii');
  assert.equal(validateField('codingHistory', 'x'.repeat(40000)), 'too-long');
});

test('history: a longer text rewrites the file, audio and other chunks stay byte for byte', async () => {
  const d = tmp();
  const orig = makeWav({ bext: { description: 'D', history: 'A=PCM\r\n' }, extra: [['LIST', Buffer.from('INFOabcd')]] });
  const p = put(d, 'h.wav', orig);
  const res = await writeBwf(p, { codingHistory: 'A=PCM\nB=ANALOGUE,M=stereo,T=tape' });
  assert.equal(res.mode, 'rewrite');
  const r = await readBwf(p);
  assert.ok(r.ok);
  assert.equal(r.fields.codingHistory, 'A=PCM\nB=ANALOGUE,M=stereo,T=tape');
  assert.equal(r.fields.description, 'D');
  const out = fs.readFileSync(p);
  assert.equal(out.readUInt32LE(4), out.length - 8, 'RIFF size matches');
  assert.equal(sha(audioOf(out)), sha(audioOf(orig)));
  assert.ok(out.includes('INFOabcd'));
});

test('history: same length is patched in place, and history can be emptied', async () => {
  const d = tmp();
  const p = put(d, 'h.wav', makeWav({ bext: { history: 'AAAA\r\n' } }));
  assert.equal((await writeBwf(p, { codingHistory: 'BBBB' })).mode, 'patch');
  assert.equal((await readBwf(p)).fields.codingHistory, 'BBBB');
  assert.equal((await writeBwf(p, { codingHistory: '' })).mode, 'rewrite');
  const r = await readBwf(p);
  assert.equal(r.fields.codingHistory, '');
  assert.equal(r.bext.size, 602);
});

test('history: a file without bext gets one with the history; a short bext locks the history', async () => {
  const d = tmp();
  const p = put(d, 'n.wav', makeWav());
  await writeBwf(p, { codingHistory: 'A=PCM' , description: 'x' });
  const r = await readBwf(p);
  assert.equal(r.fields.codingHistory, 'A=PCM');
  assert.equal(r.fields.description, 'x');
  const short = makeWav({ extra: [['bext', Buffer.alloc(400)]] });
  const q = put(d, 's.wav', short);
  const rs = await readBwf(q);
  assert.equal(rs.locked.codingHistory, 'bext-short');
  await assert.rejects(() => writeBwf(q, { codingHistory: 'x' }), { code: 'bext-short' });
});

// ---- iXML -----------------------------------------------------------------------------------------

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<BWFXML>
  <IXML_VERSION>1.5</IXML_VERSION>
  <PROJECT>Docu &amp; Co</PROJECT>
  <SCENE>12A</SCENE>
  <TAKE>3</TAKE>
  <NOTE>first line
second line</NOTE>
  <TRACK_LIST><TRACK_COUNT>2</TRACK_COUNT><TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK></TRACK_LIST>
  <USER><TAKE_TYPE>NO_GOOD</TAKE_TYPE></USER>
</BWFXML>
`;

test('ixml: reads the top-level elements only (not TAKE_TYPE, not nested NAME)', () => {
  const p = parseIxml(XML);
  assert.ok(p.ok);
  assert.deepEqual(p.fields, { ixmlProject: 'Docu & Co', ixmlScene: '12A', ixmlTape: '', ixmlTake: '3', ixmlNote: 'first line\nsecond line' });
  assert.equal(parseIxml('<foo/>').error, 'not-ixml');
  assert.equal(parseIxml('<BWFXML><PROJECT>x</BWFXML>').error, 'xml');
});

test('ixml: edits replace, add (in order) and remove elements, everything else untouched', () => {
  const out = applyIxml(XML, { ixmlScene: '7 & 8', ixmlTape: 'T-01', ixmlTake: '' });
  const p = parseIxml(out);
  assert.equal(p.fields.ixmlScene, '7 & 8');
  assert.equal(p.fields.ixmlTape, 'T-01');
  assert.equal(p.fields.ixmlTake, '');
  assert.ok(out.includes('<SCENE>7 &amp; 8</SCENE>'));
  assert.ok(out.indexOf('<TAPE>') > out.indexOf('<SCENE>') && out.indexOf('<TAPE>') < out.indexOf('<NOTE>'), 'TAPE after SCENE');
  assert.ok(out.includes('<TRACK_LIST><TRACK_COUNT>2</TRACK_COUNT>'));
  assert.ok(out.includes('<TAKE_TYPE>NO_GOOD</TAKE_TYPE>'));
  assert.ok(!out.includes('<TAKE>'), 'removed with its line');
  assert.equal(out.split('\n').length, XML.split('\n').length, 'one line out, one in');
});

test('ixml: new text, escaping, validation, complex elements refused', () => {
  const t = newIxml({ ixmlProject: 'A <b> & "c"', ixmlNote: 'x\ny' });
  assert.deepEqual(parseIxml(t).fields.ixmlProject, 'A <b> & "c"');
  assert.equal(escapeXml('<&>'), '&lt;&amp;&gt;');
  assert.equal(scan('<a><b/></a>').children.length, 1);
  assert.throws(() => applyIxml(XML, { ixmlProject: 'a\u0001' }), { code: 'invalid-char' });
  assert.throws(() => applyIxml('<BWFXML><NOTE>a<b>c</b></NOTE></BWFXML>', { ixmlNote: 'z' }), { code: 'ixml-complex' });
  assert.equal(parseIxml('<BWFXML><NOTE>a<b>c</b></NOTE></BWFXML>').complex.ixmlNote, 'ixml-complex');
});

test('ixml: in a WAV file — new chunk, longer text, same length patched, other encodings locked', async () => {
  const d = tmp();
  const orig = makeWav({ bext: { description: 'D' } });
  const p = put(d, 'i.wav', orig);
  assert.equal((await writeBwf(p, { ixmlProject: 'Docu', ixmlNote: 'hello' })).mode, 'rewrite');
  let r = await readBwf(p);
  assert.equal(r.fields.ixmlProject, 'Docu');
  assert.equal(r.fields.description, 'D');
  const out1 = fs.readFileSync(p);
  assert.equal(sha(audioOf(out1)), sha(audioOf(orig)));
  assert.ok(out1.indexOf('iXML') > out1.indexOf('bext') && out1.indexOf('iXML') < out1.indexOf('data'));
  assert.equal((await writeBwf(p, { ixmlProject: 'Docx' })).mode, 'patch');
  assert.equal((await writeBwf(p, { ixmlProject: 'A much longer project name' })).mode, 'rewrite');
  r = await readBwf(p);
  assert.equal(r.fields.ixmlProject, 'A much longer project name');
  assert.equal(r.fields.ixmlNote, 'hello');
  // utf-8 text with accents survives
  await writeBwf(p, { ixmlNote: 'caffè — è' });
  assert.equal((await readBwf(p)).fields.ixmlNote, 'caffè — è');
  // a declaration that says latin-1 is not touched
  const latin = put(d, 'l.wav', makeWav({ extra: [['iXML', Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><BWFXML></BWFXML>', 'latin1')]] }));
  const rl = await readBwf(latin);
  assert.equal(rl.locked.ixmlNote, 'ixml-encoding');
  await assert.rejects(() => writeBwf(latin, { ixmlNote: 'x' }), { code: 'ixml-encoding' });
});

// ---- cart -----------------------------------------------------------------------------------------

test('cart: layout offsets, validation, new and existing', () => {
  const c = cartData({ title: 'Jingle', artist: 'OnAir', cutId: '00123', startDate: '2026/10/13', endDate: '2099/12/31', tagText: 'tag' });
  const p = parseCart(c);
  assert.equal(p.version, '0101');
  assert.equal(p.fields.cartTitle, 'Jingle');
  assert.equal(p.fields.cartCutId, '00123');
  assert.equal(p.fields.cartEndDate, '2099/12/31');
  const n = applyCart(c, { cartTitle: 'New', cartArtist: '' });
  assert.equal(n.length, c.length);
  assert.equal(n.readInt32LE(616), -2300, 'level reference untouched');
  assert.equal(n.subarray(CART_FIXED).toString('latin1'), 'tag');
  assert.equal(parseCart(n).fields.cartArtist, '');
  const fresh = applyCart(null, { cartTitle: 'T' });
  assert.equal(fresh.length, CART_FIXED);
  assert.equal(fresh.toString('latin1', 0, 4), '0101');
  assert.equal(cartValidate('cartStartDate', '2026/02/30'), 'bad-date');
  assert.equal(cartValidate('cartStartTime', '24:00:00'), 'bad-time');
  assert.equal(cartValidate('cartTitle', 'x'.repeat(65)), 'too-long');
  assert.equal(cartValidate('cartTitle', 'é'), 'non-ascii');
});

test('cart: in a WAV file — patched in place, inserted when missing', async () => {
  const d = tmp();
  const p = put(d, 'c.wav', makeWav({ extra: [['cart', cartData({ title: 'Old', cutId: '1' })]] }));
  const before = fs.readFileSync(p);
  assert.equal((await writeBwf(p, { cartTitle: 'Brand new title', cartCutId: '' })).mode, 'patch');
  const after = fs.readFileSync(p);
  assert.equal(after.length, before.length);
  const r = await readBwf(p);
  assert.equal(r.fields.cartTitle, 'Brand new title');
  assert.equal(r.fields.cartCutId, '');
  const q = put(d, 'n.wav', makeWav());
  assert.equal((await writeBwf(q, { cartTitle: 'Added', cartStartDate: '2026/10/13', cartStartTime: '08:00:00' })).mode, 'rewrite');
  const rq = await readBwf(q);
  assert.equal(rq.fields.cartTitle, 'Added');
  assert.equal(rq.fields.cartStartTime, '08:00:00');
  assert.equal(rq.chunks.find((c) => c.id === 'cart').size, CART_FIXED);
  const short = put(d, 's.wav', makeWav({ extra: [['cart', Buffer.alloc(100)]] }));
  await assert.rejects(() => writeBwf(short, { cartTitle: 'x' }), { code: 'cart-short' });
});

test('all three together: bext, history, iXML and cart in one rewrite, audio identical', async () => {
  const d = tmp();
  const orig = makeWav({ bext: { description: 'x' }, dataBytes: 9000 });
  const p = put(d, 'all.wav', orig);
  await writeBwf(p, { description: 'Desc', codingHistory: 'A=PCM', ixmlScene: '9', cartTitle: 'T' });
  const r = await readBwf(p);
  assert.deepEqual([r.fields.description, r.fields.codingHistory, r.fields.ixmlScene, r.fields.cartTitle], ['Desc', 'A=PCM', '9', 'T']);
  assert.equal(sha(audioOf(fs.readFileSync(p))), sha(audioOf(orig)));
  if (haveFfprobe) {
    const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:format=duration', '-of', 'json', p], { encoding: 'utf8' }));
    assert.equal(out.format.tags.comment, 'Desc'); // ffmpeg's name for the bext Description
  }
});

// ---- RF64 / BW64 ----------------------------------------------------------------------------------

test('rf64: read with the 0xFFFFFFFF placeholder, sizes from ds64', async () => {
  const d = tmp();
  for (const magic of ['RF64', 'BW64']) {
    const p = put(d, `${magic}.wav`, makeWav({ rf64: magic, bext: { description: 'big file', originator: 'X' }, dataBytes: 6000 }));
    const r = await readBwf(p);
    assert.ok(r.ok, magic);
    assert.equal(r.rf64, true);
    assert.equal(r.fields.description, 'big file');
    assert.equal(r.chunks.find((c) => c.id === 'data').size, 6000);
    assert.ok(r.writable);
  }
});

test('rf64: in-place patch, and a rewrite that keeps ds64 consistent (riffSize + audio identical)', async () => {
  const d = tmp();
  const orig = makeWav({ rf64: 'RF64', bext: { description: 'x' }, dataBytes: 5000 });
  const p = put(d, 'r.wav', orig);
  assert.equal((await writeBwf(p, { description: 'patched' })).mode, 'patch');
  assert.equal((await writeBwf(p, { codingHistory: 'A=PCM,F=96000', ixmlNote: 'n', cartTitle: 'c' })).mode, 'rewrite');
  const out = fs.readFileSync(p);
  assert.equal(out.toString('latin1', 0, 4), 'RF64');
  assert.equal(out.readUInt32LE(4), 0xffffffff);
  const ds = out.indexOf('ds64') + 8;
  assert.equal(Number(out.readBigUInt64LE(ds)), out.length - 8, 'riffSize in ds64 follows the new length');
  assert.equal(Number(out.readBigUInt64LE(ds + 8)), 5000, 'dataSize unchanged');
  const r = await readBwf(p);
  assert.ok(r.ok);
  assert.deepEqual([r.fields.description, r.fields.codingHistory, r.fields.ixmlNote, r.fields.cartTitle], ['patched', 'A=PCM,F=96000', 'n', 'c']);
  assert.equal(sha(audioOf(out)), sha(audioOf(orig)));
  if (haveFfprobe) {
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', p], { encoding: 'utf8' }));
    assert.equal(info.streams[0].sample_rate, '48000');
  }
});

test('rf64: a chunk over 4 GB through the ds64 sizes (sparse file: only headers are read or written)', async () => {
  const d = tmp();
  const big = 4_500_000_000;
  const body = makeWav({ bext: { description: 'huge' } });
  const pre = body.subarray(12, body.indexOf('data')); // fmt + bext
  const head = Buffer.concat([Buffer.from('RF64'), Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('WAVE'), ds64Chunk({ dataSize: big }), pre, Buffer.from('data'), Buffer.from([0xff, 0xff, 0xff, 0xff])]);
  const ds = head.indexOf('ds64') + 8;
  head.writeBigUInt64LE(BigInt(head.length - 8 + big), ds);
  const p = path.join(d, 'huge.wav');
  const fd = fs.openSync(p, 'w');
  fs.writeSync(fd, head);
  fs.ftruncateSync(fd, head.length + big);
  fs.closeSync(fd);
  const r = await readBwf(p);
  assert.ok(r.ok, r.error);
  assert.equal(r.chunks.find((c) => c.id === 'data').size, big);
  assert.equal(r.fields.description, 'huge');
  assert.equal((await writeBwf(p, { description: 'still huge' })).mode, 'patch');
  assert.equal((await readBwf(p)).fields.description, 'still huge');
  fs.rmSync(p);
}, { skip: process.env.TF_SKIP_BIG === '1' || process.platform === 'win32' });

test('rf64: bad ds64 and a placeholder with no size are refused', async () => {
  const d = tmp();
  const noDs = makeWav({ rf64: 'RF64' });
  noDs.write('xxxx', noDs.indexOf('ds64'), 'latin1');
  assert.equal((await readBwf(put(d, 'a.wav', noDs))).error, 'rf64-bad');
  const bad = makeWav({ rf64: 'RF64', extra: [] });
  // a non-data chunk with the placeholder and no table entry
  const w = Buffer.concat([bad.subarray(0, 12), ds64Chunk({ riffSize: 60, dataSize: 4800 }), chunk('fmt ', Buffer.alloc(16))]);
  w.writeUInt32LE(0xffffffff, w.indexOf('fmt ') + 4);
  assert.equal((await readBwf(put(d, 'b.wav', w))).error, 'rf64-bad');
});
