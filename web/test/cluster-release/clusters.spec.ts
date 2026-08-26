import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const releaseRoot = path.resolve(
  '../data/releases/ephys_atlas_clusters/sha256-9b5e55215b306f26-hist-axis-v1',
);
const releaseId = path.basename(releaseRoot);

type FeatureDescriptor = {
  id: string;
  label: string;
  description: string;
  unit: string | null;
};

async function loadFeatures(): Promise<FeatureDescriptor[]> {
  const manifest = JSON.parse(
    await readFile(path.join(releaseRoot, 'manifest.json'), 'utf8'),
  ) as { features: Array<{ descriptor: { resource: { path: string } } }> };
  return Promise.all(manifest.features.map(async ({ descriptor }) => JSON.parse(
    await readFile(path.join(releaseRoot, descriptor.resource.path), 'utf8'),
  ) as FeatureDescriptor));
}

test.beforeEach(async ({ page }) => {
  await stat(path.join(releaseRoot, 'manifest.json'));
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('serves the complete approved catalog dynamically', async ({ page }) => {
  const features = await loadFeatures();
  expect(features).toHaveLength(14);
  await page.goto('/');

  await expect(page.locator('[data-context-field="dataset"] .context-field__release')).toHaveText(
    releaseId,
  );
  const featureMenu = page.locator('[data-context-field="feature"]');
  await featureMenu.locator('.context-menu__trigger').click();
  await expect(featureMenu.getByRole('option')).toHaveCount(features.length);
  await page.keyboard.press('Escape');

  for (const descriptor of features) {
    await featureMenu.locator('.context-menu__trigger').click();
    await featureMenu.getByLabel('Search features…').fill(descriptor.label);
    const option = featureMenu.getByRole('option').filter({
      hasText: descriptor.description,
    });
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(descriptor.description);
    if (descriptor.unit) await expect(option).toContainText(descriptor.unit);
    await option.click();
    await expect(page.locator('.feature-summary__description')).toHaveText(
      descriptor.description,
    );
    await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
    await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  }
});

test('switches every approved parcellation without cluster-specific UI', async ({ page }) => {
  await page.goto('/');
  const representation = page.locator('[data-context-field="representation"]');
  for (const parcellation of ['Allen', 'Beryl', 'Cosmos']) {
    await representation.locator('.context-menu__trigger').click();
    await representation.getByRole('option', { name: new RegExp(`^${parcellation}`) }).click();
    await expect(
      page.locator('[data-context-field="representation"] .context-field__value'),
    ).toHaveText(`Regional · ${parcellation}`);
    await expect(page.locator('.distribution-chart__bin')).toHaveCount(50);
    await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBeGreaterThan(0);
  }
});

test('exposes approved units, explanations, and conservative scale defaults', async ({ page }) => {
  await page.goto('/?v=4&feature=firing_rate');
  const distribution = page.locator('.distribution-chart');
  const compactDistribution = page.locator('.color-legend__bar');
  await expect(distribution).toHaveAttribute('data-axis-scale', 'log');
  await expect(compactDistribution).toHaveAttribute('data-axis-scale', 'log');
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Linear', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Linear', exact: true }).click();
  await expect(distribution).toHaveAttribute('data-axis-scale', 'linear');
  await expect(compactDistribution).toHaveAttribute('data-axis-scale', 'linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('select[aria-label="Value scale"]')).toHaveValue('linear');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(distribution).toHaveAttribute('data-axis-scale', 'log');
  await expect(compactDistribution).toHaveAttribute('data-axis-scale', 'log');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('log');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('select[aria-label="Value scale"]')).toHaveValue('log');
  await expect(page.locator('.color-legend__unit')).toHaveText('Hz');

  await page.goto('/?v=4&feature=noise_cutoff');
  await expect(page.locator('.distribution-chart')).toHaveAttribute('data-axis-scale', 'linear');
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('select[aria-label="Value scale"] option:checked')).toHaveText(
    'Auto (Linear)',
  );
  await expect(page.locator('select[aria-label="Value scale"] option[value="log"]')).toBeDisabled();
  await expect(page.locator('.color-legend__unit')).toHaveText('a.u.');
  await expect(page.locator('.feature-summary__description')).toContainText(
    'Signed standardized amplitude-histogram cutoff score',
  );

  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Info' }).click();
  const info = page.getByRole('dialog', { name: 'Dataset information' });
  await expect(info).toContainText('ephys-atlas-clusters-regional-v1');
  await expect(info).toContainText('Legacy website cluster feature catalog and unit metadata');
  await expect(info).toContainText('1d908bea095be2616a750d939d143f3b4db2a641');
  await expect(info).toContainText('none (all clusters)');
});
