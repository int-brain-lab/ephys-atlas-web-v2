import { expect, test } from '@playwright/test';

test('context selector and view actions stay on one compact row in narrow panels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/?v=4&secondary=top');
  const frame = page.locator('.secondary-view');
  const header = frame.locator('.secondary-view__header');
  await expect(header.getByRole('combobox', { name: 'Context view' })).toHaveValue('top');
  for (const width of [250, 320, 480]) {
    await frame.evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
    const bounds = await header.boundingBox();
    for (const button of await header.locator('button:visible').all()) {
      const rect = await button.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    }
    const selector = await header.getByRole('combobox', { name: 'Context view' }).boundingBox();
    const maximize = await header.getByRole('button', { name: 'Maximize secondary panel' }).boundingBox();
    expect(Math.abs(selector!.y + selector!.height / 2 - maximize!.y - maximize!.height / 2)).toBeLessThan(1);
    expect(bounds!.height).toBeLessThan(50);
  }
  await header.getByRole('combobox', { name: 'Context view' }).selectOption({ label: 'Swanson' });
  await expect(header.getByRole('combobox', { name: 'Context view' })).toHaveValue('swanson');
});
