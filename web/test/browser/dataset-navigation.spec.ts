import { expect, test } from '@playwright/test';

test('desktop project and dataset controls disclose edition and exact release context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden-v1');

  const project = page.locator('[data-context-field="project"]');
  const dataset = page.locator('[data-context-field="dataset"]');
  const view = page.locator('[data-context-field="representation"]');
  await expect(project.locator('.context-field__value')).toHaveText('Synthetic development data');
  await expect(project.locator('.context-field__release')).toHaveText('Custom versions');
  await expect(view.locator('.context-field__label')).toHaveText('View');

  await dataset.locator('.context-menu__trigger').click();
  const exactRelease = dataset.getByRole('option', { name: /Synthetic golden-v1/ });
  await expect(exactRelease).toContainText('Development');
  await expect(exactRelease).toContainText('Immutable release ID · golden-v1');
  await page.keyboard.press('Escape');

  const initialHistoryLength = await page.evaluate(() => history.length);
  await project.locator('.context-menu__trigger').click();
  await project.getByRole('option', { name: /Synthetic current edition/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBeNull();
  await expect(project.locator('.context-field__release')).toHaveText('Synthetic current edition');

  await project.locator('.context-menu__trigger').click();
  await project.getByRole('option', { name: /Browse custom versions/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('context')).toBe('custom');
  await expect.poll(() => new URL(page.url()).searchParams.get('base_edition')).toBe('synthetic-current');
  await expect(project.locator('.context-field__release'))
    .toHaveText('Custom versions · based on Synthetic current edition');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 2);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('edition')).toBe('synthetic-current');
  await expect(project.locator('.context-field__release')).toHaveText('Synthetic current edition');
});
