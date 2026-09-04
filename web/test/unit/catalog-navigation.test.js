import assert from 'node:assert/strict';
import test from 'node:test';
import {
  overrideNavigationRelease,
  resolveDatasetNavigation,
  resolveDatasetNavigationRequest,
  selectNavigationEdition,
  selectNavigationProject,
  switchNavigationDataset,
} from '../../.test-dist/application/dataset-navigation.js';

const release = (id) => ({ id, label: id, manifest: `x/${id}`, immutable: true });
const catalog = { schemaVersion: '1.0', defaultProject: 'p', projects: [{ id: 'p', title: 'P', datasetIds: ['a', 'b', 'c'], defaultDataset: 'a', defaultEdition: 'e', editions: [{ id: 'e', label: 'E', datasetReleases: new Map([['a', 'r1'], ['b', 'r2']]) }] }], datasets: [{ id: 'a', source: 'published', projectId: 'p', title: 'A', releases: [release('r1'), release('r3')], defaultRelease: 'r3' }, { id: 'b', source: 'published', projectId: 'p', title: 'B', releases: [release('r2')], defaultRelease: 'r2' }, { id: 'c', source: 'published', projectId: 'p', title: 'C', releases: [release('r4')], defaultRelease: 'r4' }] };

test('edition resolves mapped release and custom override stays custom', () => {
  const edition = resolveDatasetNavigation(catalog, 'a', undefined, { kind: 'edition', projectId: 'p', editionId: 'e' });
  assert.equal(edition.releaseId, 'r1');
  assert.equal(overrideNavigationRelease(catalog, edition, 'r3').releaseId, 'r3');
});

test('custom baseline maps in-scope datasets and defaults out-of-scope', () => {
  assert.equal(resolveDatasetNavigation(catalog, 'b', undefined, { kind: 'custom', projectId: 'p', baseEditionId: 'e' }).releaseId, 'r2');
  assert.equal(resolveDatasetNavigation(catalog, 'c', undefined, { kind: 'custom', projectId: 'p', baseEditionId: 'e' }).releaseId, 'r4');
  assert.throws(() => resolveDatasetNavigation(catalog, 'missing'), /Unknown dataset/);
});

test('project and edition selection are explicit resolver transitions', () => {
  assert.equal(selectNavigationProject(catalog, 'p').releaseId, 'r1');
  assert.deepEqual(selectNavigationEdition(catalog, 'p', 'e').context, {
    kind: 'edition', projectId: 'p', editionId: 'e',
  });
});

test('blank intent uses catalog project, dataset, and edition defaults', () => {
  const resolved = resolveDatasetNavigationRequest(catalog, {});
  assert.deepEqual(resolved.context, { kind: 'edition', projectId: 'p', editionId: 'e' });
  assert.equal(resolved.dataset.id, 'a');
  assert.equal(resolved.releaseId, 'r1');
});

test('old exact links are custom and discover the owning project', () => {
  const resolved = resolveDatasetNavigationRequest(catalog, { datasetId: 'a', releaseId: 'r3' });
  assert.deepEqual(resolved.context, { kind: 'custom', projectId: 'p' });
  assert.equal(resolved.releaseId, 'r3');
});

test('edition dataset switching follows mappings and override retains its baseline', () => {
  const edition = resolveDatasetNavigationRequest(catalog, { context: 'edition', projectId: 'p', editionId: 'e' });
  const switched = switchNavigationDataset(catalog, edition, 'b');
  assert.equal(switched.releaseId, 'r2');
  const outside = switchNavigationDataset(catalog, edition, 'c');
  assert.equal(outside.releaseId, 'r4');
  assert.deepEqual(outside.context, { kind: 'custom', projectId: 'p', baseEditionId: 'e' });
  const overridden = overrideNavigationRelease(catalog, edition, 'r3');
  assert.deepEqual(overridden.context, { kind: 'custom', projectId: 'p', baseEditionId: 'e' });
});

test('unknown custom baselines and mixed local/public context are rejected', () => {
  assert.throws(() => resolveDatasetNavigation(catalog, 'a', undefined, {
    kind: 'custom', projectId: 'p', baseEditionId: 'missing',
  }), /Unknown base edition/);
  assert.throws(() => resolveDatasetNavigationRequest(catalog, {
    context: 'local', projectId: 'p', datasetId: 'local', releaseId: 'r1',
  }), /cannot include public project/);
});

test('invalid explicit edition identities and mismatched releases stay errors', () => {
  assert.throws(() => resolveDatasetNavigationRequest(catalog, {
    context: 'edition', projectId: 'p', editionId: 'missing', datasetId: 'a',
  }), /Unknown edition missing/);
  assert.throws(() => resolveDatasetNavigationRequest(catalog, {
    context: 'edition', projectId: 'p', editionId: 'e', datasetId: 'a', releaseId: 'r3',
  }), /does not match edition/);
});
