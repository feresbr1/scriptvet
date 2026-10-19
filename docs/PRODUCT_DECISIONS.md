# Product decisions

Written on 2026-10-19, when scriptvet was started (the third product from this lab, after [lockspect](https://github.com/feresbr1/lockspect) and [vsxguard](https://github.com/feresbr1/vsxguard)).

## How the idea was chosen

| #   | Idea                                                         | Evidence                                                                  | Why not                                                                      |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Migrate pnpm settings out of `.npmrc` (pnpm 11 ignores them) | npm/cli "Revert policy on unrecognized keys" issue; pnpm 11 release notes | pnpm ships an official codemod (`pnpx codemod run pnpm-v10-to-v11`)          |
| 2   | Copilot AI-credit bill analyser                              | Billing FAQ thread with 586 comments; "AI credits unfair" (267 👍)        | copilot-arewecooked (137★), several CSV dashboards and tray apps             |
| 3   | Star history after GitHub restricted `/stargazers`           | community discussion (172 👍)                                             | GitHub shipped a privacy-safe history endpoint; star-history.com is restored |
| 4   | Restore VS Code's pre-2026 UI                                | microsoft/vscode#326146 (328 👍), #325240 (194 👍), #326328 (141 👍)      | Extensions cannot restyle the workbench without patching VS Code             |
| 5   | Remove AI co-authors from history                            | Two GitHub Community threads                                              | Contested; many projects require AI disclosure                               |
| 6   | **Explain and allowlist dependency install scripts**         | See below                                                                 | **Chosen**                                                                   |

### Evidence

- **Every major package manager now blocks dependency install scripts by default.** npm 12 does (the GitHub changelog and community post "Preparing for npm v12: install scripts and non-registry sources become opt-in", June 2026). So does pnpm 11 (`strictDepBuilds: true`, `allowBuilds`), and Bun already did (`trustedDependencies`).
- **The official guidance admits the hard part is the decision:** "allow everything currently in your tree first, then tighten later — rather than agonizing over each package". `npm approve-scripts` and `pnpm approve-builds` record decisions but do not explain what a script does.
- **Nothing else does.** installsafe.dev is a written guide. The only checker repo found (`npm-v12-checker`) had 0 stars.
- **The data is free and CORS-enabled:** per-version manifests from registry.npmjs.org and published files from jsDelivr.

## Product definition

- **Target user:** anyone upgrading to npm 12, pnpm 11 or Bun whose install now prints "scripts skipped / not approved", and maintainers reviewing a PR that adds a dependency with a new install script.
- **Pitch:** _Your dependencies' install scripts are blocked now. Which ones do you need?_
- **Workflow:** drop a lockfile (or run `npx github:feresbr1/scriptvet`) → for each script: the command, what it does, the evidence, allow or deny → copy or `--write` the config → `--check` in CI.
- **Verification:** unit tests on real script code (trimmed), CLI tests writing all four config formats, live tests against the registry, Playwright tests on desktop and mobile, and the generated config run through **npm 12.2.0 `--strict-allow-scripts`** and **pnpm 11.28.6**, including the negative case.

## Technical decisions

- **Static analysis only.** Scripts are read, never executed.
- **Exact versions.** sharp, electron, husky and prisma have dropped their install scripts in recent versions, so verdicts come from the version in the lockfile.
- **Pinned by default.** `pkg@version` entries mean a hijacked new version needs a fresh approval. Yarn and Bun only support names.
- **"Review" defaults to allow (pinned).** The build keeps working, the decision is visible, and a future version is not trusted automatically.
- **Curated notes are versioned and only refine the verdict.** If the code shows `eval`, encoded blobs or shell downloads, the verdict stays _review_ whatever the note says.
- **Bounded fetching.** At most 4 files per package, following imports only from small stub files, which took the demo from 16.6 s to 1.1 s.
