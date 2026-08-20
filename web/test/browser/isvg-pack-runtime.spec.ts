import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';

interface Fixture {
  compressed: number[];
  uncompressedBytes: number;
}

function indexedPack(): Fixture {
  const encoder = new TextEncoder();
  const projection = encoder.encode('coronal');
  const packId = encoder.encode('browser-fixture');
  const fragments = [encoder.encode('<g data-slice="4"/>'), encoder.encode('<g data-slice="9">β</g>')];
  const tableOffset = 28 + projection.length + packId.length;
  const payloadOffset = tableOffset + fragments.length * 20;
  const payloadLength = fragments.reduce((sum, value) => sum + value.length, 0);
  const raw = new Uint8Array(payloadOffset + payloadLength);
  const view = new DataView(raw.buffer);
  raw.set([0x49, 0x53, 0x56, 0x47]);
  view.setUint8(4, 1);
  view.setUint16(6, 28, true);
  view.setUint16(8, projection.length, true);
  view.setUint16(10, packId.length, true);
  view.setUint32(12, fragments.length, true);
  view.setUint32(16, tableOffset, true);
  view.setUint32(20, payloadOffset, true);
  view.setUint32(24, payloadLength, true);
  raw.set(projection, 28);
  raw.set(packId, 28 + projection.length);
  let offset = 0;
  fragments.forEach((fragment, index) => {
    const at = tableOffset + index * 20;
    view.setInt32(at, index === 0 ? 4 : 9, true);
    view.setFloat64(at + 4, index === 0 ? 100 : 225.5, true);
    view.setUint32(at + 12, offset, true);
    view.setUint32(at + 16, fragment.length, true);
    raw.set(fragment, payloadOffset + offset);
    offset += fragment.length;
  });
  return { compressed: Array.from(gzipSync(raw)), uncompressedBytes: raw.byteLength };
}

async function loadRuntime(page: import('@playwright/test').Page, fixture: Fixture) {
  await page.goto('/');
  return page.evaluate(async ({ compressed, uncompressedBytes }) => {
    const { createIsvgPackRuntime } = await import('/src/rendering/isvg-pack-runtime.ts');
    const runtime = createIsvgPackRuntime({ maxDecodedBytes: 1024 * 1024 });
    const descriptor = { projection: 'coronal', packId: 'browser-fixture', uncompressedBytes };
    const loaded = await runtime.loadPack(descriptor, new Uint8Array(compressed));
    const first = await runtime.getFragment('browser-fixture', 9);
    const second = await runtime.get('browser-fixture', 9);
    return { loaded, first, second };
  }, fixture);
}

test('real module worker returns only requested indexed SVG fragments and retains the pack', async ({ page }) => {
  const result = await loadRuntime(page, indexedPack());
  expect(result.loaded).toEqual({ projection: 'coronal', packId: 'browser-fixture', sliceCount: 2, decodedBytes: expect.any(Number), evictedPackIds: [] });
  expect(result.first).toEqual({ sliceIndex: 9, worldCoordinateUm: 225.5, svg: '<g data-slice="9">β</g>' });
  expect(result.second).toEqual(result.first);
});

test('worker validation rejects identity and decoded-size mismatches without retaining bad packs', async ({ page }) => {
  const fixture = indexedPack();
  await page.goto('/');
  const result = await page.evaluate(async ({ compressed, uncompressedBytes }) => {
    const { createIsvgPackRuntime } = await import('/src/rendering/isvg-pack-runtime.ts');
    const runtime = createIsvgPackRuntime({ maxDecodedBytes: 1 });
    const bytes = new Uint8Array(compressed);
    const identity = await runtime.loadPack({ projection: 'sagittal', packId: 'browser-fixture', uncompressedBytes }, bytes).then(() => 'unexpected', (error: Error) => error.message);
    const size = await runtime.loadPack({ projection: 'coronal', packId: 'browser-fixture', uncompressedBytes: uncompressedBytes + 1 }, bytes).then(() => 'unexpected', (error: Error) => error.message);
    const absent = await runtime.get('browser-fixture', 9);
    const oversized = await runtime.loadPack({ projection: 'coronal', packId: 'browser-fixture', uncompressedBytes, entries: [{ sliceIndex: 4, worldCoordinateUm: 100 }, { sliceIndex: 9, worldCoordinateUm: 225.5 }] }, bytes)
      .then(() => 'unexpected', (error: Error) => error.message);
    runtime.dispose();
    return { identity, size, absent, oversized };
  }, fixture);
  expect(result.identity).toMatch(/identity does not match/);
  expect(result.size).toMatch(/expected/);
  expect(result.absent).toBeNull();
  expect(result.oversized).toMatch(/exceeds maxDecodedBytes/);
});

test('eviction removes a resident pack and disposal rejects pending/future requests', async ({ page }) => {
  const fixture = indexedPack();
  await page.goto('/');
  const result = await page.evaluate(async ({ compressed, uncompressedBytes }) => {
    const { createIsvgPackRuntime } = await import('/src/rendering/isvg-pack-runtime.ts');
    const runtime = createIsvgPackRuntime();
    const descriptor = { projection: 'coronal', packId: 'browser-fixture', uncompressedBytes };
    await runtime.load(descriptor, new Uint8Array(compressed));
    await runtime.evict('browser-fixture');
    const afterEvict = await runtime.get('browser-fixture', 4);
    runtime.dispose();
    const afterDispose = await runtime.get('browser-fixture', 4).then(() => 'unexpected', (error: Error) => error.message);
    return { afterEvict, afterDispose };
  }, fixture);
  expect(result.afterEvict).toBeNull();
  expect(result.afterDispose).toMatch(/disposed/);
});
