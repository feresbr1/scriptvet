import type { ParsedLockfile } from '../types';
import { dedupe, isExactVersion, isRecord, LockfileError, splitNameAtVersion } from './util';

/** Parse Bun's text lockfile (bun.lock, Bun 1.1.39+). The binary bun.lockb is not supported. */
export function parseBunLockfile(text: string): ParsedLockfile {
  const data = parseJsonc(text);
  if (!isRecord(data) || !isRecord(data.packages)) {
    throw new LockfileError('bun.lock must contain a "packages" object.');
  }
  const result: ParsedLockfile = {
    format: 'bun',
    manager: 'bun',
    lockfileVersion: String(data.lockfileVersion ?? ''),
    packages: [],
    skipped: [],
    warnings: ['bun.lock does not record install scripts.'],
  };

  // Direct dependencies are declared by the workspaces; dev-only when only in devDependencies.
  const directDev = new Map<string, boolean>();
  if (isRecord(data.workspaces)) {
    for (const ws of Object.values(data.workspaces)) {
      if (!isRecord(ws)) continue;
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
        const deps = ws[field];
        if (!isRecord(deps)) continue;
        for (const name of Object.keys(deps)) {
          const isDev = field === 'devDependencies';
          directDev.set(name, (directDev.get(name) ?? true) && isDev);
        }
      }
    }
  }

  for (const [key, entry] of Object.entries(data.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const ident: string = entry[0];
    const split = splitNameAtVersion(ident);
    if (!split) {
      result.skipped.push({ name: key, spec: ident, reason: 'unrecognised entry' });
      continue;
    }
    const { name, version } = split;
    const registry = typeof entry[1] === 'string' ? entry[1] : '';
    if (!isExactVersion(version)) {
      const reason = version.startsWith('workspace:')
        ? 'workspace package'
        : 'not a registry package';
      result.skipped.push({ name, spec: ident, reason });
      continue;
    }
    // Top-level keys are the installed name ("pkg", "@scope/pkg", or an alias);
    // nested installs look like "parent/child".
    const isTopLevel = key.split('/').length === (key.startsWith('@') ? 2 : 1);
    const direct = isTopLevel && directDev.has(key);
    result.packages.push({
      name,
      version,
      direct,
      dev: direct ? directDev.get(key) : undefined,
      source: registry && !registry.includes('registry.npmjs.org') ? 'other-registry' : 'registry',
    });
  }

  result.packages = dedupe(result.packages);
  return result;
}

/** JSON with trailing commas and comments, as written by Bun. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[++i] ?? '';
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else if (ch === ',') {
      // Drop the comma if the next significant character closes an object or array.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? '')) j++;
      if (text[j] !== '}' && text[j] !== ']') out += ch;
    } else {
      out += ch;
    }
  }
  try {
    return JSON.parse(out);
  } catch (error) {
    throw new LockfileError(`Could not parse bun.lock: ${(error as Error).message}`);
  }
}
