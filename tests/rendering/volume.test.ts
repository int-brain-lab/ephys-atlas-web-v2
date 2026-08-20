import assert from 'node:assert/strict';
import test from 'node:test';

import type { VolumeFeaturePayload } from '../../web/src/data/contracts.js';
import type { SliceAxis } from '../../web/src/domain/types.js';
import { SchemaSlicePackVolumeSource } from '../../web/src/rendering/slice-pack-volume-source.js';
import {
  VolumeChunkCache,
  VolumeSliceLoader,
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
  const resource = {
    pack_depth: packDepth,
    axes: Object.fromEntries((['coronal', 'sagittal', 'horizontal'] as const).map((axis) => {
      const dimension = axisOrder.indexOf(axisNames[axis]);
      return [axis, {
        slice_shape: shape.filter((_, index) => index !== dimension),
        codec: { name: 'none' },
        path_template: `${axis}/{pack}.f32`,
      }];
    })),
  };
  const feature: VolumeFeaturePayload = {
    schemaVersion: '0.1',
    featureId: 'memory-slice-packs',
    representation: 'volume',
    descriptor: {
      kind: 'volume',
      format: 'ephys-atlas-chunked-volume-v0.1',
      layout: 'orthogonal_slice_packs',
      grid: {
        shape,
        axisOrder,
        coordinateSystem: 'test',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
      },
      array: { dtype: 'float32', endianness: 'little', order: 'C', nonfinite: 'preserve' },
      resource,
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
