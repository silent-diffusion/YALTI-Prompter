# Notes for Claude Code sessions

## Release every finished change

The maintainer wants each finished change released, without asking each time. Agent sessions can
push their branch but not tags (GitHub answers 403), so release through the workflows:

1. Bump the version in `package.json` and in the two root entries of `package-lock.json` (patch for
   fixes, minor for features), and turn the changelog's `## [Unreleased]` section into
   `## [x.y.z] — YYYY-MM-DD` with its link at the bottom. The release notes are that section.
2. Open a pull request to `main`, wait for CI, read the **Unit tests** step's log (not just the
   check mark), and merge it.
3. Run the **Release** workflow (`release.yml`) on `main`. It tags the commit `v<version>`, builds
   on Windows and attaches the installer, portable `.exe`, zip and `SHA256SUMS.txt` to a draft.
4. Run **Publish release** (`publish-release.yml`) with `version: x.y.z`. It checks the draft's
   files and publishes it as the latest release, the one the in-app updater finds.
5. Check without signing in: `https://api.github.com/repos/silent-diffusion/YALTI-Prompter/releases/latest`
   shows the new tag with those four files.

See docs/RELEASING.md for details.

## Working in a cloud container

- The npm registry may refuse packages, so `node_modules` can be missing: `test/unit/document.test.js`
  and `tracker.test.js` need `marked` and then only run in CI; the other unit tests run with
  `npm test`.
- Electron can't run there. Renderer pages can be checked in the preinstalled Playwright Chromium
  by serving the repository statically and stubbing the preload bridge (`window.yalti`).
