import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const archive = resolve(process.cwd(), '../fixtures/golden-v1.ibl-ephys-atlas.zip');

async function openImport(page: import('@playwright/test').Page): Promise<void> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
}

test('validated ZIP preview is read-only until confirmation and persists locally', async ({ page }) => {
  await page.goto('/');

  await openImport(page);
  const input = page.locator('.local-import__input');
  await expect(input).toHaveAttribute('accept', '.ibl-ephys-atlas.zip,application/zip');
  expect(await input.evaluate((node: HTMLInputElement) => ({ multiple: node.multiple, directory: 'webkitdirectory' in node && node.webkitdirectory })))
    .toEqual({ multiple: false, directory: false });
  await input.setInputFiles(archive);

  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Validation complete');
  await expect(dialog).toContainText('IBL Ephys Atlas v2 golden fixture');
  await expect(dialog).toContainText('golden_fixture');
  await expect(dialog).toContainText('golden-v1');
  await expect(dialog).toContainText('recipe golden-fixture-v1');
  await expect(dialog).toContainText('Regional, Volume');
  await expect(dialog).toContainText('Allen');

  const dataset = page.locator('[data-context-field="dataset"]');
  await expect(dataset.locator('.context-field__local-badge')).toBeHidden();
  await expect(dataset.locator('.context-field__value')).not.toContainText('Local datasets');

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('AP RMS');
  await expect(page.locator('.feature-summary')).toContainText('Observations11');
  await expect.poll(() => new URL(page.url()).searchParams.get('dataset')).toBe('local');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden_fixture@golden-v1');

  await page.route('**/__real-data/**', (route) => route.abort());
  await page.reload();
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('AP RMS');
  await expect(page.locator('.feature-summary')).toContainText('Observations11');
});

test('duplicate immutable local releases are rejected without replacing the stored release', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(archive);
  let dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();

  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(archive);
  dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already imported');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.reload();
  await expect(page.locator('[data-context-field="dataset"] .context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('AP RMS');
  await expect(page.locator('.feature-summary')).toContainText('Observations11');
});
