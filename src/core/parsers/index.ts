import type { ParsedLockfile } from '../types';
import { parseBunLockfile, parseJsonc } from './bun';
import { parseNpmLockfile } from './npm';
import { parsePnpmLockfile } from './pnpm';
import { parseYarnBerryLockfile, parseYarnClassicLockfile } from './yarn';
import { isRecord, LockfileError } from './util';

export { LockfileError } from './util';

export const SUPPORTED_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
] as const;

/**
 * Parse a lockfile. The format is taken from the file name when given and recognised,
 * otherwise sniffed from the content (so pasted text works too).
 */
export function parseLockfile(text: string, fileName?: string): ParsedLockfile {
  const base = fileName?.split(/[\\/]/).pop()?.toLowerCase();
  if (text.includes('\u0000') || base === 'bun.lockb') {
    throw new LockfileError(
      'bun.lockb is a binary file. Run `bun install --save-text-lockfile` to generate bun.lock, then scan that.',
    );
  }
  const trimmed = stripBom(text).trim();
  if (!trimmed) throw new LockfileError('The lockfile is empty.');

  if (base === 'package.json') throw packageJsonError();
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') {
    return parseNpmLockfile(parseJson(trimmed));
  }
  if (base === 'pnpm-lock.yaml' || base === 'pnpm-lock.yml') return parsePnpmLockfile(trimmed);
  if (base === 'bun.lock') return parseBunLockfile(trimmed);
  if (base === 'yarn.lock') return parseYarn(trimmed);

  return sniff(trimmed);
}

function sniff(text: string): ParsedLockfile {
  if (text.startsWith('{')) {
    const data = parseJsonc(text);
    if (isRecord(data)) {
      if (isRecord(data.workspaces) && isRecord(data.packages)) {
        const first = Object.values(data.packages)[0];
        if (first === undefined || Array.isArray(first)) return parseBunLockfile(text);
      }
      if ('lockfileVersion' in data && (isRecord(data.packages) || isRecord(data.dependencies))) {
        return parseNpmLockfile(data);
      }
      if ('name' in data && ('dependencies' in data || 'devDependencies' in data)) {
        throw packageJsonError();
      }
    }
    throw new LockfileError('This JSON file does not look like a package-lock.json or bun.lock.');
  }
  if (/^# yarn lockfile v1/m.test(text) || /^"?[^\s#][^\n]*@[^\n]*:\n {2}version /m.test(text)) {
    return parseYarn(text);
  }
  if (/^__metadata:/m.test(text)) return parseYarnBerryLockfile(text);
  if (/^lockfileVersion:/m.test(text)) return parsePnpmLockfile(text);
  throw new LockfileError(`Unrecognised lockfile. Supported: ${SUPPORTED_LOCKFILES.join(', ')}.`);
}

function parseYarn(text: string): ParsedLockfile {
  return /^__metadata:/m.test(text) ? parseYarnBerryLockfile(text) : parseYarnClassicLockfile(text);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new LockfileError(`Invalid JSON: ${(error as Error).message}`);
  }
}

function packageJsonError(): LockfileError {
  return new LockfileError(
    'This is a package.json. It lists version ranges, not the exact versions you install. Scan your lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock) instead.',
  );
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
