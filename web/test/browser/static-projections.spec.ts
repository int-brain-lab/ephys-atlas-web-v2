import { expect, test } from '@playwright/test';

test('Top and Swanson share regional presentation, interaction, URL state, and maximize behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v=4&secondary=top');

  const secondary = page.locator('.secondary-view');
  const top = page.locator('[data-secondary-panel="top"]');
  await expect(page.getByRole('tab', { name: 'Top' })).toHaveAttribute('aria-selected', 'true');
  await expect(top).toBeVisible();
  await expect(top.locator('path')).toHaveCount(114);
  await expect(top.locator('.secondary-projection__notice')).toContainText('not scientific data');
  await expect(top.locator('.static-projection-viewport')).toHaveAttribute('data-synthetic-fixture', 'true');

  // Synthetic fixture paths intentionally overlap; the final path owns the hit target.
  const path = top.locator('path').last();
  await path.hover();
  await expect(path).toHaveClass(/is-highlighted/);
  await expect(top.locator('.region-tooltip')).toBeVisible();
  await path.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('selected')).toContain('-997');

  await page.getByRole('tab', { name: 'Swanson' }).click();
  const swanson = page.locator('[data-secondary-panel="swanson"]');
  await expect(swanson).toBeVisible();
  await expect(swanson.locator('path')).toHaveCount(808);
  await expect.poll(() => new URL(page.url()).searchParams.get('secondary')).toBe('swanson');

  await page.getByRole('button', { name: 'Maximize secondary panel' }).click();
  await expect(secondary).toHaveAttribute('data-maximized', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBe('secondary');
  await page.keyboard.press('Escape');
  await expect(secondary).toHaveAttribute('data-maximized', 'false');
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('static projections occupy the responsive secondary workspace without becoming slice views', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?v=4&secondary=top&compact=secondary');

  await expect(page.locator('.context-strip')).toBeVisible();
  await expect(page.locator('.slice-strip')).toBeHidden();
  await expect(page.locator('[data-secondary-panel="top"]')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Top' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Context', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-secondary-panel="top"] input[type="range"]')).toHaveCount(0);
});

test('volume features remain explicitly anatomy-only on affine-free static maps', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?v=4&feature=rms_ap&repr=volume&secondary=top&compact=secondary&cursor=25,25,25');

  const top = page.locator('[data-secondary-panel="top"]');
  await expect(top.locator('path')).toHaveCount(114);
  await expect(top.locator('.secondary-projection__notice')).toContainText('anatomy only');
  await expect(top.locator('canvas')).toHaveCount(0);
});

test('static-map failures stay isolated from the registered projection frames', async ({ page }) => {
  await page.route('**/static/top.isvg.gz', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/?v=4&secondary=top');

  await expect(page.locator('[data-secondary-panel="top"] .secondary-projection__notice')).toHaveText(
    'Static projection unavailable',
  );
  await expect(page.locator('[data-secondary-panel="top"] .projection-viewport__error')).toContainText('HTTP 503');
  await expect(page.locator('[data-slice-asset="projection-pack-v1"]')).toHaveCount(3);
});
