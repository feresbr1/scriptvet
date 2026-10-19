import { parse as parseYaml } from 'yaml';
import type { LockedPackage, ParsedLockfile } from '../types';
import {
  dedupe,
  isExactVersion,
  isRecord,
  LockfileError,
  splitNameAtVersion,
  stripPeerSuffix,
} from './util';

const IMPORTER_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** Parse pnpm-lock.yaml (lockfileVersion 5.x, 6.x and 9.x). */
export function parsePnpmLockfile(text: string): ParsedLockfile {
  const data: unknown = parseYaml(text, { maxAliasCount: -1 });
  if (!isRecord(data)) throw new LockfileError('pnpm-lock.yaml must be a YAML mapping.');
  const lockfileVersion = String(data.lockfileVersion ?? '');
  const major = Number.parseInt(lockfileVersion, 10);
  const result: ParsedLockfile = {
    format: 'pnpm',
    manager: 'pnpm',
    lockfileVersion,
    packages: [],
    skipped: [],
    warnings: [],
  };

  const direct = collectDirect(data);
  const packages = isRecord(data.packages) ? data.packages : {};

  for (const [key, entry] of Object.entries(packages)) {
    const info = isRecord(entry) ? entry : {};
    const parsed = parsePackageKey(key, major);
    if (!parsed) {
      result.skipped.push({ name: key, spec: key, reason: 'unrecognised package key' });
      continue;
    }
    const resolution = isRecord(info.resolution) ? info.resolution : {};
    const name = typeof info.name === 'string' ? info.name : parsed.name;
    const version = parsed.version;

    if (typeof resolution.tarball === 'string' && !resolution.integrity) {
      result.skipped.push({ name, spec: resolution.tarball, reason: 'tarball URL' });
      continue;
    }
    if (resolution.type === 'git' || resolution.type === 'directory') {
      result.skipped.push({ name, spec: key, reason: `${resolution.type} dependency` });
      continue;
    }
    if (!isExactVersion(version)) {
      result.skipped.push({ name, spec: key, reason: 'not an exact registry version' });
      continue;
    }

    const directDev = direct.get(`${name}@${version}`);
    const pkg: LockedPackage = {
      name,
      version,
      direct: directDev !== undefined,
      source: 'registry',
    };
    if (typeof info.dev === 'boolean') pkg.dev = info.dev;
    else if (directDev !== undefined) pkg.dev = directDev;
    if (info.optional === true) pkg.optional = true;
    if (typeof info.requiresBuild === 'boolean') pkg.hasInstallScript = info.requiresBuild;
    result.packages.push(pkg);
  }

  if (major >= 9) {
    result.warnings.push('pnpm lockfile v9 does not record install scripts.');
  }
  result.packages = dedupe(result.packages);
  return result;
}

/** Turn "/@scope/name@1.0.0(peer@1)", "/name/1.0.0_peer" or "name@1.0.0" into name + version. */
function parsePackageKey(
  key: string,
  major: number,
): { name: string; version: string } | undefined {
  const clean = key.startsWith('/') ? key.slice(1) : key;
  if (major > 0 && major < 6) {
    // v5: "/name/1.0.0" or "/@scope/name/1.0.0_peer"
    const slash = clean.lastIndexOf('/');
    if (slash <= 0) return undefined;
    return { name: clean.slice(0, slash), version: stripPeerSuffix(clean.slice(slash + 1)) };
  }
  const split = splitNameAtVersion(stripPeerSuffix(clean));
  return split;
}

/** Direct dependencies as "name@version" → dev-only. */
function collectDirect(data: Record<string, unknown>): Map<string, boolean> {
  const direct = new Map<string, boolean>();
  const importers: Record<string, unknown>[] = [];
  if (isRecord(data.importers)) {
    for (const importer of Object.values(data.importers)) {
      if (isRecord(importer)) importers.push(importer);
    }
  } else {
    importers.push(data); // single-project v5 lockfiles keep dependencies at the root
  }
  for (const importer of importers) {
    for (const field of IMPORTER_FIELDS) {
      const deps = importer[field];
      if (!isRecord(deps)) continue;
      for (const [name, value] of Object.entries(deps)) {
        const raw = isRecord(value) ? value.version : value;
        if (typeof raw !== 'string') continue;
        // v5/v6 may reference "/name/1.0.0" or "1.0.0(peer)"; aliases look like "npm:real@1.0.0"
        // (v5/v6 also use "/real/1.0.0" for aliases).
        let depName = name;
        let version = stripPeerSuffix(raw);
        if (version.startsWith('npm:')) {
          const alias = splitNameAtVersion(version.slice(4));
          if (alias) ({ name: depName, version } = alias);
        } else if (version.startsWith('/')) {
          // v6 "/real@1.0.0", v5 "/real/1.0.0"
          const path = version.slice(1);
          const slash = path.lastIndexOf('/');
          const parsed =
            splitNameAtVersion(path) ??
            (slash > 0
              ? { name: path.slice(0, slash), version: path.slice(slash + 1) }
              : undefined);
          if (parsed) ({ name: depName, version } = parsed);
        } else if (!isExactVersion(version)) {
          const parsed = splitNameAtVersion(version);
          if (parsed && isExactVersion(parsed.version)) ({ name: depName, version } = parsed);
        }
        const key = `${depName}@${version}`;
        direct.set(key, (direct.get(key) ?? true) && field === 'devDependencies');
      }
    }
  }
  return direct;
}
