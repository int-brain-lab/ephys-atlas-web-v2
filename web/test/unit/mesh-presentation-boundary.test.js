import assert from 'node:assert/strict';
import test from 'node:test';
import { meshPresentationAtMl } from '../../.test-dist/rendering/3d/mesh-presentation-boundary.js';

test('original ML presentation preserves exact-zero choice, near-plane band and single-sided caps', () => {
  const rule = { coordinate: 'original-world-ml', threshold_um: 0, on_plane_side: 'right', status: 'provisional-review' };
  assert.equal(meshPresentationAtMl(-.000001, 4, 8, rule), 4);
  assert.equal(meshPresentationAtMl(0, 4, 8, rule), 8);
  assert.equal(meshPresentationAtMl(0, 4, 8, { ...rule, on_plane_side: 'left' }), 4);
  assert.equal(meshPresentationAtMl(-.0005, 4, 8, { ...rule, threshold_um: .001 }), 8);
  assert.equal(meshPresentationAtMl(.0005, 4, 8, { ...rule, threshold_um: .001, on_plane_side: 'left' }), 4);
  assert.equal(meshPresentationAtMl(0, 4, -1, rule), 4);
  assert.equal(meshPresentationAtMl(0, -1, 8, rule), 8);
});
