import type { SliceAxis } from './types.js';

export const VOLUME_AXIS_ORDER = ['coronal', 'sagittal', 'horizontal'] as const;

export interface VolumeShape {
  coronal: number;
  sagittal: number;
  horizontal: number;
}

export interface VolumeChunkKey {
  coronal: number;
  sagittal: number;
  horizontal: number;
}

export interface VolumeChunk {
  key: VolumeChunkKey;
  shape: VolumeShape;
  data: Float32Array;
}

export interface VolumeChunkMetadata {
  shape: VolumeShape;
  chunkShape: VolumeShape;
  voxelSizeUm: 25;
  storageDtype: 'float16' | 'float32';
}

export interface VolumeChunkSource {
  readonly metadata: VolumeChunkMetadata;
  loadChunk(key: VolumeChunkKey, signal?: AbortSignal): Promise<VolumeChunk>;
}

export interface VolumeSliceSource {
  loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<VolumeSlice>;
}

export interface VolumeSlice {
  axis: SliceAxis;
  index: number;
  widthAxis: SliceAxis;
  heightAxis: SliceAxis;
  width: number;
  height: number;
  data: Float32Array;
}

const PLANE_AXES: Readonly<Record<SliceAxis, readonly [SliceAxis, SliceAxis]>> = {
  coronal: ['sagittal', 'horizontal'],
  sagittal: ['coronal', 'horizontal'],
  horizontal: ['sagittal', 'coronal'],
};

function chunkKeyId(key: VolumeChunkKey): string {
  return `${key.coronal}/${key.sagittal}/${key.horizontal}`;
}

function valueAt(chunk: VolumeChunk, c: number, s: number, h: number): number {
  return chunk.data[((c * chunk.shape.sagittal) + s) * chunk.shape.horizontal + h]!;
}

function validateIndex(index: number, count: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`slice index ${index} is outside [0, ${count - 1}]`);
  }
  return index;
}

export function chunkGridShape(metadata: VolumeChunkMetadata): VolumeShape {
  return {
    coronal: Math.ceil(metadata.shape.coronal / metadata.chunkShape.coronal),
    sagittal: Math.ceil(metadata.shape.sagittal / metadata.chunkShape.sagittal),
    horizontal: Math.ceil(metadata.shape.horizontal / metadata.chunkShape.horizontal),
  };
}

export function chunkKeysForSlice(metadata: VolumeChunkMetadata, axis: SliceAxis, index: number): VolumeChunkKey[] {
  validateIndex(index, metadata.shape[axis]);
  const grid = chunkGridShape(metadata);
  const fixedChunk = Math.floor(index / metadata.chunkShape[axis]);
  const keys: VolumeChunkKey[] = [];
  for (let c = 0; c < grid.coronal; c++) {
    for (let s = 0; s < grid.sagittal; s++) {
      for (let h = 0; h < grid.horizontal; h++) {
        const candidate: VolumeChunkKey = { coronal: c, sagittal: s, horizontal: h };
        if (candidate[axis] === fixedChunk) keys.push(candidate);
      }
    }
  }
  return keys;
}

