import type { EncodedResourceDescriptor, VolumeFeaturePayload } from '../data/contracts.js';
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

interface PackEntry {
  axis: 'i0' | 'i1' | 'i2';
  firstSlice: number;
  sliceCount: number;
  decoded: {
    shape: readonly [number, number, number];
    storageAxes: readonly ['i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2'];
  };
  resource: EncodedResourceDescriptor;
}

interface SlicePackResource {
  packDepth: number;
  packs: readonly PackEntry[];
}

interface DecodedPack {
  values: Float32Array;
  entry: PackEntry;
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

function integerTriple(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${context} must contain three dimensions`);
  return [
    positiveInteger(value[0], `${context}[0]`),
    positiveInteger(value[1], `${context}[1]`),
    positiveInteger(value[2], `${context}[2]`),
  ];
}

function parseResource(feature: VolumeFeaturePayload): SlicePackResource {
  if (feature.descriptor.layout !== 'orthogonal_slice_packs') {
    throw new Error(`Volume layout ${feature.descriptor.layout} is not handled by the slice-pack adapter`);
  }
  const resource = feature.descriptor.resource;
  const rawPacks = resource.packs;
  if (!Array.isArray(rawPacks)) throw new Error('volume slice-pack resource index is missing packs');
  const packs = rawPacks.map((value, index) => {
    const raw = record(value, `volume pack ${index}`);
    const decoded = record(raw.decoded, `volume pack ${index}.decoded`);
    const storageAxes = decoded.storageAxes;
    if (!Array.isArray(storageAxes) || storageAxes.length !== 3) throw new Error(`volume pack ${index} storage axes are invalid`);
    const entry: PackEntry = {
      axis: raw.axis as PackEntry['axis'],
      firstSlice: Number(raw.firstSlice),
      sliceCount: positiveInteger(raw.sliceCount, `volume pack ${index}.sliceCount`),
      decoded: {
        shape: integerTriple(decoded.shape, `volume pack ${index}.decoded.shape`),
        storageAxes: storageAxes as unknown as PackEntry['decoded']['storageAxes'],
      },
      resource: raw.resource as EncodedResourceDescriptor,
    };
    if (!['i0', 'i1', 'i2'].includes(entry.axis) || !Number.isInteger(entry.firstSlice) || entry.firstSlice < 0) {
      throw new Error(`volume pack ${index} position is invalid`);
    }
    return entry;
  });
  return {
    packDepth: positiveInteger(resource.pack_depth, 'volume slice packs pack_depth'),
    packs,
  };
}

async function decompress(buffer: ArrayBuffer, codec: EncodedResourceDescriptor['codec']): Promise<ArrayBuffer> {
  if (codec.name === 'none') return buffer;
  if (!('DecompressionStream' in globalThis)) throw new Error('gzip volume slice packs require DecompressionStream support');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function axisDimension(feature: VolumeFeaturePayload, axis: SliceAxis): number {
  const name = AXIS_NAME[axis];
  const dimension = feature.descriptor.grid.axisOrder.findIndex((item) => item.toLowerCase() === name);
  if (dimension < 0) throw new Error(`volume affine axes do not contain ${name}`);
  return dimension;
}

function storageOffset(entry: PackEntry, rawCoordinates: readonly [number, number, number]): number {
  const coordinates = entry.decoded.storageAxes.map((axis) => rawCoordinates[Number(axis[1])]!);
  return ((coordinates[0]! * entry.decoded.shape[1]!) + coordinates[1]!) * entry.decoded.shape[2]! + coordinates[2]!;
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
    const localSlice = index - pack.entry.firstSlice;
    if (localSlice < 0 || localSlice >= pack.entry.sliceCount) {
      throw new Error(`${axis} pack ${packIndex} does not contain slice ${index}`);
    }

    const [widthAxis, heightAxis] = PLANE_AXES[axis];
    const widthDimension = axisDimension(this.feature, widthAxis);
    const heightDimension = axisDimension(this.feature, heightAxis);
    const width = this.feature.descriptor.grid.shape[widthDimension]!;
    const height = this.feature.descriptor.grid.shape[heightDimension]!;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rawCoordinates = [0, 0, 0] as [number, number, number];
        rawCoordinates[dimension] = localSlice;
        rawCoordinates[widthDimension] = x;
        rawCoordinates[heightDimension] = y;
        data[y * width + x] = pack.values[storageOffset(pack.entry, rawCoordinates)] ?? NaN;
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
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async fetchPack(axis: SliceAxis, packIndex: number, signal?: AbortSignal): Promise<DecodedPack> {
    const dimension = axisDimension(this.feature, axis);
    const rawAxis = `i${dimension}`;
    const firstSlice = packIndex * this.resource.packDepth;
    const entry = this.resource.packs.find((candidate) => candidate.axis === rawAxis && candidate.firstSlice === firstSlice);
    if (!entry) throw new Error(`volume resource index has no ${rawAxis} pack at ${firstSlice}`);
    const compressed = await this.feature.loadResource(entry.resource.path, signal, entry.resource);
    const buffer = await decompress(compressed, entry.resource.codec);
    const values = Float32Array.from(decodeBinaryArray(buffer, {
      format: 'raw-binary-array-v1',
      ...entry.resource,
      dtype: this.feature.descriptor.array.dtype,
      shape: entry.decoded.shape,
      order: 'C',
      endianness: this.feature.descriptor.array.endianness,
    }));
    return { values, entry };
  }
}
