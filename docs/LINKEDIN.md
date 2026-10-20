# LinkedIn post

Ready to copy and paste. Attach the image listed below (a real screenshot from the project). LinkedIn
tends to show posts with external links to fewer people, so a common approach is to put the links in
the first comment instead of the post. The post works either way.

**Image to attach:** `docs/images/report.png`

**First comment (optional):** Try it: https://feresbr1.github.io/scriptvet/ · Code: https://github.com/feresbr1/scriptvet

---

npm 12, pnpm 11 and Bun no longer run your dependencies' install scripts by default. Which ones do you actually need?

The usual migration advice is "approve everything you have now and tighten later", because nothing tells you what each script does. Some are essential (native builds, binary downloads). Others print a funding banner, re-check a binary that is already there, or install git hooks you never asked for.

So I built scriptvet. It:

1️⃣ finds every dependency in your lockfile with a preinstall, install or postinstall script
2️⃣ reads the code that script runs, for the exact version you have
3️⃣ classifies it (native build, binary download, message only, git hooks, code generation, obfuscated…) and recommends allow, deny or review
4️⃣ writes the allowlist your package manager wants: npm allowScripts, pnpm allowBuilds, Yarn dependenciesMeta or Bun trustedDependencies, pinned to the reviewed versions

npx github:feresbr1/scriptvet --write

Or drop a lockfile in the browser. Open source, MIT.

🔗 https://feresbr1.github.io/scriptvet/
💻 https://github.com/feresbr1/scriptvet

#npm #pnpm #javascript #opensource #supplychainsecurity
