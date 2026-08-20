import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSvgPack, parseIndexedSvgPack } from '../../web/src/rendering/svg-pack.js';

function sampleBytes(): Uint8Array {
  // ISVG v1, identities "coronal" / "synthetic-pack", two entries.
  const projection = new TextEncoder().encode('coronal');
  const pack = new TextEncoder().encode('synthetic-pack');
  const first = new TextEncoder().encode('<path id="a"/>');
  const second = new TextEncoder().encode('<path id="β"/>');
  const table = 28 + projection.length + pack.length;
  const payload = table + 40;
  const result = new Uint8Array(payload + first.length + second.length);
  const view = new DataView(result.buffer);
  result.set([0x49, 0x53, 0x56, 0x47]);
  view.setUint8(4, 1); view.setUint16(6, 28, true); view.setUint16(8, projection.length, true); view.setUint16(10, pack.length, true);
  view.setUint32(12, 2, true); view.setUint32(16, table, true); view.setUint32(20, payload, true); view.setUint32(24, first.length + second.length, true);
  result.set(projection, 28); result.set(pack, 28 + projection.length);
  view.setInt32(table, 4, true); view.setFloat64(table + 4, 100, true); view.setUint32(table + 12, 0, true); view.setUint32(table + 16, first.length, true);
  view.setInt32(table + 20, 9, true); view.setFloat64(table + 24, 225.5, true); view.setUint32(table + 32, first.length, true); view.setUint32(table + 36, second.length, true);
  result.set(first, payload); result.set(second, payload + first.length);
  return result;
}

test('strict SVG pack decoder round-trips synthetic fragments', () => {
  const decoded = decodeSvgPack(sampleBytes());
  assert.equal(decoded.projection, 'coronal');
  assert.equal(decoded.packId, 'synthetic-pack');
  assert.deepEqual(decoded.fragments.map((fragment) => fragment.svg), ['<path id="a"/>', '<path id="β"/>']);
});

test('indexed SVG pack lookup decodes only the requested fragment contract', () => {
  const indexed = parseIndexedSvgPack(sampleBytes());
  assert.deepEqual(indexed.entries.map((entry) => entry.sliceIndex), [4, 9]);
  assert.deepEqual(indexed.fragment(9), {
    sliceIndex: 9,
    worldCoordinateUm: 225.5,
    svg: '<path id="β"/>',
  });
  assert.equal(indexed.fragment(5), undefined);
});

test('strict SVG pack decoder rejects truncated and invalid UTF-8 payloads', () => {
  assert.throws(() => decodeSvgPack(sampleBytes().subarray(0, -1)), /offsets|truncated/);
  const invalid = sampleBytes(); invalid[invalid.length - 1] = 0xff;
  assert.throws(() => decodeSvgPack(invalid), /UTF-8/);
});
