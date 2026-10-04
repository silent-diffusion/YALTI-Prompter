# Contributing to YALTI Prompter

Thank you for helping make YALTI better! Bug reports, ideas, documentation fixes and code are all
welcome. By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

Open an [issue](https://github.com/silent-diffusion/YALTI-Prompter/issues) and include your Windows
version, the YALTI version (*Settings → About*), what you expected and what happened. For voice
tracking problems, describe what you were reading and how you spoke (pauses, skips, ad-libs) —
please don't attach recordings of private material.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

See [docs/BUILDING.md](docs/BUILDING.md). In short:

```bash
npm ci
npm run fetch-model
npm start
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the app is put together.

## Guidelines

- **Keep it light.** No UI frameworks or bundlers; plain HTML, CSS and JavaScript modules.
  Think twice before adding a dependency — every runtime dependency must be open source under a
  permissive license (`npm run check-licenses` enforces an allowlist).
- **Keep it private.** No network requests, analytics or cloud services in the running app. The
  only exception is the opt-in updater in `src/main/updater.js`; keep it that way.
- **Keep logic testable.** Pure logic belongs in `src/core/` with unit tests in `test/unit/`.
  Changes to the tracker need a scenario test, and should not regress the stress behavior described
  in ARCHITECTURE.md.
- **Keep it accessible and calm.** New UI should work with the keyboard, respect
  `prefers-reduced-motion`, and match the existing quiet visual language.
- **Style.** Two-space indentation, semicolons, single quotes, small focused functions, and
  comments that explain *why*. Match the surrounding code.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests and documentation updates where relevant.
3. Run `npm run test:all` (or at least `npm test`) and `npm run check-licenses` if you touched dependencies.
4. Describe what changed and how you tested it, with a screenshot or short clip for visual changes.

Contributions are accepted under the project's [MIT License](LICENSE). Assets you add (fonts,
icons, images, models) must have a compatible open license, and must be listed in
`THIRD_PARTY_NOTICES.md` with their license text in `licenses/`.
