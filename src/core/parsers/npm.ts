import type { LockedPackage, ParsedLockfile } from '../types';
import {
  classifyResolved,
  dedupe,
  isExactVersion,
  isRecord,
  isUncheckable,
  LockfileError,
  splitNameAtVersion,
} from './util';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Parse package-lock.json / npm-shrinkwrap.json (lockfileVersion 1, 2 and 3). */
export function parseNpmLockfile(data: unknown): ParsedLockfile {
  if (!isRecord(data)) throw new LockfileError('package-lock.json must be a JSON object.');
  const lockfileVersion = String(data.lockfileVersion ?? 1);
  const result: ParsedLockfile = {
    format: 'npm',
    manager: 'npm',
    lockfileVersion,
    packages: [],
    skipped: [],
    warnings: [],
  };

  if (isRecord(data.packages)) {
    parsePackagesMap(data.packages, result);
  } else if (isRecord(data.dependencies)) {
    parseV1Dependencies(data.dependencies, result);
  } else {
    throw new LockfileError('This package-lock.json has no "packages" or "dependencies" section.');
  }

  result.packages = dedupe(result.packages);
  return result;
}

function parsePackagesMap(packages: Record<string, unknown>, result: ParsedLockfile): void {
  // Names declared by the root package and workspace packages are the direct dependencies.
  const directNames = new Set<string>();
  const directDev = new Map<string, boolean>();
  for (const [path, entry] of Object.entries(packages)) {
    if (!isRecord(entry) || path.includes('node_modules/')) continue;
    for (const field of DEP_FIELDS) {
      const deps = entry[field];
      if (!isRecord(deps)) continue;
      for (const name of Object.keys(deps)) {
        directNames.add(name);
        const isDev = field === 'devDependencies';
        directDev.set(name, (directDev.get(name) ?? true) && isDev);
      }
    }
  }

  for (const [path, entry] of Object.entries(packages)) {
    if (!isRecord(entry)) continue;
    const marker = path.lastIndexOf('node_modules/');
    if (marker === -1) continue; // root or workspace source folder
    const installedAs = path.slice(marker + 'node_modules/'.length);
    const name = typeof entry.name === 'string' ? entry.name : installedAs;
    const version = typeof entry.version === 'string' ? entry.version : '';
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : undefined;

    if (entry.link === true) {
      result.skipped.push({ name, spec: resolved ?? path, reason: 'workspace link' });
      continue;
    }
    const source = classifyResolved(resolved);
    if (!version || !isExactVersion(version) || isUncheckable(source)) {
      result.skipped.push({
        name,
        spec: resolved ?? version ?? path,
        reason: describeSource(source),
      });
      continue;
    }

    const topLevel = path.split('node_modules/').length === 2;
    result.packages.push({
      name,
      version,
      direct: topLevel && directNames.has(installedAs),
      dev: entry.dev === true ? true : entry.devOptional === true ? undefined : false,
      optional: entry.optional === true,
      hasInstallScript: entry.hasInstallScript === true,
      source,
    });
  }
}

function parseV1Dependencies(deps: Record<string, unknown>, result: ParsedLockfile): void {
  result.warnings.push(
    'lockfileVersion 1 does not record install scripts or which packages are direct dependencies.',
  );
  const walk = (tree: Record<string, unknown>) => {
    for (const [installedAs, entry] of Object.entries(tree)) {
      if (!isRecord(entry)) continue;
      let name = installedAs;
      let version = typeof entry.version === 'string' ? entry.version : '';
      if (version.startsWith('npm:')) {
        const alias = splitNameAtVersion(version.slice(4));
        if (alias) ({ name, version } = alias);
      }
      const resolved = typeof entry.resolved === 'string' ? entry.resolved : undefined;
      const source = classifyResolved(resolved ?? (isExactVersion(version) ? undefined : version));
      if (!isExactVersion(version) || isUncheckable(source)) {
        result.skipped.push({ name, spec: version, reason: describeSource(source) });
      } else {
        const pkg: LockedPackage = {
          name,
          version,
          dev: entry.dev === true,
          optional: entry.optional === true,
          source,
        };
        result.packages.push(pkg);
      }
      if (isRecord(entry.dependencies)) walk(entry.dependencies);
    }
  };
  walk(deps);
}

function describeSource(source: LockedPackage['source']): string {
  switch (source) {
    case 'git':
      return 'git dependency';
    case 'file':
      return 'local file dependency';
    case 'url':
      return 'tarball URL';
    default:
      return 'not an exact registry version';
  }
}
