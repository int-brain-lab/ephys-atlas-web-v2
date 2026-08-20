import { expect, test } from '@playwright/test';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const configuredRelease = process.env.EPHYS_ATLAS_REAL_RELEASE;
if (!configuredRelease) {
  throw new Error('EPHYS_ATLAS_REAL_RELEASE must point to an immutable release directory');
}
const releaseRoot = path.resolve(configuredRelease);
const releaseId = path.basename(releaseRoot);

test.beforeEach(async ({ page }) => {
  await stat(path.join(releaseRoot, 'manifest.json'));
});

test('uses the immutable release and approved denoised feature as development defaults', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(releaseId);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText('rms ap (denoised)');
  await expect(page.getByLabel('Dataset and release')).toHaveValue(`ephys_atlas_channels::${releaseId}`);
  await expect(page.getByLabel('Feature', { exact: true })).toHaveValue('rms_ap.denoised');
  await expect(page.getByLabel('Feature', { exact: true }).locator('option')).toHaveCount(70);
  await expect(page.getByLabel('Parcellation').locator('option')).toHaveCount(3);
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  expect(new URL(page.url()).searchParams.get('release')).toBeNull();
  expect(new URL(page.url()).searchParams.get('feature')).toBeNull();
});

test('loads real float64 alpha values and all launch parcellations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=alpha_mean.raw`);

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(releaseId);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText('alpha mean (raw)');
  await expect(page.getByLabel('Parcellation')).toHaveValue('allen');
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);

  const firstRegion = page.locator('.region-row[data-missing="false"] button').first();
  await firstRegion.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).not.toBeNull();
  await expect(page.locator('.selected-region')).toHaveCount(1);

  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=rms_ap.denoised&parcel=beryl`);
  await expect(page.getByLabel('Parcellation')).toHaveValue('beryl');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);

  await page.goto(`/?v=1&release=${encodeURIComponent(releaseId)}&feature=rms_ap.denoised&parcel=cosmos`);
  await expect(page.getByLabel('Parcellation')).toHaveValue('cosmos');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
});
