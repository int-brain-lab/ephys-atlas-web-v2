import { expect, test } from '@playwright/test';

test('desktop workspace keeps projections compact enough for feature context', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(projections!.height).toBeLessThanOrEqual(405);
  expect(context!.height).toBeGreaterThanOrEqual(255);
  expect(context!.y).toBeGreaterThan(projections!.y + projections!.height);
});

test('tall desktop workspace gives excess height to feature context', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');

  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(projections!.height).toBeLessThanOrEqual(545);
  expect(context!.height).toBeGreaterThanOrEqual(400);
});

test('low browser zoom keeps feature context from overwhelming projections', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.goto('/');

  const projections = await page.locator('.slice-strip').boundingBox();
  const context = await page.locator('.context-strip').boundingBox();

  expect(projections).not.toBeNull();
  expect(context).not.toBeNull();
  expect(context!.height).toBeLessThanOrEqual(projections!.height);
});

test('feature summary balances description space with compact statistics', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Summary' }).click();

  const description = page.locator('.feature-summary__description');
  const statistic = page.locator('.feature-summary__item').first();
  const descriptionLineClamp = await description.evaluate((node) => (
    getComputedStyle(node).getPropertyValue('-webkit-line-clamp')
  ));
  const descriptionBounds = await description.boundingBox();
  const statisticBounds = await statistic.boundingBox();

  expect(descriptionLineClamp).toBe('4');
  expect(descriptionBounds).not.toBeNull();
  expect(statisticBounds).not.toBeNull();
  expect(descriptionBounds!.height).toBeGreaterThan(80);
  expect(statisticBounds!.height).toBeGreaterThanOrEqual(55);
  expect(statisticBounds!.height).toBeLessThan(60);
});
