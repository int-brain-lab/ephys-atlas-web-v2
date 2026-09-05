import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const regionalRoute = '/?v=4&dataset=golden_fixture&release=golden-v1&project=synthetic-development&context=custom&selected=-477,-803&scale=symlog&dist=focused';
const archive = resolve(process.cwd(), '../fixtures/golden-v1.ibl-ephys-atlas.zip');
const canonicalPixelPlatform = process.platform === 'linux';

async function waitForViewer(page: Page): Promise<void> {
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-layout', 'wide');
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    await expect(page.getByRole('region', { name: `${axis} view` })).toHaveAttribute('data-state', 'ready');
  }
  await expect(page.locator('.distribution-chart')).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }
    `,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(regionalRoute);
  await waitForViewer(page);
});

test('desktop overview', async ({ page }) => {
  test.skip(!canonicalPixelPlatform, 'canonical documentation pixels are generated and checked on Linux');
  await expect(page).toHaveScreenshot('desktop-overview.png', { fullPage: true });
});

test('linked anatomical views', async ({ page }) => {
  test.skip(!canonicalPixelPlatform, 'canonical documentation pixels are generated and checked on Linux');
  await expect(page.getByRole('region', { name: 'Orthogonal brain slices' }))
    .toHaveScreenshot('linked-anatomical-views.png');
});

test('encoding and distribution controls', async ({ page }) => {
  test.skip(!canonicalPixelPlatform, 'canonical documentation pixels are generated and checked on Linux');
  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('Value scale')).toHaveValue('symlog');
  await expect(settings.getByLabel('Distribution domain')).toHaveValue('focused');
  await expect(page.getByRole('region', { name: 'Compare selected regions' })).toContainText('2');
  await expect(page.getByRole('main')).toHaveScreenshot('encoding-and-distribution-controls.png');
});

test('local import preview', async ({ page }) => {
  test.skip(!canonicalPixelPlatform, 'canonical documentation pixels are generated and checked on Linux');
  const dataset = page.locator('[data-context-field="data"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
  await page.getByLabel('Local dataset ZIP archive').setInputFiles(archive);

  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog.getByRole('status')).toContainText('Validation complete');
  await expect(dialog.locator('[data-local-import-preview]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await expect(dialog).toHaveScreenshot('local-import-preview.png');
});
