import assert from 'node:assert/strict';
import test from 'node:test';

import type { VolumeFeaturePayload } from '../../web/src/data/contracts.js';
import type { SliceAxis } from '../../web/src/domain/types.js';
import { locateVolumePlane } from '../../web/src/rendering/chunked-volume-source.js';
import {
  registeredVolumeCanvasPlacement,
  volumeScalarCacheBudget,
} from '../../web/src/rendering/retained-projection-viewport.js';
import {
  assertCompatibleReferenceSpace,
  inspectVolumePlanePoint,
  volumeValueIsVisible,
} from '../../web/src/rendering/volume-inspection.js';
import { SchemaSlicePackVolumeSource } from '../../web/src/rendering/slice-pack-volume-source.js';
import { VolumeValiditySliceSource } from '../../web/src/rendering/volume-validity-source.js';
import {
  VolumeChunkCache,
  VolumeSliceLoader,
  AbortableRequestCache,
  chunkKeysForSlice,
  scalarToRgba,
  type VolumeChunk,
  type VolumeChunkKey,
  type VolumeChunkMetadata,
  type VolumeChunkSource,
} from '../../web/src/rendering/volume.js';

const axisNames: Record<SliceAxis, 'ap' | 'ml' | 'dv'> = {
  coronal: 'ap',
  sagittal: 'ml',
  horizontal: 'dv',
};

function makeSlicePackFeature(axisOrder: readonly ['dv', 'ap', 'ml'] = ['dv', 'ap', 'ml']): {
  feature: VolumeFeaturePayload;
  loads: Map<string, number>;
} {
  const anatomicalShape = { ap: 5, ml: 4, dv: 3 };
  const shape = axisOrder.map((axis) => anatomicalShape[axis]) as [number, number, number];
  const packDepth = 2;
  const loads = new Map<string, number>();
  const packs = (['coronal', 'sagittal', 'horizontal'] as const).flatMap((axis) => {
    const dimension = axisOrder.indexOf(axisNames[axis]);
    const packCount = Math.ceil(shape[dimension]! / packDepth);
    return Array.from({ length: packCount }, (_, pack) => {
      const firstSlice = pack * packDepth;
      const depth = Math.min(packDepth, shape[dimension]! - firstSlice);
      const remainingDimensions = [0, 1, 2].filter((candidate) => candidate !== dimension);
      const decodedShape = [depth, shape[remainingDimensions[0]!]!, shape[remainingDimensions[1]!]!] as [number, number, number];
      const storageAxes = [`i${dimension}`, ...remainingDimensions.map((candidate) => `i${candidate}`)] as [
        'i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2',
      ];
      const bytes = decodedShape.reduce((product, size) => product * size, 4);
      return {
        axis: `i${dimension}`,
        firstSlice,
        sliceCount: depth,
        decoded: { shape: decodedShape, storageAxes },
        resource: {
          path: `${axis}/${pack}.f32`, mediaType: 'application/octet-stream', bytes,
          sha256: '0'.repeat(64), codec: { name: 'none' as const, decodedBytes: bytes },
        },
      };
    });
  });
  const resource = { pack_depth: packDepth, packs };
  const feature: VolumeFeaturePayload = {
    schemaVersion: '1.0',
    featureId: 'memory-slice-packs',
    representation: 'volume',
    descriptor: {
      kind: 'volume',
      format: 'ephys-atlas-volume-v1',
      layout: 'orthogonal_slice_packs',
      grid: {
        shape,
        axisOrder,
        coordinateSystem: 'test',
        referenceSpaceId: 'test',
        gridId: 'test-grid',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
        worldToIndex: [0.04, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
        voxelEdgeExtentUm: [-12.5, 112.5, -12.5, 87.5, -12.5, 62.5],
      },
      array: { dtype: 'float32', endianness: 'little', order: 'C' },
      resource,
      resourceIndexPath: 'resource-index.json',
      resourceIndexResource: {
        path: 'resource-index.json', mediaType: 'application/json', bytes: 1,
        sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: 1 },
      },
      summaryPath: 'summary.json',
      summaryResource: {
        path: 'summary.json', mediaType: 'application/json', bytes: 1,
        sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: 1 },
      },
      validity: { kind: 'sentinel', outsideValue: -9999 },
    },
    summary: {
      totalVoxelCount: shape.reduce((product, size) => product * size, 1),
      validVoxelCount: shape.reduce((product, size) => product * size, 1),
      outsideVoxelCount: 0,
      missingVoxelCount: 0,
      validStatistics: {
        min: 0,
        max: 1,
        mean: 0.5,
        std: 0.25,
        median: 0.5,
        q05: 0.05,
        q25: 0.25,
        q75: 0.75,
        q95: 0.95,
      },
      valueRange: [0.05, 0.95],
    },
    async loadResource(path: string): Promise<ArrayBuffer> {
      loads.set(path, (loads.get(path) ?? 0) + 1);
      const match = /^(coronal|sagittal|horizontal)\/(\d+)\.f32$/.exec(path);
      if (!match) throw new Error(`unexpected test path ${path}`);
      const axis = match[1] as SliceAxis;
      const pack = Number(match[2]);
      const fixedDimension = axisOrder.indexOf(axisNames[axis]);
      const fixedCount = shape[fixedDimension]!;
      const depth = Math.min(packDepth, fixedCount - pack * packDepth);
      const remainingDimensions = [0, 1, 2].filter((dimension) => dimension !== fixedDimension);
      const values = new Float32Array(depth * shape[remainingDimensions[0]!]! * shape[remainingDimensions[1]!]!);
      let offset = 0;
      for (let local = 0; local < depth; local += 1) {
        for (let first = 0; first < shape[remainingDimensions[0]!]!; first += 1) {
          for (let second = 0; second < shape[remainingDimensions[1]!]!; second += 1) {
            const raw = [0, 0, 0];
            raw[fixedDimension] = pack * packDepth + local;
            raw[remainingDimensions[0]!] = first;
            raw[remainingDimensions[1]!] = second;
            const byAxis = Object.fromEntries(axisOrder.map((name, dimension) => [name, raw[dimension]!])) as Record<'ap' | 'ml' | 'dv', number>;
            values[offset++] = byAxis.ap * 100 + byAxis.ml * 10 + byAxis.dv;
          }
        }
      }
      return values.buffer;
    },
  };
  return { feature, loads };
}

