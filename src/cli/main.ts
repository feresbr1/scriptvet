import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeLockfile } from '../core/analyze';
import { configSnippets, defaultDecisions, uncovered } from '../core/config';
import { LockfileError, parseLockfile, SUPPORTED_LOCKFILES } from '../core/parsers';
import { CATEGORY_LABEL, counts, SIGNAL_LABEL, toMarkdown } from '../core/report';
import type { PackageManager, ScanReport } from '../core/types';
import { VERSION } from '../core/version';
import { findLockfile, readExistingConfig, writeConfig } from '../node/project';

const MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

const HELP = `scriptvet ${VERSION}
See what every dependency's install script does, and generate the allowlist that
npm 12, pnpm 11, Yarn and Bun need before they will run them.

Usage
  scriptvet [lockfile] [options]

  With no lockfile, the first of ${SUPPORTED_LOCKFILES.join(', ')}
  in the current directory is used.

Options
  -w, --write              Add the recommended decisions to your config
                           (package.json allowScripts, pnpm-workspace.yaml allowBuilds,
                           package.json dependenciesMeta + .yarnrc.yml, or trustedDependencies)
  -m, --manager <name>     Config to write or print: npm, pnpm, yarn, bun
                           (default: the lockfile's package manager)
      --no-pin             Allow by name instead of pinning to the reviewed version
      --print-config       Print the config snippet instead of the report
      --check              Exit 1 if a package with install scripts is missing from your config
      --json               Print the full report as JSON
      --markdown           Print a Markdown summary
      --no-color           Disable colours (NO_COLOR is also respected)
  -v, --version            Print the version
  -h, --help               Show this help

Exit codes
  0  done (or, with --check, every install script is covered)
  1  --check found install scripts your config does not cover
  2  usage error, unreadable lockfile, or a lookup failed

Examples
  npx github:feresbr1/scriptvet
  npx github:feresbr1/scriptvet --write
  npx github:feresbr1/scriptvet pnpm-lock.yaml --print-config --manager bun
  npx github:feresbr1/scriptvet --check        # in CI
`;

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        write: { type: 'boolean', short: 'w' },
        manager: { type: 'string', short: 'm' },
        'no-pin': { type: 'boolean' },
        'print-config': { type: 'boolean' },
        check: { type: 'boolean' },
        json: { type: 'boolean' },
        markdown: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    process.stderr.write(
      `scriptvet: ${(error as Error).message}\nRun scriptvet --help for usage.\n`,
    );
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const c = palette(!values['no-color'] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY));
  const fail = (message: string) => {
    process.stderr.write(`${c.red('scriptvet:')} ${message}\n`);
    return 2;
  };

  if (values.manager && !MANAGERS.includes(values.manager as PackageManager)) {
    return fail(`--manager must be one of ${MANAGERS.join(', ')}.`);
  }
  if (positionals.length > 1) return fail('Pass at most one lockfile.');
  const path = positionals[0] ? resolve(positionals[0]) : findLockfile(process.cwd());
  if (!path) {
    return fail(
      `No lockfile found in ${process.cwd()}. Pass a path, e.g. scriptvet path/to/package-lock.json`,
    );
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return fail(
      `Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`,
    );
  }
  let lockfile;
  try {
    lockfile = parseLockfile(text, basename(path));
  } catch (error) {
    if (error instanceof LockfileError) return fail(error.message);
    return fail(`Could not parse ${basename(path)}: ${(error as Error).message}`);
  }

  const quiet = values.json || values.markdown || values['print-config'] || !process.stderr.isTTY;
  if (!quiet)
    process.stderr.write(
      c.dim(`Checking ${lockfile.packages.length} packages from ${basename(path)}…\n`),
    );
  const report = await analyzeLockfile(lockfile, { fileName: basename(path) });
  const manager = (values.manager as PackageManager | undefined) ?? lockfile.manager;
  const decisions = defaultDecisions(report.verdicts);
  const pin = !values['no-pin'];
  const dir = dirname(path);

  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (values.markdown) process.stdout.write(`${toMarkdown(report)}\n`);
  else if (values['print-config']) {
    const snippet = configSnippets(report.verdicts, decisions, pin).find(
      (s) => s.manager === manager,
    )!;
    process.stdout.write(`${snippet.code}\n`);
  } else process.stdout.write(renderText(report, c));

  let code = report.errors.length ? 2 : 0;

  if (values.write) {
    try {
      const files = writeConfig(dir, manager, report.verdicts, decisions, pin);
      process.stderr.write(c.green(`Wrote ${manager} decisions to ${files.join(', ')}.\n`));
    } catch (error) {
      return fail((error as Error).message);
    }
  }

  if (values.check) {
    const missing = uncovered(report.verdicts, manager, readExistingConfig(dir));
    if (missing.length) {
      process.stderr.write(
        c.red(
          `${missing.length} package${missing.length > 1 ? 's' : ''} with install scripts not in your ${manager} config: `,
        ) +
          missing.map((m) => m.key).join(', ') +
          '\n',
      );
      code = Math.max(code, 1);
    } else {
      process.stderr.write(c.green(`Every install script is covered by your ${manager} config.\n`));
    }
  } else if (!values.write && !quiet && report.verdicts.length) {
    process.stderr.write(
      c.dim(
        `Run with --write to add these decisions to your ${manager} config, or --print-config to see it.\n`,
      ),
    );
  }
  return code;
}

