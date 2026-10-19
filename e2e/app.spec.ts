import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { fakeFetch, FILES } from '../test/helpers';

const DEMO = fileURLToPath(new URL('../examples/demo-app/package-lock.json', import.meta.url));

function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const WORLD = {
  'core-js@3.50.0': {
    scripts: { postinstall: `node -e "try{require('./postinstall')}catch(e){}"` },
    files: { 'postinstall.js': FILES.coreJsPostinstall },
  },
  'native-thing@1.0.0': { scripts: { install: 'node-gyp-build' } },
  'shady@0.0.1': { scripts: { postinstall: 'node index.js' }, files: { 'index.js': FILES.evil } },
};
const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { 'core-js': '3.50.0', 'native-thing': '1.0.0', shady: '0.0.1' } },
    'node_modules/core-js': { version: '3.50.0', hasInstallScript: true },
    'node_modules/native-thing': { version: '1.0.0', hasInstallScript: true },
    'node_modules/shady': { version: '0.0.1', hasInstallScript: true },
    'node_modules/left-pad': { version: '1.3.0' },
  },
});

test.describe('mocked registry', () => {
  test.beforeEach(async ({ page }) => {
    const fetch = fakeFetch(WORLD);
    const handler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
      const res = await fetch(route.request().url());
      await route.fulfill({
        status: res.status,
        body: await res.text(),
        headers: { 'access-control-allow-origin': '*' },
      });
    };
    await page.route('https://registry.npmjs.org/**', handler);
    await page.route('https://cdn.jsdelivr.net/**', handler);
  });

  test('upload, review, toggle and copy-ready config', async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto('./');
    await page.locator('input[type=file]').setInputFiles({
      name: 'package-lock.json',
      mimeType: 'application/json',
      buffer: Buffer.from(LOCK),
    });
    await expect(page.getByTestId('headline')).toHaveText('3 dependencies run install scripts');
    const cards = page.getByTestId('card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('shady@0.0.1');
    await expect(cards.first()).toContainText('Review');
    await expect(cards.first()).toContainText('eval / encoded data');

    const snippet = page.getByTestId('snippet');
    await expect(snippet).toContainText('"core-js@3.50.0": false');
    await expect(snippet).toContainText('"shady@0.0.1": true');

    // Deny the suspicious one.
    await page
      .getByRole('group', { name: 'Decision for shady@0.0.1' })
      .getByRole('button', { name: 'Deny' })
      .click();
    await expect(snippet).toContainText('"shady@0.0.1": false');

    // Other managers.
    await page.getByRole('tab', { name: 'pnpm' }).click();
    await expect(snippet).toContainText('allowBuilds:');
    await expect(snippet).toContainText('native-thing@1.0.0: true');
    await page.getByRole('tab', { name: 'Bun' }).click();
    await expect(snippet).toContainText('"native-thing"');
    await expect(snippet).not.toContainText('core-js');

    // Source viewer with evidence highlighted.
    await cards.first().locator('summary').click();
    await expect(cards.first().locator('.row.hit').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('explains a package.json drop', async ({ page }) => {
    await page.goto('./');
    await page.locator('input[type=file]').setInputFiles({
      name: 'package.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"name":"x","dependencies":{"a":"^1"}}'),
    });
    await expect(page.getByRole('alert')).toContainText('version ranges');
  });

  test('a lockfile without install scripts', async ({ page }) => {
    await page.goto('./');
    await page.locator('input[type=file]').setInputFiles({
      name: 'package-lock.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' } },
        }),
      ),
    });
    await expect(page.getByTestId('headline')).toHaveText('No dependency runs an install script');
  });
});

test.describe('live', () => {
  test.skip(!process.env.LIVE && !process.env.E2E_BASE_URL, 'set LIVE=1 for real registry calls');
  test('the sample finds 14 install scripts', async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto('./');
    await page.locator('input[type=file]').setInputFiles(DEMO);
    await expect(page.getByTestId('headline')).toHaveText('14 dependencies run install scripts', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('card').filter({ hasText: 'core-js@3.50.0' })).toContainText(
      'Message only',
    );
    expect(errors).toEqual([]);
    expect(readFileSync(DEMO, 'utf8').length).toBeGreaterThan(1000);
  });
});
