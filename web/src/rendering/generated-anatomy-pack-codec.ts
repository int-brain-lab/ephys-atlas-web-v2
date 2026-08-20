import type { SliceAxis } from '../domain/types.js';
import { planeToWorld, type Matrix4, type WorldAxis } from './coordinate-space.js';
import type { AnatomyRegionPath, MappingName } from './types.js';

export type AnatomyPackDecodePhase = 'gunzip' | 'utf8' | 'json-parse' | 'validate';

export interface AnatomyPackDecodeTiming {
  phase: AnatomyPackDecodePhase;
  durationMs: number;
}

export interface AnatomyPackDecodeContext {
  format: 'anatomy-pack-v1' | 'anatomy-pack-v2';
  packId: string;
  axis: SliceAxis;
  packDepth: 16 | 32;
  fixedWorldAxis: WorldAxis;
  planeIndexToWorldUm: Matrix4;
  artifact: {
    packIndex: number;
    firstSliceIndex: number;
    sliceCount: number;
    path: string;
    uncompressedBytes: number;
  };
}

export interface SlicePack {
  projection: SliceAxis;
  packDepth: 16 | 32;
  packIndex: number;
  firstSliceIndex: number;
  slices: readonly {
    sliceIndex: number;
    worldCoordinateUm: number;
    paths: readonly AnatomyRegionPath[];
  }[];
}

export interface DecodedAnatomyPack {
  pack: SlicePack;
  decodedBytes: number;
  timings: readonly AnatomyPackDecodeTiming[];
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${context} must be an integer >= ${minimum}`);
  return Number(value);
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function parseAtlasIds(value: unknown, context: string, bilateral: boolean): Readonly<Record<MappingName, number>> {
  const item = record(value, context);
  const result = {} as Record<MappingName, number>;
  for (const mapping of ['allen', 'beryl', 'cosmos'] as const) {
    const atlasId = integer(item[mapping], `${context}.${mapping}`, Number.MIN_SAFE_INTEGER);
    if (atlasId === 0 || (!bilateral && atlasId > 0)) {
      throw new Error(`${context}.${mapping} must be a valid signed hemisphere atlas ID`);
    }
    result[mapping] = atlasId;
  }
  const signs = new Set(Object.values(result).map((atlasId) => Math.sign(atlasId)));
  if (signs.size !== 1) throw new Error(`${context} mixes atlas ID hemispheres`);
  return result;
}

function parseSlicePack(value: unknown, context: AnatomyPackDecodeContext): SlicePack {
  const { artifact } = context;
  const root = record(value, artifact.path);
  const bilateral = context.format === 'anatomy-pack-v2';
  const expectedFormat = bilateral ? 'anatomy-slice-pack-v2' : 'anatomy-slice-pack-v1';
  const expectedVersion = bilateral ? '2.0' : '1.0';
  if (root.format !== expectedFormat || root.schema_version !== expectedVersion) throw new Error(`${artifact.path} has an unsupported format`);
  if (root.anatomy_pack_id !== context.packId) throw new Error(`${artifact.path} belongs to another anatomy pack`);
  if (root.projection !== context.axis) throw new Error(`${artifact.path}.projection does not match its manifest descriptor`);
  if (root.pack_depth !== context.packDepth) throw new Error(`${artifact.path}.pack_depth does not match its manifest descriptor`);
  const packIndex = integer(root.pack_index, `${artifact.path}.pack_index`);
  const firstSliceIndex = integer(root.first_slice_index, `${artifact.path}.first_slice_index`);
  if (packIndex !== artifact.packIndex || firstSliceIndex !== artifact.firstSliceIndex) {
    throw new Error(`${artifact.path} metadata does not match its manifest descriptor`);
  }
  if (root.slice_count !== artifact.sliceCount) throw new Error(`${artifact.path}.slice_count does not match its manifest descriptor`);
  if (!Array.isArray(root.slices) || root.slices.length !== artifact.sliceCount) throw new Error(`${artifact.path}.slices has the wrong length`);
  const slices = root.slices.map((value, offset) => {
    const slice = record(value, `${artifact.path}.slices[${offset}]`);
    const sliceIndex = integer(slice.slice_index, `${artifact.path}.slices[${offset}].slice_index`);
    if (sliceIndex !== firstSliceIndex + offset) throw new Error(`${artifact.path}.slices are not contiguous`);
    if (!Array.isArray(slice.paths)) throw new Error(`${artifact.path}.slices[${offset}].paths must be an array`);
    const paths = slice.paths.map((pathValue, pathIndex) => {
      const path = record(pathValue, `${artifact.path}.slices[${offset}].paths[${pathIndex}]`);
      const d = string(path.d, `${artifact.path}.slices[${offset}].paths[${pathIndex}].d`);
      if (!/^[Mm][^<>]{3,}$/.test(d)) throw new Error(`${artifact.path} contains an invalid path definition`);
      if (bilateral && path.fill_rule !== 'evenodd') throw new Error(`${artifact.path} bilateral paths must use evenodd fill`);
      return {
        atlasIds: parseAtlasIds(path.atlas_ids, `${artifact.path}.slices[${offset}].paths[${pathIndex}].atlas_ids`, bilateral),
        d,
      };
    });
    const worldCoordinateUm = finiteNumber(slice.world_coordinate_um, `${artifact.path}.slices[${offset}].world_coordinate_um`);
    const expectedWorld = planeToWorld(context.planeIndexToWorldUm, { slice: sliceIndex, u: 0, v: 0 });
    if (Math.abs(worldCoordinateUm - expectedWorld[context.fixedWorldAxis]) > 1e-6) {
      throw new Error(`${artifact.path}.slices[${offset}].world_coordinate_um does not match the projection affine`);
    }
    return { sliceIndex, worldCoordinateUm, paths };
  });
  return {
    projection: context.axis,
    packDepth: context.packDepth,
    packIndex,
    firstSliceIndex,
    slices,
  };
}

async function gunzip(buffer: ArrayBuffer, context: string): Promise<ArrayBuffer> {
  if (!('DecompressionStream' in globalThis)) throw new Error(`${context} requires gzip DecompressionStream support`);
  try {
    return await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch (error) {
    throw new Error(`${context} could not be decompressed`, { cause: error });
  }
}

export async function decodeAnatomyPack(
  compressed: ArrayBuffer,
  context: AnatomyPackDecodeContext,
): Promise<DecodedAnatomyPack> {
  const timings: AnatomyPackDecodeTiming[] = [];
  let started = performance.now();
  const decoded = await gunzip(compressed, context.artifact.path);
  timings.push({ phase: 'gunzip', durationMs: performance.now() - started });
  if (decoded.byteLength !== context.artifact.uncompressedBytes) {
    throw new Error(`${context.artifact.path} decodes to ${decoded.byteLength} bytes; expected ${context.artifact.uncompressedBytes}`);
  }

  started = performance.now();
  const json = new TextDecoder().decode(decoded);
  timings.push({ phase: 'utf8', durationMs: performance.now() - started });

  let value: unknown;
  started = performance.now();
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`${context.artifact.path} is not valid JSON`, { cause: error });
  }
  timings.push({ phase: 'json-parse', durationMs: performance.now() - started });

  started = performance.now();
  const pack = parseSlicePack(value, context);
  timings.push({ phase: 'validate', durationMs: performance.now() - started });
  return { pack, decodedBytes: decoded.byteLength, timings };
}
