import assert from 'node:assert/strict';
import test from 'node:test';
import { category, analyze, planePoint, offset, readState, writeState } from '../../.test-dist/labs/agea-model.js';

test('AGEA missing, zero and anatomy are independent categories', () => {
  assert.deepEqual([category(2, 1), category(0, 1), category(2, 0), category(0, 0),
    category(-1, 1), category(-1, 0), category(NaN, 1), category(-2, 0)], [0, 1, 2, 3, 4, 5, 6, 6]);
  const result = analyze(Float32Array.from([0, 2, -1, 0, 10, -1, NaN]), Int32Array.from([1, 1, 1, 0, 0, 0, 0]));
  assert.deepEqual(result.counts, [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(result.all.count, 4); assert.equal(result.all.mean, 3);
  assert.equal(result.labelled.mean, 1); assert.equal(result.unlabelled.mean, 5);
  assert.equal(result.bins[1][47], 1); // maximum belongs to the final bin
  assert.deepEqual(result.bins.map(b => b.reduce((a, b) => a + b)), [2, 2]);
});
test('AGEA empty populations stay unavailable and retain zero counts', () => {
  const result = analyze(Float32Array.from([-1, -1]), Int32Array.from([1, 0]));
  assert.equal(result.labelled.mean, null); assert.equal(result.all.count, 0);
  assert.equal(result.bins.flat().reduce((a, b) => a + b), 0);
});
test('AGEA source axes map clicks without swapping AP and DV', () => {
  const cursor = [1, 2, 3];
  assert.deepEqual(planePoint('coronal', 4, 5, cursor), [4, 5, 3]);
  assert.deepEqual(planePoint('sagittal', 4, 5, cursor), [1, 5, 4]);
  assert.deepEqual(planePoint('horizontal', 4, 5, cursor), [4, 2, 5]);
  assert.equal(offset([1, 2, 3], [58, 41, 67]), (41 + 2) * 67 + 3);
});
test('AGEA deep links restore policies and reject invalid selections', () => {
  const state = readState('?gene=b&voxel=100,-3,7&mode=comparison&rescale=1&outlines=0', [58, 41, 67], ['a', 'b']);
  assert.deepEqual(state.cursor, [57, 0, 7]); assert.equal(state.gene, 'b');
  const url = new URL(writeState(state, 'http://localhost/?lab=agea-coverage'));
  assert.deepEqual(readState(url.search, [58, 41, 67], ['a', 'b']), state);
  assert.equal(readState('?gene=unknown&mode=bad', [58, 41, 67], ['a']).gene, 'a');
});
