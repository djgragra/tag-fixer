/* Tag Fixer — renderer. © 2026 Graziano Melzi · OnAir Garage — MIT License */
(function () {
  "use strict";

  var KEY = "com.onairgarage.tagfixer.";
  var api = window.api;
  var $ = function (id) { return document.getElementById(id); };
  function load(k, d) { try { var v = localStorage.getItem(KEY + k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) { /* ignore */ } }

  // ---- Columns -----------------------------------------------------------------------------
  var COLS = {
    mp3: [
      { f: "title", w: "minmax(170px, 1.4fr)" }, { f: "artist", w: "minmax(140px, 1fr)" }, { f: "album", w: "minmax(140px, 1fr)" },
      { f: "year", w: "100px" }, { f: "track", w: "76px" }, { f: "genre", w: "120px" }, { f: "comment", w: "minmax(160px, 1.2fr)" }
    ],
    wav: [
      { f: "description", w: "minmax(200px, 2fr)", mono: true }, { f: "originator", w: "minmax(130px, 1fr)", mono: true },
      { f: "originatorReference", w: "minmax(130px, 1fr)", mono: true }, { f: "date", w: "118px", mono: true }, { f: "time", w: "100px", mono: true }
    ]
  };
  var FIRST = "34px minmax(200px, 1.1fr) ";
  var LAST = { mp3: " minmax(170px, 0.8fr)", wav: " 170px minmax(170px, 0.8fr)" };
  function template(tab) { return FIRST + COLS[tab].map(function (c) { return c.w; }).join(" ") + LAST[tab]; }
  var LIMIT = { description: 256, originator: 32, originatorReference: 32, date: 10, time: 8 };

  // ---- State -------------------------------------------------------------------------------
  var lang = load("lang", "en");   // the app always opens in English until the user changes it
  if (!I18N.LANGS[lang]) lang = "en";
  var t = I18N.make(lang);
  var state = { rows: [], tab: load("tab", "mp3"), nextId: 1, busy: false, restore: { available: false } };
  var byPath = {};
  var validateTimer = null, validateQueue = {};
  var pendingUpdate = null, downloadedFile = null;

  function toast(msg, ms) {
    var el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 5000);
  }
  function openDlg(id) { var d = $(id); if (!d.open) d.showModal(); }
  function closeDlg(id) { var d = $(id); if (d.open) d.close(); }
  function baseName(p) { return p.split(/[\\/]/).pop(); }
  function fmtBytes(n) {
    if (n === null || n === undefined) return "?";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i];
  }
  // Message for a code: the given group first, then the other group of codes, else the code itself.
  function msg(prefix, code) {
    var groups = [prefix, "err", "ro", "warn"];
    for (var i = 0; i < groups.length; i++) { var k = groups[i] + "." + code; var s = t(k); if (s !== k) return s; }
    return String(code);
  }

  // ---- i18n and theme ----------------------------------------------------------------------
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) { el.title = t(el.getAttribute("data-i18n-title")); });
    document.title = t("app.title");
    buildHelp();
    renderTab();
  }
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
    else document.documentElement.removeAttribute("data-theme");
  }
  var langSel = $("langSel");
  Object.keys(I18N.LANGS).forEach(function (code) { var o = document.createElement("option"); o.value = code; o.textContent = I18N.LANGS[code]; langSel.appendChild(o); });
  langSel.value = lang;
  langSel.addEventListener("change", function () { lang = langSel.value; save("lang", lang); t = I18N.make(lang); applyI18n(); });
  var themeSel = $("themeSel"), theme = load("theme", "auto");
  themeSel.value = theme; applyTheme(theme);
  themeSel.addEventListener("change", function () { theme = themeSel.value; save("theme", theme); applyTheme(theme); });

  $("optRecursive").checked = load("recursive", "0") === "1";
  $("optRecursive").addEventListener("change", function () { save("recursive", this.checked ? "1" : "0"); });
  $("updAuto").checked = load("updauto", "1") === "1";
  $("updAuto").addEventListener("change", function () { save("updauto", this.checked ? "1" : "0"); });

  // ---- Rows --------------------------------------------------------------------------------
  function rowsOf(tab) { return state.rows.filter(function (r) { return r.type === tab; }); }
  function copyFields(f) { var o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); return o; }

  function dirtyFields(row) {
    if (!row.meta || !row.meta.ok) return [];
    return COLS[row.type].map(function (c) { return c.f; }).filter(function (f) { return !isLocked(row, f) && row.cur[f] !== row.orig[f]; });
  }
  function isLocked(row, f) { return !row.meta || !row.meta.ok || !row.meta.writable || !!(row.meta.locked && row.meta.locked[f]); }
  function lockReason(row, f) {
    if (!row.meta || !row.meta.ok) return msg("ro", row.meta ? row.meta.error : "unreadable");
    if (row.meta.locked && row.meta.locked[f]) return msg("ro", row.meta.locked[f]);
    return msg("ro", row.meta.readOnlyReason);
  }
  function isEditable(row) { return row.meta && row.meta.ok && row.meta.writable; }

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
      var row = { id: state.nextId++, path: f.path, name: f.name, dir: f.dir, type: f.type, size: f.size, selected: true, meta: null, orig: {}, cur: {}, errors: {}, saveError: null };
      byPath[f.path] = row; state.rows.push(row); fresh.push(row);
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

  // ---- Table -------------------------------------------------------------------------------
  function colLabel(f) { return t("col." + f); }

  function buildHeader() {
    var tab = state.tab, grid = $("grid");
    grid.style.setProperty("--cols", template(tab));
    var head = $("head"), apply = $("applyRow");
    head.textContent = ""; apply.textContent = "";
    var all = document.createElement("div"); all.className = "c-check";
    var allChk = document.createElement("input"); allChk.type = "checkbox"; allChk.id = "selAll"; allChk.setAttribute("aria-label", t("col.all"));
    allChk.addEventListener("change", function () { rowsOf(state.tab).forEach(function (r) { r.selected = allChk.checked; }); renderBody(); updateSummary(); });
    all.appendChild(allChk); head.appendChild(all);
    var file = document.createElement("div"); file.textContent = t("col.file"); head.appendChild(file);
    COLS[tab].forEach(function (c) { var d = document.createElement("div"); d.textContent = colLabel(c.f); head.appendChild(d); });
    if (tab === "wav") { var inf = document.createElement("div"); inf.textContent = t("col.info"); head.appendChild(inf); }
    var st = document.createElement("div"); st.textContent = t("col.status"); head.appendChild(st);

    // "set for all checked rows": one input and one button per column
    var spacer = document.createElement("div"); apply.appendChild(spacer);
    var lbl = document.createElement("div"); lbl.className = "applylabel"; lbl.textContent = t("apply.label"); apply.appendChild(lbl);
    COLS[tab].forEach(function (c) {
      var cell = document.createElement("div");
      var inp = document.createElement("input"); inp.type = "text"; inp.spellcheck = false; inp.setAttribute("aria-label", t("apply.label") + ": " + colLabel(c.f));
      if (c.mono) inp.className = "mono";
      var btn = document.createElement("button"); btn.type = "button"; btn.textContent = "⇣"; btn.title = t("apply.tip");
      btn.addEventListener("click", function () { applyAll(c.f, inp.value); });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyAll(c.f, inp.value); } });
      cell.appendChild(inp); cell.appendChild(btn); apply.appendChild(cell);
    });
    if (tab === "wav") apply.appendChild(document.createElement("div"));
    apply.appendChild(document.createElement("div"));
  }

  function infoText(row) {
    var m = row.meta;
    if (!m || !m.ok || !m.info) return "";
    var i = m.info, parts = [];
    if (i.sampleRate) parts.push((i.sampleRate / 1000) + " kHz");
    if (i.bits) parts.push(i.bits + " bit");
    if (i.channels) parts.push(i.channels + " ch");
    if (i.seconds !== undefined) { var s = Math.round(i.seconds); parts.push(Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")); }
    return parts.join(" · ");
  }

  function badge(row) {
    var m = row.meta;
    if (!m) return "";
    if (!m.ok) return "";
    if (row.type === "mp3") return m.source === "v2" ? "ID3v" + m.version : m.source === "v1" ? t("badge.v1only") : t("badge.notag");
    return m.hasBext ? "bext v" + (m.bext && m.bext.version !== undefined ? m.bext.version : "?") : t("badge.nobext");
  }

  function buildRow(row) {
    var tab = row.type;
    var el = document.createElement("div");
    el.className = "row"; el.setAttribute("role", "row");
    var c0 = document.createElement("div"); c0.className = "c-check";
    var chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = row.selected; chk.setAttribute("aria-label", row.name);
    chk.addEventListener("change", function () { row.selected = chk.checked; el.classList.toggle("row--unchecked", !row.selected); updateSummary(); });
    c0.appendChild(chk); el.appendChild(c0);
    var cf = document.createElement("div"); cf.className = "c-file";
    var nm = document.createElement("div"); nm.className = "name"; nm.textContent = row.name; nm.title = row.path;
    var mt = document.createElement("div"); mt.className = "meta"; mt.textContent = row.dir; mt.title = row.dir;
    cf.appendChild(nm); cf.appendChild(mt); el.appendChild(cf);
    row.els = { row: el, inputs: {}, status: null, meta: mt };
    COLS[tab].forEach(function (c, ci) {
      var cell = document.createElement("div"); cell.className = "c-cell";
      var inp = document.createElement("input"); inp.type = "text"; inp.className = "cell" + (c.mono ? " mono" : ""); inp.spellcheck = false;
      inp.value = row.cur[c.f] === undefined ? "" : row.cur[c.f];
      inp.setAttribute("aria-label", row.name + " — " + colLabel(c.f));
      inp.addEventListener("input", function () { onEdit(row, c.f, inp.value); });
      inp.addEventListener("keydown", function (e) { onCellKey(e, row, c.f, inp); });
      cell.appendChild(inp); el.appendChild(cell);
      row.els.inputs[c.f] = inp;
    });
    if (tab === "wav") { var ci = document.createElement("div"); ci.className = "c-info"; row.els.info = ci; el.appendChild(ci); }
    var st = document.createElement("div"); st.className = "c-status"; row.els.status = st; el.appendChild(st);
    refreshRow(row);
    return el;
  }

  function statusFor(row) {
    if (!row.meta) return { text: t("status.reading"), cls: "" };
    if (!row.meta.ok) return { text: msg("ro", row.meta.error), cls: "err" };
    if (row.saveError) return { text: t("status.failed") + ": " + msg("err", row.saveError), cls: "err" };
    var errs = Object.keys(row.errors || {});
    if (errs.length) return { text: colLabel(errs[0]) + ": " + errText(errs[0], row.errors[errs[0]]) + (errs.length > 1 ? " (+" + (errs.length - 1) + ")" : ""), cls: "err" };
    if (!row.meta.writable) return { text: msg("ro", row.meta.readOnlyReason), cls: "" };
    var d = dirtyFields(row).length;
    if (d) return { text: t("status.edited", { n: d }), cls: "ok" };
    return { text: row.meta.warnings && row.meta.warnings.length ? msg("warn", row.meta.warnings[0]) : "", cls: "" };
  }
  function errText(field, code) {
    if (code === "too-long" && LIMIT[field]) return t("err.too-long-n", { n: LIMIT[field] });
    return msg("err", code);
  }

  function refreshRow(row) {
    if (!row.els) return;
    var m = row.meta;
    COLS[row.type].forEach(function (c) {
      var inp = row.els.inputs[c.f], f = c.f;
      var locked = isLocked(row, f);
      inp.disabled = locked;
      inp.title = locked && m ? lockReason(row, f) : (row.orig[f] !== row.cur[f] ? t("was") + ": " + (row.orig[f] || "∅") : "");
      if (inp.value !== (row.cur[f] === undefined ? "" : row.cur[f])) inp.value = row.cur[f] === undefined ? "" : row.cur[f];
      var dirty = !locked && row.cur[f] !== row.orig[f];
      inp.classList.toggle("cell--dirty", dirty && !(row.errors && row.errors[f]));
      inp.classList.toggle("cell--err", !!(row.errors && row.errors[f]));
      inp.classList.toggle("cell--ascii", !!(m && m.nonAscii && m.nonAscii[f] && !dirty));
      if (m && m.nonAscii && m.nonAscii[f] && !dirty) inp.title = t("warn.nonascii-existing");
      if (m && m.multi && m.multi[f] && !dirty) inp.title = t("warn.multi");
    });
    row.els.meta.textContent = badge(row) ? badge(row) + " · " + row.dir : row.dir;
    if (row.els.info) row.els.info.textContent = infoText(row);
    var st = statusFor(row);
    row.els.status.textContent = st.text; row.els.status.title = st.text;
    row.els.status.className = "c-status" + (st.cls ? " " + st.cls : "");
    row.els.row.classList.toggle("row--unchecked", !row.selected);
  }

  function renderBody() {
    var body = $("body");
    body.textContent = "";
    var rows = rowsOf(state.tab);
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { var el = buildRow(r); frag.appendChild(el); });
    body.appendChild(frag);
    if (!rows.length && state.rows.length) {
      var e = document.createElement("div"); e.className = "empty-tab"; e.textContent = t("empty.tab", { type: state.tab === "mp3" ? "MP3" : "WAV" }); body.appendChild(e);
    }
    var all = $("selAll");
    if (all) { var sel = rows.filter(function (r) { return r.selected; }).length; all.checked = rows.length > 0 && sel === rows.length; all.indeterminate = sel > 0 && sel < rows.length; }
  }

  function renderTab() {
    document.body.classList.toggle("has-files", state.rows.length > 0);
    ["mp3", "wav"].forEach(function (tab) {
      var el = $(tab === "mp3" ? "tabMp3" : "tabWav");
      el.setAttribute("aria-selected", state.tab === tab ? "true" : "false");
      $(tab === "mp3" ? "countMp3" : "countWav").textContent = String(rowsOf(tab).length);
    });
    buildHeader();
    renderBody();
    updateSummary();
  }

  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { state.tab = b.getAttribute("data-tab"); save("tab", state.tab); renderTab(); });
  });

  // ---- Editing -----------------------------------------------------------------------------
  function onEdit(row, f, value) {
    row.cur[f] = value; row.saveError = null;
    queueValidate(row);
    refreshRow(row);
    updateSummary();
  }

  function onCellKey(e, row, f, inp) {
    var rows = rowsOf(state.tab), i = rows.indexOf(row), target = null;
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

  function applyAll(f, value) {
    var n = 0;
    rowsOf(state.tab).forEach(function (r) {
      if (!r.selected || isLocked(r, f)) return;
      r.cur[f] = value; r.saveError = null; n++;
      queueValidate(r); refreshRow(r);
    });
    updateSummary();
    toast(t("apply.done", { n: n }));
  }

  $("asciiBtn").addEventListener("click", function () {
    var targets = [];
    state.rows.forEach(function (r) {
      if (!r.selected || r.type !== "wav") return;
      Object.keys(r.errors || {}).forEach(function (f) { if (r.errors[f] === "non-ascii") targets.push({ row: r, f: f }); });
    });
    if (!targets.length) return;
    api.tags.toAscii(targets.map(function (x) { return x.row.cur[x.f]; })).then(function (out) {
      out.forEach(function (v, k) { targets[k].row.cur[targets[k].f] = v; queueValidate(targets[k].row); refreshRow(targets[k].row); });
      updateSummary();
      toast(t("ascii.done", { n: out.length }));
    });
  });

  $("discardBtn").addEventListener("click", function () {
    state.rows.forEach(function (r) { if (r.meta && r.meta.ok) { r.cur = copyFields(r.orig); r.errors = {}; r.saveError = null; refreshRow(r); } });
    updateSummary();
  });

  // ---- Summary and buttons -----------------------------------------------------------------
  function changedRows() { return state.rows.filter(function (r) { return r.selected && isEditable(r) && dirtyFields(r).length; }); }
  function hasAnyDirty() { return state.rows.some(function (r) { return r.meta && r.meta.ok && dirtyFields(r).length; }); }

  function updateSummary() {
    var total = state.rows.length;
    var changed = changedRows();
    var errors = changed.filter(function (r) { return Object.keys(r.errors || {}).length; }).length;
    var nonAscii = state.rows.some(function (r) { return r.selected && r.type === "wav" && Object.keys(r.errors || {}).some(function (f) { return r.errors[f] === "non-ascii"; }); });
    var sum = $("summary");
    sum.textContent = "";
    function part(text, cls) { var s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; sum.appendChild(s); }
    if (total) {
      part(t("sum.files", { n: total }));
      part(t("sum.checked", { n: state.rows.filter(function (r) { return r.selected; }).length }));
      if (changed.length) part(t("sum.changed", { n: changed.length }), "good");
      if (errors) part(t("sum.errors", { n: errors }), "bad");
    }
    var save = $("saveBtn");
    save.textContent = changed.length ? t("btn.save", { n: changed.length }) : t("btn.save.none");
    save.disabled = state.busy || !changed.length || errors > 0;
    save.title = errors > 0 ? t("tip.blocked") : "";
    $("discardBtn").disabled = state.busy || !hasAnyDirty();
    $("asciiBtn").hidden = !nonAscii;
    $("clearBtn").disabled = state.busy || !total;
    $("restoreBtn").disabled = state.busy || !state.restore.available;
    api.setDirty(hasAnyDirty());
  }

  // ---- Adding files ------------------------------------------------------------------------
  function scanOpts() { return { recursive: $("optRecursive").checked }; }
  $("addFilesBtn").addEventListener("click", function () { api.files.pick("files", scanOpts()).then(addFiles); });
  $("addFolderBtn").addEventListener("click", function () { api.files.pick("folder", scanOpts()).then(addFiles); });
  $("clearBtn").addEventListener("click", function () {
    if (hasAnyDirty() && !window.confirm(t("clear.confirm"))) return;
    state.rows = []; byPath = {}; renderTab();
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
      dirtyFields(r).forEach(function (f) { changes[f] = r.cur[f]; });
      return { path: r.path, changes: changes };
    });
  }

  $("saveBtn").addEventListener("click", function () {
    var items = saveItems();
    if (!items.length) return;
    api.save.preflight(items).then(function (pf) {
      $("confirmText").textContent = t("confirm.text", { n: items.length });
      $("confirmDir").textContent = pf.backupDir;
      var space = $("confirmSpace");
      if (pf.enough === false) { space.textContent = t("confirm.nospace", { need: fmtBytes(pf.bytes), free: fmtBytes(pf.free) }); space.className = "hint bad"; }
      else { space.textContent = t("confirm.space", { need: fmtBytes(pf.bytes), free: fmtBytes(pf.free) }); space.className = "hint"; }
      $("confirmOk").disabled = pf.enough === false;
      var ul = $("confirmList"); ul.textContent = "";
      items.slice(0, 8).forEach(function (it) {
        var row = byPath[it.path];
        Object.keys(it.changes).slice(0, 3).forEach(function (f) {
          var li = document.createElement("li");
          li.appendChild(document.createTextNode(baseName(it.path) + " · " + colLabel(f) + ": " + (row.orig[f] || "∅") + " → "));
          var to = document.createElement("span"); to.className = "chg"; to.textContent = it.changes[f] || "∅"; li.appendChild(to); ul.appendChild(li);
        });
      });
      if (items.length > 8) { var more = document.createElement("li"); more.textContent = t("confirm.more", { n: items.length - 8 }); ul.appendChild(more); }
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

  $("confirmOk").addEventListener("click", function () {
    var items = saveItems();
    state.busy = true; updateSummary();
    $("confirmOk").disabled = true; $("confirmCancel").disabled = true;
    $("saveProgress").hidden = false; $("saveProgressText").hidden = false; $("saveBar").style.width = "0%";
    api.save.run(items).then(function (out) {
      var ok = [], failed = [];
      out.results.forEach(function (r) { (r.ok ? ok : failed).push(r); });
      failed.forEach(function (r) { if (byPath[r.path]) byPath[r.path].saveError = r.error || "unknown"; });
      return api.tags.read(ok.map(function (r) { return r.path; })).then(function (metas) {
        metas.forEach(function (m, k) { var row = byPath[ok[k].path]; if (row) applyMeta(row, m); });
        state.busy = false;
        closeDlg("confirmDlg");
        renderBody(); updateSummary(); refreshRestore();
        showResult(ok.length, failed, out.backupDir);
      });
    }).catch(function (err) { state.busy = false; closeDlg("confirmDlg"); updateSummary(); toast(String(err && err.message || err)); });
  });

  function showResult(ok, failed, dir) {
    $("resultText").textContent = t("result.ok", { n: ok }) + (failed.length ? " · " + t("result.failed", { n: failed.length }) : "");
    var ul = $("resultList"); ul.textContent = "";
    failed.slice(0, 50).forEach(function (r) { var li = document.createElement("li"); li.className = "bad"; li.textContent = baseName(r.path) + " — " + msg("err", r.error); ul.appendChild(li); });
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
      var ul = $("restoreList"); ul.textContent = "";
      if (c.problems.length) {
        var head = document.createElement("li"); head.textContent = t("restore.skipped", { n: c.problems.length }); ul.appendChild(head);
        c.problems.slice(0, 30).forEach(function (p) { var li = document.createElement("li"); li.className = "bad"; li.textContent = baseName(p.path) + " — " + msg("err", p.error); ul.appendChild(li); });
      }
      $("restoreOk").disabled = !c.todo;
      openDlg("restoreDlg");
    });
  });
  $("restoreCancel").addEventListener("click", function () { closeDlg("restoreDlg"); });
  $("restoreOk").addEventListener("click", function () {
    closeDlg("restoreDlg");
    api.restore.run().then(function (res) {
      var done = res.results.filter(function (r) { return r.ok; });
      var rows = done.map(function (r) { return byPath[r.path]; }).filter(Boolean);
      toast(t("restore.done", { n: done.length }));
      refreshRestore();
      if (rows.length) return api.tags.read(rows.map(function (r) { return r.path; })).then(function (metas) { metas.forEach(function (m, k) { applyMeta(rows[k], m); }); renderBody(); updateSummary(); });
    });
  });

  // ---- Settings and updates ----------------------------------------------------------------
  function showBackupDir() { return api.settings.get().then(function (s) { $("backupDir").textContent = s.backupDir; }); }
  $("settingsBtn").addEventListener("click", function () { showBackupDir(); openDlg("settingsDlg"); });
  $("settingsClose").addEventListener("click", function () { closeDlg("settingsDlg"); });
  $("backupChange").addEventListener("click", function () { api.settings.chooseBackupDir().then(function (s) { $("backupDir").textContent = s.backupDir; }); });
  $("backupOpen").addEventListener("click", function () { api.settings.openBackupDir(); });

  function showUpdate(info) {
    pendingUpdate = info;
    var text = $("updText");
    $("updProgress").hidden = true; $("updDownload").hidden = true; $("updShow").hidden = true; $("updPage").hidden = true;
    if (!info.ok) text.textContent = t("upd.error", { e: info.error });
    else if (info.noRelease) text.textContent = t("upd.norelease");
    else if (info.available) { text.textContent = t("upd.available", { v: info.latest }); $("updPage").hidden = false; $("updDownload").hidden = !info.installer; }
    else text.textContent = t("upd.latest", { v: info.current });
  }
  function checkUpdates(silent) {
    if (!silent) $("updText").textContent = t("upd.checking");
    return api.update.check().then(function (info) {
      if (silent) { if (info.ok && info.available) { $("updBannerText").textContent = t("upd.available", { v: info.latest }); $("updBanner").hidden = false; showUpdate(info); } }
      else showUpdate(info);
    });
  }
  $("updCheck").addEventListener("click", function () { checkUpdates(false); });
  $("updBannerBtn").addEventListener("click", function () { showBackupDir(); openDlg("settingsDlg"); });
  $("updPage").addEventListener("click", function () { if (pendingUpdate && pendingUpdate.url) api.openExternal(pendingUpdate.url); });
  $("updDownload").addEventListener("click", function () {
    $("updDownload").hidden = true; $("updProgress").hidden = false; $("updBar").style.width = "0%";
    $("updText").textContent = t("upd.downloading", { pct: 0 });
    api.update.download().then(function (res) {
      $("updProgress").hidden = true;
      if (res.ok) { downloadedFile = res.file; $("updText").textContent = t("upd.done"); $("updShow").hidden = false; }
      else { $("updText").textContent = t("upd.error", { e: res.error }); $("updDownload").hidden = false; }
    });
  });
  $("updShow").addEventListener("click", function () { if (downloadedFile) api.update.reveal(downloadedFile); });
  api.update.onProgress(function (received, total) {
    var pct = total ? Math.min(100, Math.round(received * 100 / total)) : 0;
    $("updBar").style.width = pct + "%"; $("updText").textContent = t("upd.downloading", { pct: pct });
  });

  // ---- Help --------------------------------------------------------------------------------
  function buildHelp() {
    var body = $("helpBody");
    body.textContent = "";
    function h(key) { var e = document.createElement("h3"); e.textContent = t(key); body.appendChild(e); }
    function p(key) { var e = document.createElement("p"); e.textContent = t(key); body.appendChild(e); return e; }
    function list(keys, tag) { var ul = document.createElement(tag || "ul"); keys.forEach(function (k) { var li = document.createElement("li"); li.textContent = t(k); ul.appendChild(li); }); body.appendChild(ul); }
    function table(head, rows) {
      var wrap = document.createElement("div"); wrap.className = "tablewrap";
      var tb = document.createElement("table");
      var tr = document.createElement("tr"); head.forEach(function (k) { var th = document.createElement("th"); th.textContent = t(k); tr.appendChild(th); }); tb.appendChild(tr);
      rows.forEach(function (r) { var tr2 = document.createElement("tr"); r.forEach(function (k) { var td = document.createElement("td"); td.textContent = k.indexOf(".") > 0 && /^[a-z]+\.[A-Za-z0-9.]+$/.test(k) ? t(k) : k; tr2.appendChild(td); }); tb.appendChild(tr2); });
      wrap.appendChild(tb); body.appendChild(wrap);
    }
    h("help.hWhat"); p("help.pWhat");
    h("help.hUse"); list(["help.u1", "help.u2", "help.u3", "help.u4", "help.u5", "help.u6"], "ol");
    h("help.hBwf"); p("help.pBwf");
    table(["help.bTh1", "help.bTh2", "help.bTh3"], [
      ["Description", "256", "help.bDesc"], ["Originator", "32", "help.bOrig"], ["OriginatorReference", "32", "help.bRef"],
      ["OriginationDate", "10", "help.bDate"], ["OriginationTime", "8", "help.bTime"]]);
    p("help.pBwf2");
    h("help.hId3"); p("help.pId3"); list(["help.i1", "help.i2", "help.i3", "help.i4"]);
    h("help.hSafe"); list(["help.s1", "help.s2", "help.s3", "help.s4", "help.s5"]);
    h("help.hLimits"); list(["help.l1", "help.l2", "help.l3", "help.l4", "help.l5", "help.l6"]);
    h("help.hVal"); p("help.vIntro");
    table(["help.vTh1", "help.vTh2", "help.vTh3"], [["help.v1a", "help.v1b", "help.v1c"], ["help.v2a", "help.v2b", "help.v2c"], ["help.v3a", "help.v3b", "help.v3c"], ["help.v4a", "help.v4b", "help.v4c"]]);
    p("help.vNot");
    h("help.hInst"); p("help.pInst");
    h("help.hPriv"); p("help.pPriv");
  }
  $("helpBtn").addEventListener("click", function () { openDlg("helpDlg"); });
  $("helpClose").addEventListener("click", function () { closeDlg("helpDlg"); });
  document.querySelectorAll("a[data-ext]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); if (/^https:/.test(a.href)) api.openExternal(a.href); }); });

  // ---- Start -------------------------------------------------------------------------------
  if (state.tab !== "mp3" && state.tab !== "wav") state.tab = "mp3";
  applyI18n();
  api.info().then(function (i) { $("ver").textContent = "v" + i.version; });
  refreshRestore();
  if ($("updAuto").checked) checkUpdates(true).catch(function () { /* offline: ignore */ });
})();
