import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const archive = resolve(process.cwd(), '../fixtures/golden-v1.ibl-ephys-atlas.zip');

async function openImport(page: import('@playwright/test').Page): Promise<void> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
}

async function localKeys(page: import('@playwright/test').Page): Promise<{ manifests: string[]; resources: string[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('ibl-ephys-atlas-schema-v1-local', 1);
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['manifests', 'resources'], 'readonly');
    const keys = await Promise.all(['manifests', 'resources'].map((name) => new Promise<IDBValidKey[]>((resolveKeys, reject) => {
      const request = transaction.objectStore(name).getAllKeys();
      request.onsuccess = () => resolveKeys(request.result);
      request.onerror = () => reject(request.error);
    })));
    db.close();
    return { manifests: keys[0]!.map(String), resources: keys[1]!.map(String) };
  });
}

test('quota failure after queued resource writes rolls back both stores and remains retryable', async ({ page }) => {
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    let resourcePuts = 0;
    let failed = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'resources' && !failed && ++resourcePuts === 2) {
        failed = true;
        throw new DOMException('Synthetic mid-transaction quota exhaustion', 'QuotaExceededError');
      }
      return originalPut.apply(this, args);
    };
  });
  await page.goto('/');
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(archive);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog.getByRole('status')).toContainText('Validation complete');

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No partial import was kept');
  await expect.poll(() => localKeys(page)).toEqual({ manifests: [], resources: [] });

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-context-field="dataset"] .context-field__local-badge')).toBeVisible();
  await expect.poll(() => localKeys(page)).toEqual(expect.objectContaining({
    manifests: ['golden_fixture@golden-v1'],
  }));
  await page.reload();
  await expect(page.locator('.feature-summary')).toContainText('Observations11');
});
