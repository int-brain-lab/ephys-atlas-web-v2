import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LOCAL_ARCHIVE_LIMITS,
  prepareLocalArchive,
  validateLocalArchiveInventory,
  validateLocalArchivePath,
} from '../../.test-dist/data/local-archive.js';

const fixture = new Blob([readFileSync('../fixtures/golden-v1.ibl-ephys-atlas.zip')], { type: 'application/zip' });
const authoredVolumeFixture = new Blob(
  [readFileSync('../fixtures/authored-volume-v1.ibl-ephys-atlas.zip')],
  { type: 'application/zip' },
);

function entry(overrides = {}) {
  return {
    filename: 'manifest.json',
    compressedSize: 100,
    uncompressedSize: 200,
    compressionMethod: 8,
    directory: false,
    encrypted: false,
    symlink: false,
    zip64: false,
    diskNumberStart: 0,
    unixMode: 0o100644,
    ...overrides,
  };
}

test('canonical synthetic bundle prepares a complete deterministic preview', async () => {
  const prepared = await prepareLocalArchive(fixture);
  assert.equal(prepared.preview.datasetId, 'golden_fixture');
  assert.equal(prepared.preview.releaseId, 'golden-v1');
  assert.equal(prepared.preview.selector, 'golden_fixture@golden-v1');
  assert.equal(
    prepared.preview.provenanceSummary,
    'ibl-ephys-atlas-builder 1.0.0 · recipe golden-fixture-v1 · 1 source',
  );
  assert.equal(prepared.preview.archiveBytes, fixture.size);
  assert.equal(prepared.preview.featureCount, 1);
  assert.deepEqual(prepared.preview.featureIds, ['rms_ap']);
  assert.deepEqual(prepared.preview.representations, ['regional', 'volume']);
  assert.deepEqual(prepared.preview.parcellations, ['allen']);
  assert.equal(prepared.files.size, prepared.preview.fileCount);
  assert.ok(prepared.preview.declaredDecodedBytes >= prepared.preview.storedBytes);
});

test('public-authored mask volume prepares a complete deterministic preview', async () => {
  const prepared = await prepareLocalArchive(authoredVolumeFixture);
  assert.equal(prepared.preview.datasetId, 'authored_volume_fixture');
  assert.equal(prepared.preview.releaseId, 'authored-volume-v1');
  assert.deepEqual(prepared.preview.featureIds, ['synthetic_gradient']);
  assert.deepEqual(prepared.preview.representations, ['volume']);
  assert.deepEqual(prepared.preview.parcellations, []);
  const validity = prepared.validated.features[0].representations.volume.validity;
  assert.equal(validity.kind, 'mask');
  assert.deepEqual(validity.mask.shape, [2, 3, 4]);
  assert.equal(validity.mask.resource.dtype, 'uint8');
  assert.equal(validity.mask.resource.order, 'C');
  assert.equal(validity.mask.resource.endianness, 'not-applicable');
  assert.equal(validity.mask.resource.path, 'volume/validity.u8');
});

test('preparation honors cancellation before archive work begins', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(() => prepareLocalArchive(fixture, controller.signal), { name: 'AbortError' });
});

test('portable ZIP paths reject ambiguous and nested names', () => {
  for (const path of ['', '../x', '/x', 'C:/x', 'a\\b', './x', 'a//b', 'a/%2e%2e/b', 'nested.zip', 'e\u0301.json']) {
    assert.throws(() => validateLocalArchivePath(path), /unsafe path|nested zip/i, path);
  }
  assert.equal(validateLocalArchivePath('features/value/feature.json'), 'features/value/feature.json');
});

test('inventory rejects unsafe ZIP metadata before extraction', () => {
  const cases = [
    [entry({ filename: 'other.json' }), /manifest\.json/i],
    [entry({ directory: true }), /directory entry/i],
    [entry({ encrypted: true }), /encrypted/i],
    [entry({ symlink: true }), /symbolic link/i],
    [entry({ zip64: true }), /zip64/i],
    [entry({ diskNumberStart: 1 }), /split/i],
    [entry({ compressionMethod: 12 }), /compression method/i],
    [entry({ uncompressedSize: 100_001, compressedSize: 1 }), /compression-ratio/i],
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(() => validateLocalArchiveInventory(1000, [candidate]), pattern);
  }
  assert.throws(
    () => validateLocalArchiveInventory(1000, [entry(), entry()]),
    /duplicate path/i,
  );
});

test('inventory applies archive, count, entry, aggregate, manifest and path limits', () => {
  const tiny = {
    ...LOCAL_ARCHIVE_LIMITS,
    maximumArchiveBytes: 100,
    maximumEntries: 1,
    maximumEntryCompressedBytes: 50,
    maximumEntryExpandedBytes: 100,
    maximumExpandedBytes: 100,
    maximumCompressionRatio: 10,
    maximumPathBytes: 20,
    maximumSegmentBytes: 20,
    maximumManifestBytes: 80,
  };
  assert.throws(() => validateLocalArchiveInventory(101, [entry()], tiny), /exceeds 100 bytes/i);
  assert.throws(() => validateLocalArchiveInventory(100, [entry(), entry({ filename: 'x' })], tiny), /exceeds 1 entries/i);
  assert.throws(() => validateLocalArchiveInventory(100, [entry({ compressedSize: 51, uncompressedSize: 70 })], tiny), /entry exceeds/i);
  assert.throws(() => validateLocalArchiveInventory(100, [entry({ compressedSize: 10, uncompressedSize: 81 })], tiny), /manifest exceeds/i);
  assert.throws(() => validateLocalArchivePath('a-very-long-path.json', tiny), /path exceeds/i);
});
