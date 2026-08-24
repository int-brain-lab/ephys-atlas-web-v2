import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  decodeBinaryArray,
  localDatasetReleaseId,
  parseBinaryArray,
  parseDatasetManifestDocument,
  parseFeatureDescriptor,
  parseFeaturePayload,
  resolveDatasetManifest,
  validateLocalDatasetFiles,
} from '../../.test-dist/data/validate.js';

const goldenRoot = new URL('../../../fixtures/golden-v1/', import.meta.url);

function goldenDatasetFiles() {
  const files = new Map();
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const url = new URL(relative, goldenRoot);
      if (entry.isDirectory()) walk(url, `${relative}/`);
      else files.set(relative, new Blob([readFileSync(url)]));
    }
  };
  walk(goldenRoot);
  return files;
}

function goldenManifest() {
  return JSON.parse(readFileSync(new URL('manifest.json', goldenRoot), 'utf8'));
}

function goldenFeature() {
  return JSON.parse(readFileSync(new URL('features/rms_ap/feature.json', goldenRoot), 'utf8'));
}

test('regional payload validation rejects statistic arrays with wrong length', () => {
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '1.0', featureId: 'x', representation: 'regional', parcellation: 'allen',
    regionIds: ['10', '20'], statistics: { mean: [1] },
  }), /length must match regionIds/);
});

test('binary decoder follows declared little-endian dtype', () => {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setInt32(0, 10, true);
  view.setInt32(4, 20, true);
  assert.deepEqual(decodeBinaryArray(bytes, {
    format: 'raw-binary-array-v1', path: 'ids.i32', mediaType: 'application/octet-stream',
    bytes: 8, sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: 8 },
    dtype: 'int32', shape: [2], order: 'C', endianness: 'little',
  }), [10, 20]);
});

test('local release ids namespace equal release names by source dataset', () => {
  assert.equal(localDatasetReleaseId('dataset_a', 'weekly@1'), 'dataset_a@weekly%401');
  assert.notEqual(localDatasetReleaseId('dataset_a', 'weekly'), localDatasetReleaseId('dataset_b', 'weekly'));
});

test('resolved manifest preserves schema-v1 release, provenance, dataset, and feature context', () => {
  const document = parseDatasetManifestDocument(goldenManifest());
  const feature = parseFeatureDescriptor(goldenFeature(), 'features/rms_ap/feature.json');
  const manifest = resolveDatasetManifest(document, [feature]);
  assert.equal(manifest.dataset.description, 'Small deterministic non-scientific dataset used to exercise the schema-v1 browser contract.');
  assert.deepEqual(manifest.release, {
    releaseId: 'golden-v1', immutable: true, createdAt: '2026-08-22T00:00:00Z', paperSnapshot: false,
  });
  assert.equal(manifest.provenance.sources[0].description, 'Deterministic synthetic fixture seed');
  assert.equal(manifest.provenance.builder.command, 'ephys-atlas-data golden fixtures/golden-v1');
  assert.equal(manifest.provenance.recipe.id, 'golden-fixture-v1');
  assert.equal(feature.unit, 'dB rel. V');
  assert.deepEqual(feature.artifacts.map(({ id, role, description, resource }) => ({
    id, role, description, path: resource.path,
  })), [{
    id: 'rms_ap-csv',
    role: 'current-feature',
    description: 'Human-readable regional fixture values',
    path: 'rms_ap.csv',
  }]);
  assert.deepEqual(manifest.artifacts, []);
  assert.equal(feature.representations.volume.grid.referenceSpaceId, 'allen-ccf-2017');
});

test('artifact metadata accepts every schema-v1 role and rejects duplicate ids', () => {
  const valid = goldenManifest();
  const resource = goldenFeature().artifacts[0].resource;
  valid.artifacts = ['current-feature', 'selected-data', 'source-snapshot', 'auxiliary', 'whole-release']
    .map((role, index) => ({ id: `Artifact-${index}`, role, resource }));
  const document = parseDatasetManifestDocument(valid);
  assert.deepEqual(document.artifacts.map((item) => item.role), [
    'current-feature', 'selected-data', 'source-snapshot', 'auxiliary', 'whole-release',
  ]);
  assert.throws(
    () => parseDatasetManifestDocument({ ...valid, artifacts: [valid.artifacts[0], valid.artifacts[0]] }),
    /artifact.*ids must not contain duplicates/,
  );
});

