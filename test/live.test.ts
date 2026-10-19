import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeLockfile } from '../src/core/analyze';
import { parseLockfile } from '../src/core/parsers';

// Hits registry.npmjs.org and jsDelivr. Run with LIVE=1 npm test.
describe.runIf(process.env.LIVE === '1')('live', () => {
  it('classifies the demo app the way the notes say', async () => {
    const text = readFileSync(
      new URL('../examples/demo-app/package-lock.json', import.meta.url),
      'utf8',
    );
    const report = await analyzeLockfile(parseLockfile(text, 'package-lock.json'));
    expect(report.errors).toEqual([]);
    const rec = Object.fromEntries(
      report.verdicts.map((v) => [v.name, `${v.category}/${v.recommendation}`]),
    );
    expect(rec).toMatchObject({
      bcrypt: 'native-build/allow',
      sqlite3: 'native-build/allow',
      fsevents: 'native-build/allow',
      esbuild: 'binary-check/deny',
      '@swc/core': 'binary-check/deny',
      'unrs-resolver': 'binary-check/deny',
      'core-js': 'message/deny',
      'es5-ext': 'message/deny',
      husky: 'git-hooks/deny',
      '@sentry/cli': 'binary-download/allow',
      puppeteer: 'binary-download/allow',
      ssh2: 'native-build/deny',
    });
    expect(report.verdicts).toHaveLength(14);
  }, 120_000);
});
