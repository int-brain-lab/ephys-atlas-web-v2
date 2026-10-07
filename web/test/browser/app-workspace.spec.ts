import { expect, test } from '@playwright/test';

test('intermediate header actions do not cover the representation menu', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/app/');

  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await expect(representation.locator('.context-menu__panel')).toBeVisible();
  await expect(page.locator('.app-header__desktop-actions')).toBeHidden();
  await expect(page.locator('.app-header__overflow')).toBeVisible();
});

test('view maximize is reversible with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/');

  const frame = page.locator('[data-view="coronal"]');
  await page.getByRole('button', { name: 'Maximize coronal view' }).click();
  await expect(frame).toHaveAttribute('data-maximized', 'true');
  await expect(page.locator('.atlas-app')).toHaveAttribute('data-maximized-view', 'coronal');
  await expect(page.locator('.app-header')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.app-header__actions')).toHaveAttribute('inert', '');
  await expect(page.locator('.drawer-backdrop')).toHaveCSS('pointer-events', 'auto');
  const colorbar = frame.locator('.frame-colorbar');
  await expect(colorbar).toBeVisible();
  await expect(colorbar.locator('.frame-colorbar__bar')).toHaveCSS('background-image', /linear-gradient/);
  await expect(page.locator('[data-view="sagittal"] .frame-colorbar')).toBeHidden();
  const representation = page.locator('[data-context-field="representation"]');
  await representation.locator('.context-menu__trigger').click();
  await expect(representation.locator('.context-menu__panel')).toBeVisible();
  await representation.locator('.context-menu__trigger').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBe('coronal');
  await page.keyboard.press('Escape');
  await expect(frame).toHaveAttribute('data-maximized', 'false');
  await expect(page.locator('.atlas-app')).not.toHaveAttribute('data-maximized-view', /.+/);
  await expect(colorbar).toBeHidden();
  await expect(page.locator('.app-header__actions')).not.toHaveAttribute('inert', '');
  await expect.poll(() => new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('holding A peeks at anatomy colours over regional feature fills', async ({ page }) => {
  await page.goto('/app/');
  const region = page.locator('[data-view="coronal"] path[data-allen-id="-362"]').first();
  const fill = () => region.evaluate((element) => getComputedStyle(element).fill);
  await expect.poll(fill).not.toBe('');
  const featureFill = await fill();
  const anatomyFill = await region.evaluate((element) => (element as SVGElement).style.getPropertyValue('--anatomy-fill'));
  expect(anatomyFill).not.toBe('');
  await page.keyboard.down('a');
  await expect.poll(fill).not.toBe(featureFill);
  await page.keyboard.up('a');
  await expect.poll(fill).toBe(featureFill);
});

test('compact workspace selection hydrates and persists independently', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/app/?v=4&compact=secondary');
  await expect(page.locator('.context-strip')).toBeVisible();
  await expect(page.locator('.slice-strip')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Context' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Sagittal' }).click();
  await expect(page.locator('[data-view="sagittal"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('compact')).toBe('sagittal');
  await expect(new URL(page.url()).searchParams.get('max')).toBeNull();
});

test('projection pack failure is an explicit view-frame error state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/registered/coronal/*.isvg.gz', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/app/');
  await expect(page.locator('[data-view="coronal"]')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-view="coronal"] .view-frame__status')).toHaveText('Unavailable');
});

test('drawers still close on Escape and composition changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/app/');
  const settings = page.getByRole('complementary', { name: 'Visualization settings' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveAttribute('data-open', 'false');
  await page.getByRole('button', { name: 'Regions' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('complementary', { name: 'Brain regions' })).toHaveAttribute('data-open', 'false');
});

