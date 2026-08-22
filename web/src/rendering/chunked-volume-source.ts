import type { SliceAxis } from '../domain/types.js';
import type { EncodedResourceDescriptor, VolumeFeaturePayload } from '../data/contracts.js';
import { decodeBinaryArray } from '../data/validate.js';
import { regionalIndexToCoordinateUm } from './slice-calibration.js';
import type {
  VolumeChunk,
  VolumeChunkKey,
  VolumeChunkMetadata,
  VolumeChunkSource,
  VolumeShape,
} from './volume.js';

const AXIS_NAME: Readonly<Record<SliceAxis, 'ap' | 'ml' | 'dv'>> = {
  coronal: 'ap',
  sagittal: 'ml',
  horizontal: 'dv',
};

const WORLD_ROW: Readonly<Record<'ap' | 'ml' | 'dv', number>> = {
  ml: 0,
  ap: 1,
  dv: 2,
};

interface Chunks3dResource {
  shape: readonly [number, number, number];
  chunks: readonly {
    origin: readonly [number, number, number];
    decodedShape: readonly [number, number, number];
    storageAxes: readonly ['i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2', 'i0' | 'i1' | 'i2'];
    resource: EncodedResourceDescriptor;
  }[];
}

function integerTriple(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isInteger(item) || Number(item) <= 0)) {
    throw new Error(`${context} must contain three positive integers`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function nonnegativeIntegerTriple(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isInteger(item) || Number(item) < 0)) {
    throw new Error(`${context} must contain three non-negative integers`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function chunks3dResource(feature: VolumeFeaturePayload): Chunks3dResource {
  const descriptor = feature.descriptor;
  if (descriptor.layout !== 'chunks3d') {
    throw new Error(`Volume layout ${descriptor.layout} is not handled by the chunks3d adapter`);
  }
  const raw = descriptor.resource;
  if (!Array.isArray(raw.chunks)) throw new Error('volume chunk resource index is missing chunks');
  return {
    shape: integerTriple(raw.chunk_shape, 'volume chunks shape'),
    chunks: raw.chunks.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`volume chunk ${index} is invalid`);
      const entry = value as Record<string, unknown>;
      const decoded = entry.decoded;
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error(`volume chunk ${index} decoded block is invalid`);
      const storageAxes = (decoded as Record<string, unknown>).storageAxes;
      if (!Array.isArray(storageAxes)
        || storageAxes.length !== 3
        || new Set(storageAxes).size !== 3
        || storageAxes.some((axis) => !['i0', 'i1', 'i2'].includes(String(axis)))) {
        throw new Error(`volume chunk ${index} storage axes are invalid`);
      }
      return {
        origin: nonnegativeIntegerTriple(entry.origin, `volume chunk ${index} origin`),
        decodedShape: integerTriple((decoded as Record<string, unknown>).shape, `volume chunk ${index} decoded shape`),
        storageAxes: storageAxes as unknown as Chunks3dResource['chunks'][number]['storageAxes'],
        resource: entry.resource as EncodedResourceDescriptor,
      };
    }),
  };
}

function axisDimension(feature: VolumeFeaturePayload, axis: SliceAxis): number {
  const name = AXIS_NAME[axis];
  const index = feature.descriptor.grid.axisOrder.findIndex((item) => item.toLowerCase() === name);
  if (index < 0) throw new Error(`volume axis_order does not contain ${name}`);
  return index;
}

function anatomicalShape(feature: VolumeFeaturePayload, raw: readonly [number, number, number]): VolumeShape {
  return {
    coronal: raw[axisDimension(feature, 'coronal')]!,
    sagittal: raw[axisDimension(feature, 'sagittal')]!,
    horizontal: raw[axisDimension(feature, 'horizontal')]!,
  };
}

function rawChunkKey(feature: VolumeFeaturePayload, key: VolumeChunkKey): [number, number, number] {
  const byName = {
    ap: key.coronal,
    ml: key.sagittal,
    dv: key.horizontal,
  };
  return feature.descriptor.grid.axisOrder.map((name) => {
    const value = byName[name.toLowerCase() as keyof typeof byName];
    if (value === undefined) throw new Error(`unsupported volume axis ${name}`);
    return value;
  }) as [number, number, number];
}

function rawLocalIndex(feature: VolumeFeaturePayload, c: number, s: number, h: number): [number, number, number] {
  const byName = { ap: c, ml: s, dv: h };
  return feature.descriptor.grid.axisOrder.map((name) => {
    const value = byName[name.toLowerCase() as keyof typeof byName];
    if (value === undefined) throw new Error(`unsupported volume axis ${name}`);
    return value;
  }) as [number, number, number];
}

