import type { SliceAxis } from '../domain/types.js';
import { assertInverseAffines, planeToWorld, SLICE_WORLD_AXIS, worldToPlane, type Matrix4, type WorldAxis, type WorldCoordinateUm } from './coordinate-space.js';
import type {
  AnatomyRegionPath,
  AnatomySlice,
  AnatomySliceSource,
  MappingName,
  SliceGuide,
  SliceIndices,
  ViewBox,
} from './types.js';

const SHA256 = /^[0-9a-f]{64}$/;
const AXES = ['coronal', 'sagittal', 'horizontal'] as const;
const WORLD_ROW: Readonly<Record<WorldAxis, number>> = { ml: 0, ap: 1, dv: 2 };

interface PackArtifact {
  packIndex: number;
  firstSliceIndex: number;
  sliceCount: number;
  path: string;
  bytes: number;
  uncompressedBytes: number;
  sha256: string;
}

interface PackSet {
  packDepth: 16 | 32;
  packs: readonly PackArtifact[];
}

export interface AnatomyProjection {
  axis: SliceAxis;
  fixedWorldAxis: WorldAxis;
  planeAxes: readonly [WorldAxis, WorldAxis];
  sliceCount: number;
  sliceShape: readonly [number, number];
  viewBox: ViewBox;
  planeIndexToWorldUm: Matrix4;
  worldToPlaneIndex: Matrix4;
  packSets: Readonly<Partial<Record<'16' | '32', PackSet>>>;
}

export interface AnatomyPackManifest {
  format: 'anatomy-pack-v1';
  schemaVersion: '1.0';
  packId: string;
  immutable: true;
  createdAt: string;
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>;
  source: Readonly<Record<string, unknown>>;
  coordinateSystem: Readonly<Record<string, unknown>>;
  provenance: Readonly<Record<string, unknown>>;
  validation: Readonly<Record<string, unknown>>;
  synchronizationSentinels: readonly AnatomySynchronizationSentinel[];
}

export interface AnatomySynchronizationSentinel {
  name: string;
  worldUm: readonly [number, number, number];
  projectionIndices: Readonly<Record<SliceAxis, readonly [number, number, number]>>;
}

interface SlicePack {
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

export interface GeneratedAnatomySliceSourceOptions {
  manifestUrl: string;
  packDepth?: 16 | 32;
  fetchImpl?: typeof fetch;
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

function tuple(value: unknown, length: number, context: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${context} must contain ${length} numbers`);
  return value.map((item, index) => finiteNumber(item, `${context}[${index}]`));
}

function matrix(value: unknown, context: string): Matrix4 {
  return tuple(value, 16, context) as unknown as Matrix4;
}

function worldAxis(value: unknown, context: string): WorldAxis {
  if (value !== 'ml' && value !== 'ap' && value !== 'dv') throw new Error(`${context} must be ml, ap, or dv`);
  return value;
}

function safeRelativePath(value: unknown, context: string): string {
  const path = string(value, context);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${context} must be a safe relative path`);
  }
  return path;
}

function parseArtifact(value: unknown, context: string): PackArtifact {
  const item = record(value, context);
  if (item.media_type !== 'application/json') throw new Error(`${context}.media_type must be application/json`);
  if (item.compression !== 'gzip') throw new Error(`${context}.compression must be gzip`);
  const sha256 = string(item.sha256, `${context}.sha256`);
  if (!SHA256.test(sha256)) throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
  return {
    packIndex: integer(item.pack_index, `${context}.pack_index`),
    firstSliceIndex: integer(item.first_slice_index, `${context}.first_slice_index`),
    sliceCount: integer(item.slice_count, `${context}.slice_count`, 1),
    path: safeRelativePath(item.path, `${context}.path`),
    bytes: integer(item.bytes, `${context}.bytes`, 1),
    uncompressedBytes: integer(item.uncompressed_bytes, `${context}.uncompressed_bytes`, 1),
    sha256,
  };
}

