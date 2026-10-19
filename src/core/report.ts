import type { Category, Recommendation, ScanReport, Signal } from './types';

export const CATEGORY_LABEL: Record<Category, string> = {
  'native-build': 'Native build',
  'binary-download': 'Downloads a binary',
  'binary-check': 'Binary check',
  message: 'Message only',
  'git-hooks': 'Git hooks',
  codegen: 'Code generation',
  unknown: 'Unclear',
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  allow: 'Allow',
  deny: 'Deny',
  review: 'Review',
};

export const SIGNAL_LABEL: Record<Signal, string> = {
  network: 'network requests',
  'child-process': 'spawns processes',
  'writes-files': 'writes files',
  'reads-env': 'reads environment',
  'console-only': 'only prints',
  'errors-ignored': 'failures ignored',
  shell: 'runs shell commands',
  obfuscated: 'eval / encoded data',
  'platform-specific': 'OS-specific',
};

export function counts(report: ScanReport): Record<Recommendation, number> {
  const out = { allow: 0, deny: 0, review: 0 };
  for (const v of report.verdicts) out[v.recommendation]++;
  return out;
}

export function toMarkdown(report: ScanReport): string {
  const c = counts(report);
  const lines = [
    '## scriptvet report',
    '',
    `${report.verdicts.length} of ${report.totalPackages} packages run install scripts: **${c.allow} allow**, **${c.deny} deny**, **${c.review} review**.`,
    '',
    '| Package | Hook | Does | Recommendation |',
    '| --- | --- | --- | --- |',
  ];
  for (const v of report.verdicts) {
    const hooks = Object.entries(v.hooks)
      .map(([h, cmd]) => `${h}: \`${cmd.replace(/\|/g, '\\|')}\``)
      .join('<br>');
    lines.push(
      `| \`${v.key}\` | ${hooks} | ${CATEGORY_LABEL[v.category]} | **${RECOMMENDATION_LABEL[v.recommendation]}**: ${v.reason} |`,
    );
  }
  for (const e of report.errors) lines.push('', `> ⚠️ ${e}`);
  lines.push(
    '',
    `<sub>[scriptvet](https://github.com/feresbr1/scriptvet) ${report.tool.version}</sub>`,
  );
  return lines.join('\n');
}
