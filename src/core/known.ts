import type { Category, Recommendation } from './types';

export interface KnownScript {
  category: Category;
  recommendation: Recommendation;
  note: string;
  /** The version the note was checked against. */
  verified: string;
}

/**
 * Notes for widely used packages, written after reading their install scripts.
 * They refine the automatic analysis; the script itself is still shown.
 */
export const KNOWN: Record<string, KnownScript> = {
  esbuild: {
    category: 'binary-check',
    recommendation: 'deny',
    note: 'install.js checks the binary from the matching @esbuild/* optional dependency and, if it is missing, downloads it from the npm registry. It also re-links the binary for faster start-up. Deny it if optional dependencies install normally; allow it if you install with --omit=optional.',
    verified: '0.28.2',
  },
  '@swc/core': {
    category: 'binary-check',
    recommendation: 'deny',
    note: 'postinstall.js checks that the native binary from the optional dependencies loads; if not, it installs @swc/wasm as a fallback.',
    verified: '1.16.18',
  },
  'unrs-resolver': {
    category: 'binary-check',
    recommendation: 'deny',
    note: 'Calls napi-postinstall to check the platform binary from the optional dependencies and install it if missing.',
    verified: '1.12.2',
  },
  'core-js': {
    category: 'message',
    recommendation: 'deny',
    note: 'Prints a funding banner. It is already silent in CI and when ADBLOCK or DISABLE_OPENCOLLECTIVE are set.',
    verified: '3.50.0',
  },
  'core-js-pure': {
    category: 'message',
    recommendation: 'deny',
    note: 'Prints the same funding banner as core-js.',
    verified: '3.50.0',
  },
  'es5-ext': {
    category: 'message',
    recommendation: 'deny',
    note: 'Prints a “call for peace” message when the system time zone is in Russia; otherwise it does nothing.',
    verified: '0.10.64',
  },
  nx: {
    category: 'unknown',
    recommendation: 'review',
    note: 'Does nothing unless this is the workspace’s main nx package with an nx.json. Then it checks platform support and, if Nx Cloud is used, verifies or updates the Nx Cloud client. It exits after 30 seconds at most, and failures are ignored.',
    verified: '23.3.0',
  },
  '@sentry/cli': {
    category: 'binary-download',
    recommendation: 'allow',
    note: 'Downloads the sentry-cli binary for your platform. Needed to run sentry-cli (for example to upload source maps).',
    verified: '3.8.0',
  },
  puppeteer: {
    category: 'binary-download',
    recommendation: 'allow',
    note: 'Downloads the browser Puppeteer drives. You can deny it and run `npx puppeteer browsers install chrome` yourself.',
    verified: '25.14.0',
  },
  cypress: {
    category: 'binary-download',
    recommendation: 'allow',
    note: 'Installs the Cypress app binary. You can deny it and run `npx cypress install` yourself.',
    verified: '16.2.0',
  },
  chromedriver: {
    category: 'binary-download',
    recommendation: 'allow',
    note: 'Downloads the ChromeDriver binary matching the package version.',
    verified: '155.0.2',
  },
  ssh2: {
    category: 'native-build',
    recommendation: 'deny',
    note: 'install.js tries to compile an optional crypto binding with node-gyp. If that fails it exits successfully and ssh2 uses its JavaScript implementation, so denying it only costs some speed.',
    verified: '1.17.0',
  },
  fsevents: {
    category: 'native-build',
    recommendation: 'allow',
    note: 'macOS file-watching addon, compiled with node-gyp. It is only installed on macOS.',
    verified: '2.3.3',
  },
};
