# Tag Fixer manual

Tag Fixer reads and corrects the metadata of audio files in batch: **ID3 tags and cover pictures on MP3** (ID3v2.2, v2.3 and v2.4), **BWF `bext` with its CodingHistory, iXML and cart (AES46) on WAV and BWF, also RF64/BW64**, and **Vorbis comments on FLAC**. You work in a spreadsheet-style table, every file is backed up before it is touched, and the last batch can be restored in one step. It is a free desktop app for Windows, macOS and Linux from OnAir Garage.

## Install and first launch

Download the installer for your system from the [Releases](https://github.com/djgragra/tag-fixer/releases) page and check it against `SHA256SUMS.txt`:
`Tag-Fixer-Setup-<V>.exe` (Windows), `Tag-Fixer-<V>-arm64.dmg` (Mac with Apple silicon), `Tag-Fixer-<V>-x64.dmg` (Mac with Intel), `Tag-Fixer-<V>.AppImage` (Linux).
The app is free and has no Apple or Microsoft certificate, so the first launch may show a warning.

- **Windows**: run the installer. If SmartScreen says "Windows protected your PC", click *More info* → *Run anyway*.
- **macOS**: open the disk image and drag the app to Applications. The app is signed ad hoc, which is what an Apple silicon Mac needs to open it. The first start still shows the "unidentified developer" notice: open *System Settings → Privacy & Security*, scroll down and click *Open Anyway* (right-click → Open no longer exists on macOS 15 and later). If an earlier version (26.10.3 or older) says the app is "damaged", run this once in Terminal: `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`
- **Linux**: make the AppImage executable (`chmod +x Tag-Fixer-*.AppImage`) and run it.

The app always opens in English; choose Italiano or Español from the language menu and the choice is remembered. The theme can be light, dark or follow the system.

## The window

Drop audio files or folders on the window, or use *Add files…* and *Add folder…* (*Include subfolders* goes deeper). The files go to their own tab:

| Tab | Files | What you edit |
|---|---|---|
| MP3 · ID3 | MP3 | Title, Artist, Album, Year, Track, Genre, Comment and the Cover |
| WAV · BWF | WAV and BWF, also RF64/BW64 | Three views: **BWF** (Description, Originator, Originator ref., Date, Time and Coding history), **iXML** (Project, Scene, Tape, Take, Note) and **Cart** (Title, Artist, Cut ID, Client ID, Category, Classification, Out cue, start and end date and time, User defined) |
| FLAC | FLAC | Title, Artist, Album, Date, Track, Genre and Comment (Vorbis comments) |

Each row shows a checkbox, the file, its status and the file info, then the fields. A pill at the top says how many files are in the list, how many are to be saved and how many have errors.

## Editing

1. **Click a cell and type.** Edited cells are highlighted, and invalid ones (for example a date that does not exist) turn red. Enter or the arrow keys move between rows; Esc puts the cell back as it was.
2. **The same value in many files**: type it in the highlighted row under the headings (*Set for all checked rows*) and press ⇣: it is written into every checked row of this tab.
3. **Uncheck** the files you do not want to change. Red rows block the save until you fix them or uncheck them.
4. **Undo and redo** every edit and every tool with Ctrl+Z and Ctrl+Y (⌘Z on a Mac), or with the *Undo* and *Redo* buttons. *Discard edits* throws away everything that has not been saved.
5. A file that is damaged or cut, or has a tag that cannot be read safely, is shown **read only** with the reason, and is never written.

## The tools above the table

Every tool changes the table only: nothing is written to the files until you save.

- **Patterns…**: *Fill a field from a pattern* (for example `{artist} - {title}` or `{n:3}`, with filters such as `{filename|lower}`; the counter starts where you say), *Read fields from the file name*, or *Rename files from the tags*. Saved patterns (*Saved patterns…*) are kept in the settings and travel with the configuration backup. The dialog shows what each file would get before you apply it.
- **Find & replace…**: on one field or on all the fields of the view. Find and replace text (plain text or *Regular expression*, *Whole word*, *Match case*), or clean up: remove spaces at the ends, collapse repeated spaces, UPPERCASE, lowercase, Title Case, Sentence case, remove accents, convert to ASCII. The dialog says how many cells would change.
- **Date & time from file…**: fills the BWF origination date and time, or the cart start or end, from the file name (for example `2026-10-13_0830…`, otherwise the modification time), from the modification time or from the creation time. *Also set the time* is optional.
- **Coding history…** (WAV): edit it in one file, or replace it or add a line at the end of all the checked files.
- **Cover…** (MP3): choose a JPEG or PNG image (up to 16 MB) and use it for this file or for all the checked files, or remove the picture. The image becomes the front cover and the other pictures in the tag are kept; *Remove* deletes every picture of the tag.
- **Check files…**: lists what looks wrong, by level (Errors, Warnings, Notes): missing fields, invalid values, dates in the future, duplicates and damaged files. Click a line to go to the file; *Show only these files* filters the table.
- **Export CSV…** / **Import CSV…**: export the table (the checked files or all the files of the tab) and import it back, with the separator you choose. Rows are matched by the full path or by a unique file name; an empty cell leaves the field alone unless you tick *An empty cell clears the field*.
- **Convert to ASCII**: text in the `bext` and cart fields should be ASCII (the specification says so). Non-ASCII text is flagged, and this button turns `è` into `e` and shows the result before saving.

## Saving, backups and restore

1. Press **Save…**. The window lists the changes, the **backup folder** and the free space needed; confirm to go on.
2. Every original is copied, with its modification time, to the backup folder before any change. A change that keeps the file size is patched in place; the others go through a temporary file that replaces the original only when it is complete and verified. Every file is read back and compared; if anything is wrong, the original is put back. Batches that only rename files need no backup copy.
3. When it is done the window says how many files were saved and where the originals are.
4. **Restore last batch** puts the original tags and names back from the backup (files edited again since are left as they are).

Changing the history, any iXML text, or adding a chunk **rewrites the file**: it takes time and, for the backup, as much free disk space as the file. The app checks the free space before saving. Keep the backup folder outside your playout or music folders: a backup inside a watched library could be loaded as a duplicate.

## Settings

Settings are in tabs, in the same order as in every OnAir Garage app:

| Tab | Content |
|---|---|
| General | Language, theme, the **folder for the backups** of edited files (*Change…*, *Open folder*) and how many days to keep the log files |
| Updates | The guided update (see below) |
| Backup | Export and import of settings and saved patterns (`tag-fixer-backup-YYYY-MM-DD.json`); the app keeps no passwords or tokens, so the file has none |
| Help & About | Version, licence, credits, links, *Copy info for support* (version, system, language, last update check and last error: never file names or settings), *Open logs folder* and the tip card with the jar |

The tip card has a jar and a button: both open the support page of the website in the language of the app; nothing is asked inside the app. Everything happens on your computer: the app contacts GitHub only to check for updates, when that is switched on, and to download an update you ask for.

## Updates

Tag Fixer looks for a new version 15 seconds after it starts and then every 24 hours (you can switch it off in *Settings → Updates*). A banner offers *Download and install* (with a progress bar and *Cancel*), *Remind me later* (24 hours) and *Skip this version*. The file is checked against the SHA-256 in the release (`SHA256SUMS.txt`); one that does not match is deleted. *Close and install* saves a safety copy of the settings first. After the update a *What's new* window appears once. Nothing is downloaded or installed without a click.

## Limits and safety

- Damaged or cut WAV files, an RF64 header or `ds64` chunk that is not valid, unsynchronised or compressed ID3 tags, tags with unreadable data and damaged FLAC metadata are shown read only and never written.
- A text frame, a comment or a Vorbis field with several values is shown joined by ` / ` and replaced by one value if edited. Other comments and custom frames are kept as they are.
- iXML: if the text is not UTF-8, is not valid XML, or the element you edit contains nested elements, that field is read only. cart: the chunk must have its 2048-byte fixed part, otherwise it is read only.
- Not supported: OGG, M4A, AIFF and other formats. Not touched: the audio, ID3v1, RIFF `LIST`/INFO, `axml`, other chunks and the pictures of FLAC.
- The modification time of a saved file is the time of the save; restoring puts the original time back.
- This is not a certified tool: always read the list of changes before saving.

## Troubleshooting

| Problem | What to do |
|---|---|
| macOS: "the app is damaged / cannot be opened" | Open *System Settings → Privacy & Security → Open Anyway*; for a version before 26.10.4, run in Terminal `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`. |
| Windows: "Windows protected your PC" | *More info* → *Run anyway*. |
| Linux: the AppImage does not start | Make it executable (`chmod +x`) and install FUSE (`libfuse2`) if your system needs it. |
| A cell is read only | Look at the file's status: the file is damaged or has a part the app cannot write safely. |
| Not enough space to save | Free disk space or change the backup folder in *Settings → General*. |
| A change went wrong | *Restore last batch* puts the original files back from the backup folder. |
| The update download failed with "checksum mismatch" | The file was deleted automatically. Try again, or download the installer by hand from the releases page. |

## Contacts

Graziano Melzi · OnAir Garage — `https://onairgarage.com` — `hello@onairgarage.com`. Tool page: `https://onairgarage.com/tools/tag-fixer/`. Source code and releases: `https://github.com/djgragra/tag-fixer`. Licence: MIT © 2026 Graziano Melzi.
