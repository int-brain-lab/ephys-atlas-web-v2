import { expect, test } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

import {
  archivePath,
  browserSnapshot,
  details,
  indexedDbCounts,
  loadCorpus,
  openImport,
  openManager,
  phase,
  storageSnapshot,
  verifyArchive,
  writeEvidence,
  type CorpusCase,
  type PhaseEvidence,
} from './harness.js';

const configuredCorpus = process.env.EPHYS_ATLAS_LOCAL_IMPORT_CORPUS;
const outputDirectory = path.resolve(
  process.env.EPHYS_ATLAS_LOCAL_IMPORT_BENCHMARK_OUTPUT
    ?? '../artifacts/local-import-benchmark/evidence',
);
const corpus = configuredCorpus ? await loadCorpus(path.resolve(configuredCorpus)) : null;

test.describe('opt-in local ZIP import capacity evidence', () => {
  if (!corpus || !configuredCorpus) {
    test('requires an explicit generated corpus', () => {
      test.skip(true, 'set EPHYS_ATLAS_LOCAL_IMPORT_CORPUS to a generated corpus.json');
    });
    return;
  }

  for (const item of corpus.cases) {
    test(`${item.id} remains deterministic and recoverable`, async ({ page, browserName }) => {
      const pathname = archivePath(path.resolve(configuredCorpus), item);
      await verifyArchive(pathname, item);
      await page.goto('/');
      expect(await indexedDbCounts(page)).toEqual({ manifests: 0, resources: 0 });

      const evidence: {
        format: string;
        recordedAt: string;
        corpusPath: string;
        case: CorpusCase;
        browser: Awaited<ReturnType<typeof browserSnapshot>>;
        host: Record<string, unknown>;
        initialStorage: Awaited<ReturnType<typeof storageSnapshot>>;
        phases: Record<string, PhaseEvidence>;
        preview?: Record<string, string>;
        rejection?: string;
        releaseSelector?: string;
        finalIndexedDb: Awaited<ReturnType<typeof indexedDbCounts>>;
      } = {
        format: 'ibl-ephys-atlas-local-import-browser-evidence-v1',
        recordedAt: new Date().toISOString(),
        corpusPath: path.resolve(configuredCorpus),
        case: item,
        browser: await browserSnapshot(page),
        host: {
          platform: os.platform(),
          release: os.release(),
          architecture: os.arch(),
          cpuModel: os.cpus()[0]?.model ?? null,
          logicalCpuCount: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
        },
        initialStorage: await storageSnapshot(page),
        phases: {},
        finalIndexedDb: { manifests: 0, resources: 0 },
      };

      const dialog = await openImport(page);
      const previewStarted = performance.now();
      await page.locator('.local-import__input').setInputFiles(pathname);

      await page.waitForFunction(() => {
        const value = document.querySelector('[data-local-import-status]')?.textContent ?? '';
        return value.includes('Validation complete') || value.startsWith('Could not validate');
      }, undefined, { timeout: 30 * 60_000 });
      const previewRejected = (await dialog.getByRole('status').textContent())?.startsWith('Could not validate') ?? false;

      if (item.kind === 'invalid-adversarial') {
        expect(previewRejected).toBe(true);
        await expect(dialog.getByRole('alert')).toBeVisible();
        evidence.phases.previewRejected = await phase(page, previewStarted);
        evidence.rejection = (await dialog.getByRole('alert').textContent())?.trim() ?? '';
        expect(evidence.rejection.length).toBeGreaterThan(0);
        expect(item.expected_rejection).toBeTruthy();
        expect(await indexedDbCounts(page)).toEqual({ manifests: 0, resources: 0 });
        evidence.finalIndexedDb = await indexedDbCounts(page);
        await writeEvidence(outputDirectory, browserName, item.id, evidence);
        return;
      }

      if (previewRejected) {
        evidence.phases.previewRejected = await phase(page, previewStarted);
        evidence.rejection = (await dialog.getByRole('alert').textContent())?.trim() ?? '';
        evidence.finalIndexedDb = await indexedDbCounts(page);
        await writeEvidence(outputDirectory, browserName, item.id, evidence);
        throw new Error(`Preview rejected: ${evidence.rejection || 'unknown validation error'}`);
      }
      evidence.phases.preview = await phase(page, previewStarted);
      evidence.preview = await details(dialog.locator('.local-import__summary'));
      expect(evidence.preview.Archive).toBe(path.basename(pathname));
      expect(evidence.preview.Files).toBe(Number(item.entries).toLocaleString('en-US'));
      expect(evidence.preview.Dataset).toBeTruthy();
      expect(evidence.preview.Release).toBeTruthy();

      const admissionStarted = performance.now();
      await dialog.getByRole('button', { name: 'Import', exact: true }).click();
      const admissionOutcome = await Promise.race([
        dialog.waitFor({ state: 'hidden', timeout: 30 * 60_000 }).then(() => 'admitted' as const),
        dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 30 * 60_000 }).then(() => 'rejected' as const),
      ]);
      if (admissionOutcome === 'rejected') {
        evidence.phases.admissionRejected = await phase(page, admissionStarted);
        evidence.rejection = (await dialog.getByRole('alert').textContent())?.trim() ?? '';
        evidence.finalIndexedDb = await indexedDbCounts(page);
        await writeEvidence(outputDirectory, browserName, item.id, evidence);
        throw new Error(`Admission rejected: ${evidence.rejection || 'unknown browser storage error'}`);
      }
      await expect(page.locator('[data-context-field="data"] .context-field__local-badge')).toBeVisible();
      evidence.phases.admission = await phase(page, admissionStarted);
      expect((await indexedDbCounts(page)).manifests).toBe(1);
      const releaseSelector = new URL(page.url()).searchParams.get('release');
      expect(releaseSelector).toBeTruthy();
      evidence.releaseSelector = releaseSelector!;

      const reloadStarted = performance.now();
      await page.reload();
      await expect(page.locator('[data-context-field="data"] .context-field__local-badge')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('release')).toBe(releaseSelector);
      evidence.phases.reload = await phase(page, reloadStarted);

      let manager = await openManager(page);
      let card = manager.locator(`[data-local-release="${releaseSelector}"]`);
      await expect(card).toBeVisible();
      const verifyStarted = performance.now();
      await card.getByRole('button', { name: 'Verify integrity' }).click();
      await expect(manager.getByRole('status')).not.toContainText('Verifying', { timeout: 30 * 60_000 });
      card = manager.locator(`[data-local-release="${releaseSelector}"]`);
      await expect(card).toContainText('IntegrityVerified');
      evidence.phases.deepVerify = await phase(page, verifyStarted);

      await card.getByRole('button', { name: 'Delete…' }).click();
      const deletion = page.getByRole('dialog', { name: 'Delete local dataset' });
      await expect(deletion).toBeVisible();
      const deleteStarted = performance.now();
      await deletion.getByRole('button', { name: 'Delete local dataset' }).click();
      await expect(deletion).toBeHidden();
      await expect(page.locator('[data-context-field="data"] .context-field__local-badge')).toBeHidden();
      evidence.phases.delete = await phase(page, deleteStarted);
      evidence.finalIndexedDb = await indexedDbCounts(page);
      expect(evidence.finalIndexedDb).toEqual({ manifests: 0, resources: 0 });

      await writeEvidence(outputDirectory, browserName, item.id, evidence);
    });
  }
});
