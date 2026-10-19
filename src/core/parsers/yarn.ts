import { parse as parseYaml } from 'yaml';
import type { ParsedLockfile } from '../types';
import {
  classifyResolved,
  dedupe,
  isExactVersion,
  isRecord,
  isUncheckable,
  LockfileError,
  splitNameAtVersion,
} from './util';

/** Parse a Yarn classic (v1) yarn.lock. */
export function parseYarnClassicLockfile(text: string): ParsedLockfile {
  const result: ParsedLockfile = {
    format: 'yarn-classic',
    manager: 'yarn',
    lockfileVersion: '1',
    packages: [],
    skipped: [],
    warnings: ['yarn.lock does not record install scripts or which packages are dev-only.'],
  };

  let current: { specs: string[]; fields: Record<string, string> } | undefined;
  const flush = () => {
    if (current) addClassicEntry(current.specs, current.fields, result);
    current = undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    if (!rawLine.startsWith(' ')) {
      flush();
      const header = rawLine.replace(/:\s*$/, '');
      current = { specs: header.split(/,\s*/).map(unquote), fields: {} };
      continue;
    }
    // Only first-level fields matter ("  version", "  resolved"); nested maps are indented deeper.
    if (current && /^ {2}\S/.test(rawLine)) {
      const match = /^ {2}("?[^"\s]+"?)\s+(.+)$/.exec(rawLine);
      if (match?.[1] && match[2]) current.fields[unquote(match[1])] = unquote(match[2].trim());
    }
  }
  flush();

  result.packages = dedupe(result.packages);
  return result;
}

function addClassicEntry(
  specs: string[],
  fields: Record<string, string>,
  result: ParsedLockfile,
): void {
  const first = specs[0];
  if (!first) return;
  const parsed = splitNameAtVersion(first);
  if (!parsed) return;
  let name = parsed.name;
  // Aliases: "string-width-cjs@npm:string-width@^4.2.0"
  if (parsed.version.startsWith('npm:')) {
    const alias = splitNameAtVersion(parsed.version.slice(4));
    if (alias) name = alias.name;
    else name = parsed.version.slice(4);
  }
  const version = fields.version ?? '';
  const source = classifyResolved(fields.resolved);
  if (!isExactVersion(version) || isUncheckable(source)) {
    result.skipped.push({ name, spec: fields.resolved ?? first, reason: 'not a registry package' });
    return;
  }
  result.packages.push({ name, version, source });
}

/** Parse a Yarn Berry (v2, v3, v4) yarn.lock, which is YAML. */
export function parseYarnBerryLockfile(text: string): ParsedLockfile {
  const data: unknown = parseYaml(text, { maxAliasCount: -1 });
  if (!isRecord(data)) throw new LockfileError('yarn.lock must be a YAML mapping.');
  const meta = isRecord(data.__metadata) ? data.__metadata : {};
  const result: ParsedLockfile = {
    format: 'yarn-berry',
    manager: 'yarn',
    lockfileVersion: String(meta.version ?? ''),
    packages: [],
    skipped: [],
    warnings: ['yarn.lock does not record install scripts or which packages are dev-only.'],
  };

  const direct = collectBerryDirect(data);
  for (const [key, entry] of Object.entries(data)) {
    if (key === '__metadata' || !isRecord(entry)) continue;
    const resolution = typeof entry.resolution === 'string' ? entry.resolution : '';
    const npm = resolveBerryNpm(resolution);
    if (!npm) {
      const name = splitNameAtVersion(resolution)?.name ?? key;
      const reason = resolution.includes('@workspace:')
        ? 'workspace package'
        : 'not an npm package';
      result.skipped.push({ name, spec: resolution || key, reason });
      continue;
    }
    if (!isExactVersion(npm.version)) {
      result.skipped.push({ name: npm.name, spec: resolution, reason: 'not an exact version' });
      continue;
    }
    result.packages.push({
      name: npm.name,
      version: npm.version,
      direct: direct.has(key),
      source: 'registry',
    });
  }

  result.packages = dedupe(result.packages);
  return result;
}

/**
 * Workspace entries list their dependencies as descriptors ("lodash": "npm:^4.17.21").
 * Return the lockfile keys those descriptors point at.
 */
function collectBerryDirect(data: Record<string, unknown>): Set<string> {
  const keyByDescriptor = new Map<string, string>();
  for (const key of Object.keys(data)) {
    for (const descriptor of key.split(/,\s*/)) keyByDescriptor.set(descriptor, key);
  }
  const direct = new Set<string>();
  for (const entry of Object.values(data)) {
    if (!isRecord(entry) || typeof entry.resolution !== 'string') continue;
    if (!entry.resolution.includes('@workspace:') || !isRecord(entry.dependencies)) continue;
    for (const [name, range] of Object.entries(entry.dependencies)) {
      const key = keyByDescriptor.get(`${name}@${String(range)}`);
      if (key) direct.add(key);
    }
  }
  return direct;
}

/** "lodash@npm:4.17.21" → lodash 4.17.21; patches resolve to the package they patch. */
function resolveBerryNpm(resolution: string): { name: string; version: string } | undefined {
  const split = splitNameAtVersion(resolution);
  if (!split) return undefined;
  const { name, version: locator } = split;
  if (locator.startsWith('npm:')) return { name, version: locator.slice(4) };
  if (locator.startsWith('patch:')) {
    const inner = decodeURIComponent(locator.slice('patch:'.length).split('#')[0] ?? '');
    return resolveBerryNpm(inner);
  }
  return undefined;
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/, '$1');
}
