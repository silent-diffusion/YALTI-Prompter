# Security and privacy

## Reporting a vulnerability

Please report security issues **privately** using GitHub's
[private vulnerability reporting](https://github.com/silent-diffusion/YALTI-Prompter/security/advisories/new)
rather than a public issue. Include the YALTI version, Windows version and steps to reproduce.
We aim to acknowledge reports within a week and will credit you in the release notes if you wish.

Only the latest release receives security fixes.

## Privacy design

- Speech recognition runs locally in a separate process. Audio is held in memory only for
  recognition and is never stored or transmitted.
- Scripts are read from disk and never uploaded.
- The app makes no network requests during normal use: no telemetry, analytics, crash reporting,
  update checks or accounts.
- Settings, recent file paths and reading positions are stored in plain JSON in the user's
  application-data folder (or next to the portable app).

## Hardening

- All windows use context isolation and the Chromium sandbox, with no Node.js access in pages.
- Pages are served from a private `app://` scheme limited to the app's own files, with a strict
  Content Security Policy.
- The main process accepts IPC only from the app's own pages and validates every argument.
- Navigation, new windows and `<webview>` are blocked.
- Microphone permission is granted only to the app's own origin; all other permission requests are denied.
- Markdown is converted to plain styled text; HTML in scripts is never rendered.