function parsePackSet(value: unknown, depth: 16 | 32, context: string): PackSet {
  const item = record(value, context);
  if (item.pack_depth !== depth) throw new Error(`${context}.pack_depth must be ${depth}`);
  const pathTemplate = safeRelativePath(item.path_template, `${context}.path_template`);
  if (!pathTemplate.includes('{pack}') || !pathTemplate.endsWith('.json.gz')) {
    throw new Error(`${context}.path_template must address numbered .json.gz packs`);
  }
  if (!Array.isArray(item.packs) || !item.packs.length) throw new Error(`${context}.packs must be non-empty`);
  const packs = item.packs.map((entry, index) => parseArtifact(entry, `${context}.packs[${index}]`));
  for (let index = 0; index < packs.length; index += 1) {
    const pack = packs[index]!;
    if (pack.packIndex !== index) throw new Error(`${context}.packs must have contiguous pack_index values`);
    if (pack.firstSliceIndex !== index * depth) throw new Error(`${context}.packs[${index}] has a non-contiguous slice range`);
    if (pack.sliceCount > depth) throw new Error(`${context}.packs[${index}].slice_count exceeds pack_depth`);
  }
  return { packDepth: depth, packs };
}

function parseProjection(value: unknown, axis: SliceAxis): AnatomyProjection {
  const item = record(value, `projections.${axis}`);
  const fixedWorldAxis = worldAxis(item.fixed_world_axis, `projections.${axis}.fixed_world_axis`);
  if (fixedWorldAxis !== SLICE_WORLD_AXIS[axis]) throw new Error(`projections.${axis}.fixed_world_axis is inconsistent with the projection`);
  if (!Array.isArray(item.plane_axes) || item.plane_axes.length !== 2) throw new Error(`projections.${axis}.plane_axes must contain two axes`);
  const planeAxes = item.plane_axes.map((entry, index) => worldAxis(entry, `projections.${axis}.plane_axes[${index}]`)) as [WorldAxis, WorldAxis];
  const expected = axis === 'coronal' ? ['ml', 'dv'] : axis === 'sagittal' ? ['ap', 'dv'] : ['ml', 'ap'];
  if (planeAxes[0] !== expected[0] || planeAxes[1] !== expected[1]) throw new Error(`projections.${axis}.plane_axes has the wrong display orientation`);
  const shape = tuple(item.slice_shape, 2, `projections.${axis}.slice_shape`);
  if (shape.some((number) => !Number.isInteger(number) || number <= 0)) throw new Error(`projections.${axis}.slice_shape must contain positive integers`);
  const rawViewBox = tuple(item.view_box, 4, `projections.${axis}.view_box`);
  if (rawViewBox[2]! <= 0 || rawViewBox[3]! <= 0) throw new Error(`projections.${axis}.view_box must have positive dimensions`);
  if (rawViewBox[0] !== -0.5 || rawViewBox[1] !== -0.5 || rawViewBox[2] !== shape[1] || rawViewBox[3] !== shape[0]) {
    throw new Error(`projections.${axis}.view_box must follow the declared voxel-edge and slice-shape convention`);
  }
  const planeIndexToWorldUm = matrix(item.plane_index_to_world_um, `projections.${axis}.plane_index_to_world_um`);
  const worldToPlaneIndex = matrix(item.world_to_plane_index, `projections.${axis}.world_to_plane_index`);
  assertInverseAffines(planeIndexToWorldUm, worldToPlaneIndex);
  const expectedColumns: Readonly<Record<WorldAxis, number>> = {
    [fixedWorldAxis]: 0,
    [planeAxes[0]]: 1,
    [planeAxes[1]]: 2,
  } as Readonly<Record<WorldAxis, number>>;
  for (const worldName of ['ml', 'ap', 'dv'] as const) {
    const row = WORLD_ROW[worldName];
    for (let column = 0; column < 3; column += 1) {
      const coefficient = planeIndexToWorldUm[row * 4 + column]!;
      if (column === expectedColumns[worldName]) {
        if (Math.abs(Math.abs(coefficient) - 25) > 1e-9) throw new Error(`projections.${axis} ${worldName} step must be 25 um`);
      } else if (Math.abs(coefficient) > 1e-9) {
        throw new Error(`projections.${axis} affine couples orthogonal anatomy axes`);
      }
    }
  }
  if (
    Math.abs(planeIndexToWorldUm[12]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[13]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[14]) > 1e-12 ||
    Math.abs(planeIndexToWorldUm[15] - 1) > 1e-12
  ) throw new Error(`projections.${axis} affine must be an affine transform in homogeneous coordinates`);
  const rawPackSets = record(item.pack_sets, `projections.${axis}.pack_sets`);
  const packSets: Partial<Record<'16' | '32', PackSet>> = {};
  if (rawPackSets['16'] !== undefined) packSets['16'] = parsePackSet(rawPackSets['16'], 16, `projections.${axis}.pack_sets.16`);
  if (rawPackSets['32'] !== undefined) packSets['32'] = parsePackSet(rawPackSets['32'], 32, `projections.${axis}.pack_sets.32`);
  if (!packSets['16'] && !packSets['32']) throw new Error(`projections.${axis}.pack_sets must provide depth 16 or 32`);
  const sliceCount = integer(item.slice_count, `projections.${axis}.slice_count`, 1);
  for (const packSet of Object.values(packSets)) {
    if (!packSet) continue;
    const covered = packSet.packs.reduce((sum, pack) => sum + pack.sliceCount, 0);
    if (covered !== sliceCount) throw new Error(`projections.${axis} depth-${packSet.packDepth} packs cover ${covered} of ${sliceCount} slices`);
  }
  return {
    axis,
    fixedWorldAxis,
    planeAxes,
    sliceCount,
    sliceShape: [shape[0]!, shape[1]!],
    viewBox: { x: rawViewBox[0]!, y: rawViewBox[1]!, width: rawViewBox[2]!, height: rawViewBox[3]! },
    planeIndexToWorldUm,
    worldToPlaneIndex,
    packSets,
  };
}

