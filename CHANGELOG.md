# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-20

### Added

- GitHub Action: `uses: feresbr1/scriptvet@v1` fails pull requests that add dependencies with
  unreviewed install scripts and writes the report to the job summary.

## [1.0.0] - 2026-10-19

### Added

- Finds dependencies with `preinstall` / `install` / `postinstall` scripts (and implicit `node-gyp rebuild`) in npm, pnpm, Yarn and Bun lockfiles.
- Reads the script commands and the files they run for the exact version, and classifies them: native build, binary download, binary check, message only, git hooks, code generation, or review.
- Detects network calls, child processes, file writes, environment access, shell downloads and obfuscation, with line-level evidence.
- Verified notes for widely used packages (esbuild, @swc/core, unrs-resolver, core-js, es5-ext, nx, ssh2, @sentry/cli, puppeteer, cypress, chromedriver, fsevents).
- Generates and writes `allowScripts` (npm), `allowBuilds` (pnpm), `dependenciesMeta` + `enableScripts` (Yarn) and `trustedDependencies` (Bun), pinned by default.
- `--check` for CI, JSON and Markdown output.
- Website with per-package Allow/Deny toggles and live config.

[1.0.1]: https://github.com/feresbr1/scriptvet/releases/tag/v1.0.1
[1.0.0]: https://github.com/feresbr1/scriptvet/releases/tag/v1.0.0
