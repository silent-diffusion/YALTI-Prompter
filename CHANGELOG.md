# Changelog

All notable changes to YALTI Prompter are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

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

[1.0.0]: https://github.com/silent-diffusion/YALTI-Prompter/releases/tag/v1.0.0