const metadata: VolumeChunkMetadata = {
  shape: { coronal: 5, sagittal: 4, horizontal: 3 },
  chunkShape: { coronal: 2, sagittal: 3, horizontal: 2 },
  voxelSizeUm: 25,
  storageDtype: 'float16',
};

function makeChunk(key: VolumeChunkKey): VolumeChunk {
  const origin = {
    coronal: key.coronal * metadata.chunkShape.coronal,
    sagittal: key.sagittal * metadata.chunkShape.sagittal,
    horizontal: key.horizontal * metadata.chunkShape.horizontal,
  };
  const shape = {
    coronal: Math.min(metadata.chunkShape.coronal, metadata.shape.coronal - origin.coronal),
    sagittal: Math.min(metadata.chunkShape.sagittal, metadata.shape.sagittal - origin.sagittal),
    horizontal: Math.min(metadata.chunkShape.horizontal, metadata.shape.horizontal - origin.horizontal),
  };
  const data = new Float32Array(shape.coronal * shape.sagittal * shape.horizontal);
  let i = 0;
  for (let c = 0; c < shape.coronal; c++) {
    for (let s = 0; s < shape.sagittal; s++) {
      for (let h = 0; h < shape.horizontal; h++) {
        data[i++] = (origin.coronal + c) * 100 + (origin.sagittal + s) * 10 + origin.horizontal + h;
      }
    }
  }
  return { key, shape, data };
}

class MemorySource implements VolumeChunkSource {
  readonly metadata = metadata;
  loads = 0;
  async loadChunk(key: VolumeChunkKey): Promise<VolumeChunk> {
    this.loads++;
    return makeChunk(key);
  }
}

test('chunk planner requests only bricks intersecting a plane', () => {
  assert.equal(chunkKeysForSlice(metadata, 'coronal', 1).length, 4);
  assert.equal(chunkKeysForSlice(metadata, 'sagittal', 2).length, 6);
  assert.equal(chunkKeysForSlice(metadata, 'horizontal', 2).length, 6);
});

