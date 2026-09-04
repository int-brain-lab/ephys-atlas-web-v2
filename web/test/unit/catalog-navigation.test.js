import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDatasetNavigation } from '../../.test-dist/domain/navigation.js';

const release = (id) => ({ id, label: id, manifest: `x/${id}`, immutable: true });
const catalog = { schemaVersion: '1.0', defaultProject: 'p', projects: [{ id: 'p', title: 'P', datasetIds: ['a', 'b'], defaultDataset: 'a', editions: [{ id: 'e', label: 'E', datasetReleases: new Map([['a', 'r1'], ['b', 'r2']]) }] }], datasets: [{ id: 'a', source: 'published', projectId: 'p', title: 'A', releases: [release('r1'), release('r3')], defaultRelease: 'r3' }, { id: 'b', source: 'published', projectId: 'p', title: 'B', releases: [release('r2')], defaultRelease: 'r2' }] };

test('edition resolves mapped release and custom override stays custom', () => {
  assert.equal(resolveDatasetNavigation(catalog, 'a', undefined, { kind: 'edition', projectId: 'p', editionId: 'e' }).releaseId, 'r1');
  assert.equal(resolveDatasetNavigation(catalog, 'a', 'r3', { kind: 'edition', projectId: 'p', editionId: 'e' }).releaseId, 'r3');
});

test('custom baseline maps in-scope datasets and defaults out-of-scope', () => {
  assert.equal(resolveDatasetNavigation(catalog, 'b', undefined, { kind: 'custom', projectId: 'p', baseEditionId: 'e' }).releaseId, 'r2');
  assert.throws(() => resolveDatasetNavigation(catalog, 'missing'), /Unknown dataset/);
});
