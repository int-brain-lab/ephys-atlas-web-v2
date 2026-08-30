import { expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CORPUS_FORMAT = 'ibl-ephys-atlas-local-import-benchmark-corpus-v1';

export interface CorpusCase {
  readonly id: string;
  readonly kind: 'exact-release' | 'valid-synthetic-capacity' | 'invalid-adversarial';
  readonly synthetic: boolean;
  readonly archive: string;
  readonly archive_bytes: number;
  readonly archive_sha256: string;
  readonly entries: number;
  readonly zip_expanded_bytes: number;
  readonly expected_rejection?: string;
  readonly [key: string]: unknown;
}

export interface Corpus {
  readonly format: typeof CORPUS_FORMAT;
  readonly cases: readonly CorpusCase[];
}

export interface StorageSnapshot {
  readonly usage: number | null;
  readonly quota: number | null;
  readonly persisted: boolean | null;
}

export interface BrowserSnapshot {
  readonly userAgent: string;
  readonly platform: string;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGiB: number | null;
  readonly jsHeap: {
    readonly used: number;
    readonly total: number;
    readonly limit: number;
  } | null;
}

export interface PhaseEvidence {
  readonly elapsedMs: number;
  readonly storage: StorageSnapshot;
  readonly jsHeap: BrowserSnapshot['jsHeap'];
}

export async function loadCorpus(corpusPath: string): Promise<Corpus> {
  const parsed = JSON.parse(await readFile(corpusPath, 'utf8')) as Corpus;
  if (parsed.format !== CORPUS_FORMAT || !Array.isArray(parsed.cases)) {
    throw new Error(`Unsupported local-import benchmark corpus: ${corpusPath}`);
  }
  const ids = new Set<string>();
  for (const item of parsed.cases) {
    if (!item.id || ids.has(item.id)) throw new Error(`Invalid or duplicate corpus case id: ${item.id}`);
    ids.add(item.id);
    if (!['exact-release', 'valid-synthetic-capacity', 'invalid-adversarial'].includes(item.kind)) {
      throw new Error(`Unsupported corpus case kind: ${String(item.kind)}`);
    }
    if (!Number.isSafeInteger(item.archive_bytes) || item.archive_bytes < 0) {
      throw new Error(`Invalid archive size for corpus case ${item.id}`);
    }
    if (!/^[0-9a-f]{64}$/.test(item.archive_sha256)) {
      throw new Error(`Invalid archive SHA-256 for corpus case ${item.id}`);
    }
  }
  return parsed;
}

export function archivePath(corpusPath: string, item: CorpusCase): string {
  return path.resolve(path.dirname(corpusPath), item.archive);
}

export async function verifyArchive(pathname: string, item: CorpusCase): Promise<void> {
  const metadata = await stat(pathname);
  expect(metadata.size).toBe(item.archive_bytes);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  expect(hash.digest('hex')).toBe(item.archive_sha256);
}

export async function browserSnapshot(page: Page): Promise<BrowserSnapshot> {
  return page.evaluate(() => {
    const extendedNavigator = navigator as Navigator & { deviceMemory?: number };
    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: extendedNavigator.deviceMemory ?? null,
      jsHeap: memory ? {
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit,
      } : null,
    };
  });
}

export async function storageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    let usage: number | null = null;
    let quota: number | null = null;
    let persisted: boolean | null = null;
    try {
      const estimate = await navigator.storage?.estimate();
      usage = estimate?.usage ?? null;
      quota = estimate?.quota ?? null;
    } catch { /* unavailable browser telemetry */ }
    try {
      persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    } catch { /* unavailable browser telemetry */ }
    return { usage, quota, persisted };
  });
}

export async function phase(page: Page, started: number): Promise<PhaseEvidence> {
  const elapsedMs = performance.now() - started;
  const browser = await browserSnapshot(page);
  return {
    elapsedMs,
    storage: await storageSnapshot(page),
    jsHeap: browser.jsHeap,
  };
}

export async function openImport(page: Page): Promise<Locator> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Import local dataset…' }).click();
  return page.locator('[data-local-import-dialog]');
}

export async function openManager(page: Page): Promise<Locator> {
  const dataset = page.locator('[data-context-field="dataset"]');
  await dataset.locator('.context-menu__trigger').click();
  await dataset.getByRole('option', { name: 'Manage local datasets…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Local datasets' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).not.toContainText('Inspecting');
  return dialog;
}

export async function details(locator: Locator): Promise<Record<string, string>> {
  return locator.locator('dl').first().evaluate((list) => {
    const result: Record<string, string> = {};
    const terms = [...list.querySelectorAll('dt')];
    for (const term of terms) {
      const description = term.nextElementSibling;
      if (description?.tagName === 'DD') result[term.textContent ?? ''] = description.textContent ?? '';
    }
    return result;
  });
}

export async function indexedDbCounts(page: Page): Promise<{ manifests: number; resources: number }> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'ibl-ephys-atlas-schema-v1-local')) {
      return { manifests: 0, resources: 0 };
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ibl-ephys-atlas-schema-v1-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['manifests', 'resources'], 'readonly');
      const count = (name: string) => new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [manifests, resources] = await Promise.all([count('manifests'), count('resources')]);
      return { manifests, resources };
    } finally {
      db.close();
    }
  });
}

export async function writeEvidence(
  outputDirectory: string,
  browserName: string,
  caseId: string,
  evidence: unknown,
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const filename = `${caseId.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}.${browserName}.json`;
  const destination = path.join(outputDirectory, filename);
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`);
  return destination;
}
