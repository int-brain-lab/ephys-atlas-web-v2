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
  sha256Hex,
  validateLocalDatasetFiles,
} from '../../.test-dist/data/validate.js';

function jsonBlob(value) {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

async function localDatasetFiles() {
  const regionIds = new Blob([new Int32Array([10]).buffer]);
  const values = new Blob([new Float32Array([1.5]).buffer]);
  const summary = new Blob([new Float64Array([1.5]).buffer]);
  const feature = {
    schema_version: '0.1',
    id: 'x',
    label: 'Feature X',
    description: 'Local import fixture',
    unit: 'uV',
    value_semantics: {
      quantity: 'test scalar', transform: 'identity', source_population: 'fixture', missing_values: 'none',
    },
    representations: {
      regional: {
        format: 'ephys-atlas-regional-v0.1',
        parcellations: [{
          parcellation_id: 'allen',
          summary: 'mean',
          values: {
            path: 'values.f32', dtype: 'float32', shape: [1], order: 'C', endianness: 'little',
            bytes: values.size, sha256: await sha256Hex(values),
          },
          statistics: 'statistics.json',
        }],
      },
    },
    artifacts: [],
  };
  const statistics = {
    format: 'ephys-atlas-statistics-v0.1',
    population: 'fixture',
    global: { count: 1, missing_count: 0, min: 1.5, max: 1.5, mean: 1.5, std: 0, median: 1.5 },
    regional_summary: {
      fields: ['mean'],
      values: {
        path: 'summary.f64', dtype: 'float64', shape: [1, 1], order: 'C', endianness: 'little',
        bytes: summary.size, sha256: await sha256Hex(summary),
      },
    },
  };
  const manifest = {
    schema_version: '0.1',
    dataset_id: 'dataset_a',
    title: 'Local fixture',
    description: 'Local import fixture',
    release: { release_id: 'weekly@1', immutable: true, created_at: '2026-08-20T00:00:00Z', paper_snapshot: false },
    provenance: {
      sources: [{ role: 'user-input', description: 'Local test files' }],
      builder: { name: 'unit-test', version: '1', command: 'unit-test' },
      recipe: { id: 'local-test' },
    },
    parcellations: [{
      id: 'allen',
      region_index: {
        path: 'parcellations/allen/ids.i32', dtype: 'int32', shape: [1], order: 'C', endianness: 'little',
        bytes: regionIds.size, sha256: await sha256Hex(regionIds),
      },
      metadata: 'parcellations/allen/regions.json',
    }],
    features: [{ id: 'x', path: 'features/x/feature.json' }],
    artifacts: [],
  };
  return new Map([
    ['manifest.json', jsonBlob(manifest)],
    ['parcellations/allen/ids.i32', regionIds],
    ['parcellations/allen/regions.json', jsonBlob([{ index: 0, atlas_id: 10, acronym: 'X', name: 'Region X' }])],
    ['features/x/feature.json', jsonBlob(feature)],
    ['features/x/values.f32', values],
    ['features/x/statistics.json', jsonBlob(statistics)],
    ['features/x/summary.f64', summary],
  ]);
}

function goldenDatasetFiles() {
  const root = new URL('../../../fixtures/golden-v0.1/', import.meta.url);
  const files = new Map();
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const url = new URL(relative, root);
      if (entry.isDirectory()) walk(url, `${relative}/`);
      else files.set(relative, new Blob([readFileSync(url)]));
    }
  };
  walk(root);
  return files;
}

test('regional payload validation rejects statistic arrays with wrong length', () => {
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '0.1',
    featureId: 'x',
    representation: 'regional',
    parcellation: 'allen',
    regionIds: ['10', '20'],
    statistics: { mean: [1] },
  }), /length must match regionIds/);
});

test('binary decoder follows declared little-endian dtype', () => {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setInt32(0, 10, true);
  view.setInt32(4, 20, true);
  assert.deepEqual(decodeBinaryArray(bytes, {
    path: 'ids.i32', dtype: 'int32', shape: [2], order: 'C', endianness: 'little',
  }), [10, 20]);
});

test('local release ids namespace equal release names by source dataset', () => {
  assert.equal(localDatasetReleaseId('dataset_a', 'weekly@1'), 'dataset_a@weekly%401');
  assert.notEqual(localDatasetReleaseId('dataset_a', 'weekly'), localDatasetReleaseId('dataset_b', 'weekly'));
});

test('local import validates a complete regional resource graph', async () => {
  const validated = await validateLocalDatasetFiles(await localDatasetFiles());
  assert.equal(validated.document.datasetId, 'dataset_a');
  assert.equal(validated.document.release.releaseId, 'weekly@1');
  assert.deepEqual(validated.features.map((feature) => feature.id), ['x']);
});