async function maybeDecompress(buffer: ArrayBuffer, codec: EncodedResourceDescriptor['codec']): Promise<ArrayBuffer> {
  if (codec.name === 'none') return buffer;
  if (!('DecompressionStream' in globalThis)) throw new Error('gzip volume chunks require DecompressionStream support');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function rawChunkShape(
  gridShape: readonly [number, number, number],
  chunkShape: readonly [number, number, number],
  key: readonly [number, number, number],
): [number, number, number] {
  return gridShape.map((count, dimension) => {
    const start = key[dimension]! * chunkShape[dimension]!;
    return Math.min(chunkShape[dimension]!, count - start);
  }) as [number, number, number];
}

function rawValue(values: readonly number[], shape: readonly [number, number, number], index: readonly [number, number, number]): number {
  return values[((index[0] * shape[1]) + index[1]) * shape[2] + index[2]] ?? NaN;
}

function storageIndex(
  axes: Chunks3dResource['chunks'][number]['storageAxes'],
  rawIndex: readonly [number, number, number],
): [number, number, number] {
  return axes.map((axis) => rawIndex[Number(axis[1])]!) as [number, number, number];
}

export class SchemaChunks3dVolumeSource implements VolumeChunkSource {
  readonly metadata: VolumeChunkMetadata;
  private readonly resource: Chunks3dResource;

  constructor(private readonly feature: VolumeFeaturePayload) {
    this.resource = chunks3dResource(feature);
    if (feature.descriptor.array.dtype !== 'float16' && feature.descriptor.array.dtype !== 'float32') {
      throw new Error(`volume slice renderer currently supports float16/float32, not ${feature.descriptor.array.dtype}`);
    }
    this.metadata = {
      shape: anatomicalShape(feature, feature.descriptor.grid.shape),
      chunkShape: anatomicalShape(feature, this.resource.shape),
      voxelSizeUm: Math.min(...feature.descriptor.grid.voxelSizeUm),
      storageDtype: feature.descriptor.array.dtype,
    };
  }

  async loadChunk(key: VolumeChunkKey, signal?: AbortSignal): Promise<VolumeChunk> {
    const rawKey = rawChunkKey(this.feature, key);
    const origin = rawKey.map((value, index) => value * this.resource.shape[index]!) as [number, number, number];
    const entry = this.resource.chunks.find((candidate) => candidate.origin.every((value, index) => value === origin[index]));
    if (!entry) throw new Error(`volume resource index has no chunk at ${origin.join('/')}`);
    const rawShape = rawChunkShape(this.feature.descriptor.grid.shape, this.resource.shape, rawKey);
    const expectedDecodedShape = entry.storageAxes.map((axis) => rawShape[Number(axis[1])]!);
    if (entry.decodedShape.some((value, index) => value !== expectedDecodedShape[index])) throw new Error('volume chunk decoded shape is inconsistent');
    const path = entry.resource.path;
    const compressed = await this.feature.loadResource(path, signal, entry.resource);
    const buffer = await maybeDecompress(compressed, entry.resource.codec);
    const values = decodeBinaryArray(buffer, {
      format: 'raw-binary-array-v1',
      ...entry.resource,
      path,
      dtype: this.feature.descriptor.array.dtype,
      shape: entry.decodedShape,
      order: 'C',
      endianness: this.feature.descriptor.array.endianness,
    });
    const shape = anatomicalShape(this.feature, rawShape);
    const data = new Float32Array(shape.coronal * shape.sagittal * shape.horizontal);
    let offset = 0;
    for (let c = 0; c < shape.coronal; c += 1) {
      for (let s = 0; s < shape.sagittal; s += 1) {
        for (let h = 0; h < shape.horizontal; h += 1) {
          const rawIndex = rawLocalIndex(this.feature, c, s, h);
          data[offset++] = rawValue(values, entry.decodedShape, storageIndex(entry.storageAxes, rawIndex));
        }
      }
    }
    return { key, shape, data };
  }
}

export function regionalSliceToVolumeIndex(feature: VolumeFeaturePayload, axis: SliceAxis, regionalIndex: number): number {
  const axisName = AXIS_NAME[axis];
  const rawDimension = axisDimension(feature, axis);
  const worldRow = WORLD_ROW[axisName];
  const matrix = feature.descriptor.grid.indexToWorldUm;
  if (matrix.length !== 16) throw new Error('volume index_to_world_um must contain 16 values');

  for (let column = 0; column < 3; column += 1) {
    if (column === rawDimension) continue;
    if (Math.abs(matrix[worldRow * 4 + column] ?? 0) > 1e-9) {
      throw new Error(`volume transform couples ${axisName} to another array axis; orthogonal slice mapping is undefined`);
    }
  }
  const step = matrix[worldRow * 4 + rawDimension] ?? 0;
  if (!Number.isFinite(step) || Math.abs(step) < 1e-12) throw new Error(`volume transform has no ${axisName} step`);
  const origin = matrix[worldRow * 4 + 3] ?? feature.descriptor.grid.originUm[worldRow] ?? 0;
  const coordinate = regionalIndexToCoordinateUm(axis, regionalIndex);
  const rawIndex = Math.round((coordinate - origin) / step);
  const count = feature.descriptor.grid.shape[rawDimension]!;
  return Math.min(count - 1, Math.max(0, rawIndex));
}
