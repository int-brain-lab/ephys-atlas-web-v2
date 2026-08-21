import { expect, test } from '@playwright/test';

test('desktop workspace reserves more height for feature context than projections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(projections!.height).toBeLessThan(460);
  expect(context!.height).toBeGreaterThanOrEqual(230);
  expect(context!.y).toBeGreaterThan(projections!.y + projections!.height);
});