test('resolved manifest preserves release, provenance, dataset, and feature context', () => {
  const root = new URL('../../../fixtures/golden-v0.3/', import.meta.url);
  const document = parseDatasetManifestDocument(JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')));
  const feature = parseFeatureDescriptor(
    JSON.parse(readFileSync(new URL('features/rms_ap/feature.json', root), 'utf8')),
    'features/rms_ap/feature.json',
  );
  const manifest = resolveDatasetManifest(document, [feature]);

  assert.equal(manifest.dataset.description, 'Small deterministic non-scientific dataset used to exercise the v0.1 browser contract.');
  assert.deepEqual(manifest.release, {
    releaseId: 'golden-v0.3', immutable: true, createdAt: '2026-08-20T00:00:00Z', paperSnapshot: false,
  });
  assert.equal(manifest.provenance.sources[0].description, 'Deterministic synthetic fixture seed');
  assert.equal(manifest.provenance.builder.command, 'ephys-atlas-data golden fixtures/golden-v0.3');
  assert.equal(manifest.provenance.recipe.id, 'golden-fixture-v0.3');
  assert.match(feature.description, /Synthetic feature/);
  assert.equal(feature.unit, 'dB rel. V');
  assert.deepEqual(feature.valueSemantics, {
    quantity: 'synthetic AP RMS-like scalar',
    transform: 'identity; fixture values are already display values',
    sourcePopulation: 'synthetic fixture observations',
    missingValues: 'non-finite observations are excluded from summaries and histograms',
    sourceColumn: 'rms_ap',
    qcFilter: 'none; synthetic fixture',
  });
});

test('resolved manifest rejects mismatched dataset and feature identities', () => {
  const root = new URL('../../../fixtures/golden-v0.3/', import.meta.url);
  const document = parseDatasetManifestDocument(JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')));
  const feature = parseFeatureDescriptor(
    JSON.parse(readFileSync(new URL('features/rms_ap/feature.json', root), 'utf8')),
    'features/rms_ap/feature.json',
  );

  assert.throws(
    () => resolveDatasetManifest(
      { ...document, datasetId: 'declared_dataset' },
      [feature],
      'different_dataset',
    ),
    /does not match requested dataset/,
  );
  assert.throws(
    () => resolveDatasetManifest(document, [{ ...feature, id: 'different_feature' }]),
    /does not match manifest reference/,
  );
  assert.throws(
    () => resolveDatasetManifest(document, [{
      ...feature,
      representations: {
        ...feature.representations,
        regional: {
          ...feature.representations.regional,
          parcellations: {
            beryl: {
              ...feature.representations.regional.parcellations.allen,
              parcellationId: 'beryl',
            },
          },
        },
      },
    }]),
    /references undeclared beryl parcellation/,
  );
});

test('manifest metadata validation rejects invalid release dates and provenance', () => {
  const root = new URL('../../../fixtures/golden-v0.3/', import.meta.url);
  const valid = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.throws(
    () => parseDatasetManifestDocument({ ...valid, release: { ...valid.release, created_at: '2026-02-30T00:00:00Z' } }),
    /RFC 3339 date-time/,
  );
  assert.throws(
    () => parseDatasetManifestDocument({ ...valid, provenance: { ...valid.provenance, sources: [] } }),
    /sources must not be empty/,
  );
});

test('feature metadata validation rejects a missing or non-string unit', () => {
  const root = new URL('../../../fixtures/golden-v0.3/', import.meta.url);
  const valid = JSON.parse(readFileSync(new URL('features/rms_ap/feature.json', root), 'utf8'));
  assert.throws(() => parseFeatureDescriptor({ ...valid, unit: 10 }, 'feature.json'), /feature.json.unit must be a string/);
  assert.throws(
    () => parseFeatureDescriptor({ ...valid, display: { range: [0, 'high'] } }, 'feature.json'),
    /display.range must contain 2 finite numbers/,
  );
});

test('local import validates the checked-in regional and volume golden graph', async () => {
  const files = goldenDatasetFiles();
  const validated = await validateLocalDatasetFiles(files);
  assert.equal(validated.document.datasetId, 'golden_fixture');
  assert.ok(validated.features[0].representations.volume);
});

test('local import rejects a missing generated volume chunk', async () => {
  const files = goldenDatasetFiles();
  files.delete('features/rms_ap/volume/chunks/1.1.0.f32');
  await assert.rejects(validateLocalDatasetFiles(files), /missing features\/rms_ap\/volume\/chunks\/1\.1\.0\.f32/);
});

test('local import rejects a missing transitive resource', async () => {
  const files = await localDatasetFiles();
  files.delete('features/x/summary.f64');
  await assert.rejects(validateLocalDatasetFiles(files), /missing features\/x\/summary\.f64/);
});

test('local import rejects same-size content with a wrong declared SHA-256', async () => {
  const files = await localDatasetFiles();
  files.set('features/x/values.f32', new Blob([new Float32Array([2.5]).buffer]));
  await assert.rejects(validateLocalDatasetFiles(files), /SHA-256 mismatch for features\/x\/values\.f32/);
});

test('local import rejects regional arrays inconsistent with the region index', async () => {
  const files = await localDatasetFiles();
  const feature = JSON.parse(await files.get('features/x/feature.json').text());
  feature.representations.regional.parcellations[0].values.shape = [2];
  files.set('features/x/feature.json', jsonBlob(feature));
  await assert.rejects(validateLocalDatasetFiles(files), /values shape must be \[1\]/);
});

test('binary descriptors reject unsafe paths and malformed integrity metadata', () => {
  const descriptor = { path: '../values.f32', dtype: 'float32', shape: [1], order: 'C', endianness: 'little' };
  assert.throws(() => parseBinaryArray(descriptor, 'array'), /safe relative path/);
  assert.throws(() => parseBinaryArray({ ...descriptor, path: 'values.f32', sha256: 'nope' }, 'array'), /64 lowercase/);
});
