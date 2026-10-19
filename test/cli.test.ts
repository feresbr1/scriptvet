import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/main';
import { fakeFetch, FILES } from './helpers';

const WORLD = {
  'core-js@3.50.0': {
    scripts: { postinstall: `node -e "try{require('./postinstall')}catch(e){}"` },
    files: { 'postinstall.js': FILES.coreJsPostinstall },
  },
  'native-thing@1.0.0': { scripts: { install: 'node-gyp-build' } },
  'left-pad@1.3.0': {},
};

function project(extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'scriptvet-'));
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'app', version: '1.0.0', ...extra }, null, 2)}\n`,
  );
  const packages: Record<string, unknown> = { '': { dependencies: {} } };
  for (const key of Object.keys(WORLD)) {
    const at = key.lastIndexOf('@');
    // Real npm lockfiles mark packages that have install scripts.
    const scripts = (WORLD as Record<string, { scripts?: Record<string, string> }>)[key]?.scripts;
    packages[`node_modules/${key.slice(0, at)}`] = {
      version: key.slice(at + 1),
      ...(scripts ? { hasInstallScript: true } : {}),
    };
  }
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  return dir;
}

let out = '';
let err = '';
beforeEach(() => {
  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += String(c)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => ((err += String(c)), true));
  vi.stubGlobal('fetch', fakeFetch(WORLD));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cli', () => {
  it('prints help and version', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(out).toContain('Usage');
    expect(await main(['--version'])).toBe(0);
  });

  it('reports scripts with recommendations', async () => {
    const dir = project();
    expect(await main([join(dir, 'package-lock.json'), '--no-color'])).toBe(0);
    expect(out).toContain('2 with install scripts');
    expect(out).toMatch(/ALLOW\s+native-thing@1\.0\.0/);
    expect(out).toMatch(/DENY\s+core-js@3\.50\.0/);
    expect(out).not.toContain('left-pad');
  });

  it('--check fails until --write adds the decisions (npm)', async () => {
    const dir = project();
    const lockfile = join(dir, 'package-lock.json');
    expect(await main([lockfile, '--check'])).toBe(1);
    expect(err).toContain('2 packages with install scripts not in your npm config');
    expect(await main([lockfile, '--write'])).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.allowScripts).toEqual({ 'core-js@3.50.0': false, 'native-thing@1.0.0': true });
    expect(pkg.name).toBe('app');
    expect(await main([lockfile, '--check'])).toBe(0);
  });

  it('merges into existing config without dropping entries', async () => {
    const dir = project({ allowScripts: { 'my-own@1.0.0': true } });
    await main([join(dir, 'package-lock.json'), '--write', '--no-pin']);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.allowScripts).toEqual({
      'my-own@1.0.0': true,
      'core-js': false,
      'native-thing': true,
    });
  });

  it('writes pnpm, yarn and bun formats', async () => {
    const dir = project({ trustedDependencies: ['core-js'] });
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), '# keep me\npackages:\n  - "."\n');
    const lockfile = join(dir, 'package-lock.json');

    await main([lockfile, '--write', '--manager', 'pnpm']);
    const ws = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
    expect(ws).toContain('# keep me');
    expect(parse(ws).allowBuilds).toEqual({ 'core-js@3.50.0': false, 'native-thing@1.0.0': true });
    expect(await main([lockfile, '--check', '--manager', 'pnpm'])).toBe(0);

    await main([lockfile, '--write', '--manager', 'yarn']);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependenciesMeta).toEqual({
      'core-js': { built: false },
      'native-thing': { built: true },
    });
    expect(parse(readFileSync(join(dir, '.yarnrc.yml'), 'utf8'))).toEqual({ enableScripts: false });

    await main([lockfile, '--write', '--manager', 'bun']);
    // core-js was trusted before; the deny decision removes it.
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).trustedDependencies).toEqual(
      ['native-thing'],
    );
  });

  it('prints config and JSON', async () => {
    const dir = project();
    await main([join(dir, 'package-lock.json'), '--print-config', '--manager', 'bun']);
    expect(JSON.parse(`{${out}}`)).toEqual({ trustedDependencies: ['native-thing'] });
    out = '';
    await main([join(dir, 'package-lock.json'), '--json']);
    expect(JSON.parse(out).verdicts).toHaveLength(2);
  });

  it('usage errors exit 2', async () => {
    expect(await main(['--manager', 'deno'])).toBe(2);
    expect(await main(['nope.json'])).toBe(2);
    expect(await main(['a', 'b'])).toBe(2);
    expect(await main(['--bogus'])).toBe(2);
    expect(err).toContain('Unknown option');
  });

  it('exits 2 when the registry is unreachable', async () => {
    vi.stubGlobal('fetch', fakeFetch(WORLD, { failRegistry: true }));
    expect(await main([join(project(), 'package-lock.json')])).toBe(2);
    expect(out).toContain('could not be fetched');
  }, 30_000);
});
