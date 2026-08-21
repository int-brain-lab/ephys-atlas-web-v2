import { expect, test } from '@playwright/test';

const RELEASE_PATH = '/fixtures/ephys_atlas_channels/golden-v0.3/';

test.beforeEach(async ({ page }) => {
  await page.route(`**${RELEASE_PATH}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`${RELEASE_PATH}manifest.json`)) {
      const response = await route.fetch();
      const manifest = await response.json();
      manifest.features.push({ id: 'linear_fixture', path: 'features/linear_fixture/feature.json' });
      await route.fulfill({ response, json: manifest });
      return;
    }
    if (url.pathname.endsWith(`${RELEASE_PATH}features/rms_ap/feature.json`)) {
      const response = await route.fetch();
      const feature = await response.json();
      feature.display = { scale: 'log' };
      await route.fulfill({ response, json: feature });
      return;
    }
    if (url.pathname.includes(`${RELEASE_PATH}features/linear_fixture/`)) {
      const sourceUrl = url.toString().replace('/features/linear_fixture/', '/features/rms_ap/');
      const response = await route.fetch({ url: sourceUrl });
      if (url.pathname.endsWith('/feature.json')) {
        const feature = await response.json();
        feature.id = 'linear_fixture';
        feature.label = 'Linear color fixture';
        delete feature.display;
        await route.fulfill({ response, json: feature });
      } else {
        await route.fulfill({ response });
      }
      return;
    }
    await route.continue();
  });
});

test('feature display metadata selects the automatic color scale and URL overrides persist', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');

  const scale = page.getByLabel('Color scale');
  await expect(scale).toHaveValue('auto');
  await expect(scale.locator('option:checked')).toHaveText('Auto (Logarithmic)');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();

  const feature = page.locator('[data-context-field="feature"]');
  await feature.locator('.context-menu__trigger').click();
  await feature.getByRole('option', { name: /Linear color fixture/ }).click();
  await expect(scale).toHaveValue('auto');
  await expect(scale.locator('option:checked')).toHaveText('Auto (Linear)');

  await scale.selectOption('log');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('log');
  await feature.locator('.context-menu__trigger').click();
  await feature.getByRole('option', { name: /AP RMS/ }).click();
  await expect(scale).toHaveValue('log');

  await scale.selectOption('linear');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBe('linear');
  await page.reload();
  await expect(page.getByLabel('Color scale')).toHaveValue('linear');

  await page.getByLabel('Color scale').selectOption('auto');
  await expect.poll(() => new URL(page.url()).searchParams.get('scale')).toBeNull();
  await expect(page.getByLabel('Color scale').locator('option:checked')).toHaveText('Auto (Logarithmic)');
});
