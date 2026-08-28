import assert from 'node:assert/strict';
import test from 'node:test';
import { regionalColorTextureRgb } from '../../.test-dist/rendering/3d/brain-scene-viewport.js';

test('3-D lookup accepts the modern CSS rgb syntax used by shared feature palettes', () => {
  assert.deepEqual(regionalColorTextureRgb('rgb(68 1 84)'), [68, 1, 84]);
  assert.deepEqual(regionalColorTextureRgb('rgb(68, 1, 84)'), [68, 1, 84]);
  assert.deepEqual(regionalColorTextureRgb('rgb(68 1 84)'), regionalColorTextureRgb('#440154'));
});

test('3-D lookup preserves shared hexadecimal anatomy colors', () => {
  assert.deepEqual(regionalColorTextureRgb('#00ff00'), [0, 255, 0]);
});