function parseSynchronizationSentinels(
  value: unknown,
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>,
): readonly AnatomySynchronizationSentinel[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('synchronization_sentinels must contain at least two entries');
  return value.map((entry, sentinelIndex) => {
    const context = `synchronization_sentinels[${sentinelIndex}]`;
    const item = record(entry, context);
    const worldUm = tuple(item.world_um, 3, `${context}.world_um`) as [number, number, number];
    const rawIndices = record(item.projection_indices, `${context}.projection_indices`);
    const projectionIndices = {} as Record<SliceAxis, [number, number, number]>;
    for (const axis of AXES) {
      const indices = tuple(rawIndices[axis], 3, `${context}.projection_indices.${axis}`) as [number, number, number];
      const mapped = planeToWorld(projections[axis].planeIndexToWorldUm, {
        slice: indices[0], u: indices[1], v: indices[2],
      });
      const actual = [mapped.ml, mapped.ap, mapped.dv];
      if (actual.some((coordinate, index) => Math.abs(coordinate - worldUm[index]!) > 1e-6)) {
        throw new Error(`${context}.projection_indices.${axis} does not map to world_um`);
      }
      projectionIndices[axis] = indices;
    }
    return { name: string(item.name, `${context}.name`), worldUm, projectionIndices };
  });
}

export function parseAnatomyPackManifest(value: unknown): AnatomyPackManifest {
  const root = record(value, 'anatomy manifest');
  if (root.format !== 'anatomy-pack-v1' || root.schema_version !== '1.0') throw new Error('unsupported anatomy manifest format');
  if (root.immutable !== true) throw new Error('anatomy manifest must be immutable');
  const coordinateSystem = record(root.coordinate_system, 'coordinate_system');
  if (coordinateSystem.units !== 'um') throw new Error('coordinate_system.units must be um');
  if (coordinateSystem.matrix_order !== 'row-major') throw new Error('coordinate_system.matrix_order must be row-major');
  if (coordinateSystem.voxel_centers !== 'integer-indices' || coordinateSystem.voxel_edges !== 'half-integer-indices') {
    throw new Error('anatomy manifest must declare integer voxel centers and half-integer voxel edges');
  }
  if (JSON.stringify(coordinateSystem.world_axes) !== JSON.stringify(['ml', 'ap', 'dv'])) {
    throw new Error('coordinate_system.world_axes must be [ml, ap, dv]');
  }
  const source = record(root.source, 'source');
  if (source.atlas !== 'Allen CCFv3' || source.resolution_um !== 25 || source.hemisphere !== 'left') {
    throw new Error('generated anatomy must be the 25 um left-hemisphere Allen CCFv3 atlas');
  }
  const ids = record(source.region_ids, 'source.region_ids');
  if (ids.domain !== 'signed_allen_atlas_id' || ids.left_sign !== 'negative' || ids.background_id !== 0) {
    throw new Error('source.region_ids must declare negative signed Allen IDs with background 0');
  }
  for (const key of ['annotation', 'region_lut'] as const) {
    const descriptor = record(source[key], `source.${key}`);
    string(descriptor.path, `source.${key}.path`);
    integer(descriptor.bytes, `source.${key}.bytes`, 1);
    const digest = string(descriptor.sha256, `source.${key}.sha256`);
    if (!SHA256.test(digest)) throw new Error(`source.${key}.sha256 must be 64 lowercase hexadecimal characters`);
  }
  const rawProjections = record(root.projections, 'projections');
  const projections = {
    coronal: parseProjection(rawProjections.coronal, 'coronal'),
    sagittal: parseProjection(rawProjections.sagittal, 'sagittal'),
    horizontal: parseProjection(rawProjections.horizontal, 'horizontal'),
  };
  return {
    format: 'anatomy-pack-v1',
    schemaVersion: '1.0',
    packId: string(root.pack_id, 'pack_id'),
    immutable: true,
    createdAt: string(root.created_at, 'created_at'),
    source,
    coordinateSystem,
    projections,
    provenance: record(root.provenance, 'provenance'),
    validation: record(root.validation, 'validation'),
    synchronizationSentinels: parseSynchronizationSentinels(root.synchronization_sentinels, projections),
  };
}

