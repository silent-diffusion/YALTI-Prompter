# Changelog

All notable changes to YALTI Prompter are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [1.1.1] — 2026-10-04

### Added

- A **Loading speech model** indicator with a progress ring beside the microphone indicator while
  the speech model loads.

### Changed

- On light island colors (such as the *Paper* theme) the controls, labels, status dots, help and
  indicators switch to dark, high-contrast colors.

### Fixed

- Voice tracking heard nothing when started again more than three minutes after it was last
  stopped: the speech engine had been unloaded, but the prompter kept talking to the old one.

## [1.1.0] — 2026-10-04

**Updating from 1.0.0:** version 1.0.0 can’t update itself, so install 1.1.0 once with the Setup
file (it updates the installed copy and keeps your settings). From then on, YALTI updates from
inside the app.

### Added

- **Updates from GitHub.** *Settings → Updates* (and *Check for updates…* in the tray) checks for a
  new release, shows what's new, downloads it, verifies it against the release's published
  checksums and installs it: a silent installer update with restart, a new portable `.exe` next to
  the old one, or the zip in Downloads. *Update automatically* (off by default) checks at launch
  and daily and installs on quit, never in the middle of a talk.
- **Installer recognizes an existing installation** and offers to update (or reinstall) it, to open
  YALTI and check for updates instead, or to uninstall.
- **Drag and drop text.** Drop text highlighted in any app — or a file — on the island, in
  Settings (new drop zone in *Script*) or on the editor. Files without a path on disk (from a
  browser or mail) work too and keep their format.
- **Microphone indicator.** A small round live waveform in the corner of the island while YALTI
  listens; green while following, amber while waiting for the script. Click it to stop listening.
- **Jump back.** When voice tracking moves your place a long way, a *Back to “…”* button offers to
  return (also `Backspace`, or `Ctrl+Alt+Backspace` from anywhere), then to return again. It only
  appears for real jumps, not for the next line.
- **Resize from either bottom corner**, with a grip that lights up along the corner and the size
  shown while dragging.

### Fixed

- The resize handle could not be grabbed once the controls appeared on hover.
- The tray's *Auto-scroll* item could not switch back to voice tracking.
- Reading-time estimates are phrased the same everywhere (Settings rounded short scripts up to
  “about 1 min”).
- Global shortcuts using Backspace or Delete could not be recorded.
- An in-app script pasted or dropped elsewhere replaced only the editor's title, not its text.

## [1.0.0] — 2026-10-04

First public release.

### Added

- Top-center teleprompter “island” that flows out of the screen's top edge, with liquid,
  spring-driven expand, collapse, hover, notification and retract transitions, and *Liquid*,
  *Flush* and *Floating* top-edge styles with adjustable intensity.
- Offline voice tracking with a bundled English streaming speech model (sherpa-onnx Zipformer).
  Handles pauses, skipped sentences, repeats, misread words, paraphrasing, going off-script and
  resuming anywhere in the script, with *Cautious*, *Balanced* and *Responsive* sensitivity.
- Auto-scroll with adjustable speed and optional countdown; manual scrolling by wheel, keys and drag.
- Scripts from `.txt`, `.md` (rendered without Markdown syntax), `.srt`, `.vtt` and other plain-text
  files, the clipboard, drag and drop, or the built-in live editor. Automatic reload on file
  changes, recent scripts and remembered reading positions. `[Bracketed]` stage directions.
- Customizable fonts (nine bundled open-source typefaces), size, weight, spacing, alignment, colors
  and themes, highlight color, background opacity, reading-line position, island size, position,
  display, always-on-top, shadow, mirror mode and progress line.
- System tray menu, configurable global shortcuts, start with Windows, and click-through around the island.
- Windows installer (per-user, with uninstaller), portable `.exe` and portable `.zip`.
- Documentation, third-party license notices and automated unit, speech and app tests.

[1.1.1]: https://github.com/silent-diffusion/YALTI-Prompter/releases/tag/v1.1.1
[1.1.0]: https://github.com/silent-diffusion/YALTI-Prompter/releases/tag/v1.1.0
[1.0.0]: https://github.com/silent-diffusion/YALTI-Prompter/releases/tag/v1.0.0
