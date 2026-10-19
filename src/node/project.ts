import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  bunTrustedDependencies,
  npmAllowScripts,
  pnpmAllowBuilds,
  yarnDependenciesMeta,
  type Decisions,
  type ExistingConfig,
} from '../core/config';
import { SUPPORTED_LOCKFILES } from '../core/parsers';
import type { PackageManager, ScriptVerdict } from '../core/types';

export function findLockfile(dir: string): string | undefined {
  for (const name of SUPPORTED_LOCKFILES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

interface PackageJson {
  allowScripts?: Record<string, boolean>;
  dependenciesMeta?: Record<string, { built?: boolean }>;
  trustedDependencies?: string[];
  [key: string]: unknown;
}

function readPackageJson(
  dir: string,
): { data: PackageJson; indent: string; raw: string } | undefined {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
  return { data: JSON.parse(raw) as PackageJson, indent, raw };
}

export function readExistingConfig(dir: string): ExistingConfig {
  const out: ExistingConfig = {};
  const pkg = readPackageJson(dir)?.data;
  if (pkg?.allowScripts) out.npm = pkg.allowScripts;
  if (pkg?.dependenciesMeta) out.yarn = pkg.dependenciesMeta;
  if (pkg?.trustedDependencies) out.bun = pkg.trustedDependencies;
  const ws = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(ws)) {
    const doc = parseDocument(readFileSync(ws, 'utf8'));
    const allow = doc.get('allowBuilds');
    if (allow && typeof allow === 'object' && 'toJSON' in allow) {
      out.pnpm = (allow as { toJSON(): Record<string, boolean> }).toJSON();
    }
  }
  return out;
}

/** Merge decisions into the package manager's config files. Returns the files written. */
export function writeConfig(
  dir: string,
  manager: PackageManager,
  verdicts: readonly ScriptVerdict[],
  decisions: Decisions,
  pin = true,
): string[] {
  const written: string[] = [];
  const updatePackageJson = (update: (pkg: PackageJson) => void) => {
    const current = readPackageJson(dir);
    if (!current) throw new Error(`No package.json in ${dir}.`);
    update(current.data);
    const eol = current.raw.includes('\r\n') ? '\r\n' : '\n';
    const text = JSON.stringify(current.data, null, current.indent).replace(/\n/g, eol) + eol;
    writeFileSync(join(dir, 'package.json'), text);
    written.push('package.json');
  };

  switch (manager) {
    case 'npm':
      updatePackageJson((pkg) => {
        pkg.allowScripts = { ...pkg.allowScripts, ...npmAllowScripts(verdicts, decisions, pin) };
      });
      break;
    case 'bun':
      updatePackageJson((pkg) => {
        const merged = new Set([
          ...(pkg.trustedDependencies ?? []),
          ...bunTrustedDependencies(verdicts, decisions),
        ]);
        // Denied packages must not stay trusted from an earlier run.
        for (const v of verdicts) if (decisions.get(v.key) === false) merged.delete(v.name);
        pkg.trustedDependencies = [...merged].sort();
      });
      break;
    case 'yarn': {
      updatePackageJson((pkg) => {
        pkg.dependenciesMeta = {
          ...pkg.dependenciesMeta,
          ...yarnDependenciesMeta(verdicts, decisions),
        };
      });
      const rcPath = join(dir, '.yarnrc.yml');
      const doc = parseDocument(existsSync(rcPath) ? readFileSync(rcPath, 'utf8') : '');
      if (doc.get('enableScripts') !== false) {
        doc.set('enableScripts', false);
        writeFileSync(rcPath, doc.toString());
        written.push('.yarnrc.yml');
      }
      break;
    }
    case 'pnpm': {
      const wsPath = join(dir, 'pnpm-workspace.yaml');
      const doc = parseDocument(existsSync(wsPath) ? readFileSync(wsPath, 'utf8') : '');
      for (const [key, value] of Object.entries(pnpmAllowBuilds(verdicts, decisions, pin))) {
        doc.setIn(['allowBuilds', key], value);
      }
      writeFileSync(wsPath, doc.toString());
      written.push('pnpm-workspace.yaml');
      break;
    }
  }
  return written;
}
