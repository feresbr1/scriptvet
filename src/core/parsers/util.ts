import type { LockedPackage } from '../types';

/** Loose semver check: exact versions only (no ranges, tags, URLs or hashes). */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isExactVersion(version: string): boolean {
  return EXACT_VERSION.test(version);
}

/**
 * Split "name@version" where name may be scoped ("@scope/name@1.0.0").
 * Returns undefined when there is no version separator.
 */
export function splitNameAtVersion(spec: string): { name: string; version: string } | undefined {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  if (at <= 0) return undefined;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** Strip pnpm peer-dependency suffixes: "1.0.0(react@18.2.0)" and legacy "1.0.0_react@18.2.0". */
export function stripPeerSuffix(version: string): string {
  const paren = version.indexOf('(');
  const v = paren === -1 ? version : version.slice(0, paren);
  const underscore = v.indexOf('_');
  return underscore === -1 ? v : v.slice(0, underscore);
}

export function classifyResolved(resolved: string | undefined): LockedPackage['source'] {
  if (!resolved) return 'registry';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(resolved) || /\.git(#|$)/.test(resolved)) {
    return 'git';
  }
  if (resolved.startsWith('file:') || resolved.startsWith('link:')) return 'file';
  if (/^https?:\/\//.test(resolved)) {
    if (/^https?:\/\/registry\.(npmjs\.org|yarnpkg\.com)\//.test(resolved)) return 'registry';
    if (/^https?:\/\/codeload\.github\.com\//.test(resolved)) return 'git';
    if (/\/-\/[^/]+\.tgz/.test(resolved)) return 'other-registry';
    return 'url';
  }
  return 'registry';
}

/**
 * Collapse duplicate name@version entries (the same version can be installed in many places).
 * A package is direct if any occurrence is direct, dev only if every occurrence is dev.
 */
export function dedupe(packages: LockedPackage[]): LockedPackage[] {
  const byKey = new Map<string, LockedPackage>();
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...pkg });
      continue;
    }
    prev.direct = mergeOr(prev.direct, pkg.direct);
    prev.dev = mergeAnd(prev.dev, pkg.dev);
    prev.optional = mergeAnd(prev.optional, pkg.optional);
    prev.hasInstallScript = mergeOr(prev.hasInstallScript, pkg.hasInstallScript);
  }
  return [...byKey.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

function mergeOr(a: boolean | undefined, b: boolean | undefined): boolean | undefined {
  if (a === undefined && b === undefined) return undefined;
  return Boolean(a) || Boolean(b);
}

function mergeAnd(a: boolean | undefined, b: boolean | undefined): boolean | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  return a && b;
}

/** Sources we cannot look up on the public registry by name and version. */
export function isUncheckable(source: LockedPackage['source']): boolean {
  return source === 'git' || source === 'file' || source === 'url';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class LockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockfileError';
  }
}
