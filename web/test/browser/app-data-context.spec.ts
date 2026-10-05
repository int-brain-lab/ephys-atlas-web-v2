import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('share, download and info expose the immutable scientific context', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { __copiedUrl?: string }).__copiedUrl = value; } },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&feature=rms_ap&stat=median');
  const actions = page.locator('.app-header__desktop-actions');

  await actions.getByRole('button', { name: 'Share' }).click();
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __copiedUrl?: string }).__copiedUrl)).toBe(page.url());

  await actions.getByRole('button', { name: 'Data details' }).click();
  const info = page.getByRole('dialog', { name: 'Data details' });
  await expect(info).toBeVisible();
  await expect(info).toContainText('Synthetic test fixture');
  await expect(info).toContainText('golden-v1');
  await expect(info).toContainText('AP RMS (golden fixture)');
  await expect(info).toContainText('dB rel. V');
  await expect(info).toContainText('golden-fixture-v1');
  await expect(info).toContainText('Deterministic synthetic fixture seed');
  await info.getByRole('button', { name: 'Close' }).click();

  await actions.getByRole('button', { name: 'Download' }).click();
  const downloads = page.getByRole('dialog', { name: 'Download feature data' });
  await expect(downloads).toContainText('Human-readable regional fixture values');
  const downloadPromise = page.waitForEvent('download');
  await downloads.getByRole('button', { name: /Export Allen Median as CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('golden_fixture-golden-v1-rms_ap-allen-median.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('dataset_id,release_id,feature_id,representation,parcellation,statistic,unit,region_id,acronym,region_name,value');
  expect(csv).toContain('golden_fixture,golden-v1,rms_ap,regional,allen,median,dB rel. V');
});

test('Data details confines release limitations to provenance notes', async ({ page }) => {
  const manifest = JSON.parse(await readFile('../fixtures/golden-v1/manifest.json', 'utf8'));
  manifest.provenance.notes = [
    'Original source values were preserved without denoising or anatomical masking.',
    'Registration is provisional and remains subject to scientific review.',
  ];
  const manifestBody = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(manifestBody);
  const manifestResource = {
    bytes: manifestBytes,
    sha256: createHash('sha256').update(manifestBody).digest('hex'),
    codec: { name: 'none', decoded_bytes: manifestBytes },
  };
  await page.route('**/__real-data/catalog.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    Object.assign(catalog.datasets[0].releases[0].manifest, manifestResource);
    await route.fulfill({ json: catalog });
  });
  await page.route('**/__real-data/**/manifest.json', async (route) => {
    await route.fulfill({ body: manifestBody, contentType: 'application/json' });
  });
  await page.goto('/app/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.app-header')).not.toContainText('Registration is provisional');
  await expect(page.getByRole('main')).not.toContainText('Registration is provisional');
  await page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Data details' }).click();
  const info = page.getByRole('dialog', { name: 'Data details' });
  await expect(info.getByRole('heading', { name: 'Release notes' })).toBeVisible();
  await expect(info).toContainText('Original source values were preserved without denoising or anatomical masking.');
  await expect(info).toContainText('Registration is provisional and remains subject to scientific review.');
});

