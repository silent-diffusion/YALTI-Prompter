# Architecture

YALTI Prompter is an Electron app written in plain JavaScript modules, with no UI framework and no
bundler. The code is split so that everything interesting — the speech tracker, text handling, the
island geometry — is pure logic in `src/core/` that runs the same in the app and in Node's test
runner.

## Processes

```
┌──────────────────────── Main process (src/main) ────────────────────────┐
│ app lifecycle · tray · global shortcuts · settings & state (JSON)       │
│ script loading/parsing/watching · app:// protocol · window placement    │
└───────┬───────────────────────┬──────────────────────────┬──────────────┘
        │ IPC (preload bridge)  │ IPC                      │ fork + MessagePort
┌───────▼──────────────┐ ┌──────▼─────────────────┐ ┌──────▼───────────────────────┐
│ Prompter window      │ │ Settings / Editor      │ │ Speech utility process        │
│ (transparent, top)   │ │ windows                │ │ (src/speech/worker.cjs)       │
│ island · script view │ │                        │ │ sherpa-onnx streaming ASR     │
│ tracker · mic capture│ │                        │ │ started on demand, unloaded   │
└───────┬──────────────┘ └────────────────────────┘ │ after 3 idle minutes          │
        │       direct MessagePort: 16 kHz audio ──►│                               │
        └────────────────────────── ◄── partial/final text ──────────────────────┘
```

- **Main process** owns windows, the tray, global shortcuts, persistence and file access. Pages
  are served from a private `app://yalti/` scheme that only exposes the renderer code, shared core
  modules, bundled fonts and icons — never arbitrary files.
- **Prompter window** is a frameless, transparent, always-on-top window anchored to the top edge of
  a display. It draws the island, renders the script, runs the tracker and captures the microphone.
- **Speech process** is an Electron *utility process*. It loads the native sherpa-onnx addon and the
  model only when voice tracking is first used. A crash there cannot take down the interface; the
  prompter reconnects automatically.

All pages run with `contextIsolation`, `sandbox` and no Node.js integration. Preload scripts expose
small, fixed APIs, and the main process only accepts IPC from `app://yalti` pages. Navigation and
new windows are blocked, and the microphone permission is granted only to the app's own origin.

## Audio path

1. `getUserMedia` opens the microphone (noise suppression and auto-gain on, echo cancellation off).
2. An `AudioContext` running at 16 kHz resamples the input; an `AudioWorklet`
   (`capture-worklet.js`) cuts it into 100 ms chunks and measures loudness.
