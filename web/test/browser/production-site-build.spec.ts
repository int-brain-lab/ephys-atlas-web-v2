import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('production build uses immutable asset URLs and no copied development corpus', async ({ page }) => {
  test.setTimeout(90_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'atlas-production-site-test-'));
  const output = path.join(temporary, 'site');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_') && !key.startsWith('EPHYS_ATLAS_')));
    await promisify(execFile)('node', ['node_modules/vite/bin/vite.js', 'build', '--base', '/site/builds/test-only/', '--outDir', output], {
      cwd: process.cwd(), timeout:60_000, env: {...env, EPHYS_ATLAS_SITE_BUILD:'1',
        VITE_DATASET_CATALOG_URL:'/__real-data/catalog.json',
        VITE_PROJECTION_PACK_URL:'/atlas/projections/ibl-static-registered-v1/manifest.json'},
    });
    expect((await readdir(output)).sort()).toEqual(['assets', 'index.html']);
    await mkdir(path.join(output, 'brand'));
    await copyFile('public/brand/ibl-core-logo.svg', path.join(output, 'brand/ibl-core-logo.svg'));
    await copyFile('public/favicon.png', path.join(output, 'favicon.png'));
    await page.route('**/site/builds/test-only/**', async route => {
      const relative = new URL(route.request().url()).pathname.slice('/site/builds/test-only/'.length);
      const mime = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      await route.fulfill({body:await readFile(path.join(output, relative)), contentType:mime});
    });
    await page.route('http://127.0.0.1:4173/', async route => route.fulfill({body:await readFile(path.join(output,'index.html')), contentType:'text/html'}));
    await page.goto('/');
    await expect(page.locator('[data-view="coronal"] .view-frame__brain-svg')).toBeVisible();
    await expect(page.locator('[data-view="coronal"] path[data-allen-id]').first()).toBeVisible();
    await expect(page.locator('img[src="/site/builds/test-only/brand/ibl-core-logo.svg"]')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(temporary, {recursive:true, force:true});
  }
});
