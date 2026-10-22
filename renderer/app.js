/* Tag Fixer — renderer. © 2026 Graziano Melzi · OnAir Garage — MIT License */
(function () {
  "use strict";

  var OLD_KEY = "com.onairgarage.tagfixer.";
  var api = window.api;
  var $ = function (id) { return document.getElementById(id); };
  function oldLoad(k) { try { return localStorage.getItem(OLD_KEY + k); } catch (e) { return null; } }

  // ---- Columns -----------------------------------------------------------------------------
  // special: "cover" and "history" cells open a dialog instead of being typed in
  var VIEWS = {
    mp3: [
      { f: "title", w: "minmax(170px, 1.4fr)" }, { f: "artist", w: "minmax(140px, 1fr)" }, { f: "album", w: "minmax(140px, 1fr)" },
      { f: "year", w: "100px" }, { f: "track", w: "76px" }, { f: "genre", w: "120px", list: true }, { f: "comment", w: "minmax(160px, 1.2fr)" },
      { f: "cover", w: "150px", special: "cover" }
    ],
    flac: [
      { f: "title", w: "minmax(170px, 1.4fr)" }, { f: "artist", w: "minmax(140px, 1fr)" }, { f: "album", w: "minmax(140px, 1fr)" },
      { f: "year", w: "100px" }, { f: "track", w: "76px" }, { f: "genre", w: "120px", list: true }, { f: "comment", w: "minmax(160px, 1.2fr)" }
    ],
    "wav:bwf": [
      { f: "description", w: "minmax(200px, 2fr)", mono: true }, { f: "originator", w: "minmax(130px, 1fr)", mono: true },
      { f: "originatorReference", w: "minmax(130px, 1fr)", mono: true }, { f: "date", w: "118px", mono: true }, { f: "time", w: "100px", mono: true },
      { f: "codingHistory", w: "minmax(150px, 1fr)", mono: true, special: "history" }
    ],
    "wav:ixml": [
      { f: "ixmlProject", w: "minmax(160px, 1fr)" }, { f: "ixmlScene", w: "minmax(100px, .6fr)" }, { f: "ixmlTape", w: "minmax(100px, .6fr)" },
      { f: "ixmlTake", w: "minmax(80px, .5fr)" }, { f: "ixmlNote", w: "minmax(220px, 2fr)" }
    ],
    "wav:cart": [
      { f: "cartTitle", w: "minmax(150px, 1.3fr)", mono: true }, { f: "cartArtist", w: "minmax(120px, 1fr)", mono: true }, { f: "cartCutId", w: "100px", mono: true },
      { f: "cartClientId", w: "110px", mono: true }, { f: "cartCategory", w: "110px", mono: true }, { f: "cartClassification", w: "110px", mono: true },
      { f: "cartOutCue", w: "130px", mono: true }, { f: "cartStartDate", w: "112px", mono: true }, { f: "cartStartTime", w: "96px", mono: true },
      { f: "cartEndDate", w: "112px", mono: true }, { f: "cartEndTime", w: "96px", mono: true }, { f: "cartUserDef", w: "120px", mono: true }
    ]
  };
  var TYPES = ["mp3", "wav", "flac"];
  var LIMIT = { description: 256, originator: 32, originatorReference: 32, date: 10, time: 8, ixmlProject: 256, ixmlScene: 256, ixmlTape: 256, ixmlTake: 64, ixmlNote: 8192,
    cartTitle: 64, cartArtist: 64, cartCutId: 64, cartClientId: 64, cartCategory: 64, cartClassification: 64, cartOutCue: 64, cartStartDate: 10, cartStartTime: 8, cartEndDate: 10, cartEndTime: 8, cartUserDef: 64 };
  var GENRES = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk-Rock", "National Folk", "Swing", "Fast Fusion", "Bebop", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock", "Psychedelic Rock", "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour", "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock", "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Podcast", "Audiobook", "Radio", "Jingle"];

  // ---- State -------------------------------------------------------------------------------
  var state = { rows: [], tab: "mp3", wavSet: "bwf", nextId: 1, busy: false, restore: { available: false }, filterIds: null, settings: null };
  var byPath = {}, byId = {};
  var lang = "en", t = I18N.make("en");
  var validateTimer = null, validateQueue = {}, renameTimer = null;
  var hist = { undo: [], redo: [], lastAt: 0 };
  var upd = { view: null, phase: "idle", file: null, error: null, pct: 0, received: 0, total: 0 };

  function toast(msg, ms) {
    var el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 5000);
  }
  function openDlg(id) { var d = $(id); if (!d.open) d.showModal(); }
  function closeDlg(id) { var d = $(id); if (d.open) d.close(); }
  function anyDialogOpen() { return !!document.querySelector("dialog[open]"); }
  function baseName(p) { return p.split(/[\\/]/).pop(); }
  function fmtBytes(n) {
    if (n === null || n === undefined) return "?";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i];
  }
  // Message for a code: the given group first, then the other groups of codes, else the code itself.
  function msg(prefix, code) {
    var groups = [prefix, "err", "ro", "warn"];
    for (var i = 0; i < groups.length; i++) { var k = groups[i] + "." + code; var s = t(k); if (s !== k) return s; }
    return String(code);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function clear(node) { node.textContent = ""; }
  function saveSettings(patch) { return api.settings.update(patch).then(function (s) { state.settings = s; return s; }); }

  // ---- Views -------------------------------------------------------------------------------
  function viewKey() { return state.tab === "wav" ? "wav:" + state.wavSet : state.tab; }
  function currentView() { return VIEWS[viewKey()]; }
  function allViews(type) { return type === "wav" ? VIEWS["wav:bwf"].concat(VIEWS["wav:ixml"], VIEWS["wav:cart"]) : VIEWS[type]; }
  function allFields(type) { return allViews(type).map(function (c) { return c.f; }); }
  function textFields(type) { return allViews(type).filter(function (c) { return c.special !== "cover"; }).map(function (c) { return c.f; }); }
  function colLabel(f) { return t("col." + f); }

  // ---- i18n and theme ----------------------------------------------------------------------
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (e) { e.textContent = t(e.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach(function (e) { e.title = t(e.getAttribute("data-i18n-title")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (e) { e.placeholder = t(e.getAttribute("data-i18n-placeholder")); });
    document.title = t("app.title");
    buildHelp();
    renderTab();
    renderUpdate();
    fillAbout();
  }
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
    else document.documentElement.removeAttribute("data-theme");
  }
  var langSel = $("langSel");
  Object.keys(I18N.LANGS).forEach(function (code) { var o = el("option", "", I18N.LANGS[code]); o.value = code; langSel.appendChild(o); });
  langSel.addEventListener("change", function () { lang = langSel.value; saveSettings({ language: lang }); t = I18N.make(lang); applyI18n(); });
  $("themeSel").addEventListener("change", function () { var v = $("themeSel").value; saveSettings({ theme: v }); applyTheme(v); });
  $("optRecursive").addEventListener("change", function () { saveSettings({ recursive: this.checked }); });
  var gl = $("genres");
  GENRES.forEach(function (g) { var o = document.createElement("option"); o.value = g; gl.appendChild(o); });

  // ---- Rows --------------------------------------------------------------------------------
  function rowsOf(tab) { return state.rows.filter(function (r) { return r.type === tab; }); }
  function visibleRows(tab) { return rowsOf(tab).filter(function (r) { return !state.filterIds || state.filterIds[r.id]; }); }
  function checkedRows(tab) { return rowsOf(tab).filter(function (r) { return r.selected; }); }
  function copyFields(f) { var o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); return o; }

  function isLocked(row, f) { return !row.meta || !row.meta.ok || !row.meta.writable || !!(row.meta.locked && row.meta.locked[f]); }
  function lockReason(row, f) {
    if (!row.meta || !row.meta.ok) return msg("ro", row.meta ? row.meta.error : "unreadable");
    if (row.meta.locked && row.meta.locked[f]) return msg("ro", row.meta.locked[f]);
    return msg("ro", row.meta.readOnlyReason);
  }
  function isEditable(row) { return row.meta && row.meta.ok && row.meta.writable; }
  function dirtyFields(row) {
    if (!row.meta || !row.meta.ok) return [];
    return allFields(row.type).filter(function (f) { return !isLocked(row, f) && (row.cur[f] || "") !== (row.orig[f] || ""); });
  }
  function hasRename(row) { return !!row.newName && row.newName !== row.name; }
  function isChanged(row) { return (isEditable(row) && dirtyFields(row).length > 0) || hasRename(row); }
  function errorCount(row) { return Object.keys(row.errors || {}).length + (row.renameProblem ? 1 : 0); }

  function applyMeta(row, meta) {
    row.meta = meta;
    row.saveError = null; row.errors = {};
    if (meta && meta.ok) { row.orig = copyFields(meta.fields); row.cur = copyFields(meta.fields); }
    else { row.orig = {}; row.cur = {}; }
  }

  function addFiles(res) {
    if (!res) return;
    var fresh = [];
    res.files.forEach(function (f) {
      if (byPath[f.path]) return;
      var row = { id: state.nextId++, path: f.path, name: f.name, dir: f.dir, type: f.type, size: f.size, mtimeMs: f.mtimeMs, birthtimeMs: f.birthtimeMs, selected: true, meta: null, orig: {}, cur: {}, errors: {}, saveError: null, newName: null, renameProblem: null };
      byPath[f.path] = row; byId[row.id] = row; state.rows.push(row); fresh.push(row);
    });
    if (res.skipped) toast(t("scan.skipped", { n: res.skipped }));
    if (res.unreadable) toast(t("scan.unreadable", { n: res.unreadable }));
    if (res.truncated) toast(t("scan.truncated"));
    if (!fresh.length) return;
    if (!rowsOf(state.tab).length) state.tab = fresh[0].type;
    renderTab();
    readRows(fresh);
  }

  function readRows(rows) {
    var i = 0;
    function next() {
      if (i >= rows.length) { renderTab(); return Promise.resolve(); }
      var chunk = rows.slice(i, i + 25); i += 25;
      return api.tags.read(chunk.map(function (r) { return r.path; })).then(function (metas) {
        metas.forEach(function (m, k) { applyMeta(chunk[k], m); });
        $("summary").textContent = t("reading", { n: Math.min(i, rows.length), m: rows.length });
        return next();
      });
    }
    return next();
  }

  // ---- Undo / redo -------------------------------------------------------------------------
  // an entry: { id, f, before, after } ; f "__name" is the new file name. A group is one user action.
  function getRaw(row, f) { return f === "__name" ? row.newName : row.cur[f]; }
  function setRaw(row, f, v) {
    if (f === "__name") row.newName = v || null; else row.cur[f] = v === undefined ? "" : v;
    row.saveError = null;
  }
  function pushUndo(group) { hist.undo.push(group); if (hist.undo.length > 500) hist.undo.shift(); hist.redo = []; }
  function afterChange(rows) {
    var seen = {};
    rows.forEach(function (r) { if (seen[r.id]) return; seen[r.id] = 1; queueValidate(r); refreshRow(r); });
    scheduleRenameCheck();
    updateSummary();
  }
  // changes: [{ row, f, value }] -> number of entries really changed
  function applyChanges(changes) {
    var group = [], rows = [];
    changes.forEach(function (c) {
      var before = getRaw(c.row, c.f);
      if ((before || "") === (c.value || "")) return;
      group.push({ id: c.row.id, f: c.f, before: before === undefined ? "" : before, after: c.value });
      setRaw(c.row, c.f, c.value);
      rows.push(c.row);
    });
    if (!group.length) return 0;
    pushUndo(group);
    afterChange(rows);
    return group.length;
  }
  function recordTyping(row, f, before, after) {
    var now = Date.now(), last = hist.undo[hist.undo.length - 1];
    if (last && last.length === 1 && last[0].id === row.id && last[0].f === f && now - hist.lastAt < 1500) last[0].after = after;
    else pushUndo([{ id: row.id, f: f, before: before, after: after }]);
    hist.lastAt = now;
  }
  function stepHistory(from, to, key) {
    var g = from.pop();
    if (!g) return;
    var rows = [];
    (key === "before" ? g.slice().reverse() : g).forEach(function (e) {
      var row = byId[e.id];
      if (!row) return;
      setRaw(row, e.f, e[key]); rows.push(row);
    });
    to.push(g);
    afterChange(rows);
  }
  function undo() { stepHistory(hist.undo, hist.redo, "before"); }
  function redo() { stepHistory(hist.redo, hist.undo, "after"); }
  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key.toLowerCase();
    if (anyDialogOpen()) return; // the fields of a dialog keep their own undo
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  // ---- Table -------------------------------------------------------------------------------
  function hasInfo() { return state.tab === "wav" || state.tab === "flac"; }
  function template() {
    return "34px minmax(210px, 1.1fr) " + currentView().map(function (c) { return c.w; }).join(" ") + (hasInfo() ? " 190px" : "") + " minmax(170px, 0.8fr)";
  }

  function buildHeader() {
    var grid = $("grid"), view = currentView();
    grid.style.setProperty("--cols", template());
    var head = $("head"), apply = $("applyRow");
    clear(head); clear(apply);
    var all = el("div", "c-check");
    var allChk = el("input"); allChk.type = "checkbox"; allChk.id = "selAll"; allChk.setAttribute("aria-label", t("col.all"));
    allChk.addEventListener("change", function () { visibleRows(state.tab).forEach(function (r) { r.selected = allChk.checked; }); renderBody(); updateSummary(); });
    all.appendChild(allChk); head.appendChild(all);
    head.appendChild(el("div", "", t("col.file")));
    view.forEach(function (c) { head.appendChild(el("div", "", colLabel(c.f))); });
    if (hasInfo()) head.appendChild(el("div", "", t("col.info")));
    head.appendChild(el("div", "", t("col.status")));

    // "set for all checked rows": one input and one button per column
    apply.appendChild(el("div"));
    apply.appendChild(el("div", "applylabel", t("apply.label")));
    view.forEach(function (c) {
      var cell = el("div");
      if (c.special) {
        var open = el("button", "", c.special === "cover" ? t("tool.cover") : t("tool.history")); open.type = "button";
        open.addEventListener("click", function () { if (c.special === "cover") openCover(null); else openHistory(null); });
        cell.appendChild(open);
      } else {
        var inp = el("input"); inp.type = "text"; inp.spellcheck = false; inp.setAttribute("aria-label", t("apply.label") + ": " + colLabel(c.f));
        if (c.mono) inp.className = "mono";
        if (c.list) inp.setAttribute("list", "genres");
        var btn = el("button", "", "⇣"); btn.type = "button"; btn.title = t("apply.tip");
        btn.addEventListener("click", function () { applyAll(c.f, inp.value); });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyAll(c.f, inp.value); } });
        cell.appendChild(inp); cell.appendChild(btn);
      }
      apply.appendChild(cell);
    });
    if (hasInfo()) apply.appendChild(el("div"));
    apply.appendChild(el("div"));
  }

  function infoText(row) {
    var m = row.meta;
    if (!m || !m.ok || !m.info) return "";
    var i = m.info, parts = [];
    if (i.sampleRate) parts.push((i.sampleRate / 1000) + " kHz");
    if (i.bits) parts.push(i.bits + " bit");
    if (i.channels) parts.push(i.channels + " ch");
    if (i.seconds !== undefined) { var s = Math.round(i.seconds); parts.push(Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")); }
    if (m.rf64) parts.push(m.rf64);
    if (m.hasIxml) parts.push("iXML");
    if (m.hasCart) parts.push("cart");
    return parts.join(" · ");
  }

  function badge(row) {
    var m = row.meta;
    if (!m || !m.ok) return "";
    if (row.type === "mp3") return m.source === "v2" ? "ID3v" + m.version : m.source === "v1" ? t("badge.v1only") : t("badge.notag");
    if (row.type === "flac") return m.hasComment ? "FLAC · Vorbis" : t("badge.nocomment");
    return m.hasBext ? "bext v" + (m.bext && m.bext.version !== undefined ? m.bext.version : "?") : t("badge.nobext");
  }

  // what a cell shows
  function shownValue(row, c) {
    var v = row.cur[c.f] === undefined ? "" : row.cur[c.f];
    if (c.special === "cover") {
      if (v.indexOf("file:") === 0) return "→ " + baseName(v.slice(5));
      if (v === "" && row.orig.cover) return "(" + t("cover.removed") + ")";
      return v;
    }
    if (c.special === "history") {
      var lines = v ? v.split("\n") : [];
      return lines.length ? lines[0] + (lines.length > 1 ? "  (+" + (lines.length - 1) + ")" : "") : "";
    }
    return v;
  }

  function buildRow(row) {
    var view = allViewsFor(row);
    var elr = el("div", "row"); elr.setAttribute("role", "row");
    var c0 = el("div", "c-check");
    var chk = el("input"); chk.type = "checkbox"; chk.checked = row.selected; chk.setAttribute("aria-label", row.name);
    chk.addEventListener("change", function () { row.selected = chk.checked; elr.classList.toggle("row--unchecked", !row.selected); updateSummary(); });
    c0.appendChild(chk); elr.appendChild(c0);
    var cf = el("div", "c-file");
    var nm = el("div", "name"); var mt = el("div", "meta");
    cf.appendChild(nm); cf.appendChild(mt); elr.appendChild(cf);
    row.els = { row: elr, inputs: {}, status: null, meta: mt, name: nm };
    view.forEach(function (c) {
      var cell = el("div", "c-cell");
      var inp = el("input", "cell" + (c.mono ? " mono" : "") + (c.special ? " cell--btn" : "")); inp.type = "text"; inp.spellcheck = false;
      inp.setAttribute("aria-label", row.name + " — " + colLabel(c.f));
      if (c.list) inp.setAttribute("list", "genres");
      if (c.special) {
        inp.readOnly = true;
        inp.addEventListener("click", function () { if (!inp.disabled) { if (c.special === "cover") openCover(row); else openHistory(row); } });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && !inp.disabled) { e.preventDefault(); if (c.special === "cover") openCover(row); else openHistory(row); } });
      } else {
        inp.addEventListener("input", function () { onEdit(row, c.f, inp.value); });
        inp.addEventListener("keydown", function (e) { onCellKey(e, row, c.f, inp); });
      }
      cell.appendChild(inp); elr.appendChild(cell);
      row.els.inputs[c.f] = inp;
    });
    if (hasInfo()) { var ci = el("div", "c-info"); row.els.info = ci; elr.appendChild(ci); } else row.els.info = null;
    var st = el("div", "c-status"); row.els.status = st; elr.appendChild(st);
    refreshRow(row);
    return elr;
  }
  function allViewsFor() { return currentView(); }

  function statusFor(row) {
    if (!row.meta) return { text: t("status.reading"), cls: "" };
    if (!row.meta.ok) return { text: msg("ro", row.meta.error), cls: "err" };
    if (row.saveError) return { text: t("status.failed") + ": " + msg("err", row.saveError), cls: "err" };
    if (row.renameProblem) return { text: t("status.rename") + ": " + msg("err", row.renameProblem), cls: "err" };
    var errs = Object.keys(row.errors || {});
    if (errs.length) return { text: colLabel(errs[0]) + ": " + errText(errs[0], row.errors[errs[0]]) + (errs.length > 1 ? " (+" + (errs.length - 1) + ")" : ""), cls: "err" };
    if (!row.meta.writable) return { text: msg("ro", row.meta.readOnlyReason), cls: "ro" };
    var d = dirtyFields(row).length + (hasRename(row) ? 1 : 0);
    if (d) return { text: t("status.edited", { n: d }), cls: "ok" };
    return { text: row.meta.warnings && row.meta.warnings.length ? msg("warn", row.meta.warnings[0]) : "", cls: row.meta.warnings && row.meta.warnings.length ? "warn" : "" };
  }
  function errText(field, code) {
    if (code === "too-long" && LIMIT[field]) return t("err.too-long-n", { n: LIMIT[field] });
    return msg("err", code);
  }

  function refreshRow(row) {
    if (!row.els) return;
    var m = row.meta;
    currentView().forEach(function (c) {
      var inp = row.els.inputs[c.f], f = c.f;
      if (!inp) return;
      var locked = isLocked(row, f);
      inp.disabled = locked;
      var shown = shownValue(row, c);
      inp.title = locked && m ? lockReason(row, f) : ((row.orig[f] || "") !== (row.cur[f] || "") ? t("was") + ": " + (c.special === "history" ? (row.orig[f] || "∅").split("\n")[0] : (row.orig[f] || "∅")) : "");
      if (inp.value !== shown) inp.value = shown;
      var dirty = !locked && (row.cur[f] || "") !== (row.orig[f] || "");
      inp.classList.toggle("cell--dirty", dirty && !(row.errors && row.errors[f]));
      inp.classList.toggle("cell--err", !!(row.errors && row.errors[f]));
      inp.classList.toggle("cell--ascii", !!(m && m.nonAscii && m.nonAscii[f] && !dirty));
      if (m && m.nonAscii && m.nonAscii[f] && !dirty) inp.title = t("warn.nonascii-existing");
      if (m && m.multi && m.multi[f] && !dirty) inp.title = t("warn.multi");
      if (row.errors && row.errors[f]) inp.title = errText(f, row.errors[f]);
    });
    if (hasRename(row)) {
      row.els.name.textContent = row.newName; row.els.name.className = "name name--new"; row.els.name.title = t("was") + ": " + row.name;
      row.els.meta.textContent = t("was") + ": " + row.name;
    } else {
      row.els.name.textContent = row.name; row.els.name.className = "name"; row.els.name.title = row.path;
      row.els.meta.textContent = badge(row) ? badge(row) + " · " + row.dir : row.dir; row.els.meta.title = row.dir;
    }
    if (row.els.info) row.els.info.textContent = infoText(row);
    var st = statusFor(row);
    clear(row.els.status);
    if (st.text) { var pill = el("span", "st" + (st.cls ? " st--" + st.cls : ""), st.text); pill.title = st.text; row.els.status.appendChild(pill); }
    row.els.row.classList.toggle("row--unchecked", !row.selected);
  }

  function renderBody() {
    var body = $("body");
    clear(body);
    var rows = visibleRows(state.tab);
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(buildRow(r)); });
    body.appendChild(frag);
    if (!rows.length && state.rows.length) body.appendChild(el("div", "empty-tab", t("empty.tab", { type: tabName(state.tab) })));
    var all = $("selAll");
    if (all) { var sel = rows.filter(function (r) { return r.selected; }).length; all.checked = rows.length > 0 && sel === rows.length; all.indeterminate = sel > 0 && sel < rows.length; }
  }
  function tabName(tab) { return tab === "mp3" ? "MP3" : tab === "flac" ? "FLAC" : "WAV"; }

  function renderTab() {
    document.body.classList.toggle("has-files", state.rows.length > 0);
    TYPES.forEach(function (tab) {
      var id = tab === "mp3" ? "Mp3" : tab === "wav" ? "Wav" : "Flac";
      $("tab" + id).setAttribute("aria-selected", state.tab === tab ? "true" : "false");
      $("count" + id).textContent = String(rowsOf(tab).length);
    });
    $("wavSets").hidden = state.tab !== "wav";
    document.querySelectorAll("[data-set]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-set") === state.wavSet ? "true" : "false"); });
    $("toolDate").hidden = state.tab !== "wav";
    $("toolHistory").hidden = state.tab !== "wav";
    $("toolCover").hidden = state.tab !== "mp3";
    $("filterBar").hidden = !state.filterIds;
    if (state.filterIds) $("filterText").textContent = t("filter.on", { n: Object.keys(state.filterIds).length });
    buildHeader();
    renderBody();
    updateSummary();
  }

  document.querySelectorAll(".tab[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { state.tab = b.getAttribute("data-tab"); saveSettings({ tab: state.tab }); renderTab(); });
  });
  document.querySelectorAll("[data-set]").forEach(function (b) {
    b.addEventListener("click", function () { state.wavSet = b.getAttribute("data-set"); saveSettings({ wavSet: state.wavSet }); renderTab(); });
  });
  $("filterOff").addEventListener("click", function () { state.filterIds = null; renderTab(); });

  // ---- Editing -----------------------------------------------------------------------------
  function onEdit(row, f, value) {
    var before = row.cur[f] === undefined ? "" : row.cur[f];
    if (before === value) return;
    recordTyping(row, f, before, value);
    row.cur[f] = value; row.saveError = null;
    queueValidate(row);
    refreshRow(row);
    updateSummary();
  }

  function onCellKey(e, row, f, inp) {
    var rows = visibleRows(state.tab), i = rows.indexOf(row), target = null;
    if (e.key === "Escape") { e.preventDefault(); inp.value = row.orig[f] === undefined ? "" : row.orig[f]; onEdit(row, f, inp.value); return; }
    if (e.key === "Enter" || e.key === "ArrowDown") target = rows[i + (e.shiftKey && e.key === "Enter" ? -1 : 1)];
    else if (e.key === "ArrowUp") target = rows[i - 1];
    else return;
    e.preventDefault();
    if (target && target.els && target.els.inputs[f] && !target.els.inputs[f].disabled) { target.els.inputs[f].focus(); target.els.inputs[f].select(); }
  }

  function queueValidate(row) {
    validateQueue[row.id] = row;
    clearTimeout(validateTimer);
    validateTimer = setTimeout(runValidate, 120);
  }
  function runValidate() {
    var rows = Object.keys(validateQueue).map(function (k) { return validateQueue[k]; });
    validateQueue = {};
    if (!rows.length) return Promise.resolve();
    var items = rows.map(function (r) {
      var fields = {};
      dirtyFields(r).forEach(function (f) { fields[f] = r.cur[f]; });
      return { kind: r.type, version: r.meta && r.meta.version ? String(r.meta.version).slice(2) : "3", fields: fields };
    });
    return api.tags.validate(items).then(function (res) {
      res.forEach(function (errs, k) { rows[k].errors = errs; refreshRow(rows[k]); });
      updateSummary();
    });
  }

  function scheduleRenameCheck() {
    clearTimeout(renameTimer);
    renameTimer = setTimeout(function () {
      var rows = state.rows.filter(hasRename);
      state.rows.forEach(function (r) { if (!hasRename(r) && r.renameProblem) { r.renameProblem = null; refreshRow(r); } });
      if (!rows.length) { updateSummary(); return; }
      api.tools.renameCheck(rows.map(function (r) { return { path: r.path, rename: r.newName }; })).then(function (res) {
        rows.forEach(function (r) { var p = res[r.path] || null; if (p !== r.renameProblem) { r.renameProblem = p; refreshRow(r); } });
        updateSummary();
      });
    }, 200);
  }

  function applyAll(f, value) {
    var changes = [], skipped = 0;
    checkedRows(state.tab).forEach(function (r) {
      if (isLocked(r, f)) { skipped++; return; }
      changes.push({ row: r, f: f, value: value });
    });
    var n = applyChanges(changes);
    toast(t("apply.done", { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  }

  $("asciiBtn").addEventListener("click", function () {
    var targets = [];
    state.rows.forEach(function (r) {
      if (!r.selected || r.type !== "wav") return;
      Object.keys(r.errors || {}).forEach(function (f) { if (r.errors[f] === "non-ascii") targets.push({ row: r, f: f }); });
    });
    if (!targets.length) return;
    api.tags.toAscii(targets.map(function (x) { return x.row.cur[x.f]; })).then(function (out) {
      var n = applyChanges(targets.map(function (x, k) { return { row: x.row, f: x.f, value: out[k] }; }));
      toast(t("ascii.done", { n: n }));
    });
  });

  $("discardBtn").addEventListener("click", function () {
    state.rows.forEach(function (r) { if (r.meta && r.meta.ok) { r.cur = copyFields(r.orig); r.errors = {}; r.saveError = null; } r.newName = null; r.renameProblem = null; refreshRow(r); });
    hist.undo = []; hist.redo = [];
    updateSummary();
  });

  // ---- Summary and buttons -----------------------------------------------------------------
  function changedRows() { return state.rows.filter(function (r) { return r.selected && isChanged(r); }); }
  function hasAnyDirty() { return state.rows.some(function (r) { return (r.meta && r.meta.ok && dirtyFields(r).length) || hasRename(r); }); }

  function updateSummary() {
    var total = state.rows.length;
    var changed = changedRows();
    var errors = changed.filter(function (r) { return errorCount(r) > 0; }).length;
    var nonAscii = state.rows.some(function (r) { return r.selected && r.type === "wav" && Object.keys(r.errors || {}).some(function (f) { return r.errors[f] === "non-ascii"; }); });
    var sum = $("summary");
    clear(sum);
    function part(text, cls) { sum.appendChild(el("span", cls || "", text)); }
    if (total) {
      part(t("sum.files", { n: total }));
      part(t("sum.checked", { n: state.rows.filter(function (r) { return r.selected; }).length }));
      if (changed.length) part(t("sum.changed", { n: changed.length }), "good");
      if (errors) part(t("sum.errors", { n: errors }), "bad");
    }
    var pill = $("pill");
    clear(pill); pill.className = "pill";
    if (total) {
      pill.classList.add(errors ? "pill--bad" : changed.length ? "pill--edit" : "pill--ok");
      pill.appendChild(el("span", "dot"));
      pill.appendChild(document.createTextNode(errors ? t("pill.errors", { n: errors }) : changed.length ? t("pill.edit", { n: changed.length }) : t("pill.files", { n: total })));
    }
    var save = $("saveBtn");
    save.textContent = changed.length ? t("btn.save", { n: changed.length }) : t("btn.save.none");
    save.disabled = state.busy || !changed.length || errors > 0;
    save.title = errors > 0 ? t("tip.blocked") : "";
    $("discardBtn").disabled = state.busy || !hasAnyDirty();
    $("asciiBtn").hidden = !nonAscii;
    $("clearBtn").disabled = state.busy || !total;
    $("restoreBtn").disabled = state.busy || !state.restore.available;
    $("undoBtn").disabled = state.busy || !hist.undo.length;
    $("redoBtn").disabled = state.busy || !hist.redo.length;
    ["toolPattern", "toolFind", "toolDate", "toolHistory", "toolCover", "toolCheck", "toolCsvOut", "toolCsvIn"].forEach(function (id) { $(id).disabled = state.busy || !total; });
    api.setDirty(hasAnyDirty());
  }

  // ---- Adding files ------------------------------------------------------------------------
  function scanOpts() { return { recursive: $("optRecursive").checked }; }
  $("addFilesBtn").addEventListener("click", function () { api.files.pick("files", scanOpts()).then(addFiles); });
  $("addFolderBtn").addEventListener("click", function () { api.files.pick("folder", scanOpts()).then(addFiles); });
  $("clearBtn").addEventListener("click", function () {
    if (hasAnyDirty() && !window.confirm(t("clear.confirm"))) return;
    state.rows = []; byPath = {}; byId = {}; state.filterIds = null; hist.undo = []; hist.redo = []; renderTab();
  });
  var dragDepth = 0;
  window.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
  window.addEventListener("dragleave", function (e) { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
    var paths = Array.prototype.map.call(e.dataTransfer.files, function (f) { try { return api.pathForFile(f); } catch (err) { return ""; } }).filter(Boolean);
    if (paths.length) api.files.expand(paths, scanOpts()).then(addFiles);
  });

  // ---- Save --------------------------------------------------------------------------------
  function saveItems() {
    return changedRows().map(function (r) {
      var changes = {};
      if (isEditable(r)) dirtyFields(r).forEach(function (f) { changes[f] = r.cur[f]; });
      return { path: r.path, changes: changes, rename: hasRename(r) ? r.newName : null };
    });
  }

  function describeChange(row, f, value) {
    if (f === "cover") return (row.orig.cover || "∅") + " → " + (value === "" ? "(" + t("cover.removed") + ")" : baseName(value.slice(5)));
    var o = (row.orig[f] || "∅").replace(/\n/g, " ⏎ "), n = (value || "∅").replace(/\n/g, " ⏎ ");
    return o + " → " + n;
  }

  $("saveBtn").addEventListener("click", function () {
    var items = saveItems();
    if (!items.length) return;
    api.save.preflight(items).then(function (pf) {
      $("confirmText").textContent = t("confirm.text", { n: items.length });
      $("confirmDir").textContent = pf.backupDir;
      var space = $("confirmSpace");
      if (pf.bytes === 0) { space.textContent = t("confirm.nobackup"); space.className = "hint"; }
      else if (pf.enough === false) { space.textContent = t("confirm.nospace", { need: fmtBytes(pf.bytes), free: fmtBytes(pf.free) }); space.className = "hint bad"; }
      else { space.textContent = t("confirm.space", { need: fmtBytes(pf.bytes), free: fmtBytes(pf.free) }); space.className = "hint"; }
      var rp = Object.keys(pf.renames || {});
      var rn = $("confirmRename");
      rn.hidden = !rp.length;
      if (rp.length) rn.textContent = t("confirm.renameProblems", { n: rp.length }) + " " + baseName(rp[0]) + ": " + msg("err", pf.renames[rp[0]]);
      $("confirmOk").disabled = pf.enough === false || rp.length > 0;
      var ul = $("confirmList"); clear(ul);
      items.slice(0, 8).forEach(function (it) {
        var row = byPath[it.path];
        Object.keys(it.changes).slice(0, 3).forEach(function (f) {
          var li = el("li");
          li.appendChild(document.createTextNode(baseName(it.path) + " · " + colLabel(f) + ": "));
          var to = el("span", "chg", describeChange(row, f, it.changes[f])); li.appendChild(to); ul.appendChild(li);
        });
        if (it.rename) { var lr = el("li"); lr.appendChild(document.createTextNode(t("confirm.rename") + ": " + baseName(it.path) + " → ")); lr.appendChild(el("span", "chg", it.rename)); ul.appendChild(lr); }
      });
      if (items.length > 8) ul.appendChild(el("li", "", t("confirm.more", { n: items.length - 8 })));
      $("saveProgress").hidden = true; $("saveProgressText").hidden = true;
      $("confirmCancel").disabled = false;
      openDlg("confirmDlg");
    });
  });
  $("confirmCancel").addEventListener("click", function () { closeDlg("confirmDlg"); });
  $("confirmDlg").addEventListener("cancel", function (e) { if (state.busy) e.preventDefault(); });

  api.save.onProgress(function (p) {
    $("saveBar").style.width = Math.round(p.index * 100 / p.total) + "%";
    $("saveProgressText").textContent = t("saving", { i: p.index + 1, n: p.total }) + " " + baseName(p.path);
  });

  function rekey(row, newPath) {
    delete byPath[row.path];
    row.path = newPath; row.name = baseName(newPath); row.dir = newPath.slice(0, newPath.length - row.name.length).replace(/[\\/]$/, "") || row.dir;
    byPath[newPath] = row;
  }

  $("confirmOk").addEventListener("click", function () {
    var items = saveItems();
    state.busy = true; updateSummary();
    $("confirmOk").disabled = true; $("confirmCancel").disabled = true;
    $("saveProgress").hidden = false; $("saveProgressText").hidden = false; $("saveBar").style.width = "0%";
    api.save.run(items).then(function (out) {
      var ok = [], failed = [];
      out.results.forEach(function (r) { (r.ok ? ok : failed).push(r); });
      failed.forEach(function (r) { if (byPath[r.path]) byPath[r.path].saveError = r.error || "unknown"; });
      var rows = [];
      ok.forEach(function (r) { var row = byPath[r.path]; if (!row) return; if (r.newPath) rekey(row, r.newPath); row.newName = null; row.renameProblem = null; rows.push(row); });
      return api.tags.read(rows.map(function (r) { return r.path; })).then(function (metas) {
        metas.forEach(function (m, k) { applyMeta(rows[k], m); });
        state.busy = false;
        hist.undo = []; hist.redo = [];
        closeDlg("confirmDlg");
        renderBody(); updateSummary(); refreshRestore();
        showResult(ok.length, failed, out.backupDir);
      });
    }).catch(function (err) { state.busy = false; closeDlg("confirmDlg"); updateSummary(); toast(String(err && err.message || err)); });
  });

  function showResult(ok, failed, dir) {
    $("resultText").textContent = t("result.ok", { n: ok }) + (failed.length ? " · " + t("result.failed", { n: failed.length }) : "");
    var ul = $("resultList"); clear(ul);
    failed.slice(0, 50).forEach(function (r) { ul.appendChild(el("li", "bad", baseName(r.path) + " — " + msg("err", r.error))); });
    $("resultHint").textContent = ok && dir ? t("result.hint", { dir: dir }) : "";
    openDlg("resultDlg");
  }
  $("resultClose").addEventListener("click", function () { closeDlg("resultDlg"); });

  // ---- Restore -----------------------------------------------------------------------------
  function refreshRestore() {
    return api.restore.info().then(function (i) { state.restore = i; updateSummary(); $("restoreBtn").title = i.available ? new Date(i.createdAt).toLocaleString(lang) + " · " + t("sum.files", { n: i.count }) : ""; });
  }
  $("restoreBtn").addEventListener("click", function () {
    api.restore.check().then(function (c) {
      $("restoreText").textContent = c.todo ? t("restore.text", { n: c.todo }) : t("restore.none");
      var ul = $("restoreList"); clear(ul);
      if (c.problems.length) {
        ul.appendChild(el("li", "", t("restore.skipped", { n: c.problems.length })));
        c.problems.slice(0, 30).forEach(function (p) { ul.appendChild(el("li", "bad", baseName(p.path) + " — " + msg("err", p.error))); });
      }
      $("restoreOk").disabled = !c.todo;
      openDlg("restoreDlg");
    });
  });
  $("restoreCancel").addEventListener("click", function () { closeDlg("restoreDlg"); });
  $("restoreOk").addEventListener("click", function () {
    closeDlg("restoreDlg");
    state.busy = true; updateSummary();
    api.restore.run().then(function (res) {
      state.busy = false;
      var done = res.results.filter(function (r) { return r.ok; });
      var rows = [];
      done.forEach(function (r) { var row = byPath[r.from || r.path]; if (!row) return; if (r.from) rekey(row, r.path); rows.push(row); });
      toast(t("restore.done", { n: done.length }));
      refreshRestore();
      if (rows.length) return api.tags.read(rows.map(function (r) { return r.path; })).then(function (metas) { metas.forEach(function (m, k) { applyMeta(rows[k], m); }); hist.undo = []; hist.redo = []; renderBody(); updateSummary(); });
      updateSummary();
    });
  });

  // ---- Patterns ----------------------------------------------------------------------------
  var pat = { rows: [], last: null, timer: null, seq: 0 };
  var SPECIAL_TOKENS = ["filename", "ext", "folder", "n", "n:3", "mdate", "mtime", "today"];

  function payloadRows(rows) {
    return rows.map(function (r) { return { id: r.id, path: r.path, fields: copyFields(r.cur), mtimeMs: r.mtimeMs, birthtimeMs: r.birthtimeMs }; });
  }
  function needRows(rows) { if (!rows.length) { toast(t("tool.nocheck")); return false; } return true; }
  function previewTable(table, head, rows) {
    clear(table);
    var tr = el("tr"); head.forEach(function (h) { tr.appendChild(el("th", "", h)); }); table.appendChild(tr);
    rows.forEach(function (cells) {
      var r = el("tr", cells.err ? "err" : ""); if (cells.onClick) { r.className += " go"; r.addEventListener("click", cells.onClick); }
      cells.cols.forEach(function (c) { r.appendChild(el("td", c.cls || "", c.text)); });
      table.appendChild(r);
    });
  }
  function patMode() { return $("patMode").value; }
  function patPresets() { return (state.settings.presets || []).filter(function (p) { return p.kind === patMode(); }); }
  function fillPresets() {
    var sel = $("patPresets"); clear(sel);
    var list = patPresets();
    var o0 = el("option", "", list.length ? t("pat.presets") : t("pat.noPresets")); o0.value = ""; sel.appendChild(o0);
    list.forEach(function (p) { var o = el("option", "", p.name + "  ·  " + p.pattern); o.value = p.id; sel.appendChild(o); });
  }
  function fillPatternChips() {
    var box = $("patChips"); clear(box);
    var mode = patMode();
    var tokens = textFields(state.tab).concat(mode === "read" ? ["n"] : SPECIAL_TOKENS);
    tokens.forEach(function (tk) {
      var b = el("button", "chip", "{" + tk + "}"); b.type = "button";
      b.addEventListener("click", function () {
        var inp = $("patPattern"), s = inp.selectionStart == null ? inp.value.length : inp.selectionStart, e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + "{" + tk + "}" + inp.value.slice(e2);
        inp.focus(); inp.setSelectionRange(s + tk.length + 2, s + tk.length + 2); schedulePattern();
      });
      box.appendChild(b);
    });
  }
  function patModeChanged() {
    var mode = patMode();
    $("patFieldWrap").hidden = mode !== "fill";
    $("patStart").parentNode.hidden = mode === "read";
    $("patHint").textContent = t("pat.hint." + mode);
    fillPatternChips(); fillPresets(); schedulePattern();
  }
  function openPattern() {
    var rows = checkedRows(state.tab);
    if (!needRows(rows)) return;
    pat.rows = rows;
    var sel = $("patField"); clear(sel);
    textFields(state.tab).forEach(function (f) { var o = el("option", "", colLabel(f)); o.value = f; sel.appendChild(o); });
    var first = currentView().filter(function (c) { return !c.special; })[0];
    sel.value = first ? first.f : sel.options[0].value;
    $("patMode").value = "fill";
    $("patPattern").value = "";
    $("patPresetName").value = "";
    $("patError").hidden = true; clear($("patPreview")); $("patSummary").textContent = ""; $("patApply").disabled = true;
    patModeChanged();
    openDlg("patternDlg");
    $("patPattern").focus();
  }
  function schedulePattern() { clearTimeout(pat.timer); pat.timer = setTimeout(runPattern, 150); }
  function runPattern() {
    var seq = ++pat.seq, mode = patMode(), pattern = $("patPattern").value;
    if (!pattern.trim()) { $("patError").hidden = true; clear($("patPreview")); $("patSummary").textContent = ""; $("patApply").disabled = true; pat.last = null; return; }
    api.tools.pattern({ mode: mode, pattern: pattern, field: $("patField").value, known: textFields(state.tab), startAt: parseInt($("patStart").value, 10) || 0, rows: payloadRows(pat.rows) }).then(function (res) {
      if (seq !== pat.seq) return;
      var err = $("patError");
      if (res.error) { err.hidden = false; err.textContent = t("pat.err." + res.error, { token: res.token || "" }); clear($("patPreview")); $("patSummary").textContent = ""; $("patApply").disabled = true; pat.last = null; return; }
      err.hidden = true;
      pat.last = { mode: mode, res: res, field: $("patField").value };
      var head = mode === "read" ? [t("col.file"), t("pat.values")] : mode === "rename" ? [t("col.file"), t("pat.newName")] : [t("col.file"), t("pat.current"), t("pat.new")];
      var rows = [];
      res.results.slice(0, 8).forEach(function (r) {
        var row = byId[r.id];
        var bad = r.error || r.problem;
        var shown;
        if (mode === "read") shown = r.values ? Object.keys(r.values).map(function (k) { return colLabel(k) + " = " + r.values[k]; }).join(" · ") : msg("err", r.error);
        else shown = bad && !r.value ? msg("err", r.error || r.problem) : r.value + (r.problem ? "   ⚠ " + msg("err", r.problem) : "");
        var cols = [{ text: row.name }];
        if (mode === "fill") cols.push({ text: (row.cur[$("patField").value] || "∅").replace(/\n/g, " ⏎ "), cls: "same" });
        cols.push({ text: shown, cls: bad ? "" : (r.same ? "same" : "new") });
        rows.push({ cols: cols, err: !!bad });
      });
      previewTable($("patPreview"), head, rows);
      var n = res.results.length;
      $("patSummary").textContent = t("pat.summary", { n: n, bad: res.bad }) + (res.results.length > 8 ? " " + t("pat.first", { n: 8 }) : "");
      $("patApply").disabled = mode === "rename" ? res.bad > 0 : res.bad >= n;
    });
  }
  ["patMode"].forEach(function (id) { $(id).addEventListener("change", patModeChanged); });
  ["patField", "patPattern", "patStart"].forEach(function (id) { $(id).addEventListener("input", schedulePattern); });
  $("patField").addEventListener("change", schedulePattern);
  $("patPresetUse").addEventListener("click", function () {
    var id = $("patPresets").value;
    var p = (state.settings.presets || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    $("patPattern").value = p.pattern;
    if (p.kind === "fill" && p.field && textFields(state.tab).indexOf(p.field) >= 0) $("patField").value = p.field;
    $("patPresetName").value = p.name;
    schedulePattern();
  });
  $("patPresetSave").addEventListener("click", function () {
    var name = $("patPresetName").value.trim(), pattern = $("patPattern").value;
    if (!name || !pattern.trim()) { toast(t("pat.presetNeed")); return; }
    var list = (state.settings.presets || []).filter(function (p) { return !(p.kind === patMode() && p.name.toLowerCase() === name.toLowerCase()); });
    var old = (state.settings.presets || []).filter(function (p) { return p.kind === patMode() && p.name.toLowerCase() === name.toLowerCase(); })[0];
    list.push({ id: old ? old.id : null, name: name, kind: patMode(), field: patMode() === "fill" ? $("patField").value : "", pattern: pattern });
    saveSettings({ presets: list }).then(function () { fillPresets(); toast(t("pat.presetSaved")); });
  });
  $("patPresetDel").addEventListener("click", function () {
    var id = $("patPresets").value;
    if (!id) return;
    saveSettings({ presets: (state.settings.presets || []).filter(function (p) { return p.id !== id; }) }).then(function () { fillPresets(); });
  });
  $("patCancel").addEventListener("click", function () { closeDlg("patternDlg"); });
  $("patApply").addEventListener("click", function () {
    if (!pat.last) return;
    var l = pat.last, changes = [], skipped = 0, n = 0;
    l.res.results.forEach(function (r) {
      var row = byId[r.id];
      if (!row) return;
      if (l.mode === "fill") {
        if (r.error) return;
        if (isLocked(row, l.field)) { skipped++; return; }
        changes.push({ row: row, f: l.field, value: r.value });
      } else if (l.mode === "read") {
        if (!r.values) return;
        Object.keys(r.values).forEach(function (f) { if (isLocked(row, f)) { skipped++; return; } changes.push({ row: row, f: f, value: r.values[f] }); });
      } else if (r.value && !r.problem) changes.push({ row: row, f: "__name", value: r.value === row.name ? "" : r.value });
    });
    n = applyChanges(changes);
    closeDlg("patternDlg");
    toast(t(l.mode === "rename" ? "pat.doneRename" : "pat.done", { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  });
  $("toolPattern").addEventListener("click", openPattern);

  // ---- Find & replace ----------------------------------------------------------------------
  var fnd = { rows: [], last: null, timer: null, seq: 0 };
  function openFind() {
    var rows = checkedRows(state.tab);
    if (!needRows(rows)) return;
    fnd.rows = rows;
    var sel = $("findField"); clear(sel);
    var all = el("option", "", t("find.allFields")); all.value = "*"; sel.appendChild(all);
    currentView().filter(function (c) { return !c.special || c.special === "history"; }).forEach(function (c) { var o = el("option", "", colLabel(c.f)); o.value = c.f; sel.appendChild(o); });
    $("findOp").value = "find"; $("findText").value = ""; $("findRepl").value = "";
    $("findCase").checked = false; $("findWord").checked = false; $("findRegex").checked = false;
    $("findError").hidden = true; clear($("findPreview")); $("findSummary").textContent = ""; $("findApply").disabled = true;
    $("findBox").hidden = false;
    openDlg("findDlg");
    $("findText").focus();
  }
  function findOp() {
    var type = $("findOp").value;
    return type === "find" ? { type: "find", find: $("findText").value, replace: $("findRepl").value, regex: $("findRegex").checked, caseSensitive: $("findCase").checked, wholeWord: $("findWord").checked } : { type: type };
  }
  function scheduleFind() { clearTimeout(fnd.timer); fnd.timer = setTimeout(runFind, 150); }
  function runFind() {
    var seq = ++fnd.seq, op = findOp();
    $("findBox").hidden = op.type !== "find";
    if (op.type === "find" && !op.find) { $("findError").hidden = true; clear($("findPreview")); $("findSummary").textContent = ""; $("findApply").disabled = true; fnd.last = null; return; }
    var fields = $("findField").value === "*" ? currentView().filter(function (c) { return !c.special || c.special === "history"; }).map(function (c) { return c.f; }) : [$("findField").value];
    var jobs = fields.map(function (f) {
      var rows = fnd.rows.filter(function (r) { return !isLocked(r, f); });
      return api.tools.text({ op: op, rows: rows.map(function (r) { return { id: r.id, value: r.cur[f] || "" }; }) }).then(function (res) { return { f: f, res: res }; });
    });
    Promise.all(jobs).then(function (all) {
      if (seq !== fnd.seq) return;
      var err = all.filter(function (x) { return x.res.error; })[0];
      if (err) { $("findError").hidden = false; $("findError").textContent = t("find.err." + err.res.error); clear($("findPreview")); $("findSummary").textContent = ""; $("findApply").disabled = true; fnd.last = null; return; }
      $("findError").hidden = true;
      var changes = [];
      all.forEach(function (x) { x.res.results.forEach(function (r) { if (r.changed) changes.push({ id: r.id, f: x.f, value: r.value }); }); });
      fnd.last = changes;
      var rows = changes.slice(0, 8).map(function (c) { var row = byId[c.id]; return { cols: [{ text: row.name }, { text: colLabel(c.f) }, { text: (row.cur[c.f] || "∅").replace(/\n/g, " ⏎ "), cls: "same" }, { text: (c.value || "∅").replace(/\n/g, " ⏎ "), cls: "new" }] }; });
      previewTable($("findPreview"), [t("col.file"), t("find.field"), t("pat.current"), t("pat.new")], rows);
      $("findSummary").textContent = t("find.summary", { n: changes.length });
      $("findApply").disabled = !changes.length;
    });
  }
  ["findText", "findRepl"].forEach(function (id) { $(id).addEventListener("input", scheduleFind); });
  ["findCase", "findWord", "findRegex", "findOp", "findField"].forEach(function (id) { $(id).addEventListener("change", scheduleFind); });
  $("findCancel").addEventListener("click", function () { closeDlg("findDlg"); });
  $("findApply").addEventListener("click", function () {
    if (!fnd.last) return;
    var n = applyChanges(fnd.last.map(function (c) { return { row: byId[c.id], f: c.f, value: c.value }; }));
    closeDlg("findDlg");
    toast(t("find.done", { n: n }));
  });
  $("toolFind").addEventListener("click", openFind);

  // ---- Date and time from the file ---------------------------------------------------------
  var dt = { rows: [], last: null, seq: 0 };
  function openDate() {
    var rows = checkedRows("wav");
    if (!needRows(rows)) return;
    dt.rows = rows;
    $("dateSource").value = "name"; $("dateTarget").value = "bext"; $("dateWithTime").checked = true;
    openDlg("dateDlg");
    runDate();
  }
  function runDate() {
    var seq = ++dt.seq;
    api.tools.datetime({ source: $("dateSource").value, target: $("dateTarget").value, withTime: $("dateWithTime").checked, rows: payloadRows(dt.rows) }).then(function (res) {
      if (seq !== dt.seq) return;
      dt.last = res.results;
      var rows = res.results.slice(0, 8).map(function (r) { return { cols: [{ text: byId[r.id].name }, { text: r.date, cls: "new" }, { text: r.time || "—", cls: "new" }, { text: t("date.from." + r.from), cls: "same" }] }; });
      previewTable($("datePreview"), [t("col.file"), t("col.date"), t("col.time"), t("date.source")], rows);
      var fromName = res.results.filter(function (r) { return r.from === "name"; }).length;
      $("dateSummary").textContent = t("date.summary", { n: res.results.length, m: fromName });
      $("dateApply").disabled = !res.results.length;
    });
  }
  ["dateSource", "dateTarget", "dateWithTime"].forEach(function (id) { $(id).addEventListener("change", runDate); });
  $("dateCancel").addEventListener("click", function () { closeDlg("dateDlg"); });
  $("dateApply").addEventListener("click", function () {
    var tg = $("dateTarget").value;
    var fd = tg === "bext" ? "date" : tg === "cart-start" ? "cartStartDate" : "cartEndDate";
    var ft = tg === "bext" ? "time" : tg === "cart-start" ? "cartStartTime" : "cartEndTime";
    var changes = [], skipped = 0;
    (dt.last || []).forEach(function (r) {
      var row = byId[r.id];
      if (!row) return;
      if (isLocked(row, fd)) { skipped++; return; }
      changes.push({ row: row, f: fd, value: r.date });
      if (r.time && !isLocked(row, ft)) changes.push({ row: row, f: ft, value: r.time });
    });
    var n = applyChanges(changes);
    closeDlg("dateDlg");
    toast(t("date.done", { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  });
  $("toolDate").addEventListener("click", openDate);

  // ---- Coding history ----------------------------------------------------------------------
  var hs = { row: null };
  function openHistory(row) {
    var rows = checkedRows("wav");
    if (!row && !needRows(rows)) return;
    hs.row = row;
    $("histText").value = row ? (row.cur.codingHistory || "") : "";
    $("histError").hidden = true;
    var mode = $("histMode");
    mode.options[0].hidden = !row; mode.options[0].disabled = !row;
    mode.value = row ? "row" : "append";
    openDlg("historyDlg");
    $("histText").focus();
  }
  $("histCancel").addEventListener("click", function () { closeDlg("historyDlg"); });
  $("histApply").addEventListener("click", function () {
    var text = $("histText").value.replace(/\r\n?/g, "\n").replace(/\n+$/, ""), mode = $("histMode").value;
    if (/[^\u0000-\u007f]/.test(text)) { $("histError").hidden = false; $("histError").textContent = msg("err", "non-ascii"); return; }
    var changes = [], skipped = 0;
    var rows = mode === "row" && hs.row ? [hs.row] : checkedRows("wav");
    rows.forEach(function (r) {
      if (isLocked(r, "codingHistory")) { skipped++; return; }
      var cur = r.cur.codingHistory || "";
      var value = mode === "append" ? (text ? (cur ? cur + "\n" + text : text) : cur) : text;
      changes.push({ row: r, f: "codingHistory", value: value });
    });
    var n = applyChanges(changes);
    closeDlg("historyDlg");
    toast(t("hist.done", { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  });
  $("toolHistory").addEventListener("click", function () { openHistory(null); });

  // ---- Cover -------------------------------------------------------------------------------
  var cv = { row: null, picked: null };
  var BLANK = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><rect width="140" height="140" fill="#888" fill-opacity=".15"/></svg>');
  function openCover(row) {
    var rows = checkedRows("mp3");
    if (!row && !needRows(rows)) return;
    cv.row = row; cv.picked = null;
    $("coverError").hidden = true;
    $("coverNew").src = BLANK; $("coverNewText").textContent = t("cover.new");
    $("coverNow").src = BLANK; $("coverNowText").textContent = t("cover.current");
    $("coverNow").parentNode.hidden = !row;
    $("coverRemoveRow").hidden = !row; $("coverUseRow").hidden = !row;
    $("coverUseRow").disabled = true; $("coverUseAll").disabled = true;
    if (row) api.cover.preview(row.path).then(function (p) { if (p && cv.row === row) { $("coverNow").src = p.preview; $("coverNowText").textContent = t("cover.current") + " · " + p.mime; } else if (cv.row === row) $("coverNowText").textContent = t("cover.none"); });
    openDlg("coverDlg");
  }
  $("coverPick").addEventListener("click", function () {
    api.cover.pick().then(function (r) {
      if (!r) return;
      if (!r.ok) { $("coverError").hidden = false; $("coverError").textContent = r.name + ": " + msg("err", r.error); return; }
      $("coverError").hidden = true;
      cv.picked = r;
      $("coverNew").src = r.preview || BLANK; $("coverNewText").textContent = r.name + " · " + fmtBytes(r.size);
      $("coverUseRow").disabled = false; $("coverUseAll").disabled = false;
    });
  });
  function coverApply(rows, value, key) {
    var changes = [], skipped = 0;
    rows.forEach(function (r) { if (isLocked(r, "cover")) { skipped++; return; } changes.push({ row: r, f: "cover", value: value }); });
    var n = applyChanges(changes);
    closeDlg("coverDlg");
    toast(t(key, { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  }
  $("coverUseRow").addEventListener("click", function () { if (cv.picked && cv.row) coverApply([cv.row], cv.picked.token, "cover.done"); });
  $("coverUseAll").addEventListener("click", function () { if (cv.picked) coverApply(checkedRows("mp3"), cv.picked.token, "cover.done"); });
  $("coverRemoveRow").addEventListener("click", function () { if (cv.row) coverApply([cv.row], "", "cover.doneRemove"); });
  $("coverRemoveAll").addEventListener("click", function () { coverApply(checkedRows("mp3"), "", "cover.doneRemove"); });
  $("coverCancel").addEventListener("click", function () { closeDlg("coverDlg"); });
  $("toolCover").addEventListener("click", function () { openCover(null); });

  // ---- Check files -------------------------------------------------------------------------
  var chk = { issues: [], sev: { error: true, warn: true, info: true } };
  function openCheck() {
    var rows = state.rows;
    var files = rows.map(function (r) {
      return { id: r.id, name: r.name, kind: r.type, ok: !!(r.meta && r.meta.ok), writable: !!(r.meta && r.meta.writable), fields: copyFields(r.cur), meta: r.meta ? { hasBext: r.meta.hasBext, source: r.meta.source, version: r.meta.version, pictures: r.meta.pictures, warnings: r.meta.warnings } : {} };
    });
    api.tools.checks(files).then(function (issues) {
      chk.issues = issues;
      renderCheck();
      openDlg("checkDlg");
    });
  }
  function checkShown() { return chk.issues.filter(function (i) { return chk.sev[i.severity]; }); }
  function renderCheck() {
    var c = { error: 0, warn: 0, info: 0 };
    chk.issues.forEach(function (i) { c[i.severity]++; });
    var files = {}; chk.issues.forEach(function (i) { files[i.id] = 1; });
    $("checkSummary").textContent = chk.issues.length ? t("check.summary", { n: Object.keys(files).length, m: state.rows.length }) : t("check.none");
    var fb = $("checkFilters"); clear(fb);
    ["error", "warn", "info"].forEach(function (s) {
      var l = el("label", "check"); var cb = el("input"); cb.type = "checkbox"; cb.checked = chk.sev[s];
      cb.addEventListener("change", function () { chk.sev[s] = cb.checked; renderCheck(); });
      l.appendChild(cb); l.appendChild(el("span", "", t("check.sev." + s) + " (" + c[s] + ")")); fb.appendChild(l);
    });
    var shown = checkShown();
    previewTable($("checkList"), [t("check.severity"), t("col.file"), t("check.issue")], shown.slice(0, 1000).map(function (i) {
      var row = byId[i.id];
      return { cols: [{ text: t("check.sev." + i.severity), cls: "sev-" + i.severity }, { text: row ? row.name : "?" }, { text: t("chk." + i.code, { field: i.field ? colLabel(i.field) : "" }) }], onClick: function () { gotoRow(row); } };
    }));
    $("checkShow").disabled = !shown.length;
  }
  function gotoRow(row) {
    if (!row) return;
    closeDlg("checkDlg");
    state.tab = row.type;
    if (state.filterIds && !state.filterIds[row.id]) state.filterIds = null;
    renderTab();
    if (row.els) { row.els.row.scrollIntoView({ block: "center" }); row.els.row.classList.add("row--flash"); setTimeout(function () { row.els && row.els.row.classList.remove("row--flash"); }, 1600); }
  }
  $("checkClose").addEventListener("click", function () { closeDlg("checkDlg"); });
  $("checkShow").addEventListener("click", function () {
    var ids = {}; var first = null;
    checkShown().forEach(function (i) { ids[i.id] = 1; if (!first) first = byId[i.id]; });
    state.filterIds = ids;
    if (first && !visibleRows(state.tab).length) state.tab = first.type;
    closeDlg("checkDlg");
    renderTab();
  });
  $("toolCheck").addEventListener("click", openCheck);

  // ---- CSV ---------------------------------------------------------------------------------
  var csv = { mode: "out", phase: "choose", plan: null };
  function csvFieldList() { return textFields(state.tab); }
  function openCsv(mode) {
    csv.mode = mode; csv.phase = "choose"; csv.plan = null;
    $("csvTitle").textContent = t(mode === "out" ? "csv.titleOut" : "csv.titleIn");
    $("csvOutForm").hidden = mode !== "out"; $("csvInForm").hidden = mode !== "in";
    $("csvDelim").value = lang === "en" ? "," : ";";
    $("csvRows").value = checkedRows(state.tab).length ? "checked" : "all";
    $("csvClear").checked = false;
    $("csvError").hidden = true; clear($("csvList"));
    $("csvHint").textContent = t(mode === "out" ? "csv.hintOut" : "csv.hintIn");
    $("csvGo").textContent = t(mode === "out" ? "csv.export" : "csv.choose");
    $("csvGo").disabled = false;
    openDlg("csvDlg");
  }
  $("csvGo").addEventListener("click", function () {
    if (csv.mode === "out") {
      var rows = $("csvRows").value === "checked" ? checkedRows(state.tab) : rowsOf(state.tab);
      if (!rows.length) { $("csvError").hidden = false; $("csvError").textContent = t("tool.nocheck"); return; }
      var fields = csvFieldList();
      api.tools.csvExport({ tab: state.tab, delimiter: $("csvDelim").value, headers: ["path"].concat(fields), rows: rows.map(function (r) { return [r.path].concat(fields.map(function (f) { return r.cur[f] || ""; })); }) }).then(function (res) {
        if (res.canceled) return;
        closeDlg("csvDlg");
        toast(t("csv.exported", { n: res.count, name: res.name }));
      });
      return;
    }
    if (csv.phase === "choose") {
      api.tools.csvImport({ known: csvFieldList(), files: rowsOf(state.tab).map(function (r) { return { path: r.path }; }), emptyMeansClear: $("csvClear").checked }).then(function (res) {
        if (res.canceled) return;
        if (!res.ok) { $("csvError").hidden = false; $("csvError").textContent = t("csv.err." + res.error); return; }
        $("csvError").hidden = true;
        csv.plan = res; csv.phase = "apply";
        var ul = $("csvList"); clear(ul);
        ul.appendChild(el("li", "", t("csv.found", { name: res.name, n: res.rows })));
        ul.appendChild(el("li", "chg", t("csv.willUpdate", { n: res.updates.length, cols: res.columns.map(colLabel).join(", ") })));
        if (res.unmatched.length) ul.appendChild(el("li", "bad", t("csv.unmatched", { n: res.unmatched.length })));
        if (res.ambiguous.length) ul.appendChild(el("li", "bad", t("csv.ambiguous", { n: res.ambiguous.length })));
        $("csvGo").textContent = t("csv.apply"); $("csvGo").disabled = !res.updates.length;
      });
      return;
    }
    var changes = [], skipped = 0;
    csv.plan.updates.forEach(function (u) {
      var row = byPath[u.path];
      if (!row) return;
      Object.keys(u.values).forEach(function (f) { if (isLocked(row, f)) { skipped++; return; } changes.push({ row: row, f: f, value: u.values[f] }); });
    });
    var n = applyChanges(changes);
    closeDlg("csvDlg");
    toast(t("csv.done", { n: n }) + (skipped ? " · " + t("apply.skipped", { n: skipped }) : ""));
  });
  $("csvCancel").addEventListener("click", function () { closeDlg("csvDlg"); });
  $("toolCsvOut").addEventListener("click", function () { openCsv("out"); });
  $("toolCsvIn").addEventListener("click", function () { openCsv("in"); });

  // ---- Settings ----------------------------------------------------------------------------
  function showBackupDir() { return api.settings.get().then(function (s) { state.settings = s; $("backupDir").textContent = s.backupDir; }); }
  function openSettings(pane) {
    showBackupDir();
    $("langSel").value = lang; $("themeSel").value = state.settings.theme; $("logDays").value = state.settings.logRetentionDays;
    $("updAuto").checked = state.settings.checkUpdates;
    $("cfgChoose").hidden = true; $("cfgResult").textContent = "";
    selectSettingsTab(pane || "general");
    fillAbout();
    renderUpdate();
    openDlg("settingsDlg");
  }
  function selectSettingsTab(name) {
    document.querySelectorAll("[data-stab]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-stab") === name ? "true" : "false"); });
    document.querySelectorAll("[data-spane]").forEach(function (p) { p.hidden = p.getAttribute("data-spane") !== name; });
  }
  document.querySelectorAll("[data-stab]").forEach(function (b) { b.addEventListener("click", function () { selectSettingsTab(b.getAttribute("data-stab")); }); });
  $("settingsBtn").addEventListener("click", function () { openSettings("general"); });
  $("settingsClose").addEventListener("click", function () { closeDlg("settingsDlg"); });
  $("backupChange").addEventListener("click", function () { api.settings.chooseBackupDir().then(function (s) { state.settings = s; $("backupDir").textContent = s.backupDir; }); });
  $("backupOpen").addEventListener("click", function () { api.settings.openBackupDir(); });
  $("logDays").addEventListener("change", function () { var v = parseInt($("logDays").value, 10); if (v >= 1 && v <= 90) saveSettings({ logRetentionDays: v }); });

  // configuration backup
  $("cfgExport").addEventListener("click", function () {
    api.backup.export().then(function (r) { if (r.canceled) return; $("cfgResult").textContent = t("cfg.exported", { name: r.name }); });
  });
  $("cfgImport").addEventListener("click", function () {
    api.backup.import().then(function (r) {
      if (r.canceled) return;
      if (!r.ok) { $("cfgResult").textContent = t("cfg.err." + r.error); $("cfgChoose").hidden = true; return; }
      $("cfgResult").textContent = "";
      $("cfgChooseText").textContent = t("cfg.found", { name: r.name, n: r.presets });
      $("cfgChoose").hidden = false;
    });
  });
  $("cfgCancel").addEventListener("click", function () { $("cfgChoose").hidden = true; });
  $("cfgApply").addEventListener("click", function () {
    api.backup.apply($("cfgMode").value).then(function (r) {
      $("cfgChoose").hidden = true;
      if (!r.ok) { $("cfgResult").textContent = t("cfg.err." + r.error); return; }
      state.settings = r.settings;
      lang = r.settings.language; t = I18N.make(lang);
      applyTheme(r.settings.theme);
      $("optRecursive").checked = r.settings.recursive;
      $("langSel").value = lang; $("themeSel").value = r.settings.theme; $("updAuto").checked = r.settings.checkUpdates; $("logDays").value = r.settings.logRetentionDays;
      applyI18n();
      $("cfgResult").textContent = r.added !== null ? t("cfg.doneAdd", { n: r.added }) : t("cfg.doneReplace");
    });
  });

  // ---- About ---------------------------------------------------------------------------------
  var appInfo = null;
  function fillAbout() {
    if (!appInfo) return;
    $("aboutVer").textContent = "v" + appInfo.version;
    $("aboutSys").textContent = appInfo.platform + " " + appInfo.arch + " · Electron " + appInfo.electron;
  }
  $("aboutCopy").addEventListener("click", function () {
    api.supportInfo().then(function (text) {
      var done = function () { toast(t("about.copied")); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      else { fallbackCopy(text); done(); }
    });
  });
  function fallbackCopy(text) { var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) { /* ignore */ } ta.remove(); }
  $("aboutLogs").addEventListener("click", function () { api.logs.openFolder(); });
  $("aboutUpdate").addEventListener("click", function () { selectSettingsTab("updates"); checkNow(); });

  // ---- Guided update -----------------------------------------------------------------------
  function updInfo() { return upd.view && upd.view.info; }
  function checkNow() {
    $("updText").textContent = t("upd.checking");
    return api.update.check().then(function (view) { upd.view = view; if (upd.phase !== "downloading") { upd.phase = view.downloaded ? "ready" : "idle"; upd.file = view.downloaded; } renderUpdate(); });
  }
  function lastCheckText() {
    var lc = upd.view && upd.view.lastCheck;
    if (!lc || !lc.at) return t("upd.never");
    return t("upd.last", { when: new Date(lc.at).toLocaleString(lang), result: lc.ok ? t("upd.ok") : t("upd.failed") });
  }
  function renderUpdate() {
    var info = updInfo();
    var avail = info && info.ok && info.available;
    var banner = $("updBanner"); clear(banner);
    var showBanner = (avail && (upd.view.banner === "show" || upd.phase !== "idle")) || upd.phase === "error";
    banner.hidden = !showBanner;
    // settings pane
    var text = $("updText");
    ["updDownload", "updCancel", "updInstall", "updRetry", "updPage"].forEach(function (id) { $(id).hidden = true; });
    $("updProgress").hidden = upd.phase !== "downloading";
    $("updBar").style.width = upd.pct + "%";
    $("updNotes").textContent = avail && info.notes ? info.notes : "";
    $("updLast").textContent = lastCheckText();
    var line;
    if (upd.phase === "downloading") line = t("upd.downloading", { pct: upd.pct, got: fmtBytes(upd.received), total: upd.total ? fmtBytes(upd.total) : "?" });
    else if (upd.phase === "ready") line = t("upd.ready", { v: info ? info.latest : "" });
    else if (upd.phase === "error") line = upd.error;
    else if (!info) line = t("upd.notChecked");
    else if (!info.ok) line = t("upd.error", { e: info.error });
    else if (info.noRelease) line = t("upd.norelease");
    else if (avail) line = t("upd.available", { v: info.latest, c: info.current });
    else line = t("upd.latest", { v: info.current });
    text.textContent = line;
    if (avail) $("updPage").hidden = false;
    if (upd.phase === "idle" && avail && info.installer) $("updDownload").hidden = false;
    if (upd.phase === "idle" && avail && !info.installer) text.textContent = line + " " + t("upd.noInstaller");
    if (upd.phase === "downloading") $("updCancel").hidden = false;
    if (upd.phase === "ready") $("updInstall").hidden = false;
    if (upd.phase === "error") { $("updRetry").hidden = false; }
    if (!showBanner) return;
    // the banner
    var left = el("div", "update-banner__text");
    left.appendChild(el("strong", "", upd.phase === "error" ? upd.error : line));
    if (upd.phase === "idle" && info.notes) left.appendChild(el("span", "update-banner__notes", info.notes));
    banner.appendChild(left);
    function btn(label, cls, fn) { var b = el("button", "btn btn--small " + cls, label); b.type = "button"; b.addEventListener("click", fn); banner.appendChild(b); return b; }
    if (upd.phase === "downloading") {
      var pr = el("div", "progress"); var bar = el("div", "progress__bar"); bar.style.width = upd.pct + "%"; pr.appendChild(bar); banner.appendChild(pr);
      btn(t("upd.cancel"), "btn--ghost", cancelDownload);
    } else if (upd.phase === "ready") {
      btn(t("upd.install"), "", doInstall);
      btn(t("upd.page"), "btn--ghost", openNotes);
    } else if (upd.phase === "error") {
      btn(t("upd.retry"), "", function () { if (updInfo() && updInfo().available) startDownload(); else checkNow(); });
    } else {
      if (info.installer) btn(t("upd.download"), "", startDownload);
      btn(t("upd.later"), "btn--ghost", function () { api.update.remind().then(function (v) { upd.view = v; renderUpdate(); }); });
      btn(t("upd.skip"), "btn--ghost", function () { api.update.skip().then(function (v) { upd.view = v; renderUpdate(); }); });
      btn(t("upd.page"), "btn--ghost", openNotes);
    }
  }
  function openNotes() { api.update.page(); }
  function startDownload() {
    upd.phase = "downloading"; upd.pct = 0; upd.received = 0; upd.total = 0; upd.error = null;
    renderUpdate();
    api.update.download().then(function (res) {
      if (res.ok) { upd.phase = "ready"; upd.file = res.file; }
      else if (res.error === "cancelled") upd.phase = "idle";
      else { upd.phase = "error"; upd.error = t("upd.dlError", { e: res.error === "checksum-mismatch" ? t("upd.badHash") : res.error }); }
      renderUpdate();
    });
  }
  function cancelDownload() { api.update.cancel(); }
  function doInstall() {
    api.update.install().then(function (res) {
      if (res.ok) {
        if (res.hint === "mac") toast(t("upd.hintMac"), 12000);
        else if (res.hint === "linux") toast(t("upd.hintLinux"), 12000);
        else toast(t("upd.closing"), 6000);
        return;
      }
      if (res.error === "cancelled") return;
      if (res.error === "busy") { upd.phase = "ready"; toast(t("upd.busy"), 8000); return; }
      upd.phase = "error"; upd.error = t("upd.installError", { e: res.error }); renderUpdate();
    });
  }
  $("updCheck").addEventListener("click", checkNow);
  $("updDownload").addEventListener("click", startDownload);
  $("updCancel").addEventListener("click", cancelDownload);
  $("updInstall").addEventListener("click", doInstall);
  $("updRetry").addEventListener("click", function () { if (updInfo() && updInfo().available) startDownload(); else checkNow(); });
  $("updPage").addEventListener("click", openNotes);
  $("updAuto").addEventListener("change", function () { saveSettings({ checkUpdates: this.checked }); });
  api.update.onProgress(function (received, total) {
    upd.received = received; upd.total = total; upd.pct = total ? Math.min(100, Math.round(received * 100 / total)) : 0;
    renderUpdate();
  });
  api.update.onView(function (view) { upd.view = view; if (upd.phase === "idle" || upd.phase === "ready") upd.phase = view.downloaded ? "ready" : "idle"; renderUpdate(); });

  // What's new (once, after an update)
  function showWhatsNew(info) {
    if (!info) return;
    $("whatsNewTitle").textContent = t("whatsnew.title", { v: info.version });
    var ul = $("whatsNewList"); clear(ul);
    (info.bullets.length ? info.bullets : [t("whatsnew.empty")]).forEach(function (b) { ul.appendChild(el("li", "", b.replace(/\*\*/g, "").replace(/`/g, ""))); });
    openDlg("whatsNewDlg");
  }
  $("whatsNewOk").addEventListener("click", function () { closeDlg("whatsNewDlg"); api.whatsNew.seen(); });
  $("whatsNewDlg").addEventListener("cancel", function () { api.whatsNew.seen(); });
  $("whatsNewNotes").addEventListener("click", function () { api.update.page(); });

  // ---- Help --------------------------------------------------------------------------------
  function buildHelp() {
    var body = $("helpBody");
    clear(body);
    function h(key) { body.appendChild(el("h3", "", t(key))); }
    function p(key) { var e = el("p", "", t(key)); body.appendChild(e); return e; }
    function list(keys, tag) { var ul = el(tag || "ul"); keys.forEach(function (k) { ul.appendChild(el("li", "", t(k))); }); body.appendChild(ul); }
    function table(head, rows) {
      var wrap = el("div", "tablewrap tablewrap--plain");
      var tb = el("table");
      var tr = el("tr"); head.forEach(function (k) { tr.appendChild(el("th", "", t(k))); }); tb.appendChild(tr);
      rows.forEach(function (r) { var tr2 = el("tr"); r.forEach(function (k) { tr2.appendChild(el("td", "", /^[a-z]+\.[A-Za-z0-9.]+$/.test(k) ? t(k) : k)); }); tb.appendChild(tr2); });
      wrap.appendChild(tb); body.appendChild(wrap);
    }
    h("help.hWhat"); p("help.pWhat");
    h("help.hUse"); list(["help.u1", "help.u2", "help.u3", "help.u4", "help.u5", "help.u6", "help.u7"], "ol");
    h("help.hTools"); list(["help.t1", "help.t2", "help.t3", "help.t4", "help.t5", "help.t6", "help.t7", "help.t8"]);
    p("help.pPatterns");
    h("help.hBwf"); p("help.pBwf");
    table(["help.bTh1", "help.bTh2", "help.bTh3"], [
      ["Description", "256", "help.bDesc"], ["Originator", "32", "help.bOrig"], ["OriginatorReference", "32", "help.bRef"],
      ["OriginationDate", "10", "help.bDate"], ["OriginationTime", "8", "help.bTime"], ["CodingHistory", "—", "help.bHist"]]);
    p("help.pBwf2");
    h("help.hIxml"); p("help.pIxml");
    h("help.hCart"); p("help.pCart");
    h("help.hRf64"); p("help.pRf64");
    h("help.hId3"); p("help.pId3"); list(["help.i1", "help.i2", "help.i3", "help.i4", "help.i5"]);
    h("help.hFlac"); p("help.pFlac");
    h("help.hSafe"); list(["help.s1", "help.s2", "help.s3", "help.s4", "help.s5", "help.s6"]);
    h("help.hLimits"); list(["help.l1", "help.l2", "help.l3", "help.l4", "help.l5", "help.l6", "help.l7"]);
    h("help.hVal"); p("help.vIntro");
    table(["help.vTh1", "help.vTh2", "help.vTh3"], [["help.v1a", "help.v1b", "help.v1c"], ["help.v2a", "help.v2b", "help.v2c"], ["help.v3a", "help.v3b", "help.v3c"], ["help.v4a", "help.v4b", "help.v4c"], ["help.v5a", "help.v5b", "help.v5c"]]);
    p("help.vNot");
    h("help.hInst"); p("help.pInst");
    h("help.hPriv"); p("help.pPriv");
  }
  $("helpBtn").addEventListener("click", function () { openDlg("helpDlg"); });
  $("helpClose").addEventListener("click", function () { closeDlg("helpDlg"); });
  $("aboutTip").addEventListener("click", function () { api.openExternal(t("about.tipUrl")); });
  $("aboutTipJar").addEventListener("click", function () { api.openExternal(t("about.tipUrl")); }); // the jar does what the button does
  document.querySelectorAll("a[data-ext]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); if (/^https:/.test(a.href)) api.openExternal(a.href); }); });

  // ---- Start -------------------------------------------------------------------------------
  // The first version kept the choices in localStorage; they move once into the settings file.
  function migrate(s) {
    if (s.migrated) return Promise.resolve(s);
    var patch = { migrated: true };
    var l = oldLoad("lang"), th = oldLoad("theme"), tb = oldLoad("tab"), rc = oldLoad("recursive"), ua = oldLoad("updauto");
    if (l && I18N.LANGS[l]) patch.language = l;
    if (th === "light" || th === "dark" || th === "auto") patch.theme = th;
    if (tb === "mp3" || tb === "wav" || tb === "flac") patch.tab = tb;
    if (rc !== null) patch.recursive = rc === "1";
    if (ua !== null) patch.checkUpdates = ua === "1";
    return api.settings.update(patch);
  }

  api.settings.get().then(migrate).then(function (s) {
    state.settings = s;
    lang = I18N.LANGS[s.language] ? s.language : "en"; t = I18N.make(lang);
    state.tab = s.tab; state.wavSet = s.wavSet;
    $("optRecursive").checked = s.recursive;
    $("themeSel").value = s.theme; langSel.value = lang;
    applyTheme(s.theme);
    applyI18n();
    api.info().then(function (i) { appInfo = i; $("ver").textContent = "v" + i.version; fillAbout(); });
    refreshRestore();
    api.update.state().then(function (v) { if (v && v.info) { upd.view = v; renderUpdate(); } });
    api.whatsNew.get().then(showWhatsNew);
  });
})();
