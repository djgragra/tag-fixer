# Tag Fixer (BWF/ID3 Tag Fixer)

Read and correct broadcast metadata in batch: **ID3 tags on MP3** and the **BWF `bext` chunk on WAV** (description, originator, originator reference, date, time). Spreadsheet-style table, every file backed up before it is touched, one-step restore. Free desktop app (Electron) from [OnAir Garage](https://onairgarage.com).

- Tool page: https://onairgarage.com/tools/tag-fixer/
- Author: Graziano Melzi · OnAir Garage — hello@onairgarage.com
- License: MIT (see `LICENSE`)
- Systems: Windows (installer), macOS (dmg, Apple silicon and Intel), Linux (AppImage, x64)

## What it does

Drop MP3 / WAV files or folders on the window. MP3 and WAV files go to their own tab with the columns that belong to them. Click a cell and type; edited cells are highlighted, invalid ones turn red. A green row under the headings writes one value into every checked row. "Save…" shows the list of changes, the backup folder and the free space, then edits the files.

- **MP3 (ID3v2.3 / v2.4):** title, artist, album, year, track, genre, comment. Everything else in the tag (pictures, private frames, unknown frames) is copied byte for byte. The tag version is kept (year is `TYER` in v2.3, `TDRC` in v2.4); a file without an ID3v2 tag gets a v2.3 tag; an ID3v1 tag is shown when there is no v2 tag and is never modified.
- **WAV (BWF):** the five editable `bext` fields. `TimeReference`, `UMID`, loudness values, `Version` and `CodingHistory` are shown or kept untouched. A WAV without a `bext` chunk gets a new one (Version 0) right after `fmt `.
- **Safety:** original copied (with its modification time) to the backup folder before any change; changes that keep the file size are patched in place; others go through a temporary file that replaces the original only when complete and verified; every file is read back and compared; on any problem the original is put back. "Restore last batch" restores the files of the last batch (not those edited again since).
- Non-ASCII text in `bext` fields is flagged (the specification is ASCII); "Convert to ASCII" turns `è` into `e` and shows the result before saving.
- Languages: English (default, the app always opens in English), Italiano, Español; the choice is remembered. Theme: light, dark or follow the system.
- Optional update check against the public GitHub releases of this project, with a download verified against `SHA256SUMS.txt`.

## Formulas and sources

No measurements. The rules come from these documents:

| Value / rule | Source | Status |
|---|---|---|
| `bext` layout: Description 256, Originator 32, OriginatorReference 32, OriginationDate 10, OriginationTime 8, TimeReference 8, Version 2, UMID 64, loudness 10, Reserved 180, CodingHistory variable (fixed part 602 bytes) | EBU Tech 3285 v2.0 (May 2011), clause 2.3 | **official** (read) |
| Text fields are ASCII; shorter strings end with a NUL | same, clause 2.3 | **official** (read) |
| Date `yyyy-mm-dd`, time `hh-mm-ss`, any separator allowed (`- _ : space .` recommended); ranges (month 1–12, day by month, hour 0–23, minute/second 0–59) | same | **official** (read) |
| Version 0: 254 reserved bytes after Version; Version 1: UMID; Version 2: loudness | same, clause 1.1 | **official** (read) |
| Unknown chunks must be passed on | same, clause 2.1 | **official** (read) |
| Inserting a new `bext` after the `fmt ` chunk | the specification lists `bext` first but does not demand an order; after `fmt ` is the choice that older readers handle best | **recommended** (my choice) |
| ID3v2.3: header, frame header, `TIT2 TPE1 TALB TYER TRCK TCON COMM`, encodings `$00` ISO-8859-1 / `$01` UTF-16 with BOM, padding of `$00` | id3.org ID3v2.3.0 (3 Feb 1999) | **official**, read as a summary of the public page |
| ID3v2.4: encodings `$02` UTF-16BE / `$03` UTF-8, frame flags, synchsafe sizes, footer `3DI`, `TDRC` | id3.org ID3v2.4.0 structure | **official**, read as a summary of the public page |
| RIFF chunk layout (id, 32-bit little-endian size, data, pad to even) | well-known container format; checked against ffmpeg and exiftool output | **official / widely implemented** (RIFF spec not re-read here) |

## Assumptions and limits

- RF64 / BW64 (files over 4 GB) are refused; damaged or cut WAV files, ID3v2.2 tags, unsynchronised tags and tags with unreadable data are shown read-only.
- The comment column is the `COMM` frame with an empty description (the first one); other comments and custom `TXXX` frames are not shown and are kept as they are. A text frame with several values is shown joined by ` / ` and replaced by one value if edited.
- The genre is stored as typed; no genre list is applied. `OriginatorReference` is free text: the format of EBU R 99 was not read and is not checked.
- If the new ID3 tag does not fit in the space of the old one, the file is rewritten with 1 KiB of padding after the tag.
- Not touched: audio, pictures, ID3v1, RIFF `LIST`/INFO, iXML, cart chunks.
- Backups are full copies of the edited files: for large WAV files the disk space needed equals the size of the files; the app checks the free space before saving.
- The modification time of a saved file is the time of the save (restoring puts the original time back).

## Validation and references

Results as of 2026-10-01 on macOS (Intel). This is not a certified tool.

| Reference | What it validates | Result | How to re-run |
|---|---|---|---|
| `dev/bwf.test.js` (hand-built WAV files, bytes checked) | `bext` read/patch/insert, ASCII and date/time rules, RF64 and damaged files refused, other bytes unchanged | 12 tests pass | `npm test` |
| `dev/id3.test.js` (hand-built tags) | v2.2/2.3/2.4 reading, in-place and rewrite, unknown frames and audio byte-identical, encodings, ID3v1 untouched, read-only cases | 14 tests pass | `npm test` |
| `dev/batch.test.js` | backup, restore (bytes and modification time), files that cannot be edited, free-space check | 7 tests pass | `npm test` |
| exiftool (independent reader) | reads the `bext` and ID3 values we write, no warnings | passes (inside the tests above) | `npm test` (needs `exiftool`) |
| ffprobe / ffmpeg 9.0.1 (independent reader and encoder) | files written by a real encoder are read and edited; the **decoded audio is identical (md5) before and after** the edit; ffprobe sees the new values and the untouched frames | 4 tests pass | `npm test` (needs `ffmpeg` with libmp3lame) |
| `dev/e2e-electron.mjs` (real app, DevTools protocol) | drop files, edit cells, invalid values block saving, Convert to ASCII, set for all, save, backup, restore, nothing left behind | passes | `node dev/e2e-electron.mjs` |

Before choosing the ID3 writer, `node-id3` 0.2.9 was tried and **rejected**: it dropped an unknown frame, rewrote a v2.4 tag as v2.3 and left a `TDRC` frame (v2.4 only) in it, which exiftool reports as invalid.

**Not validated:** Windows and Linux; files written by the many real programs and recorders (only hand-built files and ffmpeg were used); how other software reads the edited files; very large files; case-insensitive-name effects on the backup mirror; installers, auto-update and drag & drop from the file manager on real machines. Try the tool on copies of your own files first.

## Sources to re-check

Last read on 2026-10-01:

| Document | Version read |
|---|---|
| EBU Tech 3285, *Specification of the Broadcast Wave Format (BWF)* — https://tech.ebu.ch/docs/tech/tech3285.pdf (page https://tech.ebu.ch/publications/tech3285 lists v2, 20 May 2011, as the current one) | Version 2.0, May 2011 (full text read) |
| ID3v2.3.0 — https://id3.org/id3v2.3.0 | 3 Feb 1999 (summary of the page) |
| ID3v2.4.0 structure — https://id3.org/id3v2.4.0-structure | summary of the page |

## Run locally

Needs Node.js 18+ (`ffmpeg`, `ffprobe` and `exiftool` are optional, for the cross-checks).

```bash
npm install
npm start                    # run the app
npm test                     # unit and cross-check tests (Node test runner)
node dev/e2e-electron.mjs    # end-to-end check of the real app
npm run dist:mac             # or dist:win / dist:linux — installers in release/
```

Release files go to a GitHub release with a `SHA256SUMS.txt`. The update check expects: `Tag-Fixer-Setup-<version>.exe`, `Tag-Fixer-<version>-arm64.dmg` / `Tag-Fixer-<version>-x64.dmg`, `Tag-Fixer-<version>.AppImage`.

## Structure

- `main.js`, `preload.cjs` — Electron main process and the bridge to the window.
- `src/bwf.js` — BWF/`bext` reader and writer. `src/id3.js` — ID3v2 reader and byte-preserving writer. `src/batch.js` — file scan, backup, apply, verify, restore. `src/updater.js` — update check and verified download.
- `renderer/` — interface (strict CSP, no inline script or style, no external resources).
- `assets/` — icons (`dev/make-icons.py`). `dev/` — tests and tools.

Versions are `YY.M.N` (e.g. `26.10.1`), tags `v26.10.1`. The version lives in `package.json`.

## Credits

No third-party fonts or libraries at run time (system fonts). Build tools: Electron and electron-builder (MIT).
