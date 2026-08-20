import type { SliceAxis } from '../domain/types.js';
import type { VolumeFeaturePayload } from '../data/contracts.js';
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
  ap: 0,
  ml: 1,
  dv: 2,
};

interface Chunks3dResource {
  shape: readonly [number, number, number];
  codec: { name: 'none' | 'gzip' };
  pathTemplate: string;
}

function integerTriple(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isInteger(item) || Number(item) <= 0)) {
    throw new Error(`${context} must contain three positive integers`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function chunks3dResource(feature: VolumeFeaturePayload): Chunks3dResource {
  const descriptor = feature.descriptor;
  if (descriptor.layout !== 'chunks3d') {
    throw new Error(`Volume layout ${descriptor.layout} is not handled by the chunks3d adapter`);
  }
  const raw = descriptor.resource;
  const codecRaw = raw.codec;
  if (!codecRaw || typeof codecRaw !== 'object' || Array.isArray(codecRaw)) throw new Error('volume chunks codec must be an object');
  const codecName = (codecRaw as Record<string, unknown>).name;
  if (codecName !== 'none' && codecName !== 'gzip') throw new Error(`unsupported volume chunk codec ${String(codecName)}`);
  if (typeof raw.path_template !== 'string' || !raw.path_template) throw new Error('volume chunks path_template is required');
  return {
    shape: integerTriple(raw.shape, 'volume chunks shape'),
    codec: { name: codecName },
    pathTemplate: raw.path_template,
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

function pathForChunk(template: string, key: readonly [number, number, number]): string {
  return template
    .replaceAll('{i0}', String(key[0]))
    .replaceAll('{i1}', String(key[1]))
    .replaceAll('{i2}', String(key[2]));
}

async function maybeDecompress(buffer: ArrayBuffer, codec: Chunks3dResource['codec']): Promise<ArrayBuffer> {
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

export class SchemaChunks3dVolumeSource implements VolumeChunkSource {
  readonly metadata: VolumeChunkMetadata;
  private readonly resource: Chunks3dResource;

  constructor(private readonly feature: VolumeFeaturePayload) {
    this.resource = chunks3dResource(feature);
    if (feature.descriptor.array.dtype !== 'float16' && feature.descriptor.array.dtype !== 'float32') {
      throw new Error(`volume slice renderer currently supports float16/float32, not ${feature.descriptor.array.dtype}`);
    }
    if (feature.descriptor.grid.voxelSizeUm.some((value) => value !== 25)) {
      throw new Error('launch volume renderer currently requires the 25 um encoding grid');
    }
    this.metadata = {
      shape: anatomicalShape(feature, feature.descriptor.grid.shape),
      chunkShape: anatomicalShape(feature, this.resource.shape),
      voxelSizeUm: 25,
      storageDtype: feature.descriptor.array.dtype,
    };
  }

  async loadChunk(key: VolumeChunkKey, signal?: AbortSignal): Promise<VolumeChunk> {
    const rawKey = rawChunkKey(this.feature, key);
    const rawShape = rawChunkShape(this.feature.descriptor.grid.shape, this.resource.shape, rawKey);
    const path = pathForChunk(this.resource.pathTemplate, rawKey);
    const compressed = await this.feature.loadResource(path, signal);
    const buffer = await maybeDecompress(compressed, this.resource.codec);
    const values = decodeBinaryArray(buffer, {
      path,
      dtype: this.feature.descriptor.array.dtype,
      shape: rawShape,
      order: 'C',
      endianness: this.feature.descriptor.array.endianness,
    });
    const shape = anatomicalShape(this.feature, rawShape);
    const data = new Float32Array(shape.coronal * shape.sagittal * shape.horizontal);
    let offset = 0;
    for (let c = 0; c < shape.coronal; c += 1) {
      for (let s = 0; s < shape.sagittal; s += 1) {
        for (let h = 0; h < shape.horizontal; h += 1) {
          data[offset++] = rawValue(values, rawShape, rawLocalIndex(this.feature, c, s, h));
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
