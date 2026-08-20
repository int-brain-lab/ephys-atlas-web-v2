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

test('wide header keeps long feature and representation context legible', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto('/?feature=aperiodic_exponent.denoised');

  const feature = page.locator('[data-context-field="feature"] .context-field__value');
  const representation = page.locator('[data-context-field="representation"] .context-field__value');
  const registration = page.locator('[data-context-field="representation"] .context-field__release');
  await expect(feature).toHaveText('aperiodic exponent (denoised)');
  await expect(representation).toHaveText('Regional · Allen');
  await expect(registration).toHaveText('Allen CCFv3 · 10 µm');
  for (const field of [feature, representation, registration]) {
    expect(await field.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

test('uses the immutable release and approved denoised feature as development defaults', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(releaseId);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText('rms ap (denoised)');
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await expect(dataset.getByRole('option', { selected: true })).toContainText(releaseId);
  await page.keyboard.press('Escape');
  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await expect(feature.getByRole('option')).toHaveCount(70);
  await expect(feature.getByRole('option', { selected: true })).toContainText('rms ap (denoised)');
  await page.keyboard.press('Escape');
  const view = page.locator('[data-context-field="representation"]');
  await view.locator('.context-menu__trigger').click();
  await expect(view.getByRole('option').filter({ hasText: /Allen|Beryl|Cosmos/ })).toHaveCount(3);
  await expect(view.getByRole('option', { selected: true })).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  expect(new URL(page.url()).searchParams.get('release')).toBeNull();
  expect(new URL(page.url()).searchParams.get('feature')).toBeNull();
});

test('loads real float64 alpha values and all launch parcellations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await feature.getByLabel('Search features, units, or IDs').fill('alpha_mean.raw');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await feature.getByRole('option').click();

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(releaseId);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText('alpha mean (raw)');
  await expect(page.locator('[data-context-field="representation"] .context-field__value')).toHaveText('Regional · Allen');
  await expect.poll(() => new URL(page.url()).searchParams.get('feature')).toBe('alpha_mean.raw');
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);

  const firstRegion = page.locator('.region-row[data-missing="false"] button').first();
  await firstRegion.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).not.toBeNull();
  await expect(page.locator('.selected-region')).toHaveCount(1);

  const view = page.locator('[data-context-field="representation"]');
  await view.locator('.context-menu__trigger').click();
  await view.getByRole('option', { name: /^Beryl/ }).click();
  await expect(page.locator('[data-context-field="representation"] .context-field__value')).toHaveText('Regional · Beryl');
  await expect.poll(() => new URL(page.url()).searchParams.get('parcel')).toBe('beryl');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);

  await view.locator('.context-menu__trigger').click();
  await view.getByRole('option', { name: /^Cosmos/ }).click();
  await expect(page.locator('[data-context-field="representation"] .context-field__value')).toHaveText('Regional · Cosmos');
  await expect.poll(() => new URL(page.url()).searchParams.get('parcel')).toBe('cosmos');
  await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
});
