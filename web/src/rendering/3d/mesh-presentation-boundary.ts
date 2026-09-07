import type { MeshPresentationBoundaryV1 } from '../../data/schema-v1.js';

/** Match the fragment shader using the decoded, undisplaced world ML coordinate. */
export function meshPresentationAtMl(ml: number, left: number, right: number, boundary: MeshPresentationBoundaryV1): number {
  if (left < 0) return right;
  if (right < 0) return left;
  if (ml < -boundary.threshold_um) return left;
  if (ml > boundary.threshold_um) return right;
  return boundary.on_plane_side === 'left' ? left : right;
}

export const MESH_PRESENTATION_GLSL = `
float meshPresentationAtMl(float ml, float left, float right) {
  if (left < 0.) return right;
  if (right < 0.) return left;
  if (ml < -uThreshold) return left;
  if (ml > uThreshold) return right;
  return uOnPlaneLeft > .5 ? left : right;
}`;
