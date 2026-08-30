import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function setResourceIntegrity(resource, encoded, decodedBytes = encoded.byteLength, codec = 'none') {
  resource.bytes = encoded.byteLength;
  resource.sha256 = sha256(encoded);
  resource.codec = { name: codec, decoded_bytes: decodedBytes };
}

function replaceFeatureAndManifest(files, feature) {
  const featureBytes = Buffer.from(JSON.stringify(feature));
  files.set('features/rms_ap/feature.json', new Blob([featureBytes]));
  const manifest = goldenManifest();
  setResourceIntegrity(manifest.features[0].descriptor.resource, featureBytes);
  files.set('manifest.json', new Blob([JSON.stringify(manifest)]));
}

function replaceStatisticsFeatureAndManifest(files, statistics) {
  const statisticsBytes = Buffer.from(JSON.stringify(statistics));
  files.set('features/rms_ap/allen.statistics.json', new Blob([statisticsBytes]));
  const feature = goldenFeature();
  setResourceIntegrity(feature.representations.regional.parcellations[0].statistics.resource, statisticsBytes);
  replaceFeatureAndManifest(files, feature);
}

test('regional payload validation rejects statistic arrays with wrong length', () => {
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '1.0', featureId: 'x', representation: 'regional', parcellation: 'allen',
    regionIds: ['10', '20'], statistics: { mean: [1] },
  }), /length must match regionIds/);
});

test('regional payload validation uses the shared distribution semantics', () => {
  const counts = { binCounts: [1, 1], underflowCount: 0, overflowCount: 0 };
  const regional = [{ binCounts: [1, 1], underflowCount: 0, overflowCount: 0 }];
  const distribution = {
    binnings: [{
      id: 'linear-full', scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [1, 2, 3],
      global: counts, regional, binRule: 'left-closed-right-open-last-closed',
    }, {
      id: 'symlog-full', scale: { kind: 'symlog', linearThreshold: 1 }, domain: { kind: 'full' },
      edges: [1, 2, 3.00000000001], global: counts, regional,
      binRule: 'left-closed-right-open-last-closed',
    }],
  };
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '1.0', featureId: 'x', representation: 'regional', parcellation: 'allen',
    regionIds: ['10'], statistics: { count: [2] }, distribution,
  }), /endpoints must be identical across scales/);
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

