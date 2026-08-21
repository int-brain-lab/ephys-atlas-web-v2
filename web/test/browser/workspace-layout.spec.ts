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

test('feature summary prioritizes description space over statistic padding', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const description = page.locator('.feature-summary__description');
  const summary = page.locator('.feature-summary');
  const statistic = page.locator('.feature-summary__item').first();
  const descriptionStyles = await description.evaluate((node) => getComputedStyle(node));
  const descriptionBounds = await description.boundingBox();
  const summaryBounds = await summary.boundingBox();
  const statisticBounds = await statistic.boundingBox();

  expect(descriptionStyles.webkitLineClamp).toBe('4');
  expect(descriptionBounds).not.toBeNull();
  expect(summaryBounds).not.toBeNull();
  expect(statisticBounds).not.toBeNull();
  expect(descriptionBounds!.height).toBeGreaterThan(summaryBounds!.height);
  expect(statisticBounds!.height).toBeLessThan(60);
});