test('slice loader assembles canonical orthogonal planes', async () => {
  const source = new MemorySource();
  const loader = new VolumeSliceLoader(source, { cacheBytes: 1024 * 1024, concurrency: 2 });
  const coronal = await loader.loadSlice('coronal', 2);
  assert.deepEqual([coronal.widthAxis, coronal.heightAxis, coronal.width, coronal.height], ['sagittal', 'horizontal', 4, 3]);
  assert.deepEqual([...coronal.data], [200, 210, 220, 230, 201, 211, 221, 231, 202, 212, 222, 232]);
  const sagittal = await loader.loadSlice('sagittal', 1);
  assert.deepEqual([sagittal.widthAxis, sagittal.heightAxis, sagittal.width, sagittal.height], ['coronal', 'horizontal', 5, 3]);
  assert.deepEqual([...sagittal.data], [10, 110, 210, 310, 410, 11, 111, 211, 311, 411, 12, 112, 212, 312, 412]);
  const horizontal = await loader.loadSlice('horizontal', 1);
  assert.deepEqual([horizontal.widthAxis, horizontal.heightAxis, horizontal.width, horizontal.height], ['sagittal', 'coronal', 4, 5]);
  assert.deepEqual([...horizontal.data].slice(0, 8), [1, 11, 21, 31, 101, 111, 121, 131]);
});

test('cache makes navigation inside the same chunk slab request-free', async () => {
  const source = new MemorySource();
  const loader = new VolumeSliceLoader(source, { cacheBytes: 1024 * 1024 });
  await loader.loadSlice('coronal', 0);
  const afterFirst = source.loads;
  await loader.loadSlice('coronal', 1);
  assert.equal(source.loads, afterFirst);
});

test('slice-pack source assembles all planes under permuted storage axes', async () => {
  const { feature } = makeSlicePackFeature();
  const source = new SchemaSlicePackVolumeSource(feature);
  const coronal = await source.loadSlice('coronal', 2);
  assert.deepEqual([coronal.widthAxis, coronal.heightAxis, coronal.width, coronal.height], ['sagittal', 'horizontal', 4, 3]);
  assert.deepEqual([...coronal.data], [200, 210, 220, 230, 201, 211, 221, 231, 202, 212, 222, 232]);
  const sagittal = await source.loadSlice('sagittal', 1);
  assert.deepEqual([...sagittal.data], [10, 110, 210, 310, 410, 11, 111, 211, 311, 411, 12, 112, 212, 312, 412]);
  const horizontal = await source.loadSlice('horizontal', 1);
  assert.deepEqual([...horizontal.data].slice(0, 8), [1, 11, 21, 31, 101, 111, 121, 131]);
});

test('slice-pack source reuses a pack and decodes a short edge pack', async () => {
  const { feature, loads } = makeSlicePackFeature();
  const source = new SchemaSlicePackVolumeSource(feature);
  await source.loadSlice('coronal', 0);
  await source.loadSlice('coronal', 1);
  assert.equal(loads.get('coronal/0.f32'), 1);
  const edge = await source.loadSlice('coronal', 4);
  assert.deepEqual([...edge.data].slice(0, 4), [400, 410, 420, 430]);
  assert.equal(loads.get('coronal/2.f32'), 1);
});

test('world-space volume plane location follows the declared inverse without clamping', () => {
  const { feature } = makeSlicePackFeature();
  feature.descriptor.grid.indexToWorldUm = [
    0, 0, 25, 0,
    0, 25, 0, 0,
    25, 0, 0, 0,
    0, 0, 0, 1,
  ];
  feature.descriptor.grid.worldToIndex = [
    0, 0, 0.04, 0,
    0, 0.04, 0, 0,
    0.04, 0, 0, 0,
    0, 0, 0, 1,
  ];
  const world = { ml: 75, ap: 50, dv: 25 };
  assert.deepEqual(locateVolumePlane(feature, 'coronal', world), {
    status: 'in-grid', index: 2, fractionalIndex: 2, rawDimension: 1,
  });
  assert.deepEqual(locateVolumePlane(feature, 'sagittal', world), {
    status: 'in-grid', index: 3, fractionalIndex: 3, rawDimension: 2,
  });
  assert.deepEqual(locateVolumePlane(feature, 'horizontal', world), {
    status: 'in-grid', index: 1, fractionalIndex: 1, rawDimension: 0,
  });
  assert.equal(locateVolumePlane(feature, 'coronal', { ...world, ap: -12.5 }).status, 'in-grid');
  assert.equal(locateVolumePlane(feature, 'coronal', { ...world, ap: -12.6 }).status, 'out-of-grid');
  assert.equal(locateVolumePlane(feature, 'coronal', { ...world, ap: 112.49 }).status, 'in-grid');
  assert.equal(locateVolumePlane(feature, 'coronal', { ...world, ap: 112.5 }).status, 'out-of-grid');
});