3. Chunks go straight to the speech process over a `MessagePort` created by the main process.
   (They are copied, not transferred: Electron's port bridge drops transferred buffers.)
4. The worker feeds sherpa-onnx's streaming Zipformer transducer with greedy search. Endpoint
   rules split speech into segments after 1.2 s of silence. Changed partial results and final
   segments go back to the prompter.

Nothing is written to disk. Stopping voice tracking closes the microphone immediately.

## Speech tracking (`src/core/tracker.js`)

The tracker answers one question on every recognizer update: *where in the script is the speaker
now?* It is designed around a few principles from the product brief:

- Prefer understanding the position in the **whole** script over matching the next expected words.
- Never move blindly on unrelated speech; **wait** when unsure.
- **Recover** when the speaker returns — even somewhere else.

### Normalization

Script and recognized words are reduced to the same form (`src/core/text.js`): lower case,
no accents or punctuation, contractions joined (`don't → dont`), hyphenated words split, and
numbers spelled out the way people say them (`2024 → twenty twenty four`, `40% → forty percent`,
`3rd → third`). Each script word can become several tokens. `[Bracketed cues]` produce no tokens.

Every script token gets a weight: function words (*the, and, of…*) weigh 0.3, content words 1.0,
and words that repeat throughout the script weigh less because they say less about position.

### Alignment

The last 14 recognized tokens are aligned against the script with a weighted local alignment
(Smith–Waterman style dynamic programming):

| Move | Score |
| --- | --- |
| Match (exact, same phonetic key, or close spelling) | + weight × similarity |
| Substitution (misheard word) | −0.45 |
| Spoken word not in the script (ad-lib, recognizer noise) | −0.40 |
| Script word skipped | −(0.15 + 0.25 × weight), growing for longer skips |
| Two spoken words = one script word (“on boarding” → “onboarding”) | + weight |
| One spoken word = two script words (“today” → “to day”) | + 0.9 × weights |

Similarity uses a compact Metaphone-like phonetic key (so *their/there* and *invoice/envoice*
match) and edit distance; the newest word of a partial result may be incomplete and is allowed to
match as a prefix. Similarities are cached per distinct word, so a full pass over a 10 000-word
script takes a few milliseconds. Scripts over 20 000 tokens are searched in windows around the
current position and around rare words that were just heard.

Every alignment ending on a recent spoken word becomes a *candidate* position. Each candidate
carries three kinds of evidence:

- **score** — the whole alignment, including older context (continuity);
- **tail** — evidence since the last big gap (three or more consecutive skips or extra words);
  used for jumps;
- **recent** — an exponentially decaying sum (factor 0.65 per word) plus a bitmask of which of
  the last six words matched; used for small moves.

Separating these matters. An old, strong alignment must not be able to “walk” forward through
unrelated speech by occasionally matching a common word — only *recent* evidence may move the
prompter.

### Decisions

- **Local candidates** (12 tokens behind to 45 ahead of the current position) are ranked by score
  and accepted when the recent evidence clears the sensitivity threshold. Small advances are cheap;
  moving further ahead within the local window needs proportionally more evidence. A run of
  in-order matches of common words (“thank you to everyone who…”) also counts for small advances.
  Moving backwards requires a clear re-read, never jitter.
- **Global candidates** (anywhere else) are ranked by tail evidence and must clear a threshold that
  grows with distance (and more so backwards), beat the local candidate by a margin, be unambiguous
  (no similarly good candidate elsewhere), and be confirmed by consecutive updates — unless the
  evidence is overwhelming.
- **Off-script:** when the latest words match nothing, the position holds and the state becomes
  *searching* (amber dot, pulsing marker, a gentle hint after a few seconds). While searching — or
  once nothing nearby has explained two updates in a row — the distance penalty is relaxed, because
  the old position is no longer a reliable prior. This is what lets YALTI find you when you return
  somewhere else.
- **Manual scrolling** resets the tracker to the new place and clears the heard words, so they
  cannot pull the prompter back.

The *Cautious*, *Balanced* and *Responsive* presets scale these thresholds. *Find my place anywhere*
disables global jumps.

### Verification

`test/unit/tracker.test.js` drives the tracker with a deterministic noisy-recognizer simulation
(substitutions, deletions, insertions) through straight reads, skipped sentences, far jumps,
off-script stretches, returns to earlier sections, repeats, paraphrases, on-topic chatter,
identical phrases elsewhere, pauses and a 15 000-token script. A stress run across 40 seeds and
three noise levels (8 %, 15 % and 25 % word substitution) showed: no drift while off-script, never
more than two words ahead of the speaker, median lag of zero words, and typically 3–9 words to
re-acquire after a jump. `test/speech/pipeline.test.js` repeats the key scenarios with real
recognition of synthesized speech.

## The island (`src/core/island-shape.js`, `src/renderer/prompter/island.js`)

The island is one SVG path redrawn each animation frame from a handful of springs (width, height,
corner radius). The path is attached to the top edge and has concave “shoulders” that flare into
the bezel; corners use smooth, squircle-like curves. While the springs move, the sides and bottom
edge bow slightly in proportion to their velocity, so the surface looks like liquid being pushed
and pulled rather than a rectangle being resized.

All states — hidden, compact, hovered compact, notification, expanded — are just different spring
targets, so every transition is part of the same continuous motion. Growing spreads sideways first
and then drops; shrinking lifts first and then narrows. The frame loop only runs while something
moves, so an idle prompter uses no CPU.

The window itself is fixed in size (the largest island plus room for shoulders and shadow).
Transparent pixels pass clicks through: the page hit-tests the pointer against the current island
shape and toggles `setIgnoreMouseEvents(…, { forward: true })`.

The expanded content has a fixed layout and is revealed by a clip that follows the surface, so
text never reflows during an animation.

## Script view (`src/renderer/prompter/script-view.js`)

Each word is a `<span>`, which lets the tracker highlight exact words. Line positions are measured
once per layout change; scrolling is a GPU `translate3d` on the text column driven by a critically
damped spring (or a constant speed during auto-scroll). Highlight changes touch only the spans whose
state changes.

## Scripts (`src/main/script-parser.js`, `src/core/document.js`)

Files are decoded (UTF-8, UTF-16 with BOM, or Windows-1252) and parsed into blocks of styled runs.
Markdown goes through `marked`'s lexer and is rebuilt as plain runs — raw HTML is never injected
into the page. The document model maps display words to tracking tokens. When a file changes on
disk, the prompter finds the same passage in the new text and keeps your place.

## Settings and state

`src/core/settings-schema.js` defines every setting with its type, range and default. The main
process validates every change against it, persists settings (debounced, atomic writes) and
broadcasts changes to all windows, which apply them live. App state (recent files, per-script
reading positions) is stored separately. Portable builds keep both next to the executable.
