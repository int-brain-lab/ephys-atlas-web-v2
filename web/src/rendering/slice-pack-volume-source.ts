import type { VolumeFeaturePayload } from '../data/contracts.js';
import { decodeBinaryArray } from '../data/validate.js';
import type { SliceAxis } from '../domain/types.js';
import type { VolumeSlice, VolumeSliceSource } from './volume.js';

const AXIS_NAME: Readonly<Record<SliceAxis, 'ap' | 'ml' | 'dv'>> = {
  coronal: 'ap',
  sagittal: 'ml',
  horizontal: 'dv',
};

const PLANE_AXES: Readonly<Record<SliceAxis, readonly [SliceAxis, SliceAxis]>> = {
  coronal: ['sagittal', 'horizontal'],
  sagittal: ['coronal', 'horizontal'],
  horizontal: ['sagittal', 'coronal'],
};

interface AxisPackResource {
  sliceShape: readonly [number, number];
  codec: 'none' | 'gzip';
  pathTemplate: string;
}

interface SlicePackResource {
  packDepth: number;
  axes: Readonly<Record<SliceAxis, AxisPackResource>>;
}

interface DecodedPack {
  values: Float32Array;
  depth: number;
  sliceShape: readonly [number, number];
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }
  return value;
}

function integerPair(value: unknown, context: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${context} must contain two dimensions`);
  return [positiveInteger(value[0], `${context}[0]`), positiveInteger(value[1], `${context}[1]`)];
}

function parseAxis(value: unknown, context: string): AxisPackResource {
  const resource = record(value, context);
  const codec = record(resource.codec, `${context}.codec`).name;
  if (codec !== 'none' && codec !== 'gzip') throw new Error(`${context}.codec.name is unsupported`);
  if (typeof resource.path_template !== 'string' || !resource.path_template.includes('{pack}')) {
    throw new Error(`${context}.path_template must contain {pack}`);
  }
  return {
    sliceShape: integerPair(resource.slice_shape, `${context}.slice_shape`),
    codec,
    pathTemplate: resource.path_template,
  };
}

function parseResource(feature: VolumeFeaturePayload): SlicePackResource {
  if (feature.descriptor.layout !== 'orthogonal_slice_packs') {
    throw new Error(`Volume layout ${feature.descriptor.layout} is not handled by the slice-pack adapter`);
  }
  const resource = feature.descriptor.resource;
  const axes = record(resource.axes, 'volume slice_packs.axes');
  return {
    packDepth: positiveInteger(resource.pack_depth, 'volume slice_packs.pack_depth'),
    axes: {
      coronal: parseAxis(axes.coronal, 'volume slice_packs.axes.coronal'),
      sagittal: parseAxis(axes.sagittal, 'volume slice_packs.axes.sagittal'),
      horizontal: parseAxis(axes.horizontal, 'volume slice_packs.axes.horizontal'),
    },
  };
}

async function decompress(buffer: ArrayBuffer, codec: 'none' | 'gzip'): Promise<ArrayBuffer> {
  if (codec === 'none') return buffer;
  if (!('DecompressionStream' in globalThis)) throw new Error('gzip volume slice packs require DecompressionStream support');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function axisDimension(feature: VolumeFeaturePayload, axis: SliceAxis): number {
  const name = AXIS_NAME[axis];
  const dimension = feature.descriptor.grid.axisOrder.findIndex((item) => item.toLowerCase() === name);
  if (dimension < 0) throw new Error(`volume axis_order does not contain ${name}`);
  return dimension;
}

function pathForPack(template: string, pack: number): string {
  return template.replaceAll('{pack}', String(pack));
}

export class SchemaSlicePackVolumeSource implements VolumeSliceSource {
  private readonly resource: SlicePackResource;
  private readonly cache = new Map<string, DecodedPack>();
  private readonly pending = new Map<string, Promise<DecodedPack>>();
  private cacheBytes = 0;

  constructor(
    private readonly feature: VolumeFeaturePayload,
    private readonly maxCacheBytes = 48 * 1024 * 1024,
  ) {
    this.resource = parseResource(feature);
    if (feature.descriptor.array.dtype !== 'float16' && feature.descriptor.array.dtype !== 'float32') {
      throw new Error(`volume slice renderer currently supports float16/float32, not ${feature.descriptor.array.dtype}`);
    }
    if (feature.descriptor.grid.voxelSizeUm.some((value) => value !== 25)) {
      throw new Error('launch volume renderer currently requires the 25 um encoding grid');
    }
    if (!Number.isFinite(maxCacheBytes) || maxCacheBytes <= 0) throw new RangeError('maxCacheBytes must be positive');
  }

  async loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<VolumeSlice> {
    const dimension = axisDimension(this.feature, axis);
    const count = this.feature.descriptor.grid.shape[dimension]!;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new RangeError(`slice index ${index} is outside [0, ${count - 1}]`);
    }
    const packIndex = Math.floor(index / this.resource.packDepth);
    const pack = await this.loadPack(axis, packIndex, signal);
    const localSlice = index - packIndex * this.resource.packDepth;
    if (localSlice >= pack.depth) throw new Error(`${axis} pack ${packIndex} does not contain slice ${index}`);

    const [widthAxis, heightAxis] = PLANE_AXES[axis];
    const width = this.feature.descriptor.grid.shape[axisDimension(this.feature, widthAxis)]!;
    const height = this.feature.descriptor.grid.shape[axisDimension(this.feature, heightAxis)]!;
    const remainingNames = this.feature.descriptor.grid.axisOrder
      .map((name) => name.toLowerCase())
      .filter((_, rawDimension) => rawDimension !== dimension);
    const widthName = AXIS_NAME[widthAxis];
    const heightName = AXIS_NAME[heightAxis];
    const firstIsWidth = remainingNames[0] === widthName && remainingNames[1] === heightName;
    const firstIsHeight = remainingNames[0] === heightName && remainingNames[1] === widthName;
    if (!firstIsWidth && !firstIsHeight) throw new Error(`${axis} slice pack axes are inconsistent with axis_order`);
    const data = new Float32Array(width * height);
    const sliceOffset = localSlice * pack.sliceShape[0] * pack.sliceShape[1];
    if (firstIsHeight && pack.sliceShape[0] === height && pack.sliceShape[1] === width) {
      data.set(pack.values.subarray(sliceOffset, sliceOffset + data.length));
      return { axis, index, widthAxis, heightAxis, width, height, data };
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const first = firstIsWidth ? x : y;
        const second = firstIsWidth ? y : x;
        const offset = sliceOffset + first * pack.sliceShape[1] + second;
        data[y * width + x] = pack.values[offset] ?? NaN;
      }
    }
    return { axis, index, widthAxis, heightAxis, width, height, data };
  }

  async prefetchAdjacent(axis: SliceAxis, index: number, radius = 1, signal?: AbortSignal): Promise<void> {
    const dimension = axisDimension(this.feature, axis);
    const count = this.feature.descriptor.grid.shape[dimension]!;
    const packs = new Set<number>();
    for (let delta = -radius; delta <= radius; delta += 1) {
      const candidate = index + delta;
      if (candidate >= 0 && candidate < count) packs.add(Math.floor(candidate / this.resource.packDepth));
    }
    await Promise.all([...packs].map((pack) => this.loadPack(axis, pack, signal).then(() => undefined)));
  }

  private async loadPack(axis: SliceAxis, packIndex: number, signal?: AbortSignal): Promise<DecodedPack> {
    const key = `${axis}/${packIndex}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.fetchPack(axis, packIndex, signal).then((pack) => {
      this.cache.set(key, pack);
      this.cacheBytes += pack.values.byteLength;
      while (this.cacheBytes > this.maxCacheBytes && this.cache.size > 1) {
        const oldestKey = this.cache.keys().next().value as string;
        const oldest = this.cache.get(oldestKey)!;
        this.cache.delete(oldestKey);
        this.cacheBytes -= oldest.values.byteLength;
      }
      return pack;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async fetchPack(axis: SliceAxis, packIndex: number, signal?: AbortSignal): Promise<DecodedPack> {
    const axisResource = this.resource.axes[axis];
    const dimension = axisDimension(this.feature, axis);
    const sliceCount = this.feature.descriptor.grid.shape[dimension]!;
    const depth = Math.min(this.resource.packDepth, sliceCount - packIndex * this.resource.packDepth);
    if (depth <= 0) throw new RangeError(`${axis} pack ${packIndex} is outside the volume`);
    const path = pathForPack(axisResource.pathTemplate, packIndex);
    const compressed = await this.feature.loadResource(path, signal);
    const buffer = await decompress(compressed, axisResource.codec);
    const values = Float32Array.from(decodeBinaryArray(buffer, {
      path,
      dtype: this.feature.descriptor.array.dtype,
      shape: [depth, ...axisResource.sliceShape],
      order: 'C',
      endianness: this.feature.descriptor.array.endianness,
    }));
    return { values, depth, sliceShape: axisResource.sliceShape };
  }
}
