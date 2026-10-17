# Changelog

## 26.10.3 — 2026-10-17

- **Guided update, safer download**: the shared `updater` module is now fully version 2. An installer download that fails, is cancelled, stalls or fails its checksum no longer leaves a `.part` file in the Downloads folder (the file is closed before it is deleted, which Windows requires), and `.part` files left by an earlier run are removed when the app starts and before a new download.
- **Dependencies**: Electron 44.9.0 (from 44.5.1) and the npm packages updated within their current major versions.
- **Tip jar**: Help & About has a small box with the tip jar and one button that opens the tip page of onairgarage.com in your browser, in the language of the app. Nothing else changes: no pop-ups, no reminders.

## 26.10.2 — 2026-10-13

- **New formats**: FLAC (title, artist, album, date, track, genre and comment as Vorbis comments, the audio never moved or changed), **RF64 / BW64** WAV files over 4 GB, and **ID3v2.2** tags, which can now be edited like v2.3 and v2.4 (they were read-only).
- **New fields**: the **CodingHistory** of the BWF `bext` chunk; the **iXML** project, scene, tape, take and note; the **cart** (AES46) title, artist, cut ID, client ID, category, classification, out cue, start and end date and time, user defined. A WAV without these chunks gets a new one when you edit it.
- **Cover pictures** (MP3): see, replace from a JPEG or PNG file in one or many files, or remove.
- **Patterns**: fill a field from a pattern such as `{artist} - {title}` or `{n:3}`, read fields out of the file name, or **rename the files** from their tags (checked before saving; "Restore last batch" gives the names back). Patterns can be saved.
- **Find & replace** (plain text or regular expression) and clean-ups (trim, spaces, UPPER / lower / Title / Sentence case, accents, ASCII); **date & time from the file** (from the name or the modification / creation time) into the BWF origination fields or the cart start / end; **CSV export and import**; **Check files** (missing fields, invalid values, dates in the future, duplicates, damaged files) with a filter to see only those files; **Undo / Redo** (Ctrl+Z, Ctrl+Y) for everything. A genre list in the genre box.
- **New logo and look**: a tag with a waveform and a check mark in the OnAir Garage orange, drawn as SVG (`assets/logo.svg`; the app icons are generated from it with `dev/make-icons.mjs`); header with a status pill, tools bar, cards and rounded corners, a welcome screen with the logo, status pills in the table, transitions that stop when the system asks for less motion. Language and theme moved into Settings.
- **Guided update, the same in every OnAir Garage app**: a banner offers *Download and install*, *Remind me later* (24 hours) and *Skip this version*; progress bar with Cancel; the installer is checked against the published SHA-256 sums. *Close and install* is refused while a save or a restore is running, saves a **safety copy** of the settings first (the last 3 are kept) and, on Windows, closes the app and starts the installer; on macOS it opens the disk image, on Linux it shows the AppImage. After the update a **What's new** window shows once. Nothing is installed without a click.
- **Backup like the other apps**: Settings → Backup exports and imports the settings and the saved patterns (`tag-fixer-backup-YYYY-MM-DD.json`), replacing everything or adding only the patterns you do not have. This app keeps no passwords or tokens, so there is no password box.
- **Signature of the OnAir Garage apps**: Settings in tabs (General, Updates, Backup, Help & About); *Help & About* with credits, links, *Copy info for support* (no file names or settings) and *Open logs folder*; daily logs of at most 5 MB each, 7 days kept (no file names); the choices of the first version (language, theme, last tab) moved from the browser storage to `settings.json` and are carried over at the first start.
- `CLAUDE.md` is now part of the repository and points to the standard the app is built under.
- Screenshots in `docs/screenshots/`; the README says which parts of the iXML, AES46 and EBU Tech 3306 specifications were not read.
- Tests: 102 (new ones for FLAC, RF64, CodingHistory, iXML, cart, ID3v2.2, covers, renaming, patterns, CSV, checks, settings, backup, guided update, logs, translations), plus two end-to-end scripts on the real app (`dev/e2e-electron.mjs`, `dev/e2e-update.mjs` with a fake GitHub). Tried on Linux only; Windows and macOS were not run for this release.

## 26.10.1 — 2026-10-01

- First release: batch viewer and editor for ID3 tags on MP3 and the BWF `bext` chunk on WAV, with backup of every file before it is touched and one-step restore.
