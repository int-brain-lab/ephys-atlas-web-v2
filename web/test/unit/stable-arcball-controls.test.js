import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { arcballDragQuaternion, screenToArcball } from '../../.test-dist/rendering/3d/stable-arcball-controls.js';

test('screenToArcball projects inside and normalizes outside the virtual sphere', () => {
  assert.deepEqual(screenToArcball(0, 0).toArray(), [0, 0, 1]);
  assert.ok(Math.abs(screenToArcball(2, 0).length() - 1) < 1e-12);
});

test('press-referenced arcball has identity for a closed drag', () => {
  const start = new Vector3(.2, -.3, Math.sqrt(.87)).normalize();
  const closed = arcballDragQuaternion(start, start);
  assert.ok(Math.abs(closed.x) < 1e-12);
  assert.ok(Math.abs(closed.y) < 1e-12);
  assert.ok(Math.abs(closed.z) < 1e-12);
  assert.ok(Math.abs(closed.w - 1) < 1e-12);
});
