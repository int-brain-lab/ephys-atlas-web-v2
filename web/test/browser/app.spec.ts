import { expect, test } from '@playwright/test';

const reviewViewports = [
  { name: 'wide-desktop', width: 1680, height: 1050, layout: 'wide', body: { x: 8, y: 72, width: 1664, height: 970 } },
  { name: 'compact-desktop', width: 1440, height: 900, layout: 'compact', body: { x: 8, y: 72, width: 1424, height: 820 } },
  { name: 'compact-laptop', width: 1280, height: 800, layout: 'compact', body: { x: 8, y: 72, width: 1264, height: 720 } },
  { name: 'tablet', width: 1024, height: 768, layout: 'narrow', body: { x: 8, y: 72, width: 1008, height: 688 } },
  { name: 'phone', width: 390, height: 844, layout: 'phone', body: { x: 4, y: 60, width: 382, height: 780 } },
] as const;

for (const viewport of reviewViewports) {
  test(`phase 2 context header: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const app = page.locator('.atlas-app');
    await expect(app).toHaveAttribute('data-layout', viewport.layout);
    await expect(page.getByRole('heading', { name: 'IBL Ephys Atlas' })).toBeVisible();
    await expect(page.getByLabel('Atlas workspace')).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);
    await expect(page.locator('body')).toHaveJSProperty('scrollHeight', viewport.height);

    await expect(page.locator('[data-context-field="dataset"]')).toContainText('Ephys Atlas channels (fixture)');
    await expect(page.locator('[data-context-field="feature"]')).toContainText('Firing rate');
    await expect(page.locator('[data-context-field="representation"]')).toContainText('Regional');

    // Phase 1 has been visually approved. Its macro geometry is now a browser-regression
    // contract while Phase 2 intentionally changes only the context header.
    expect(await page.locator('.app-body').boundingBox()).toEqual(viewport.body);

    if (viewport.width >= 1480) {
      await expect(page.getByLabel('Brain regions')).toBeVisible();
      await expect(page.getByLabel('Visualization settings')).toBeVisible();
      await expect(page.getByLabel('coronal view')).toBeVisible();
      await expect(page.getByLabel('sagittal view')).toBeVisible();
      await expect(page.getByLabel('horizontal view')).toBeVisible();
    } else if (viewport.width >= 1100) {
      await expect(page.getByLabel('Brain regions')).toBeVisible();
      await expect(page.getByLabel('Visualization settings')).not.toBeInViewport();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Regions' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Coronal' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('coronal view')).toBeVisible();
      await expect(page.getByLabel('sagittal view')).not.toBeVisible();
      await page.getByRole('button', { name: 'Sagittal' }).click();
      await expect(page.getByLabel('sagittal view')).toBeVisible();
    }

    await page.screenshot({ path: `test-results/phase2-${viewport.name}-${viewport.width}x${viewport.height}.png`, fullPage: true });
  });
}

test('phone keeps context visible and collapses secondary actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('[data-context-field="dataset"]')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"]')).toBeVisible();
  await expect(page.locator('[data-context-field="representation"]')).toBeVisible();
  await expect(page.locator('.app-header__desktop-actions')).not.toBeVisible();

  const more = page.locator('.app-header__overflow-trigger');
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('.app-header__overflow-menu')).toBeVisible();
  await expect(page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(page.locator('.app-header__overflow-menu').getByRole('button', { name: 'Info' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.app-header__overflow-menu')).not.toBeVisible();
});

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