export class VolumeChunkCache {
  readonly maxBytes: number;
  private readonly entries = new Map<string, VolumeChunk>();
  private bytes = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be positive');
  }

  get byteLength(): number { return this.bytes; }
  get size(): number { return this.entries.size; }

  get(key: VolumeChunkKey): VolumeChunk | undefined {
    const id = chunkKeyId(key);
    const chunk = this.entries.get(id);
    if (!chunk) return undefined;
    this.entries.delete(id);
    this.entries.set(id, chunk);
    return chunk;
  }

  set(chunk: VolumeChunk): void {
    const id = chunkKeyId(chunk.key);
    const previous = this.entries.get(id);
    if (previous) {
      this.bytes -= previous.data.byteLength;
      this.entries.delete(id);
    }
    this.entries.set(id, chunk);
    this.bytes += chunk.data.byteLength;
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldestId = this.entries.keys().next().value as string;
      const oldest = this.entries.get(oldestId)!;
      this.entries.delete(oldestId);
      this.bytes -= oldest.data.byteLength;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= values.length) return;
      out[i] = await fn(values[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return out;
}

export class VolumeSliceLoader implements VolumeSliceSource {
  readonly cache: VolumeChunkCache;
  readonly source: VolumeChunkSource;
  private readonly concurrency: number;

  constructor(source: VolumeChunkSource, options: { cacheBytes?: number; concurrency?: number } = {}) {
    this.source = source;
    this.cache = new VolumeChunkCache(options.cacheBytes ?? 96 * 1024 * 1024);
    this.concurrency = options.concurrency ?? 8;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new RangeError('concurrency must be a positive integer');
  }

  async loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<VolumeSlice> {
    const { metadata } = this.source;
    validateIndex(index, metadata.shape[axis]);
    const keys = chunkKeysForSlice(metadata, axis, index);
    const chunks = await mapWithConcurrency(keys, this.concurrency, async (key) => {
      const cached = this.cache.get(key);
      if (cached) return cached;
      const chunk = await this.source.loadChunk(key, signal);
      this.cache.set(chunk);
      return chunk;
    });

    const [widthAxis, heightAxis] = PLANE_AXES[axis];
    const width = metadata.shape[widthAxis];
    const height = metadata.shape[heightAxis];
    const data = new Float32Array(width * height);
    const cs = metadata.chunkShape;

    for (const chunk of chunks) {
      const origin = {
        coronal: chunk.key.coronal * cs.coronal,
        sagittal: chunk.key.sagittal * cs.sagittal,
        horizontal: chunk.key.horizontal * cs.horizontal,
      };
      const localFixed = index - origin[axis];
      if (localFixed < 0 || localFixed >= chunk.shape[axis]) continue;

      if (axis === 'coronal') {
        for (let localS = 0; localS < chunk.shape.sagittal; localS++) {
          const x = origin.sagittal + localS;
          for (let localH = 0; localH < chunk.shape.horizontal; localH++) {
            const y = origin.horizontal + localH;
            data[y * width + x] = valueAt(chunk, localFixed, localS, localH);
          }
        }
      } else if (axis === 'sagittal') {
        for (let localC = 0; localC < chunk.shape.coronal; localC++) {
          const x = origin.coronal + localC;
          for (let localH = 0; localH < chunk.shape.horizontal; localH++) {
            const y = origin.horizontal + localH;
            data[y * width + x] = valueAt(chunk, localC, localFixed, localH);
          }
        }
      } else {
        for (let localC = 0; localC < chunk.shape.coronal; localC++) {
          const y = origin.coronal + localC;
          for (let localS = 0; localS < chunk.shape.sagittal; localS++) {
            const x = origin.sagittal + localS;
            data[y * width + x] = valueAt(chunk, localC, localS, localFixed);
          }
        }
      }
    }

    return { axis, index, widthAxis, heightAxis, width, height, data };
  }

  async prefetchAdjacent(axis: SliceAxis, index: number, radius = 1, signal?: AbortSignal): Promise<void> {
    const count = this.source.metadata.shape[axis];
    const indices = new Set<number>();
    for (let delta = -radius; delta <= radius; delta++) {
      const candidate = index + delta;
      if (candidate >= 0 && candidate < count) indices.add(candidate);
    }
    const keys = new Map<string, VolumeChunkKey>();
    for (const candidate of indices) {
      for (const key of chunkKeysForSlice(this.source.metadata, axis, candidate)) {
        if (!this.cache.get(key)) keys.set(chunkKeyId(key), key);
      }
    }
    await mapWithConcurrency([...keys.values()], this.concurrency, async (key) => {
      if (this.cache.get(key)) return;
      this.cache.set(await this.source.loadChunk(key, signal));
    });
  }
}

export function scalarToRgba(values: Float32Array, palette: Uint8Array, min: number, max: number, out = new Uint8ClampedArray(values.length * 4)): Uint8ClampedArray {
  if (palette.length === 0 || palette.length % 4 !== 0) throw new RangeError('palette must contain RGBA entries');
  if (!(max > min)) throw new RangeError('max must be greater than min');
  if (out.length !== values.length * 4) throw new RangeError('out has wrong length');
  const n = palette.length / 4;
  const scale = (n - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(n - 1, Math.floor((value - min) * scale))) : 0;
    const p = normalized * 4;
    const o = i * 4;
    out[o] = palette[p]!;
    out[o + 1] = palette[p + 1]!;
    out[o + 2] = palette[p + 2]!;
    out[o + 3] = Number.isFinite(value) ? palette[p + 3]! : 0;
  }
  return out;
}
