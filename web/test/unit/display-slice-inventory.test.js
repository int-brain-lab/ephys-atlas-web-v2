import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDisplaySliceInventory,
  createDisplaySliceInventories,
  createDisplaySliceInventoriesFromManifest,
} from '../../.test-dist/rendering/display-slice-inventory.js';

test('maps display ordinals to explicit native indices and clamps ordinal steps', () => {
  const inventory = createDisplaySliceInventory([0, 8, 16, 24]);
  assert.equal(inventory.count, 4);
  assert.deepEqual(inventory.indices, [0, 8, 16, 24]);
  assert.equal(inventory.nativeIndexAtOrdinal(2), 16);
  assert.equal(inventory.step(1, 1), 2);
  assert.equal(inventory.step(0, -3), 0);
  assert.equal(inventory.step(3, 4), 3);
});

test('resolves native URL state to nearest display plane with lower-index tie break', () => {
  const inventory = createDisplaySliceInventory([10, 30, 50]);
  assert.equal(inventory.ordinalForNativeIndex(30), 1);
  assert.equal(inventory.ordinalForNativeIndex(39), 1);
  assert.equal(inventory.ordinalForNativeIndex(40), 1);
  assert.equal(inventory.ordinalForNativeIndex(41), 2);
  assert.equal(inventory.ordinalForNativeIndex(-100), 0);
  assert.equal(inventory.ordinalForNativeIndex(100), 2);
});

test('validates explicit sorted indices independently for each axis', () => {
  const inventories = createDisplaySliceInventories({
    coronal: [0, 80],
    sagittal: [1, 81, 161],
    horizontal: [4],
  });
  assert.equal(inventories.coronal.nativeIndexAtOrdinal(1), 80);
  assert.equal(inventories.sagittal.ordinalForNativeIndex(120), 1);
  assert.equal(inventories.horizontal.count, 1);
  assert.throws(() => createDisplaySliceInventory([]), /at least one/);
  assert.throws(() => createDisplaySliceInventory([0, 0]), /strictly increasing/);
  assert.throws(() => createDisplaySliceInventory([0, 1.5]), /integer/);
});

test('adapts explicit manifest projection inventories and rejects legacy implicit domains', () => {
  const inventories = createDisplaySliceInventoriesFromManifest({
    coronal: { sliceCount: 1320, displaySliceIndices: [0, 80, 160] },
    sagittal: { sliceCount: 1140, displaySliceIndices: [0, 80] },
    horizontal: { sliceCount: 800, displaySliceIndices: [0, 80] },
  });
  assert.equal(inventories.coronal.nativeIndexAtOrdinal(2), 160);
  assert.throws(() => createDisplaySliceInventoriesFromManifest({
    coronal: { sliceCount: 1 }, sagittal: { sliceCount: 1, displaySliceIndices: [0] }, horizontal: { sliceCount: 1, displaySliceIndices: [0] },
  }), /required/);
  assert.throws(() => createDisplaySliceInventoriesFromManifest({
    coronal: { sliceCount: 10, displaySliceIndices: [10] }, sagittal: { sliceCount: 1, displaySliceIndices: [0] }, horizontal: { sliceCount: 1, displaySliceIndices: [0] },
  }), /outside/);
});