type Paint = (s: string) => string;
interface Palette {
  red: Paint;
  green: Paint;
  yellow: Paint;
  blue: Paint;
  dim: Paint;
  bold: Paint;
}

function palette(enabled: boolean): Palette {
  const wrap = (open: string, close = '\x1b[39m'): Paint =>
    enabled ? (s) => `${open}${s}${close}` : (s) => s;
  return {
    red: wrap('\x1b[31m'),
    green: wrap('\x1b[32m'),
    yellow: wrap('\x1b[33m'),
    blue: wrap('\x1b[34m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    bold: wrap('\x1b[1m', '\x1b[22m'),
  };
}

function renderText(report: ScanReport, c: Palette): string {
  const n = counts(report);
  const out = [
    '',
    c.dim(
      `${report.lockfile.fileName} · ${report.totalPackages} packages · ${report.verdicts.length} with install scripts`,
    ),
    c.bold(
      `${c.green(`${n.allow} allow`)}  ${c.dim('·')}  ${c.blue(`${n.deny} deny`)}  ${c.dim('·')}  ${c.yellow(`${n.review} review`)}`,
    ),
    '',
  ];
  for (const v of report.verdicts) {
    const tag =
      v.recommendation === 'allow'
        ? c.green('ALLOW ')
        : v.recommendation === 'deny'
          ? c.blue('DENY  ')
          : c.yellow('REVIEW');
    out.push(
      ` ${tag} ${c.bold(v.key)}${v.direct ? c.dim(' (direct)') : ''}  ${c.dim(CATEGORY_LABEL[v.category])}`,
    );
    for (const [hook, cmd] of Object.entries(v.hooks)) {
      out.push(
        c.dim(
          `        ${hook}: ${cmd}${v.implicitGyp && hook === 'install' ? ' (implicit, binding.gyp)' : ''}`,
        ),
      );
    }
    out.push(`        ${v.reason}`);
    if (v.note) out.push(c.dim(`        note: ${v.note}`));
    const desc = v.files.find((f) => f.description)?.description;
    if (desc) out.push(c.dim(`        says: “${desc}”`));
    if (v.signals.length)
      out.push(c.dim(`        signals: ${v.signals.map((s) => SIGNAL_LABEL[s]).join(', ')}`));
    out.push('');
  }
  if (!report.verdicts.length)
    out.push(c.green('No dependency runs an install script. Nothing to allow.'), '');
  for (const e of report.errors) out.push(c.yellow(`! ${e}`));
  for (const n2 of report.notes) out.push(c.dim(`note: ${n2}`));
  out.push('');
  return out.join('\n');
}
