import { analyzeCommand, analyzeSource, decide } from './classify';
import { KNOWN } from './known';
import { fetchManifest, fetchPackageFile, mapLimit, type FetchLike } from './sources';
import type {
  Hook,
  LockedPackage,
  ParsedLockfile,
  ScanProgress,
  ScanReport,
  ScriptFile,
  ScriptVerdict,
  Signal,
} from './types';
import { VERSION } from './version';

const HOOKS: Hook[] = ['preinstall', 'install', 'postinstall'];
const MAX_FILES = 4;
const MAX_FILE_BYTES = 400_000;
const EXCERPT_LINES = 40;

export interface AnalyzeOptions {
  fetch?: FetchLike;
  fileName?: string;
  now?: Date;
  onProgress?: (p: ScanProgress) => void;
}

/** Packages that may have install scripts (lockfiles that record it let us skip the rest). */
export function candidates(lockfile: ParsedLockfile): LockedPackage[] {
  return lockfile.packages.filter((p) => p.hasInstallScript !== false);
}

export async function analyzeLockfile(
  lockfile: ParsedLockfile,
  options: AnalyzeOptions = {},
): Promise<ScanReport> {
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const progress = options.onProgress ?? (() => {});
  const notes: string[] = [...lockfile.warnings];
  const errors: string[] = [];
  const toCheck = candidates(lockfile);
  if (toCheck.length < lockfile.packages.length) {
    notes.push(
      `The lockfile records install scripts: ${lockfile.packages.length - toCheck.length} of ${lockfile.packages.length} packages have none and were skipped.`,
    );
  }

  // 1. Manifests: which packages really have install hooks (including implicit node-gyp).
  let done = 0;
  progress({ stage: 'manifests', done, total: toCheck.length });
  const withHooks: {
    pkg: LockedPackage;
    hooks: Partial<Record<Hook, string>>;
    implicitGyp: boolean;
    os?: string[];
  }[] = [];
  let failed = 0;
  await mapLimit(toCheck, 16, async (pkg) => {
    try {
      const manifest = await fetchManifest(fetchFn, pkg.name, pkg.version);
      if (manifest) {
        const hooks: Partial<Record<Hook, string>> = {};
        for (const hook of HOOKS) {
          const cmd = manifest.scripts?.[hook];
          if (cmd && cmd.trim()) hooks[hook] = cmd.trim();
        }
        // npm runs `node-gyp rebuild` for packages with binding.gyp and no install/preinstall.
        const implicitGyp = Boolean(manifest.gypfile) && !hooks.install && !hooks.preinstall;
        if (implicitGyp) hooks.install = 'node-gyp rebuild';
        if (Object.keys(hooks).length) withHooks.push({ pkg, hooks, implicitGyp, os: manifest.os });
      }
    } catch {
      failed++;
    }
    progress({ stage: 'manifests', done: ++done, total: toCheck.length });
  });
  if (failed) {
    errors.push(
      `${failed} package manifest${failed > 1 ? 's' : ''} could not be fetched from the npm registry, so some install scripts may be missing from this report.`,
    );
  }

  // 2. Read the files those hooks run, and decide.
  done = 0;
  progress({ stage: 'files', done, total: withHooks.length });
  let fileFailures = 0;
  const verdicts = await mapLimit(withHooks, 8, async ({ pkg, hooks, implicitGyp, os }) => {
    const signals = new Set<Signal>();
    const files: ScriptFile[] = [];
    const sources: string[] = [];
    const helpers: string[] = [];
    let commandCategory: ScriptVerdict['category'] | undefined;
    const queue: string[] = [];

    for (const hook of HOOKS) {
      const cmd = hooks[hook];
      if (!cmd) continue;
      const parsed = analyzeCommand(cmd);
      commandCategory ??= parsed.category;
      parsed.signals.forEach((s) => signals.add(s));
      queue.push(...parsed.files);
    }

    // Fetch the files the hooks run in parallel; follow imports only from small stub files
    // that delegate their work (e.g. `require('napi-postinstall')` or `import './lib/install.js'`).
    const seen = new Set<string>();
    const fetchLevel = async (paths: string[]) => {
      const fresh = paths
        .filter((p) => !seen.has(p) && !p.endsWith('.json'))
        .slice(0, MAX_FILES - files.length);
      fresh.forEach((p) => seen.add(p));
      const texts = await Promise.all(
        fresh.map((path) =>
          fetchPackageFile(fetchFn, pkg.name, pkg.version, path).catch(() => {
            fileFailures++;
            return undefined;
          }),
        ),
      );
      const next: string[] = [];
      fresh.forEach((path, i) => {
        const text = texts[i];
        if (text === undefined) return;
        const truncated = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
        const analysis = analyzeSource(truncated);
        analysis.signals.forEach((s) => signals.add(s));
        helpers.push(...analysis.helpers);
        sources.push(truncated);
        files.push({
          path,
          excerpt: excerptOf(truncated),
          description: analysis.description,
          evidence: analysis.evidence,
          bytes: text.length,
        });
        if (text.length < 3000)
          next.push(...analysis.imports.map((imp) => resolveRelative(path, imp)));
      });
      return next;
    };
    const level1 = await fetchLevel(queue);
    if (level1.length && files.length < MAX_FILES) await fetchLevel(level1);

    // "console-only" only holds if no other file did more.
    if (
      signals.has('console-only') &&
      (signals.has('network') || signals.has('child-process') || signals.has('writes-files'))
    ) {
      signals.delete('console-only');
    }
    if (os?.length) signals.add('platform-specific');

    const known = KNOWN[pkg.name];
    const redFlag = signals.has('obfuscated') || signals.has('shell');
    // A curated note refines the category, unless the code itself raises a red flag.
    let decision = decide({
      commandCategory: known && !redFlag ? known.category : commandCategory,
      signals: [...signals],
      helpers,
      sources,
      implicitGyp,
    });
    // "Only prints" is misleading once the script is known to do something else.
    if (decision.category !== 'message') signals.delete('console-only');
    if (known && !redFlag) {
      decision = {
        category: known.category,
        recommendation: known.recommendation,
        reason:
          known.recommendation === decision.recommendation
            ? decision.reason
            : 'See the note below, and read the script before deciding.',
      };
    }
    progress({ stage: 'files', done: ++done, total: withHooks.length });

    const verdict: ScriptVerdict = {
      name: pkg.name,
      version: pkg.version,
      key: `${pkg.name}@${pkg.version}`,
      direct: pkg.direct,
      dev: pkg.dev,
      optional: pkg.optional,
      hooks,
      implicitGyp,
      os,
      category: decision.category,
      recommendation: decision.recommendation,
      reason: decision.reason,
      signals: [...signals],
      files,
      note: known ? `${known.note} (Checked against ${pkg.name}@${known.verified}.)` : undefined,
    };
    return verdict;
  });
  if (fileFailures) {
    errors.push(
      `${fileFailures} script file${fileFailures > 1 ? 's' : ''} could not be downloaded from jsDelivr; their verdicts are based on the command only.`,
    );
  }
  progress({ stage: 'done', done: verdicts.length, total: verdicts.length });

  const order = { review: 0, allow: 1, deny: 2 } as const;
  verdicts.sort(
    (a, b) => order[a.recommendation] - order[b.recommendation] || a.name.localeCompare(b.name),
  );

  return {
    tool: { name: 'scriptvet', version: VERSION },
    scannedAt: (options.now ?? new Date()).toISOString(),
    lockfile: {
      format: lockfile.format,
      manager: lockfile.manager,
      lockfileVersion: lockfile.lockfileVersion,
      fileName: options.fileName,
    },
    totalPackages: lockfile.packages.length,
    checkedPackages: toCheck.length,
    verdicts,
    notes,
    errors,
  };
}

function resolveRelative(from: string, target: string): string {
  const base = from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  const joined = base.join('/');
  return /\.(?:c|m)?js$|\.json$/.test(joined) ? joined : `${joined}.js`;
}

function excerptOf(text: string): string {
  return text.split(/\r?\n/).slice(0, EXCERPT_LINES).join('\n');
}
