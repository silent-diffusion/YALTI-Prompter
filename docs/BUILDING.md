# Building YALTI Prompter from source

## Prerequisites

- Windows 10 or 11, 64-bit
- [Node.js](https://nodejs.org/) 22 or newer (the LTS release is recommended) — includes npm
- [Git](https://git-scm.com/)
- About 2 GB of free disk space (dependencies, the speech model and build output)

No compiler or Visual Studio is needed: the speech engine ships as prebuilt N-API binaries.

## Get the code and dependencies

```bash
git clone https://github.com/silent-diffusion/YALTI-Prompter.git
cd YALTI-Prompter
npm ci
npm run fetch-model
```

`npm run fetch-model` downloads the bundled speech model (about 73 MB) from a pinned revision on
Hugging Face into `resources/models/` and verifies every file's SHA-256 checksum. The model is
not stored in git. For offline builds, copy the files from another machine and run
`npm run fetch-model -- --from <folder>`.

If `npm start` reports that the Electron binary is missing, run `npx install-electron`
(newer npm versions skip install scripts unless they are approved).

## Run

```bash
npm start        # run the app
npm run dev      # run with the developer tools opened for the prompter window
```

The app uses its normal settings folder (`%APPDATA%\YALTI Prompter`) even when run from source.

## Test

```bash
npm test             # unit tests: text normalization, parsing, tracker scenarios, geometry, settings
npm run test:speech  # real speech: Windows voices → recognizer → tracker (needs the model)
npm run test:app     # launches the app and drives it end to end, writing screenshots to test-output/
npm run test:all     # all of the above
```

- **Unit tests** include a simulated noisy recognizer that exercises reading straight through,
  skipping, repeating, paraphrasing, going off-script and resuming elsewhere.
- **Speech tests** synthesize audio with the built-in Windows (SAPI) voices at test time, run the
  bundled recognizer on it and check that the tracker follows asides, jumps and returns.
- **App smoke test** runs the real windows in a separate profile. Add
  `-- --fake-mic path\to\speech.wav` to also push a WAV file through Chromium's microphone pipeline
  into the speech engine, or `-- --exe "dist\win-unpacked\YALTI Prompter.exe"` to test a packaged build.
- **Click-through check** (`test/app/click-through.ps1`): with the app paused in smoke mode
  (`YALTI_SMOKE_PAUSE_MS=9000`), it moves the mouse with real input events and asks Windows which
  window is under the pointer — the transparent margins must belong to the app beneath, the island
  to YALTI. The cursor is restored afterwards.
- **README images:** after a smoke run with `--fake-mic`, `npm run screenshots` composes the
  captures into `docs/images/`.

## Package

```bash
npm run pack     # unpacked app in dist/win-unpacked (quick check)
npm run dist     # installer, portable .exe and .zip in dist/
```

| Output | Description |
| --- | --- |
| `dist/YALTI-Prompter-Setup-<version>.exe` | NSIS installer (per-user, no admin needed, with uninstaller) |
| `dist/YALTI-Prompter-Portable-<version>.exe` | Single-file portable app |
| `dist/YALTI-Prompter-<version>-win-x64.zip` | Portable folder |

Before packaging, `npm run check-licenses` verifies that all runtime dependencies use approved
open-source licenses and refreshes `THIRD_PARTY_NOTICES.md` and `licenses/npm/`.

Builds are unsigned unless you provide a code-signing certificate through electron-builder's
standard `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables.

## Project layout

```
src/
  core/        Pure logic shared by the app and tests (no Electron):
               text normalization, numbers, document model, speech tracker,
               island geometry, springs, settings schema
  main/        Electron main process: windows, tray, shortcuts, settings store,
               script loading and parsing, speech host, app:// protocol
  preload/     Minimal, sandboxed bridges between pages and the main process
  renderer/    The prompter, settings and editor pages (HTML/CSS/JS modules)
  speech/      Speech engine wrapper and the utility-process worker
assets/        App icons and the welcome script
resources/     Speech models (downloaded, not in git)
licenses/      License texts shipped with the app
scripts/       Model download, icons, license check, smoke-test runner
test/          Unit, speech and fixture files
docs/          Documentation
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Regenerating assets

- **Icons:** edit `assets/icons/icon.svg`, then `npm run icons` renders `icon.png`, `icon.ico`,
  `tray.ico` and `build/icon.*`.
- **UI icons:** add a [Lucide](https://lucide.dev/icons/) name to `scripts/sync-icons.mjs` and run
  `npm run sync-icons`.
- **Fonts:** add a `@fontsource-variable/<name>` dependency (it must be OFL or similarly licensed),
  import its CSS in `src/renderer/shared/fonts.css` and add it to `FONTS` in
  `src/core/settings-schema.js`.

## Adding another speech model

Any [sherpa-onnx streaming transducer model](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html)
works. Put its files in a folder under `resources/models/` (bundled) or in the user models folder
(*Settings → Voice → Models folder*, i.e. `%APPDATA%\YALTI Prompter\models`) and add a `model.json`:

```json
{
  "id": "my-model",
  "name": "My language — streaming",
  "language": "xx",
  "license": "Apache-2.0",
  "files": {
    "encoder": "encoder.int8.onnx",
    "decoder": "decoder.int8.onnx",
    "joiner": "joiner.int8.onnx",
    "tokens": "tokens.txt"
  }
}
```

The model then appears in *Settings → Voice → Speech model*. Text normalization is tuned for
English (numbers are spelled out in English), but word matching works for any language written
with spaces between words. Check the model's license before distributing it.

## Troubleshooting

- **`EBUSY` when packaging:** close any running copy of the app and any terminal whose current
  folder is inside `dist/`.
- **Voice tracking says no model is installed:** run `npm run fetch-model`.
- **The speech test is skipped:** it needs Windows and the downloaded model.
