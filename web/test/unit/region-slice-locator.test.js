import assert from 'node:assert/strict';
import test from 'node:test';
import { RegionSliceLocator } from '../../.test-dist/rendering/region-slice-locator.js';
import { createDisplaySliceInventories } from '../../.test-dist/rendering/display-slice-inventory.js';

function fixture() {
  const calls = [];
  const source = {
    async getDisplaySliceInventories() {
      return createDisplaySliceInventories({ coronal: [1, 9, 17], sagittal: [1, 9, 17], horizontal: [1, 9, 17] });
    },
    async loadSlice(axis, index, signal) {
      signal?.throwIfAborted();
      calls.push([axis, index]);
      const target = { coronal: 9, sagittal: 1, horizontal: 17 }[axis];
      return { sliceIndex: index, svgFragment: index === target
        ? '<path data-allen-id="-68" data-beryl-id="362" data-cosmos-id="688" d="M0 0L1 0L1 1Z"/>'
        : '<path data-allen-id="997" data-beryl-id="997" data-cosmos-id="997"/>' };
    },
  };
  return { source, calls, locator: new RegionSliceLocator(source) };
}

test('finds nearest visible planes across mappings and signed physical IDs; reuses presence data', async () => {
  const { locator, calls } = fixture();
  const current = { coronal: 11, sagittal: 9, horizontal: 9 };
  const expected = { coronal: 11, sagittal: 1, horizontal: 17 };
  assert.deepEqual(await locator.locate('-68', 'allen', current, new AbortController().signal), expected);
  const count = calls.length;
  assert.deepEqual(await locator.locate('-362', 'beryl', current, new AbortController().signal), expected);
  assert.deepEqual(await locator.locate('688', 'cosmos', current, new AbortController().signal), expected);
  assert.equal(calls.length, count);
});

test('missing planes and invalid IDs return no cursor, and void does not scan', async () => {
  const { locator, calls } = fixture();
  const current = { coronal: 9, sagittal: 9, horizontal: 9 };
  assert.equal(await locator.locate('0', 'allen', current, new AbortController().signal), null);
  assert.equal(await locator.locate('abc', 'allen', current, new AbortController().signal), null);
  assert.equal(calls.length, 0);
  assert.equal(await locator.locate('-999', 'allen', current, new AbortController().signal), null);
  assert.equal(calls.length, 9);
});

test('cancellation stops a scan and failures remain retryable', async () => {
  const { locator, source } = fixture();
  const current = { coronal: 9, sagittal: 9, horizontal: 9 };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(locator.locate('-68', 'allen', current, controller.signal), { name: 'AbortError' });
  const load = source.loadSlice;
  source.loadSlice = async () => { throw new Error('offline'); };
  await assert.rejects(locator.locate('-68', 'allen', current, new AbortController().signal), /offline/);
  source.loadSlice = load;
  assert.deepEqual(await locator.locate('-68', 'allen', current, new AbortController().signal),
    { coronal: 9, sagittal: 1, horizontal: 17 });
});

test('an aborted lookup ignores late shared reads without aborting those reads', async () => {
  const { locator, source } = fixture();
  const original = source.loadSlice;
  const controller = new AbortController();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  source.loadSlice = async (axis, index, signal) => {
    assert.equal(signal, undefined);
    await gate;
    return original(axis, index);
  };
  const finding = locator.locate('-68', 'allen', { coronal: 9, sagittal: 9, horizontal: 9 }, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  release();
  await assert.rejects(finding, { name: 'AbortError' });
});
