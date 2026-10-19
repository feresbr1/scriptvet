# Contributing to scriptvet

The most useful contribution is a **wrong verdict**: a package scriptvet allows that should be denied, or the reverse. Open an issue with the package name and version, and what its install script really does.

## Adding a note for a package

Notes live in `src/core/known.ts`. Before adding one:

1. Read the package's install script and the files it runs, for a specific version (jsDelivr: `https://cdn.jsdelivr.net/npm/<name>@<version>/<file>`).
2. Write what it does in one or two factual sentences, and set `verified` to that version.
3. If you claim it is safe to deny, check it: install the package with its scripts denied and use it.

## Development

Requires Node.js 22 (the CLI runs on Node 18.17+).

```sh
npm install
npm run dev
npm test
LIVE=1 npm test          # real registry and jsDelivr
npx playwright install chromium
npm run build:web && npm run test:e2e
npm run check
```

## Layout

```
src/core/parsers/   lockfile parsers (npm, pnpm, Yarn, Bun)
src/core/classify.ts  command + source analysis, verdicts
src/core/known.ts   notes for well-known packages
src/core/config.ts  allowlist formats and coverage checks
src/node/           reading and writing project config files
src/cli/            command line
src/web/            website
examples/demo-app/  a real lockfile with 14 install scripts
```

## Rules

- Never execute package code. scriptvet reads scripts; it does not run them.
- Send only package names and versions to third parties.
- Rebuild and commit `dist/cli/scriptvet.mjs` (`npm run build:cli`) when CLI or core code changes.

By contributing you agree that your contributions are licensed under the MIT License and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