function parseAtlasIds(value: unknown, context: string): Readonly<Record<MappingName, number>> {
  const item = record(value, context);
  const result = {} as Record<MappingName, number>;
  for (const mapping of ['allen', 'beryl', 'cosmos'] as const) {
    const atlasId = integer(item[mapping], `${context}.${mapping}`, Number.MIN_SAFE_INTEGER);
    if (atlasId >= 0) throw new Error(`${context}.${mapping} must be a negative left-hemisphere atlas ID`);
    result[mapping] = atlasId;
  }
  return result;
}

function parseSlicePack(value: unknown, manifest: AnatomyPackManifest, artifact: PackArtifact): SlicePack {
  const root = record(value, artifact.path);
  if (root.format !== 'anatomy-slice-pack-v1' || root.schema_version !== '1.0') throw new Error(`${artifact.path} has an unsupported format`);
  if (root.anatomy_pack_id !== manifest.packId) throw new Error(`${artifact.path} belongs to another anatomy pack`);
  const rawProjection = root.projection;
  if (!AXES.includes(rawProjection as SliceAxis)) throw new Error(`${artifact.path}.projection is invalid`);
  const projection = rawProjection as SliceAxis;
  const packDepth = root.pack_depth;
  if (packDepth !== 16 && packDepth !== 32) throw new Error(`${artifact.path}.pack_depth is invalid`);
  const packIndex = integer(root.pack_index, `${artifact.path}.pack_index`);
  const firstSliceIndex = integer(root.first_slice_index, `${artifact.path}.first_slice_index`);
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
      return { atlasIds: parseAtlasIds(path.atlas_ids, `${artifact.path}.slices[${offset}].paths[${pathIndex}].atlas_ids`), d };
    });
    const worldCoordinateUm = finiteNumber(slice.world_coordinate_um, `${artifact.path}.slices[${offset}].world_coordinate_um`);
    const projectionGeometry = manifest.projections[projection];
    const expectedWorld = planeToWorld(projectionGeometry.planeIndexToWorldUm, { slice: sliceIndex, u: 0, v: 0 });
    if (Math.abs(worldCoordinateUm - expectedWorld[projectionGeometry.fixedWorldAxis]) > 1e-6) {
      throw new Error(`${artifact.path}.slices[${offset}].world_coordinate_um does not match the projection affine`);
    }
    return { sliceIndex, worldCoordinateUm, paths };
  });
  return { projection, packDepth, packIndex, firstSliceIndex, slices };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gunzipJson(buffer: ArrayBuffer, context: string): Promise<{ value: unknown; byteLength: number }> {
  if (!('DecompressionStream' in globalThis)) throw new Error(`${context} requires gzip DecompressionStream support`);
  let decoded: ArrayBuffer;
  try {
    decoded = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch (error) {
    throw new Error(`${context} could not be decompressed`, { cause: error });
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(decoded)), byteLength: decoded.byteLength };
  } catch (error) {
    throw new Error(`${context} is not valid JSON`, { cause: error });
  }
}

export class GeneratedAnatomySliceSource implements AnatomySliceSource {
  private readonly fetchImpl: typeof fetch;
  private readonly packDepth: 16 | 32 | undefined;
  private manifestPromise: Promise<AnatomyPackManifest> | null = null;
  private readonly packs = new Map<string, Promise<SlicePack>>();

  constructor(private readonly options: GeneratedAnatomySliceSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.packDepth = options.packDepth;
  }

