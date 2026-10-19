import { stringify } from 'yaml';
import type { PackageManager, ScriptVerdict } from './types';

/** allow = true, deny = false, keyed by "name@version". */
export type Decisions = Map<string, boolean>;

/**
 * Default decisions: follow the recommendation; "review" is allowed but pinned to the
 * reviewed version, so the build keeps working and a new version needs a new approval.
 */
export function defaultDecisions(verdicts: readonly ScriptVerdict[]): Decisions {
  return new Map(verdicts.map((v) => [v.key, v.recommendation !== 'deny']));
}

export interface ConfigSnippet {
  manager: PackageManager;
  label: string;
  file: string;
  code: string;
  note: string;
}

interface Entry {
  name: string;
  version: string;
  allow: boolean;
}

function entries(verdicts: readonly ScriptVerdict[], decisions: Decisions): Entry[] {
  return verdicts
    .map((v) => ({
      name: v.name,
      version: v.version,
      allow: decisions.get(v.key) ?? v.recommendation !== 'deny',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function npmAllowScripts(
  verdicts: readonly ScriptVerdict[],
  decisions: Decisions,
  pin = true,
) {
  const out: Record<string, boolean> = {};
  for (const e of entries(verdicts, decisions))
    out[pin ? `${e.name}@${e.version}` : e.name] = e.allow;
  return out;
}

export function pnpmAllowBuilds(
  verdicts: readonly ScriptVerdict[],
  decisions: Decisions,
  pin = true,
) {
  const out: Record<string, boolean> = {};
  for (const e of entries(verdicts, decisions))
    out[pin ? `${e.name}@${e.version}` : e.name] = e.allow;
  return out;
}

export function yarnDependenciesMeta(verdicts: readonly ScriptVerdict[], decisions: Decisions) {
  const out: Record<string, { built: boolean }> = {};
  for (const e of entries(verdicts, decisions)) {
    // Yarn matches by name; if any version is allowed, allow the name.
    out[e.name] = { built: Boolean(out[e.name]?.built) || e.allow };
  }
  return out;
}

export function bunTrustedDependencies(
  verdicts: readonly ScriptVerdict[],
  decisions: Decisions,
): string[] {
  return [
    ...new Set(
      entries(verdicts, decisions)
        .filter((e) => e.allow)
        .map((e) => e.name),
    ),
  ];
}

export function configSnippets(
  verdicts: readonly ScriptVerdict[],
  decisions: Decisions,
  pin = true,
): ConfigSnippet[] {
  const indent = (obj: unknown) => JSON.stringify(obj, null, 2);
  return [
    {
      manager: 'npm',
      label: 'npm',
      file: 'package.json',
      code: `"allowScripts": ${indent(npmAllowScripts(verdicts, decisions, pin))}`,
      note: 'npm 11.16+ reads allowScripts from package.json; npm 12 blocks everything else. Add --strict-allow-scripts in CI to fail on new scripts.',
    },
    {
      manager: 'pnpm',
      label: 'pnpm',
      file: 'pnpm-workspace.yaml',
      code: stringify({ allowBuilds: pnpmAllowBuilds(verdicts, decisions, pin) }).trimEnd(),
      note: 'pnpm 11 reads allowBuilds from pnpm-workspace.yaml (strictDepBuilds fails installs on unreviewed scripts by default).',
    },
    {
      manager: 'yarn',
      label: 'Yarn',
      file: 'package.json + .yarnrc.yml',
      code: `// package.json\n"dependenciesMeta": ${indent(yarnDependenciesMeta(verdicts, decisions))}\n\n# .yarnrc.yml\nenableScripts: false`,
      note: 'Yarn 2+ (Berry). With enableScripts: false, only packages marked built: true run their scripts. Yarn matches by name, not version.',
    },
    {
      manager: 'bun',
      label: 'Bun',
      file: 'package.json',
      code: `"trustedDependencies": ${indent(bunTrustedDependencies(verdicts, decisions))}`,
      note: 'Bun blocks scripts by default except for its own list of well-known packages; trustedDependencies replaces that list for your project. Bun matches by name.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Coverage: is every package with install scripts already decided in the config?
// ---------------------------------------------------------------------------

export interface ExistingConfig {
  npm?: Record<string, boolean>;
  pnpm?: Record<string, boolean>;
  yarn?: Record<string, { built?: boolean }>;
  bun?: string[];
}

/** Packages with install scripts that the existing config does not mention. */
export function uncovered(
  verdicts: readonly ScriptVerdict[],
  manager: PackageManager,
  existing: ExistingConfig,
): ScriptVerdict[] {
  return verdicts.filter((v) => {
    switch (manager) {
      case 'npm':
        return !matchesKey(existing.npm, v);
      case 'pnpm':
        return !matchesKey(existing.pnpm, v);
      case 'yarn':
        return !(existing.yarn && v.name in existing.yarn);
      case 'bun':
        // Bun has no deny list: anything not trusted is blocked, so nothing is "unreviewed".
        return false;
    }
  });
}

/** Keys may be "name", "name@version" or pnpm's "name@1.0.0 || 1.0.1". */
function matchesKey(map: Record<string, unknown> | undefined, v: ScriptVerdict): boolean {
  if (!map) return false;
  for (const key of Object.keys(map)) {
    const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
    const name = at === -1 ? key : key.slice(0, at);
    if (name !== v.name) continue;
    if (at === -1) return true;
    const versions = key
      .slice(at + 1)
      .split('||')
      .map((s) => s.trim());
    if (versions.includes(v.version)) return true;
  }
  return false;
}