test('resolved manifest rejects mismatched dataset, feature, and parcellation identities', () => {
  const document = parseDatasetManifestDocument(goldenManifest());
  const feature = parseFeatureDescriptor(goldenFeature(), 'features/rms_ap/feature.json');
  assert.throws(() => resolveDatasetManifest({ ...document, datasetId: 'declared_dataset' }, [feature], 'different_dataset'), /does not match requested dataset/);
  assert.throws(() => resolveDatasetManifest(document, [{ ...feature, id: 'different_feature' }]), /does not match manifest reference/);
  assert.throws(() => resolveDatasetManifest(document, [{
    ...feature,
    representations: {
      ...feature.representations,
      regional: {
        ...feature.representations.regional,
        parcellations: { beryl: { ...feature.representations.regional.parcellations.allen, parcellationId: 'beryl' } },
      },
    },
  }]), /references undeclared beryl parcellation/);
});

test('manifest metadata validation rejects invalid release dates and provenance', () => {
  const valid = goldenManifest();
  assert.throws(() => parseDatasetManifestDocument({ ...valid, release: { ...valid.release, created_at: '2026-02-30T00:00:00Z' } }), /RFC 3339 date-time/);
  assert.throws(() => parseDatasetManifestDocument({ ...valid, provenance: { ...valid.provenance, sources: [] } }), /sources must not be empty/);
});

test('feature metadata validates units and retains presentation-only color defaults', () => {
  const valid = goldenFeature();
  assert.throws(() => parseFeatureDescriptor({ ...valid, unit: 10 }, 'feature.json'), /feature.json.unit must be a string/);
  assert.throws(() => parseFeatureDescriptor({ ...valid, display: { range: [0, 'high'] } }, 'feature.json'), /display.range must contain 2 finite numbers/);
  assert.throws(() => parseFeatureDescriptor({ ...valid, display: { scale: 'symlog' } }, 'feature.json'), /display.scale must be linear or log/);
  const feature = parseFeatureDescriptor({ ...valid, display: { colormap: 'magma', range: [0.1, 10], scale: 'log' } }, 'feature.json');
  assert.deepEqual(feature.display, { colormap: 'magma', range: [0.1, 10], scale: 'log' });
});

test('volume parsing derives the exact inverse when the optional redundant matrix is absent', () => {
  const valid = goldenFeature();
  delete valid.representations.volume.grid.world_to_index;
  const feature = parseFeatureDescriptor(valid, 'feature.json');
  assert.deepEqual(feature.representations.volume.grid.worldToIndex, [
    0, 0.04, 0, 0,
    0.04, 0, 0, 0,
    0, 0, 0.04, 0,
    0, 0, 0, 1,
  ]);
});

test('local import validates the complete checked-in schema-v1 graph', async () => {
  const validated = await validateLocalDatasetFiles(goldenDatasetFiles());
  assert.equal(validated.document.datasetId, 'golden_fixture');
  assert.ok(validated.features[0].representations.volume);
});

test('local import rejects a missing explicit volume chunk', async () => {
  const files = goldenDatasetFiles();
  files.delete('features/rms_ap/volume/chunks/1.1.0.f32');
  await assert.rejects(validateLocalDatasetFiles(files), /missing features\/rms_ap\/volume\/chunks\/1\.1\.0\.f32/i);
});

test('local import rejects a missing transitive regional resource', async () => {
  const files = goldenDatasetFiles();
  files.delete('features/rms_ap/allen.summary.f64');
  await assert.rejects(validateLocalDatasetFiles(files), /missing features\/rms_ap\/allen\.summary\.f64/i);
});

test('local import rejects same-size content with a wrong declared SHA-256', async () => {
  const files = goldenDatasetFiles();
  files.set('features/rms_ap/allen.values.f32', new Blob([new Float32Array([1, 2, 3, 4]).buffer]));
  await assert.rejects(validateLocalDatasetFiles(files), /SHA-256 mismatch for features\/rms_ap\/allen\.values\.f32/);
});

test('binary descriptors reject unsafe paths and malformed integrity metadata', () => {
  const descriptor = {
    format: 'raw-binary-array-v1', dtype: 'float32', shape: [1], order: 'C', endianness: 'little',
    resource: {
      path: '../values.f32', media_type: 'application/octet-stream', bytes: 4, sha256: '0'.repeat(64),
      codec: { name: 'none', decoded_bytes: 4 },
    },
  };
  assert.throws(() => parseBinaryArray(descriptor, 'array'), /safe relative path/);
  assert.throws(() => parseBinaryArray({ ...descriptor, resource: { ...descriptor.resource, path: 'values.f32', sha256: 'nope' } }, 'array'), /64 lowercase/);
});
