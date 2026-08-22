import { expect, test } from '@playwright/test';

test('browser history checkpoints context changes but not slice refinements', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const context = page.locator('[data-context-field="representation"]');
  const trigger = context.locator('.context-menu__trigger');
  await expect(trigger).toContainText('Regional');
  const initialHistoryLength = await page.evaluate(() => window.history.length);

  await trigger.click();
  await context.getByRole('option', { name: /Volume/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBe('volume');
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(initialHistoryLength + 1);

  await page.getByLabel('coronal slice').fill('83');
  await expect.poll(() => new URL(page.url()).searchParams.get('cursor')).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(initialHistoryLength + 1);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBeNull();
  await expect(trigger).toContainText('Regional');

  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBe('volume');
  await expect(trigger).toContainText('Volume');
  await expect(page.getByLabel('coronal slice')).toHaveValue('83');
});
