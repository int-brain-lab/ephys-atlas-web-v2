import { expect, test } from '@playwright/test';

for (const outcome of ['ready', 'error'] as const) {
  test(`feature updating feedback lasts through numeric loading: ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/features/rms_ap/volume/chunks/**', async (route) => {
      await gate;
      if (outcome === 'error') await route.fulfill({ status: 503, body: 'Unavailable' });
      else await route.continue();
    });
    await page.goto('/app/?v=4&cursor=25,25,25');
    const frame = page.locator('[data-view="coronal"]');
    const renderer = frame.locator('.view-frame__renderer');
    await expect(renderer).toHaveAttribute('data-slice-asset', 'projection-pack-v1');
    await expect(frame).toHaveAttribute('aria-busy', 'false');
    const previous = await renderer.locator('svg').first().innerHTML();
    const display = page.locator('[data-context-field="representation"]');
    await display.locator('.context-menu__trigger').click();
    await display.getByRole('option', { name: /Volume/ }).click();
    await expect(frame).toHaveAttribute('aria-busy', 'true');
    await expect(frame.locator('.view-frame__status')).toHaveText('Updating…');
    await expect(renderer).toHaveAttribute('data-slice-asset', 'projection-pack-v1');
    expect(await renderer.locator('svg').first().innerHTML()).toBe(previous);
    release();
    await expect(frame).toHaveAttribute('aria-busy', 'false');
    if (outcome === 'ready') {
      await expect(renderer).toHaveAttribute('data-slice-asset', 'schema-volume-v1');
      await expect(frame.locator('.view-frame__status')).toHaveText('');
    } else {
      await expect(frame.locator('.view-frame__status')).toHaveText('Anatomy only');
      await expect(renderer.locator('.projection-viewport__error')).toBeVisible();
    }
  });
}