  loadManifest(): Promise<AnatomyPackManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetchManifest();
      this.manifestPromise.catch(() => { this.manifestPromise = null; });
    }
    return this.manifestPromise;
  }

  async loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice> {
    const manifest = await this.loadManifest();
    const projection = manifest.projections[axis];
    if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
      throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
    }
    const packSet = this.packDepth == null
      ? projection.packSets['16'] ?? projection.packSets['32']
      : projection.packSets[String(this.packDepth) as '16' | '32'];
    if (!packSet) throw new Error(`${axis} anatomy has no depth-${this.packDepth} pack set`);
    const artifact = packSet.packs.find((candidate) => index >= candidate.firstSliceIndex && index < candidate.firstSliceIndex + candidate.sliceCount);
    if (!artifact) throw new Error(`${axis} anatomy index ${index} is not covered by a pack`);
    const pack = await this.loadPack(manifest, axis, packSet.packDepth, artifact, signal);
    const slice = pack.slices[index - artifact.firstSliceIndex];
    if (!slice || slice.sliceIndex !== index) throw new Error(`${artifact.path} does not contain ${axis} slice ${index}`);
    return { axis, ...slice, viewBox: projection.viewBox };
  }

  async worldFromSliceIndices(indices: SliceIndices): Promise<WorldCoordinateUm> {
    const manifest = await this.loadManifest();
    const world: WorldCoordinateUm = { ml: 0, ap: 0, dv: 0 };
    for (const axis of AXES) {
      const projection = manifest.projections[axis];
      const index = indices[axis];
      if (!Number.isInteger(index) || index < 0 || index >= projection.sliceCount) {
        throw new RangeError(`${axis} anatomy index ${index} is outside [0, ${projection.sliceCount - 1}]`);
      }
      const coordinate = planeToWorld(projection.planeIndexToWorldUm, { slice: index, u: 0, v: 0 });
      world[projection.fixedWorldAxis] = coordinate[projection.fixedWorldAxis];
    }
    return world;
  }

  async guidesForWorld(axis: SliceAxis, world: WorldCoordinateUm): Promise<readonly SliceGuide[]> {
    const projection = (await this.loadManifest()).projections[axis];
    const plane = worldToPlane(projection.worldToPlaneIndex, world);
    return projection.planeAxes.map((worldAxis, index) => ({
      sourceAxis: AXES.find((candidate) => SLICE_WORLD_AXIS[candidate] === worldAxis)!,
      targetAxis: axis,
      dimension: index === 0 ? 'x' : 'y',
      position: index === 0 ? plane.u : plane.v,
    }));
  }

  private async fetchManifest(): Promise<AnatomyPackManifest> {
    const response = await this.fetchImpl(this.options.manifestUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Anatomy manifest request failed (${response.status})`);
    return parseAnatomyPackManifest(await response.json());
  }

  private loadPack(manifest: AnatomyPackManifest, axis: SliceAxis, packDepth: 16 | 32, artifact: PackArtifact, signal?: AbortSignal): Promise<SlicePack> {
    const key = `${axis}:${packDepth}:${artifact.path}`;
    let pending = this.packs.get(key);
    if (!pending) {
      pending = this.fetchPack(manifest, axis, packDepth, artifact, signal);
      this.packs.set(key, pending);
      pending.catch(() => this.packs.delete(key));
    }
    return pending;
  }

  private async fetchPack(manifest: AnatomyPackManifest, axis: SliceAxis, packDepth: 16 | 32, artifact: PackArtifact, signal?: AbortSignal): Promise<SlicePack> {
    const url = new URL(artifact.path, this.options.manifestUrl).toString();
    const response = await this.fetchImpl(url, { cache: 'force-cache', ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(`Anatomy pack request failed (${response.status}): ${artifact.path}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== artifact.bytes) throw new Error(`${artifact.path} has ${buffer.byteLength} bytes; expected ${artifact.bytes}`);
    if (await sha256Hex(buffer) !== artifact.sha256) throw new Error(`SHA-256 mismatch for anatomy pack ${artifact.path}`);
    const decoded = await gunzipJson(buffer, artifact.path);
    if (decoded.byteLength !== artifact.uncompressedBytes) {
      throw new Error(`${artifact.path} decodes to ${decoded.byteLength} bytes; expected ${artifact.uncompressedBytes}`);
    }
    const pack = parseSlicePack(decoded.value, manifest, artifact);
    if (pack.projection !== axis || pack.packDepth !== packDepth || pack.packIndex !== artifact.packIndex || pack.firstSliceIndex !== artifact.firstSliceIndex) {
      throw new Error(`${artifact.path} metadata does not match its manifest descriptor`);
    }
    return pack;
  }
}