test('feature metadata validates units and retains representation-specific scalar presentation', () => {
  const valid = goldenFeature();
  assert.throws(() => parseFeatureDescriptor({ ...valid, unit: 10 }, 'feature.json'), /feature.json.unit must be a string/);
  assert.throws(() => parseFeatureDescriptor({
    ...valid,
    display: { ...valid.display, regional: { ...valid.display.regional, range: [0, 'high'] } },
  }, 'feature.json'), /regional display range must contain 2 finite numbers|display.regional.range must contain 2 finite numbers/);
  assert.throws(() => parseFeatureDescriptor({
    ...valid,
    display: {
      ...valid.display,
      regional: {
        ...valid.display.regional,
        scales: [{ kind: 'linear' }, { kind: 'symlog', linear_threshold: 0 }],
      },
    },
  }, 'feature.json'), /signed-log threshold is invalid|linear_threshold must be positive/);
  assert.throws(() => parseFeatureDescriptor({
    ...valid,
    display: {
      ...valid.display,
      regional: {
        ...valid.display.regional,
        range: [0, 10],
        scales: [{ kind: 'linear' }, { kind: 'log' }],
        preferred_scale: 'log',
      },
    },
  }, 'feature.json'), /range shared with log must be positive/);
  assert.throws(() => parseFeatureDescriptor({
    ...valid,
    display: {
      ...valid.display,
      regional: { ...valid.display.regional, scales: [{ kind: 'linear' }, { kind: 'unknown' }] },
    },
  }, 'feature.json'), /scale kind is invalid|kind is unsupported/);
  const feature = parseFeatureDescriptor({
    ...valid,
    display: {
      ...valid.display,
      regional: {
        colormap: 'magma',
        range: [0.1, 10],
        scales: [{ kind: 'linear' }, { kind: 'log' }],
        preferred_scale: 'log',
        distribution_domains: [{ kind: 'full' }],
        preferred_distribution_domain: 'full',
      },
    },
  }, 'feature.json');
  assert.deepEqual(feature.display.regional, {
    colormap: 'magma',
    range: [0.1, 10],
    scales: [{ kind: 'linear' }, { kind: 'log' }],
    preferredScale: 'log',
    distributionDomains: [{ kind: 'full' }],
    preferredDistributionDomain: 'full',
  });
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

test('local import rejects regional distribution rows that do not conserve finite observations', async () => {
  const files = goldenDatasetFiles();
  const path = 'features/rms_ap/allen.distribution.linear-focused.u32';
  const bytes = await files.get(path).arrayBuffer();
  const counts = new Uint32Array(bytes.slice(0));
  counts[0] += 1;
  files.set(path, new Blob([counts.buffer]));
  const statistics = JSON.parse(await files.get('features/rms_ap/allen.statistics.json').text());
  const binning = statistics.distribution.binnings.find((item) => item.id === 'linear-focused');
  setResourceIntegrity(binning.regional_counts.resource, new Uint8Array(counts.buffer));
  replaceStatisticsFeatureAndManifest(files, statistics);
  await assert.rejects(validateLocalDatasetFiles(files), /does not conserve its population/);
});

test('local import rejects a distribution whose full domain does not enclose the summary extrema', async () => {
  const files = goldenDatasetFiles();
  const path = 'features/rms_ap/allen.statistics.json';
  const statistics = JSON.parse(await files.get(path).text());
  for (const full of statistics.distribution.binnings.filter((binning) => binning.domain.kind === 'full')) {
    full.edges[0] = statistics.global.min + 0.01;
  }
  replaceStatisticsFeatureAndManifest(files, statistics);
  await assert.rejects(validateLocalDatasetFiles(files), /population minimum|declared minimum/);
});

test('local import enforces exact per-resource and aggregate decoded limits', async () => {
  const baseline = await validateLocalDatasetFiles(goldenDatasetFiles());
  const maximumResourceDecodedBytes = Math.max(
    ...[...goldenDatasetFiles().values()].map((blob) => blob.size),
  );
  await validateLocalDatasetFiles(goldenDatasetFiles(), {
    limits: { maximumResourceDecodedBytes, maximumDecodedBytes: baseline.declaredDecodedBytes },
  });
  await assert.rejects(
    validateLocalDatasetFiles(goldenDatasetFiles(), {
      limits: { maximumResourceDecodedBytes, maximumDecodedBytes: baseline.declaredDecodedBytes - 1 },
    }),
    /aggregate decoded-size limit/i,
  );
  await assert.rejects(
    validateLocalDatasetFiles(goldenDatasetFiles(), {
      limits: { maximumResourceDecodedBytes: maximumResourceDecodedBytes - 1, maximumDecodedBytes: Number.MAX_SAFE_INTEGER },
    }),
    /per-resource decoded-size limit|manifest\.json exceeds/i,
  );
});

test('local import supports bounded gzip JSON resources and accounts for decoded artifacts', async () => {
  const files = goldenDatasetFiles();
  const feature = goldenFeature();
  const artifactPath = 'features/rms_ap/rms_ap.csv';
  const artifactDecoded = Buffer.from(await files.get(artifactPath).arrayBuffer());
  const artifactEncoded = gzipSync(artifactDecoded);
  files.set(artifactPath, new Blob([artifactEncoded]));
  setResourceIntegrity(feature.artifacts[0].resource, artifactEncoded, artifactDecoded.byteLength, 'gzip');

  const featureDecoded = Buffer.from(JSON.stringify(feature));
  const featureEncoded = gzipSync(featureDecoded);
  files.set('features/rms_ap/feature.json', new Blob([featureEncoded]));
  const manifest = goldenManifest();
  setResourceIntegrity(manifest.features[0].descriptor.resource, featureEncoded, featureDecoded.byteLength, 'gzip');
  files.set('manifest.json', new Blob([JSON.stringify(manifest)]));

  const validated = await validateLocalDatasetFiles(files);
  assert.equal(validated.features[0].id, 'rms_ap');
  assert.ok(validated.declaredDecodedBytes > validated.storedBytes);
});

test('local import stops inner gzip expansion at the declared decoded length', async () => {
  const files = goldenDatasetFiles();
  const decoded = Buffer.from(JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }));
  const encoded = gzipSync(decoded);
  files.set('features/rms_ap/feature.json', new Blob([encoded]));
  const manifest = goldenManifest();
  setResourceIntegrity(manifest.features[0].descriptor.resource, encoded, 1, 'gzip');
  files.set('manifest.json', new Blob([JSON.stringify(manifest)]));
  await assert.rejects(validateLocalDatasetFiles(files), /decodes to more than 1 bytes/i);
});

test('local import preserves cancellation during graph validation', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled during validation', 'AbortError'));
  await assert.rejects(
    validateLocalDatasetFiles(goldenDatasetFiles(), { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('local import rejects same-size content with a wrong declared SHA-256', async () => {
  const files = goldenDatasetFiles();
  files.set('features/rms_ap/allen.values.f32', new Blob([new Float32Array([1, 2, 3, 4]).buffer]));
  await assert.rejects(validateLocalDatasetFiles(files), /SHA-256 mismatch for features\/rms_ap\/allen\.values\.f32/);
});

test('local import rejects undeclared files after resolving the complete graph', async () => {
  const files = goldenDatasetFiles();
  files.set('undeclared.txt', new Blob(['not declared']));
  await assert.rejects(validateLocalDatasetFiles(files), /undeclared files: undeclared\.txt/i);
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

test('binary descriptors reject unsafe integers and overflowing shape products', () => {
  const resource = {
    path: 'values.f32', media_type: 'application/octet-stream', bytes: 4, sha256: '0'.repeat(64),
    codec: { name: 'none', decoded_bytes: 4 },
  };
  const descriptor = {
    format: 'raw-binary-array-v1', dtype: 'float32', shape: [1], order: 'C', endianness: 'little',
    resource,
  };
  assert.throws(
    () => parseBinaryArray({
      ...descriptor,
      resource: { ...resource, bytes: Number.MAX_SAFE_INTEGER + 1, codec: { name: 'none', decoded_bytes: Number.MAX_SAFE_INTEGER + 1 } },
    }, 'array'),
    /safe integer/,
  );
  assert.throws(
    () => parseBinaryArray({
      ...descriptor,
      shape: [Number.MAX_SAFE_INTEGER, 2],
      resource: { ...resource, bytes: 0, codec: { name: 'none', decoded_bytes: 0 } },
    }, 'array'),
    /safe integer range/,
  );
});