test('volume plane edges register into anatomy coordinates with declared orientation', () => {
  const { feature } = makeSlicePackFeature();
  feature.descriptor.grid.shape = [8, 6, 4];
  feature.descriptor.grid.axisOrder = ['ap', 'ml', 'dv'];
  feature.descriptor.grid.referenceSpaceId = 'allen-ccf-2017';
  feature.descriptor.grid.indexToWorldUm = [
    0, 25, 0, 0,
    25, 0, 0, 0,
    0, 0, 25, 0,
    0, 0, 0, 1,
  ];
  const registration = {
    axis: 'coronal' as const,
    referenceSpaceId: 'allen-ccf-2017',
    viewBox: { x: -20, y: -20, width: 40, height: 40 },
    planeIndexToWorldUm: [
      0, 10, 0, 0,
      25, 0, 0, 0,
      0, 0, -10, 0,
      0, 0, 0, 1,
    ] as const,
    worldToPlaneIndex: [
      0, 0.04, 0, 0,
      0.1, 0, 0, 0,
      0, 0, -0.1, 0,
      0, 0, 0, 1,
    ] as const,
  };
  const placement = registeredVolumeCanvasPlacement(feature, {
    axis: 'coronal', index: 2, widthAxis: 'sagittal', heightAxis: 'horizontal',
    width: 6, height: 4, data: new Float32Array(24),
  }, registration);
  assert.deepEqual(placement, {
    x: -1.25,
    y: -8.75,
    width: 15,
    height: 10,
    flipX: false,
    flipY: true,
    viewBox: registration.viewBox,
  });
  assert.throws(
    () => assertCompatibleReferenceSpace(
      { ...registration, referenceSpaceId: 'different-space' },
      feature,
    ),
    /Cannot composite different-space anatomy with allen-ccf-2017 volume/,
  );
});

test('plane inspection maps background coordinates to exact voxel validity and value', () => {
  const { feature } = makeSlicePackFeature();
  feature.descriptor.grid.shape = [8, 6, 4];
  feature.descriptor.grid.axisOrder = ['ap', 'ml', 'dv'];
  feature.descriptor.grid.referenceSpaceId = 'allen-ccf-2017';
  feature.descriptor.grid.indexToWorldUm = [
    0, 25, 0, 0,
    25, 0, 0, 0,
    0, 0, 25, 0,
    0, 0, 0, 1,
  ];
  feature.descriptor.grid.worldToIndex = [
    0, 0.04, 0, 0,
    0.04, 0, 0, 0,
    0, 0, 0.04, 0,
    0, 0, 0, 1,
  ];
  const registration = {
    axis: 'coronal' as const,
    referenceSpaceId: 'allen-ccf-2017',
    viewBox: { x: -20, y: -20, width: 40, height: 40 },
    planeIndexToWorldUm: [
      0, 10, 0, 0,
      25, 0, 0, 0,
      0, 0, -10, 0,
      0, 0, 0, 1,
    ] as const,
    worldToPlaneIndex: [
      0, 0.04, 0, 0,
      0.1, 0, 0, 0,
      0, 0, -0.1, 0,
      0, 0, 0, 1,
    ] as const,
  };
  const data = new Float32Array(24);
  data[2 * 6 + 3] = 42;
  const slice = {
    axis: 'coronal' as const, index: 2, widthAxis: 'sagittal' as const,
    heightAxis: 'horizontal' as const, width: 6, height: 4, data,
  };
  assert.deepEqual(inspectVolumePlanePoint(feature, slice, registration, { u: 7.5, v: -5 }), {
    status: 'valid',
    world: { ml: 75, ap: 50, dv: 50 },
    fractionalIndex: [2, 3, 2],
    voxelIndex: [2, 3, 2],
    value: 42,
  });
  assert.equal(inspectVolumePlanePoint(feature, slice, registration, { u: 20, v: 0 }).status, 'out-of-grid');
  slice.data[2 * 6 + 3] = Number.NaN;
  assert.equal(inspectVolumePlanePoint(feature, slice, registration, { u: 7.5, v: -5 }).status, 'missing');
  slice.data[2 * 6 + 3] = -9999;
  assert.equal(inspectVolumePlanePoint(feature, slice, registration, { u: 7.5, v: -5 }).status, 'outside');
});

