import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const archive = resolve(process.cwd(), '../fixtures/golden-v1.ibl-ephys-atlas.zip');
const authoredArchive = resolve(process.cwd(), '../fixtures/authored-regional-v1.ibl-ephys-atlas.zip');
const authoredVolumeArchive = resolve(process.cwd(), '../fixtures/authored-volume-v1.ibl-ephys-atlas.zip');

async function openImport(page: import('@playwright/test').Page): Promise<void> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
}

async function importArchive(page: import('@playwright/test').Page, path: string): Promise<void> {
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog.getByRole('status')).toContainText('Validation complete');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openManager(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Manage local datasets…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Local datasets' });
  await expect(dialog.getByRole('status')).not.toContainText('Inspecting');
  return dialog;
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

test('a bundle generated by the public regional authoring API imports through the real browser path', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(authoredArchive);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog).toContainText('Public authoring regional fixture');
  await expect(dialog).toContainText('decision_signal');
  await expect(dialog).toContainText('ibl-ephys-atlas-regional-authoring-v1');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page.locator('[data-context-field="dataset"] .context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('Decision signal');
  await expect(page.locator('.feature-summary')).toContainText('Observations4');
});

test('a public-authored synthetic volume imports, renders, navigates, and reloads from IndexedDB', async ({ page }) => {
  const scientificHttpRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('authored_volume_fixture') || path.includes('synthetic_gradient')) {
      scientificHttpRequests.push(request.url());
    }
  });
  await page.goto('/');
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(authoredVolumeArchive);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await expect(dialog.getByRole('status')).toContainText('Validation complete');
  await expect(dialog).toContainText('Public authoring volume fixture');
  await expect(dialog).toContainText('authored_volume_fixture');
  await expect(dialog).toContainText('authored-volume-v1');
  await expect(dialog).toContainText('synthetic_gradient');
  await expect(dialog).toContainText('ibl-ephys-atlas-volume-authoring-v1');
  await expect(dialog).toContainText('Volume');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  const dataset = page.locator('[data-context-field="dataset"]');
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-context-field="feature"] .context-field__value'))
    .toContainText('Synthetic volume gradient');
  await expect.poll(() => new URL(page.url()).searchParams.get('dataset')).toBe('local');
  await expect.poll(() => new URL(page.url()).searchParams.get('release'))
    .toBe('authored_volume_fixture@authored-volume-v1');
  await expect.poll(() => new URL(page.url()).searchParams.get('repr')).toBe('volume');

  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('cursor', '-5689,5350,232');
    url.searchParams.set('secondary', 'summary');
    history.replaceState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  for (const [axis, width, height] of [
    ['coronal', 3, 4],
    ['sagittal', 2, 4],
    ['horizontal', 3, 2],
  ] as const) {
    const renderer = page.locator(`[data-view="${axis}"] .view-frame__renderer`);
    await expect(renderer).toHaveAttribute('data-slice-asset', 'schema-volume-v1');
    await expect(renderer).toHaveAttribute('data-volume-feature', 'synthetic_gradient');
    const canvas = renderer.locator('canvas.view-frame__volume-canvas');
    await expect(canvas).toBeAttached();
    await expect(canvas).toHaveJSProperty('width', width);
    await expect(canvas).toHaveJSProperty('height', height);
  }
  const summary = page.locator('.secondary-view__summary');
  await expect(summary).toContainText('Valid voxels');
  await expect(summary).toContainText('22');
  await expect(summary).toContainText(
    '24 grid voxels: 22 valid, 1 outside, and 1 missing. Statistics and distribution use valid voxels only.',
  );

  const coronal = page.locator('[data-view="coronal"] .view-frame__renderer');
  await expect(coronal).toHaveAttribute('data-volume-index', '1');
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('cursor', '-5689,5400,232');
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(coronal).toHaveAttribute('data-volume-index', '0');

  await page.route('**/__real-data/**', (route) => route.abort());
  await page.reload();
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();
  await expect(page.locator('[data-slice-asset="schema-volume-v1"]')).toHaveCount(3);
  await expect(page.locator('[data-view="coronal"] canvas.view-frame__volume-canvas'))
    .toHaveJSProperty('width', 3);
  await expect(summary).toContainText('Valid voxels22');
  expect(scientificHttpRequests).toEqual([]);
});

test('deleting the active local release is confirmed, atomic, isolated, and permits reimport', async ({ page }) => {
  await page.goto('/');
  await importArchive(page, archive);
  await importArchive(page, authoredArchive);

  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Delete this local dataset…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete local dataset' });
  await expect(dialog).toContainText('authored_regional_fixture@authored-regional-v1');
  await expect(dialog).toContainText('this browser on this device');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();

  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Delete this local dataset…' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete local dataset' });
  await dialog.getByRole('button', { name: 'Delete local dataset' }).click();
  await expect(dialog).toBeHidden();
  await expect(dataset.locator('.context-field__local-badge')).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get('dataset')).not.toBe('local');
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).not.toBe('authored_regional_fixture@authored-regional-v1');

  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ibl-ephys-atlas-schema-v1-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['manifests', 'resources'], 'readonly');
    const values = await Promise.all(['manifests', 'resources'].map((name) => new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = transaction.objectStore(name).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    db.close();
    return { manifests: values[0]!.map(String), resources: values[1]!.map(String) };
  });
  expect(stored.manifests).toEqual(['golden_fixture@golden-v1']);
  expect(stored.resources.some((key) => key.startsWith('authored_regional_fixture@authored-regional-v1\0'))).toBe(false);
  expect(stored.resources.some((key) => key.startsWith('golden_fixture@golden-v1\0'))).toBe(true);

  await page.goBack();
  await expect(dataset.locator('.context-field__local-badge')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden_fixture@golden-v1');
  await expect(page.locator('.feature-summary')).toContainText('Observations11');

  await importArchive(page, authoredArchive);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('Decision signal');
});

