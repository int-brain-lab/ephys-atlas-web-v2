import { expect, test } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide' },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact' },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact' },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow' },
  { name: 'phone', width: 390, height: 844, layout: 'phone' },
] as const;

for (const viewport of reviewViewports) {
  test(`phase 1 shell: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const app = page.locator('.atlas-app');
    await expect(app).toHaveAttribute('data-layout', viewport.layout);
    await expect(page.getByRole('heading', { name: 'IBL Ephys Atlas' })).toBeVisible();
    await expect(page.getByLabel('Atlas workspace')).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);

    if (viewport.width >= 1480) {
      await expect(page.getByLabel('Brain regions')).toBeVisible();
      await expect(page.getByLabel('Visualization settings')).toBeVisible();
      await expect(page.getByLabel('coronal view')).toBeVisible();
      await expect(page.getByLabel('sagittal view')).toBeVisible();
      await expect(page.getByLabel('horizontal view')).toBeVisible();
    } else if (viewport.width >= 1100) {
      await expect(page.getByLabel('Brain regions')).toBeVisible();
      await expect(page.getByLabel('Visualization settings')).not.toBeInViewport();
    } else {
      await expect(page.getByRole('button', { name: 'Coronal' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('coronal view')).toBeVisible();
      await expect(page.getByLabel('sagittal view')).not.toBeVisible();
      await page.getByRole('button', { name: 'Sagittal' }).click();
      await expect(page.getByLabel('sagittal view')).toBeVisible();
    }

    await page.screenshot({ path: `test-results/phase1-${viewport.name}-${viewport.width}x${viewport.height}.png`, fullPage: true });
  });
}

test('drawers close on Escape and do not survive composition changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Visualization settings')).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Visualization settings')).toHaveAttribute('data-open', 'false');

  await page.getByRole('button', { name: 'Regions' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Brain regions')).toHaveAttribute('data-open', 'false');
});