test('validity-mask source verifies once and extracts matching planes in raw C order', async () => {
  const { feature } = makeSlicePackFeature();
  feature.descriptor.grid.shape = [2, 2, 2];
  feature.descriptor.grid.axisOrder = ['ap', 'ml', 'dv'];
  const mask = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1]);
  let maskLoads = 0;
  feature.descriptor.validity = {
    kind: 'mask',
    mask: {
      resource: {
        format: 'raw-binary-array-v1', dtype: 'uint8', shape: [2, 2, 2], order: 'C',
        endianness: 'not-applicable',
        path: 'validity.u8', mediaType: 'application/octet-stream', bytes: mask.byteLength,
        sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: mask.byteLength },
      },
      shape: [2, 2, 2],
    },
    codes: { valid: 0, outside: 1, missing: 2 },
  };
  feature.loadResource = async (path) => {
    assert.equal(path, 'validity.u8');
    maskLoads += 1;
    return mask.buffer.slice(0);
  };
  const base = {
    async loadSlice(axis: SliceAxis, index: number) {
      return {
        axis, index, widthAxis: 'sagittal' as const, heightAxis: 'horizontal' as const,
        width: 2, height: 2, data: new Float32Array([10, 20, 30, 40]),
      };
    },
  };
  const source = new VolumeValiditySliceSource(feature, base);
  const first = await source.loadSlice('coronal', 1);
  const second = await source.loadSlice('coronal', 0);
  assert.deepEqual([...first.validity!], [1, 0, 2, 1]);
  assert.deepEqual([...second.validity!], [0, 2, 1, 0]);
  assert.equal(maskLoads, 1);
  assert.equal(volumeValueIsVisible(feature, 10, first.validity![0]), false);
  assert.equal(volumeValueIsVisible(feature, 20, first.validity![1]), true);
  assert.equal(volumeValueIsVisible(feature, 30, first.validity![2]), false);
  assert.equal(volumeScalarCacheBudget(feature, 64), 56);
  assert.throws(() => volumeScalarCacheBudget(feature, 8), /exceeds the decoded-memory budget/);
});

test('disposing a chunked source releases its decoded cache and refuses reuse', async () => {
  const loader = new VolumeSliceLoader(new MemorySource(), { cacheBytes: 1024 * 1024 });
  await loader.loadSlice('coronal', 0);
  assert.ok(loader.cache.byteLength > 0);
  loader.dispose();
  assert.equal(loader.cache.byteLength, 0);
  await assert.rejects(loader.loadSlice('coronal', 0), /disposed/);
});

test('in-flight volume requests deduplicate without one consumer cancellation poisoning another', async () => {
  const requests = new AbortableRequestCache<number>();
  let starts = 0;
  let release!: (value: number) => void;
  const transport = new Promise<number>((resolve) => { release = resolve; });
  const firstAbort = new AbortController();
  const start = async () => {
    starts += 1;
    return transport;
  };
  const first = requests.load('same', start, firstAbort.signal);
  const second = requests.load('same', start);
  firstAbort.abort();
  release(42);
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(await second, 42);
  assert.equal(starts, 1);
});

test('LRU cache respects a byte budget', () => {
  const cache = new VolumeChunkCache(64);
  cache.set(makeChunk({ coronal: 0, sagittal: 0, horizontal: 0 }));
  cache.set(makeChunk({ coronal: 0, sagittal: 1, horizontal: 0 }));
  assert.ok(cache.byteLength <= 64 || cache.size === 1);
});

test('scalar palette mapping is bounded and makes non-finite values transparent', () => {
  const values = new Float32Array([-1, 0, 0.5, 1, 2, Number.NaN]);
  const palette = new Uint8Array([0, 0, 0, 255, 100, 0, 0, 255, 200, 0, 0, 255]);
  const rgba = scalarToRgba(values, palette, 0, 1);
  assert.deepEqual([...rgba], [
    0, 0, 0, 255,
    0, 0, 0, 255,
    100, 0, 0, 255,
    200, 0, 0, 255,
    200, 0, 0, 255,
    0, 0, 0, 0,
  ]);
});