test('sharing a local view discloses that the dataset is not transferred before copying', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { __copiedUrl?: string }).__copiedUrl = value; } },
    });
  });
  await page.goto('/');
  await importArchive(page, archive);

  const share = page.locator('.app-header__desktop-actions').getByRole('button', { name: 'Share' });
  await share.click();
  let dialog = page.getByRole('dialog', { name: 'Share local view' });
  await expect(dialog).toContainText('does not contain or transfer the dataset');
  await expect(dialog).toContainText('exact local release is already imported');
  expect(await page.evaluate(() => (window as Window & { __copiedUrl?: string }).__copiedUrl)).toBeUndefined();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => (window as Window & { __copiedUrl?: string }).__copiedUrl)).toBeUndefined();

  await share.click();
  dialog = page.getByRole('dialog', { name: 'Share local view' });
  await dialog.getByRole('button', { name: 'Copy local link' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as Window & { __copiedUrl?: string }).__copiedUrl)).toBe(page.url());
});

test('quota exhaustion aborts admission with actionable recovery guidance', async ({ page }) => {
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'resources') throw new DOMException('Synthetic quota exhaustion', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
  });
  await page.goto('/');
  await openImport(page);
  await page.locator('.local-import__input').setInputFiles(archive);
  const dialog = page.getByRole('dialog', { name: 'Import local dataset' });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('does not have enough storage');
  await expect(dialog.getByRole('alert')).toContainText('No partial import was kept');
  await expect(page.locator('[data-context-field="dataset"] .context-field__local-badge')).toBeHidden();
});

test('local manager reports exact releases, origin-wide storage, and damaged-entry recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 12_345, quota: 98_765 }),
        persisted: async () => false,
      },
    });
  });
  await page.goto('/');
  await importArchive(page, archive);
  await importArchive(page, authoredArchive);

  let manager = await openManager(page);
  await expect(manager).toContainText('2 local releases');
  await expect(manager).toContainText('Site data in use12 KiB');
  await expect(manager).toContainText('Estimated site quota96 KiB');
  await expect(manager).toContainText('all data stored by this site, not just imported releases');
  await expect(manager).toContainText('PersistenceNot granted');
  const authored = manager.locator('[data-local-release="authored_regional_fixture@authored-regional-v1"]');
  await expect(authored).toContainText('Source datasetauthored_regional_fixture');
  await expect(authored).toContainText('Source releaseauthored-regional-v1');
  await expect(authored).toContainText('Imported');
  await expect(authored).not.toContainText('ImportedNot recorded');
  await expect(authored).toContainText('Stored data');
  await expect(authored).toContainText('IntegrityVerified');

  await manager.locator('[data-local-release="golden_fixture@golden-v1"]')
    .getByRole('button', { name: 'Select' }).click();
  await expect(manager).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe('golden_fixture@golden-v1');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ibl-ephys-atlas-schema-v1-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('resources', 'readwrite');
    const store = transaction.objectStore('resources');
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = store.getAllKeys(IDBKeyRange.bound(
        'authored_regional_fixture@authored-regional-v1\0',
        'authored_regional_fixture@authored-regional-v1\u0001',
        false,
        true,
      ));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    store.delete(keys[0]!);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });

  manager = await openManager(page);
  const damagedBeforeCheck = manager.locator('[data-local-release="authored_regional_fixture@authored-regional-v1"]');
  await damagedBeforeCheck.getByRole('button', { name: 'Verify integrity' }).click();
  await expect(manager.getByRole('status')).toContainText('2 local releases');
  const damaged = manager.locator('[data-local-release="authored_regional_fixture@authored-regional-v1"]');
  await expect(damaged).toContainText('IntegrityDamaged');
  await expect(damaged.getByRole('alert')).toContainText('is missing');
  await expect(damaged.getByRole('alert')).toContainText('import the source archive again');
  await damaged.getByRole('button', { name: 'Remove damaged release…' }).click();

  const deletion = page.getByRole('dialog', { name: 'Delete local dataset' });
  await expect(deletion).toContainText('authored_regional_fixture@authored-regional-v1');
  await deletion.getByRole('button', { name: 'Delete local dataset' }).click();
  await expect(deletion).toBeHidden();
  await importArchive(page, authoredArchive);
  await expect(page.locator('[data-context-field="feature"] .context-field__value')).toContainText('Decision signal');
});

test('legacy local rows and unavailable Storage API remain truthfully unknown', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => { throw new Error('estimate rejected'); },
        persisted: async () => { throw new Error('persistence rejected'); },
      },
    });
  });
  await page.goto('/');
  await importArchive(page, archive);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ibl-ephys-atlas-schema-v1-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('manifests', 'readwrite');
    const store = transaction.objectStore('manifests');
    const stored = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get('golden_fixture@golden-v1');
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    delete stored.rootManifest;
    delete stored.importedAt;
    delete stored.integrity;
    store.put(stored);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });

  const manager = await openManager(page);
  const legacy = manager.locator('[data-local-release="golden_fixture@golden-v1"]');
  await expect(legacy).toContainText('ImportedNot recorded');
  await expect(legacy).toContainText('IntegrityNot verifiable');
  await expect(legacy.getByRole('button', { name: 'Verify integrity' })).toBeDisabled();
  await expect(manager).toContainText('PersistenceNot reported by this browser');
  await expect(manager).not.toContainText('Site data in use');
  await expect(manager).not.toContainText('Estimated site quota');
});
