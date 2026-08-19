export interface BrainMeshGeometry {
  regionId: number;
  /** xyz float32 triplets in the shared IBL/renderer scene coordinates. */
  positions: Float32Array;
  /** Triangle vertex indices. */
  indices: Uint32Array;
}

export interface PointCloudGeometry {
  /** xyz float32 triplets. */
  positions: Float32Array;
  /** Optional scalar feature, one float32 per point. */
  values?: Float32Array;
  /** Optional stable point ids for future picking/selection. */
  ids?: Uint32Array;
}

export interface Renderer3DScene {
  meshes: readonly BrainMeshGeometry[];
  points?: PointCloudGeometry;
}

export interface Scene3DMemoryEstimate {
  meshBytes: number;
  pointBytes: number;
  totalBytes: number;
}

export function validateRenderer3DScene(scene: Renderer3DScene): void {
  const regionIds = new Set<number>();
  for (const mesh of scene.meshes) {
    if (!Number.isInteger(mesh.regionId)) throw new TypeError('mesh regionId must be an integer');
    if (regionIds.has(mesh.regionId)) throw new Error(`duplicate mesh regionId ${mesh.regionId}`);
    regionIds.add(mesh.regionId);
    if (mesh.positions.length % 3 !== 0) throw new RangeError(`mesh ${mesh.regionId} positions are not xyz triplets`);
    const vertexCount = mesh.positions.length / 3;
    if (mesh.indices.length % 3 !== 0) throw new RangeError(`mesh ${mesh.regionId} indices are not triangles`);
    for (const index of mesh.indices) {
      if (index >= vertexCount) throw new RangeError(`mesh ${mesh.regionId} index ${index} exceeds ${vertexCount} vertices`);
    }
  }

  const points = scene.points;
  if (!points) return;
  if (points.positions.length % 3 !== 0) throw new RangeError('point positions are not xyz triplets');
  const count = points.positions.length / 3;
  if (points.values && points.values.length !== count) throw new RangeError('point values length does not match point count');
  if (points.ids && points.ids.length !== count) throw new RangeError('point ids length does not match point count');
}

export function estimateRenderer3DSceneBytes(scene: Renderer3DScene): Scene3DMemoryEstimate {
  const meshBytes = scene.meshes.reduce((total, mesh) => total + mesh.positions.byteLength + mesh.indices.byteLength, 0);
  const pointBytes = scene.points
    ? scene.points.positions.byteLength + (scene.points.values?.byteLength ?? 0) + (scene.points.ids?.byteLength ?? 0)
    : 0;
  return { meshBytes, pointBytes, totalBytes: meshBytes + pointBytes };
}
