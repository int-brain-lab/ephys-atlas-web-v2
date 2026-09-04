import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySyntheticZScore,
  reconcileComparison,
  reduceComparisonState,
} from '../../.test-dist/domain/comparison.js';

const dataset = (releaseId = 'r1') => ({ datasetId: 'synthetic_comparison', releaseId });
const regional = (parcellation = 'allen', normalizationIds = ['synthetic-z-v1']) => ({
  kind: 'regional', parcellation, normalizationIds,
});
const volume = (referenceSpaceId, gridId, normalizationIds = ['synthetic-z-v1']) => ({
  kind: 'volume', referenceSpaceId, gridId, normalizationIds,
});
const feature = (id, representations = [regional()], groupIds = []) => ({ id, groupIds, representations });
const release = (features, releaseId = 'r1') => ({ dataset: dataset(releaseId), features });
const state = (overrides = {}) => ({
  dataset: dataset(),
  scope: { kind: 'all' },
  mode: 'gallery',
  orientation: 'coronal',
  target: { kind: 'regional', parcellation: 'allen' },
  normalizationId: 'synthetic-z-v1',
  activeFeatureId: null,
  pinnedFeatureIds: [],
  ...overrides,
});

test('symbolic and explicit scopes resolve release order at arbitrary sizes', () => {
  for (const count of [3, 20, 100, 4_345]) {
    const features = Array.from({ length: count }, (_, index) => feature(`f${index}`));
    const resolved = reconcileComparison(
      state(),
      release(features),
    );
    assert.equal(resolved.status, 'ready');
    assert.equal(resolved.state.scope.kind, 'all');
    assert.equal(resolved.featureIds.length, count);
    assert.equal(resolved.featureIds[0], 'f0');
    assert.equal(resolved.featureIds.at(-1), `f${count - 1}`);

    const explicit = reconcileComparison(state({
      scope: { kind: 'explicit', featureIds: features.map(({ id }) => id).reverse() },
    }), release(features));
    assert.equal(explicit.status, 'ready');
    assert.deepEqual(explicit.featureIds, features.map(({ id }) => id));
  }
});

test('group and explicit scopes preserve canonical release-relative ordering', () => {
  const features = [
    feature('a', [regional()], ['early']),
    feature('b', [regional()], ['late']),
    feature('c', [regional()], ['early']),
    feature('d', [regional()], ['early']),
  ];
  const grouped = reconcileComparison(state({ scope: { kind: 'group', groupId: 'early' } }), release(features));
  assert.deepEqual(grouped.featureIds, ['a', 'c', 'd']);
  assert.deepEqual(grouped.state.scope, { kind: 'group', groupId: 'early' });

  const explicit = reconcileComparison(state({
    scope: { kind: 'explicit', featureIds: ['d', 'unknown', 'b', 'd', 'a'] },
  }), release(features));
  assert.deepEqual(explicit.featureIds, ['a', 'b', 'd']);
  assert.deepEqual(explicit.state.scope, { kind: 'explicit', featureIds: ['a', 'b', 'd'] });
});

test('release reconciliation removes stale identities while retaining surviving pin order', () => {
  const resolved = reconcileComparison(state({
    dataset: dataset('old'),
    scope: { kind: 'explicit', featureIds: ['a', 'b', 'c'] },
    activeFeatureId: 'b',
    pinnedFeatureIds: ['c', 'stale', 'a', 'c'],
  }), release([feature('c'), feature('a')], 'new'));

  assert.deepEqual(resolved.state.dataset, dataset('new'));
  assert.deepEqual(resolved.state.scope, { kind: 'explicit', featureIds: ['c', 'a'] });
  assert.equal(resolved.state.activeFeatureId, 'c');
  assert.deepEqual(resolved.state.pinnedFeatureIds, ['c', 'a']);
});

