import { expect, test } from '@playwright/test';

test('header uses the official IBL Core negative lockup and palette', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const logo = page.getByAltText('IBL Core');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', '/brand/ibl-core-logo.svg');
  await expect(logo).toHaveAttribute('width', '240');
  await expect(logo).toHaveAttribute('height', '209');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ephys Atlas');

  await expect.poll(() => logo.evaluate((node: HTMLImageElement) => ({
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight,
  }))).toEqual({ complete: true, naturalWidth: 240, naturalHeight: 209 });

  expect(await page.locator('.app-header__brand').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator(':root').evaluate((node) => ({
    accent: getComputedStyle(node).getPropertyValue('--color-accent').trim(),
    blue: getComputedStyle(node).getPropertyValue('--color-brand-blue').trim(),
    cyan: getComputedStyle(node).getPropertyValue('--color-brand-cyan').trim(),
    magenta: getComputedStyle(node).getPropertyValue('--color-brand-magenta').trim(),
  }))).toEqual({ accent: '#009fd7', blue: '#004d89', cyan: '#009fd7', magenta: '#ce2c97' });

  const desktopLogo = await logo.boundingBox();
  expect(desktopLogo).not.toBeNull();
  expect(desktopLogo!.height).toBeGreaterThanOrEqual(39);
  expect(desktopLogo!.height).toBeLessThanOrEqual(44);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(logo).toBeVisible();
  expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBe(390);
  const phoneLogo = await logo.boundingBox();
  expect(phoneLogo).not.toBeNull();
  expect(phoneLogo!.height).toBeGreaterThanOrEqual(33);
  expect(phoneLogo!.height).toBeLessThanOrEqual(35);
});
