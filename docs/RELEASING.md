# Releasing

YALTI Prompter uses [semantic versioning](https://semver.org/). Releases are built by GitHub
Actions from version tags and published as **draft** GitHub releases, so a maintainer can review
the notes before publishing.

## Repository

The project lives at [silent-diffusion/YALTI-Prompter](https://github.com/silent-diffusion/YALTI-Prompter).
The release workflow requests `contents: write` for its built-in `GITHUB_TOKEN`, so no extra
secrets are needed, and it publishes to whichever repository it runs in (forks work too).

Never commit `node_modules/`, `dist/`, `test-output/` or the speech model files in
`resources/models/` — `.gitignore` already excludes them. The workflows download and verify the
model with `npm run fetch-model`.

## Making a release

1. Update the version in `package.json` (for example `npm version 1.1.0 --no-git-tag-version`).
2. Add a section to `CHANGELOG.md`.
3. Run the checks locally:
   ```bash
   npm run check-licenses
   npm run test:all
   ```
4. Commit, then tag and push:
   ```bash
   git tag v1.1.0
   git push origin main --tags
   ```
   Or, once the commit is on `main`, open **Actions → Release → Run workflow** on `main`: the
   workflow tags the commit `v<version>` itself before building. (It refuses to run on other
   branches, or when that tag already exists on a different commit.)
5. The **Release** workflow builds the installer, the portable `.exe` and the `.zip` on Windows,
   attaches them and their SHA-256 checksums to a draft release named after the tag. The in-app
   updater relies on those checksums (`SHA256SUMS.txt`) and refuses releases without them.
6. Review the draft on GitHub, paste the changelog section into the notes, and publish it.

## Building a release by hand

```bash
npm ci
npm run fetch-model
npm run check-licenses
npm test
npm run dist
```

Upload the three files from `dist/` (`YALTI-Prompter-Setup-*.exe`, `YALTI-Prompter-Portable-*.exe`,
`YALTI-Prompter-*-win-x64.zip`) to a GitHub release, together with checksums:

```powershell
Get-FileHash dist\*.exe, dist\*.zip -Algorithm SHA256 | Format-Table Hash, Path
```

## Code signing

Builds are currently unsigned, so Windows SmartScreen shows a warning on first launch. To sign,
provide a certificate to electron-builder through the `CSC_LINK` and `CSC_KEY_PASSWORD` secrets in
the release workflow. Open-source projects can apply for free signing through programs such as
[SignPath Foundation](https://signpath.org/).
