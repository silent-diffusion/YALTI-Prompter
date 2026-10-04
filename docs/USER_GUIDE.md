# YALTI Prompter — User guide

YALTI Prompter is a teleprompter that lives at the top of your screen. It shows your script
right under your webcam, follows your voice as you read, and gets out of the way when you don't
need it.

- [The island](#the-island)
- [Scripts](#scripts)
- [Reading with your voice](#reading-with-your-voice)
- [Auto-scroll and manual scrolling](#auto-scroll-and-manual-scrolling)
- [Customizing](#customizing)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [The tray icon](#the-tray-icon)
- [Updates](#updates)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)

## The island

The prompter has three states, and moves between them as one continuous surface:

| State | What you see | How to get there |
| --- | --- | --- |
| **Expanded** | The full teleprompter with your script. | Click the compact island, press `Enter`, or `Ctrl+Alt+Enter` from anywhere. |
| **Compact** | A small pill showing the script title, a status dot and a progress ring. | Press `Esc`, double-click the text, or click the chevron in the controls. |
| **Hidden** | Nothing — the island retracts into the top edge. | Press `H`, `Ctrl+Alt+Y` from anywhere, or click the tray icon. Do the same to bring it back. |

Hover over the expanded island to reveal the controls along its bottom edge. They fade away when
you move the mouse off the island or stop moving it.

- **Move it:** drag the text sideways to slide the island along the top edge. It snaps back to
  the center when you get close.
- **Resize it:** drag either bottom corner. A highlighted arc shows the grip when you hover the rim of the corner, and the new size is shown while you drag. The island stays centered, so it grows on both sides.
- **Click through it:** the transparent space around the island never blocks the apps underneath.

When the island is compact, short notifications (such as “Loaded …”) briefly widen it, just like a
phone's dynamic island.

The status dot in the compact island means:

| Dot | Meaning |
| --- | --- |
| Grey | Idle |
| Green, pulsing with your voice | Listening and following the script |
| Amber | Listening, but what you say doesn't match the script right now — YALTI is waiting |
| Gold | Auto-scrolling |
| Red | Something needs attention (for example, the microphone is blocked) |

## Scripts

### Opening a script

- **Ctrl+O** or the folder button opens a file.
- **Drag and drop** a file onto the island, onto *Settings → Script* (or anywhere in the Settings
  window), or onto the script editor.
- **Drag highlighted text** from Word, a browser, an email or any other app and drop it on the
  island or in Settings — it becomes the script, just like pasting.
- **Ctrl+V** creates a script from the text on your clipboard.
- **Recent scripts** are listed in the tray menu and in *Settings → Script*.
- You can also open a file with YALTI from Explorer (*Open with → YALTI Prompter*).

Supported formats: plain text (`.txt`, `.text`), Markdown (`.md`, `.markdown`), subtitles
(`.srt`, `.vtt` — timestamps are removed) and other plain-text files such as `.fountain`.
Files can be UTF-8, UTF-16 or Windows-1252 encoded.

### How scripts are shown

- Paragraphs and line breaks are kept.
- Markdown is rendered as clean text: headings are larger, lists keep their bullets and numbers,
  **bold** and *italic* are shown as emphasis, and links show just their text. The Markdown
  symbols themselves are never displayed.
- Text in **[square brackets]** — such as `[pause]` or `[smile]` — is shown small and muted as a
  stage direction. It is never expected to be spoken, so it won't confuse voice tracking.

### Editing

Press **Ctrl+E** (or the pencil button) to open the script editor. With *Live update* on, the
prompter updates as you type and keeps your place. Press **Ctrl+S** to save the file.
Pasted scripts and new scripts are kept inside YALTI until you save them with *Save as*.

You can also edit the file in any other editor — YALTI notices when the file is saved and reloads
it automatically, keeping your reading position (*Settings → Script → Reload automatically*).
**Ctrl+R** reloads by hand.

YALTI remembers where you were in each script and returns there the next time you open it.

## Reading with your voice

1. Make sure voice tracking is selected (the waveform button in the controls).
2. Press **Space** or the microphone button. The first time, Windows may ask for microphone access.
3. Start reading. The words you have said on the current line are tinted, the word you just said is
   highlighted, and the next line stays at the reading line.

While YALTI listens, a small round **microphone indicator** in the top-right corner of the island
shows a live waveform of what the microphone hears — green while it follows your script, amber
while it waits for words from the script. Click it to stop listening. (Turn it off in
*Settings → Voice → Microphone indicator*. With reduced motion turned on in Windows it shows a
still microphone whose glow follows your voice.)

YALTI is built for real speaking, not perfect reading:

- **Pauses** — nothing moves while you are quiet.
- **Skipping a sentence or two** — YALTI notices within a few words and catches up.
- **Repeating yourself** — it won't run ahead; if you clearly re-read an earlier sentence it follows you back.
- **Misreading or changing words, paraphrasing** — close-enough matches and sounds-alike words still count.
- **Going off-script** — when what you say stops matching, YALTI holds still. After a few seconds
  a small “Listening for your script…” note appears and the reading marker gently pulses.
- **Coming back somewhere else** — start reading any part of the script and YALTI finds it, usually
  within five to ten words. It prefers nearby text and only jumps far when it is sure.
- **Jumping back** — when YALTI moves your place a long way, a small *Back to “…”* button appears
  at the top of the island for a few seconds, showing the first words of where you were. Click it
  (or press **Backspace**, or `Ctrl+Alt+Backspace` from anywhere) to return; it then offers
  *Return to “…”* in case the jump was right after all. It only appears for real jumps: never for
  the next line, and for a skip of two or three lines only once your old place has scrolled out of
  view. Scrolling by hand dismisses it.

If you scroll by hand while listening, YALTI continues from wherever you scrolled to.

### Tuning (Settings → Voice)

- **Sensitivity** — *Cautious* waits for more words before moving (good for noisy rooms or lots of
  ad-libbing); *Responsive* follows faster (good for clean audio and close reading).
- **Find my place anywhere** — turn off to only follow nearby text and never jump to distant sections.
- **Microphone indicator** — show or hide the live waveform in the corner of the island.
- **Microphone** — choose the input device and use *Test microphone* to check the level.
- **Processor threads** — one is enough for most computers.

The bundled speech model understands English. Additional
[sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html)
streaming transducer models can be placed in the models folder (*Settings → Voice → Models folder*);
see [BUILDING.md](BUILDING.md#adding-another-speech-model).

## Auto-scroll and manual scrolling

Press **M** (or the waveform button) to switch voice tracking off. **Space** then starts and pauses
a steady auto-scroll. Use **[** and **]** (or the − and + buttons) to change the speed, and set an
optional countdown in *Settings → Reading*.

At any time you can scroll by hand: mouse wheel, **↑ / ↓** for a line, **PgUp / PgDn** for a
page, **Home** to go back to the start, or drag the text up and down.

## Customizing

Open **Settings** with **Ctrl+,**, the gear button or the tray menu. Changes apply immediately and
are saved automatically.

- **Text** — font (nine open-source typefaces), size, weight, line spacing, letter spacing and alignment.
- **Colors** — ready-made themes, or your own background, text and highlight colors; background
  opacity; how visible already-read text stays.
- **Display** — width and height, which monitor, horizontal position, whether to attach to the
  screen edge or below a top taskbar, always-on-top, and the top-edge effect:
  - *Liquid*: the island flows out of the bezel with soft curved shoulders and moves like liquid.
  - *Flush*: square shoulders that meet the screen edge.
  - *Floating*: a rounded panel hanging just below the edge.
  - *Intensity* controls how strongly the surface flares and ripples.
  Also: corner roundness, soft shadow, mirrored text (for beam-splitter glass) and the progress line.
- **Reading** — voice or auto-scroll, auto-scroll speed, manual (mouse wheel) scrolling speed, countdown, scroll smoothness, the reading-line
  position (which controls how much upcoming text you see), spoken-word highlighting, dimming of
  read text, and the reading marker.
- **Shortcuts** — change or disable the global shortcuts.
- **General** — start with Windows, how to start (open, compact or in the tray), reset settings.

## Keyboard shortcuts

Press **?** in the prompter to see them all.

| Action | Prompter focused | Anywhere |
| --- | --- | --- |
| Start / pause | `Space` | `Ctrl+Alt+S` |
| Voice tracking on / off | `M` | `Ctrl+Alt+M` |
| Show / hide | `H` | `Ctrl+Alt+Y` |
| Expand / collapse | `Enter` / `Esc` | `Ctrl+Alt+Enter` |
| Line back / forward | `↑` / `↓` | `Ctrl+Alt+PgUp` / `Ctrl+Alt+PgDn` |
| Page back / forward | `PgUp` / `PgDn` | |
| Back to the start / end | `Home` / `End` | `Ctrl+Alt+Home` |
| Jump back after a jump (press again to return) | `Backspace` | `Ctrl+Alt+Backspace` |
| Slower / faster | `[` / `]` | `Ctrl+Alt+-` / `Ctrl+Alt+=` |
| Text size | `Ctrl` `+` / `Ctrl` `−` | |
| Open / paste / edit / reload | `Ctrl+O` / `Ctrl+V` / `Ctrl+E` / `Ctrl+R` | |
| Settings | `Ctrl+,` | |
| Help | `?` | |

If a global shortcut is already used by another app, *Settings → Shortcuts* shows a red dot next
to it — record a different one.

## The tray icon

YALTI keeps running in the notification area so it is always ready. Click the icon to show or
hide the prompter; right-click for the menu (open, recent scripts, paste, edit, start/pause, voice
tracking, always on top, display, settings, check for updates, quit). Closing settings or the
editor never quits the app — use *Quit YALTI Prompter* in the tray menu.

## Updates

Open *Settings → Updates* (or *Check for updates…* in the tray menu) to see whether a new version
of YALTI is out. If one is, you can read what's new and download it:

- **Installed copy** — *Download and install* fetches the new installer. It installs by itself the
  next time you quit YALTI, or choose *Restart and install* to do it right away; YALTI comes back
  on its own a moment later, with your settings and scripts as they were.
- **Portable .exe** — the new version is saved next to the one you are running; *Switch to the new
  version* starts it. Your settings move with it. Delete the old .exe when you like.
- **Portable .zip** — the new zip is saved to your Downloads folder; unzip it in place of the old
  folder.

Every download is checked against the checksums published with the release and is discarded if it
doesn't match.

**Update automatically** (off unless you turn it on) checks when YALTI starts and once a day while
it runs. Installed copies download the update in the background and install it when you quit —
never in the middle of a talk. Portable copies just let you know.

Running a newer *YALTI-Prompter-Setup* over an installed copy also works. The installer notices
that YALTI is already installed and offers to install the new version over it, to open YALTI and
check for updates instead, or to uninstall it.

## Privacy

- Speech recognition runs on your computer with an open-source model. Audio is processed in memory
  and immediately discarded — it is never recorded or saved.
- Scripts are read from your disk and never uploaded.
- There are no accounts, no analytics and no crash reporting, and it works with your network cable
  unplugged. The only network requests YALTI ever makes are update checks and downloads from
  GitHub — when you click *Check for updates*, or if you turn on *Update automatically*. They ask
  for the latest release and send nothing about you or your scripts.
- Settings, recent scripts and reading positions are stored in `%APPDATA%\YALTI Prompter`
  (or in `YALTI Prompter Data` next to the portable app).

## Troubleshooting

**“Microphone access is blocked.”** Open *Windows Settings → Privacy & security → Microphone* and
turn on *Microphone access* and *Let desktop apps access your microphone*. Clicking the message in
YALTI opens that page.

**The prompter doesn't move when I speak.** Check the level in *Settings → Voice → Test microphone*
and choose the right input. Make sure you are reading the loaded script. In noisy places, move
closer to the microphone; try the *Responsive* sensitivity if it feels slow.

**It jumped somewhere unexpected.** Use *Cautious* sensitivity, or turn off *Find my place anywhere*.
Scroll by hand to put it back — YALTI continues from there.

**The island covers something I need.** Drag it sideways, collapse it with `Esc`, hide it with
`Ctrl+Alt+Y`, or attach it *below the taskbar* if your taskbar is at the top.

**A global shortcut doesn't work.** Another app may already own it; pick a different one in
*Settings → Shortcuts*.

**Windows says “Windows protected your PC”.** Release builds are not yet code-signed. Choose
*More info → Run anyway*.
