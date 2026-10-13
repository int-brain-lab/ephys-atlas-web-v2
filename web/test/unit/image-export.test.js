import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageExportSize } from '../../.test-dist/rendering/image-export.js';

test('export resolution uses the source aspect ratio, independent of panel size', () => {
  assert.deepEqual(imageExportSize(340, 300), { width: 2400, height: 2118 });
  assert.deepEqual(imageExportSize(2, 4, 1024), { width: 512, height: 1024 });
  assert.deepEqual(imageExportSize(10000, 1, 10), { width: 10, height: 1 });
});

test('export rejects invalid dimensions and unbounded allocations', () => {
  for (const edge of [0, -1, 1.5, NaN, Infinity, 8193]) assert.throws(() => imageExportSize(2, 3, edge), RangeError);
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => imageExportSize(width, 3), RangeError);
});