test('explicit mixed or incompatible targets fail closed with exact identities', () => {
  const features = [
    feature('allen', [regional('allen')]),
    feature('beryl', [regional('beryl')]),
    feature('volume-a', [volume('allen-ccf-v3', 'grid-10um')]),
  ];
  const resolved = reconcileComparison(state({
    scope: { kind: 'explicit', featureIds: ['allen', 'beryl', 'volume-a'] },
    activeFeatureId: 'allen',
    pinnedFeatureIds: ['allen'],
  }), release(features));

  assert.equal(resolved.status, 'incompatible');
  assert.deepEqual(resolved.featureIds, []);
  assert.deepEqual(resolved.incompatibleFeatureIds, ['beryl', 'volume-a']);
  assert.equal(resolved.state.activeFeatureId, null);
  assert.deepEqual(resolved.state.pinnedFeatureIds, []);
});

test('symbolic scopes select compatible targets and volume grids do not define compatibility', () => {
  const features = [
    feature('regional', [regional()]),
    feature('volume-10', [volume('allen-ccf-v3', 'grid-10um')], ['volumes']),
    feature('volume-50', [volume('allen-ccf-v3', 'grid-50um')], ['volumes']),
    feature('other-space', [volume('other-space', 'grid-50um')], ['volumes']),
  ];
  const resolved = reconcileComparison(state({
    scope: { kind: 'group', groupId: 'volumes' },
    target: { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' },
  }), release(features));

  assert.equal(resolved.status, 'ready');
  assert.deepEqual(resolved.featureIds, ['volume-10', 'volume-50']);

  const explicit = reconcileComparison(state({
    scope: { kind: 'explicit', featureIds: ['volume-10', 'other-space'] },
    target: { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' },
  }), release(features));
  assert.equal(explicit.status, 'incompatible');
  assert.deepEqual(explicit.incompatibleFeatureIds, ['other-space']);
});

test('missing groups and normalization identities resolve to an empty comparison', () => {
  const missingGroup = reconcileComparison(
    state({ scope: { kind: 'group', groupId: 'missing' } }),
    release([feature('a')]),
  );
  assert.equal(missingGroup.status, 'empty');
  assert.deepEqual(missingGroup.featureIds, []);

  const missingNormalization = reconcileComparison(
    state({ normalizationId: 'not-declared' }),
    release([feature('a')]),
  );
  assert.equal(missingNormalization.status, 'empty');
});

test('comparison reducer changes one intent field and keeps pin order unique', () => {
  const initial = state({ activeFeatureId: 'a', pinnedFeatureIds: ['a'] });
  let next = reduceComparisonState(initial, { type: 'mode/set', mode: 'profile' });
  next = reduceComparisonState(next, { type: 'orientation/set', orientation: 'sagittal' });
  next = reduceComparisonState(next, { type: 'pin/toggle', featureId: 'b' });
  next = reduceComparisonState(next, { type: 'pin/toggle', featureId: 'a' });

  assert.equal(next.mode, 'profile');
  assert.equal(next.orientation, 'sagittal');
  assert.equal(next.activeFeatureId, 'a');
  assert.deepEqual(next.pinnedFeatureIds, ['b']);
  assert.deepEqual(next.scope, initial.scope);
  assert.deepEqual(next.dataset, initial.dataset);
});

test('synthetic z-scores require explicit valid parameters and preserve missingness', () => {
  const definition = {
    kind: 'synthetic-zscore', id: 'synthetic-z-v1', label: 'Synthetic test baseline',
    mean: 10, standardDeviation: 2, zeroVariance: 'missing',
  };
  assert.equal(applySyntheticZScore(14, definition), 2);
  assert.equal(applySyntheticZScore(null, definition), null);
  assert.equal(applySyntheticZScore(Number.NaN, definition), null);
  assert.equal(applySyntheticZScore(14, { ...definition, standardDeviation: 0 }), null);
  assert.throws(
    () => applySyntheticZScore(14, { ...definition, standardDeviation: -1 }),
    /standard deviation must be finite and non-negative/,
  );
});
