/** Fixed source-coordinate candidate, confined to the development review lab. */
import type { EncodedResourceDescriptor, VolumeFeaturePayload, VolumeGridDescriptor } from '../data/contracts.js';
import { applyAffine, assertInverseAffines, type Matrix4, type WorldCoordinateUm } from '../core/spatial.js';
import type { LabManifest } from './agea-data.js';
import { offset, PLANES, planePoint, type Axis, type Triple } from './agea-model.js';

export function alignmentGrid(manifest: LabManifest, candidateReference: string): VolumeGridDescriptor {
  const m = manifest.index_to_world_um;
  if (m.length !== 16 || m.some(v => !Number.isFinite(v)) || m.slice(12).join(',') !== '0,0,0,1') throw new Error('Invalid source affine');
  const inverse = Array<number>(16).fill(0); inverse[15] = 1;
  const dimensions = new Set<number>();
  const voxelSize: Triple = [0, 0, 0];
  for (let row = 0; row < 3; row++) {
    const entries = [0, 1, 2].filter(d => m[row * 4 + d] !== 0);
    if (entries.length !== 1 || dimensions.has(entries[0]!)) throw new Error('Source affine must be a signed axis permutation');
    const dimension = entries[0]!; dimensions.add(dimension);
    const scale = m[row * 4 + dimension]!;
    inverse[dimension * 4 + row] = 1 / scale;
    inverse[dimension * 4 + 3] = -m[row * 4 + 3]! / scale;
    voxelSize[dimension] = Math.abs(scale);
  }
  assertInverseAffines(m as unknown as Matrix4, inverse as unknown as Matrix4);
  const edges: number[][] = [];
  for (const a of [-.5, manifest.shape[0] - .5]) for (const b of [-.5, manifest.shape[1] - .5]) for (const c of [-.5, manifest.shape[2] - .5]) {
    edges.push(applyAffine(m as unknown as Matrix4, [a, b, c]));
  }
  const extent = [0, 1, 2].flatMap(d => [Math.min(...edges.map(p => p[d]!)), Math.max(...edges.map(p => p[d]!))]);
  return { referenceSpaceId: candidateReference, gridId: 'agea-200um-alignment-candidate-only',
    shape: manifest.shape, axisOrder: ['ml', 'dv', 'ap'], coordinateSystem: 'Candidate ML/AP/DV micrometres',
    voxelSizeUm: voxelSize, originUm: [m[3]!, m[7]!, m[11]!], indexToWorldUm: m,
    worldToIndex: inverse, voxelEdgeExtentUm: extent as [number, number, number, number, number, number] };
}

export function sourceVoxel(grid: VolumeGridDescriptor, world: WorldCoordinateUm): { fractional: Triple; index: Triple | null } {
  const fractional = applyAffine(grid.worldToIndex as Matrix4, [world.ml, world.ap, world.dv]).map((value) => {
    const half = Math.round(value * 2) / 2;
    return Math.abs(value - half) <= 1e-12 ? half : value;
  }) as Triple;
  if (fractional.some((v, d) => !Number.isFinite(v) || v < -.5 || v >= grid.shape[d]! - .5)) return { fractional, index: null };
  return { fractional, index: fractional.map(v => Math.floor(v + .5)) as Triple };
}

/** Contours at true voxel edges, in the raw volume plane's pixel coordinates. */
export function coarseBoundaryPath(labels: Int32Array, shape: Triple, axis: Axis, index: number): string {
  const p = PLANES[axis]; const cursor: Triple = [0, 0, 0]; cursor[p.fixed] = index;
  const width = shape[p.x]!; const height = shape[p.y]!;
  const value = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0
    : labels[offset(planePoint(axis, x, y, cursor), shape)]!;
  const parts: string[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = value(x, y); if (id === 0) continue;
    if (id !== value(x - 1, y)) parts.push(`M${x},${y}v1`);
    if (id !== value(x, y - 1)) parts.push(`M${x},${y}h1`);
    if (value(x + 1, y) === 0) parts.push(`M${x + 1},${y}v1`);
    if (value(x, y + 1) === 0) parts.push(`M${x},${y + 1}h1`);
  }
  return parts.join('');
}

/** Materialize verified lab arrays into the existing volume payload interface.
 * This is never a release builder: the explicitly selected candidate frame is
 * used only to REVIEW the fixed source affine through the production renderer.
 */
export async function alignmentFeature(values: Float32Array, grid: VolumeGridDescriptor, id: string, expression: boolean): Promise<VolumeFeaturePayload> {
  if (values.length !== grid.shape.reduce((a, b) => a * b, 1)) throw new Error('Alignment array shape mismatch');
  const buffers = new Map<string, ArrayBuffer>();
  async function resource(name: string, bytes: ArrayBuffer): Promise<EncodedResourceDescriptor> {
    const path = `${id}/${name}`;
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    buffers.set(path, bytes);
    return { path, bytes: bytes.byteLength, sha256, mediaType: 'application/octet-stream', codec: { name: 'none', decodedBytes: bytes.byteLength } };
  }
  const mask = new Uint8Array(values.length);
  const valid: number[] = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(v) || (expression && v === -1)) mask[i] = 2;
    else if (expression && v < 0) throw new Error('Unexpected negative expression');
    else valid.push(v);
  });
  valid.sort((a, b) => a - b);
  const quantile = (p: number) => {
    if (!valid.length) return null;
    const x = p * (valid.length - 1); const low = Math.floor(x);
    return valid[low]! + (valid[Math.ceil(x)]! - valid[low]!) * (x - low);
  };
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const summary = { totalVoxelCount: values.length, validVoxelCount: valid.length, outsideVoxelCount: 0,
    missingVoxelCount: values.length - valid.length,
    validStatistics: { min: valid[0] ?? null, max: valid.at(-1) ?? null, mean,
      std: mean === null ? null : Math.sqrt(valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / valid.length),
      median: quantile(.5), q05: quantile(.05), q25: quantile(.25), q75: quantile(.75), q95: quantile(.95) },
    valueRange: [valid[0] ?? null, valid.at(-1) ?? null] as const };
  const scalar = await resource('values.f32', Float32Array.from(values).buffer);
  const validity = await resource('validity.u8', mask.buffer);
  const index = { chunk_shape: grid.shape, chunks: [{ origin: [0, 0, 0], resource: scalar,
    decoded: { shape: grid.shape, storageAxes: ['i0', 'i1', 'i2'] } }] };
  const encoder = new TextEncoder();
  const indexResource = await resource('index.json', encoder.encode(JSON.stringify(index)).buffer);
  const summaryResource = await resource('summary.json', encoder.encode(JSON.stringify(summary)).buffer);
  return { schemaVersion: '1.0', featureId: id, representation: 'volume', summary,
    descriptor: { kind: 'volume', format: 'ephys-atlas-volume-v1', layout: 'chunks3d', grid,
      array: { dtype: 'float32', endianness: 'little', order: 'C' }, resource: index,
      resourceIndexPath: indexResource.path, resourceIndexResource: indexResource,
      summaryPath: summaryResource.path, summaryResource,
      validity: { kind: 'mask', codes: { valid: 0, outside: 1, missing: 2 },
        mask: { shape: grid.shape, resource: { ...validity, format: 'raw-binary-array-v1', dtype: 'uint8',
          shape: grid.shape, order: 'C', endianness: 'little' } } } },
    async loadResource(path, signal) {
      signal?.throwIfAborted(); const data = buffers.get(path);
      if (!data) throw new Error('Undeclared in-memory lab resource');
      return data;
    } };
}
