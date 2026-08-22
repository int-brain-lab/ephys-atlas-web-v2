import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOrthogonalNavigation, deriveRegionalSliceIndices } from '../../.test-dist/domain/navigation.js';
import {
  ORTHOGONAL_PROJECTION_REGISTRY,
  PROJECTION_REGISTRY,
  WORKSPACE_VIEW_REGISTRY,
} from '../../.test-dist/domain/projections.js';

test('enabled projection and workspace registries keep projection and secondary identities distinct', () => {
  assert.deepEqual(PROJECTION_REGISTRY.map(({ kind, id }) => [kind, id]), [
    ['orthogonal', 'coronal'],
    ['orthogonal', 'sagittal'],
    ['orthogonal', 'horizontal'],
    ['static', 'top'],
    ['static', 'swanson'],
  ]);
  assert.deepEqual(WORKSPACE_VIEW_REGISTRY.map(({ kind, id }) => [kind, id]), [
    ['projection', 'coronal'],
    ['projection', 'sagittal'],
    ['projection', 'horizontal'],
    ['secondary', 'secondary'],
  ]);
});

test('one world cursor derives every native plane and each projection guide pair', () => {
  const cursor = { xUm: -39, yUm: -1210, zUm: -3678 };
  assert.deepEqual(deriveRegionalSliceIndices(cursor), {
    coronal: 661,
    sagittal: 570,
    horizontal: 401,
  });
  for (const projection of ORTHOGONAL_PROJECTION_REGISTRY) {
    const navigation = deriveOrthogonalNavigation(cursor, projection.id);
    assert.equal(navigation.nativeIndex, deriveRegionalSliceIndices(cursor)[projection.id]);
    assert.equal(navigation.guides.length, 2);
    assert.equal(navigation.guides.every(({ targetAxis }) => targetAxis === projection.id), true);
  }
});
