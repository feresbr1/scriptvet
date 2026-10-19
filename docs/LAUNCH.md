# Launch kit

Nothing here has been posted. Each channel needs the maintainer's own account, and its self-promotion rules apply.

**Assets:** https://feresbr1.github.io/scriptvet/ · `docs/images/report.png` · `docs/images/cli.png` · `public/og.png`

## One-liners

- npm 12 stopped running your dependencies' install scripts. scriptvet tells you which ones you actually need, and writes the allowlist.
- Drop a lockfile and see what every `postinstall` does (native build, binary download, funding banner, git hooks), with the code, a recommendation, and `allowScripts` / `allowBuilds` / `trustedDependencies` ready to paste.

## Show HN

**Title:** `Show HN: Scriptvet – which of your deps' install scripts does npm 12 need to run?`

> npm 12 (and pnpm 11, and Bun) no longer run dependency install scripts unless you allowlist them. The official advice is to approve everything you have now and tighten later, because nothing tells you what each script does.
>
> scriptvet reads your lockfile, finds every package with preinstall/install/postinstall (plus npm's implicit node-gyp rebuild for binding.gyp), fetches the script files for that exact version from jsDelivr, and classifies them. Native builds (bcrypt, sqlite3) need allowing. Binary checks (esbuild, @swc/core) are redundant when optional deps install. Funding banners (core-js) and git hooks (husky 4) can go. Anything with eval, base64 blobs or curl|sh is marked for review with the offending lines.
>
> Then it writes the config for your package manager, pinned to the versions you reviewed: allowScripts, allowBuilds, dependenciesMeta or trustedDependencies. I checked the output against npm 12.2's --strict-allow-scripts and pnpm 11, including that esbuild still works with its postinstall denied.
>
> Browser version (lockfile stays local): https://feresbr1.github.io/scriptvet/ · CLI: `npx github:feresbr1/scriptvet --write`

## Reddit

| Subreddit    | Angle                                                              | Notes                                                        |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| r/node       | "npm 12 blocks install scripts — here's what each common one does" | Lead with the esbuild/core-js/bcrypt findings, then the tool |
| r/javascript | Same, shorter                                                      | Project posts allowed; avoid repeat posting                  |
| r/pnpm       | `allowBuilds` generation for pnpm 11                               | Small, but on target                                         |
| r/webdev     | Showoff Saturday only                                              |                                                              |

## Places where people hit the problem

- npm/cli and pnpm/pnpm issues about skipped scripts (`ERR_PNPM_IGNORED_BUILDS`, "install scripts not covered"): answer with how to decide, linking the tool where it helps.
- The GitHub Community discussion "Preparing for npm v12" (198547).
- Framework READMEs that tell users to `npm approve-scripts` (Electron, Prisma, Playwright docs).

## Write-up ideas

1. _"What 14 popular install scripts actually do (and which you can deny under npm 12)"_: the demo-app findings.
2. _"allowScripts vs allowBuilds vs trustedDependencies: the same allowlist in four package managers"_.

## Keywords

`npm 12 install scripts` · `npm allowScripts` · `npm approve-scripts` · `npm install-scripts approve` · `pnpm allowBuilds` · `ERR_PNPM_IGNORED_BUILDS` · `bun trustedDependencies` · `yarn dependenciesMeta built` · `which postinstall scripts are safe` · `esbuild postinstall` · `core-js postinstall` · `--strict-allow-scripts`
