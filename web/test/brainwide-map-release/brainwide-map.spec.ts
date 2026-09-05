import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const releaseRoot = path.resolve(
  process.env.EPHYS_ATLAS_BRAINWIDE_MAP_RELEASE
    ?? '../data/releases/brainwide_map/legacy-v1-1d908bea-d050-q14-linear-full-v1',
);
const releaseId = path.basename(releaseRoot);

test.beforeEach(async ({ page }) => {
  await stat(path.join(releaseRoot, 'manifest.json'));
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('local catalog exposes the complete preserved Beryl release', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-context-field="data"] .context-field__value')).toHaveText(
    'Brain-Wide Map / Preserved legacy results',
  );
  await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Data details' }).click();
  const release = page.getByRole('dialog', { name: 'Data details' });
  await expect(release).toContainText('Local preview');
  await expect(release.getByRole('region', { name: 'Data version' })).toContainText(releaseId);
  await expect(release).not.toContainText('Synthetic');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText(
    'choice decoding significant',
  );
  await expect(page.locator('[data-context-field="representation"] .context-field__value')).toHaveText(
    'Regional · Beryl',
  );
  await expect(page.locator('.distribution-chart')).toHaveAttribute('data-axis-scale', 'linear');
  await expect(page.locator('.distribution-chart')).toHaveAttribute('data-distribution-domain', 'full');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('select[aria-label="Value scale"] option:checked')).toHaveText('Auto (Linear)');
  await expect(page.locator('select[aria-label="Distribution domain"] option:checked')).toHaveText('Auto (Full)');
  await expect(page.locator('select[aria-label="Value scale"] option[value="log"]')).toHaveAttribute('disabled', '');
  await page.getByRole('button', { name: 'Close Visualization settings' }).click();

  const dataset = page.locator('[data-context-field="data"]');
  await dataset.locator('.context-menu__trigger').click();
  await expect(dataset.getByRole('option', { selected: true }).locator('.context-menu__option-label')).toHaveText(
    'Preserved legacy results',
  );
  await page.keyboard.press('Escape');
  await expect(dataset).toContainText('Preserved legacy data');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await expect(feature.getByRole('option')).toHaveCount(30);
  await expect(feature.getByRole('option', { selected: true })).toContainText(
    'choice decoding significant',
  );
  await page.keyboard.press('Escape');

  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await expect(representation.getByRole('option')).toHaveCount(2);
  await expect(representation.getByRole('option', { name: /^Regional/ })).toBeVisible();
  await expect(representation.getByRole('option', { name: /^Beryl/ })).toBeVisible();
  await expect(representation.getByRole('option', { name: /^Allen|^Cosmos/ })).toHaveCount(0);
});

test('legacy significance values and provenance survive the HTTP browser path', async ({ page }) => {
  await page.goto('/');

  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBe(201);
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-total', '201');
  await expect(page.locator('.feature-summary')).toContainText('201');
  await expect(page.locator('.feature-summary')).toContainText('0.9279');
  await expect(page.locator('.region-row[data-region-id="-589508455"] .region-row__value')).toHaveAttribute(
    'aria-label',
    'mean 1',
  );
  await expect(page.locator('.region-row[data-region-id="-589508447"] .region-row__value')).toHaveAttribute(
    'aria-label',
    'mean 0.5',
  );

  await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Data details' }).click();
  const info = page.getByRole('dialog', { name: 'Data details' });
  await expect(info).toContainText('Immutable development release');
  await expect(info).toContainText('not a regeneration from a current Brain-Wide Map paper release');
  await expect(info).toContainText('legacy boolean presentation: false=0.5, true=1.0');
  await expect(info).toContainText('brainwide-map-legacy-website-regional-v1');
  await expect(info).toContainText('Pinned v1 website Brain-Wide Map generator');
  await expect(info).toContainText('1d908bea095be2616a750d939d143f3b4db2a641');
});

test('feature switching and download retain immutable BWM context', async ({ page }) => {
  await page.goto('/');

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await feature.getByLabel('Search features…').fill('wheel velocity glm effect');
  await expect(feature.getByRole('option')).toHaveCount(1);
  await feature.getByRole('option').click();

  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toHaveText(
    'wheel velocity glm effect',
  );
  await expect.poll(() => new URL(page.url()).searchParams.get('feature')).toBe(
    'wheel_velocity_glm_effect',
  );
  await expect.poll(() => page.locator('.region-row[data-missing="false"]').count()).toBe(210);
  await expect(page.locator('.distribution-chart__global')).toHaveAttribute('data-total', '210');

  await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Download' }).click();
  const downloads = page.getByRole('dialog', { name: 'Download feature data' });
  const downloadPromise = page.waitForEvent('download');
  await downloads.getByRole('button', { name: /Export Beryl Mean as CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `brainwide_map-${releaseId}-wheel_velocity_glm_effect-beryl-mean.csv`,
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, 'utf8');
  expect(csv).toContain(
    `brainwide_map,${releaseId},wheel_velocity_glm_effect,regional,beryl,mean`,
  );
});
