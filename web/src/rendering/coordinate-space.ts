import type { CursorState, SliceAxis } from '../domain/types.js';

export const WORLD_AXES = ['ml', 'ap', 'dv'] as const;
export type WorldAxis = (typeof WORLD_AXES)[number];
export type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface WorldCoordinateUm {
  ml: number;
  ap: number;
  dv: number;
}

export interface PlaneCoordinate {
  slice: number;
  u: number;
  v: number;
}

export const SLICE_WORLD_AXIS: Readonly<Record<SliceAxis, WorldAxis>> = {
  coronal: 'ap',
  sagittal: 'ml',
  horizontal: 'dv',
};

export const PROJECTION_PLANE_AXES: Readonly<Record<SliceAxis, readonly [WorldAxis, WorldAxis]>> = {
  coronal: ['ml', 'dv'],
  sagittal: ['ap', 'dv'],
  horizontal: ['ml', 'ap'],
};

/** CursorState uses conventional Cartesian names: x=ML, y=AP, z=DV. */
export function cursorStateToWorld(cursor: CursorState): WorldCoordinateUm {
  return { ml: cursor.xUm, ap: cursor.yUm, dv: cursor.zUm };
}

export function worldToCursorState(world: WorldCoordinateUm): CursorState {
  return { xUm: world.ml, yUm: world.ap, zUm: world.dv };
}

export function applyAffine(matrix: Matrix4, coordinate: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = coordinate;
  const w = matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) throw new Error('affine maps coordinate to an invalid homogeneous value');
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]) / w,
    (matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]) / w,
    (matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11]) / w,
  ];
}

export function planeToWorld(matrix: Matrix4, plane: PlaneCoordinate): WorldCoordinateUm {
  const [ml, ap, dv] = applyAffine(matrix, [plane.slice, plane.u, plane.v]);
  return { ml, ap, dv };
}

export function worldToPlane(matrix: Matrix4, world: WorldCoordinateUm): PlaneCoordinate {
  const [slice, u, v] = applyAffine(matrix, [world.ml, world.ap, world.dv]);
  return { slice, u, v };
}

export function assertInverseAffines(indexToWorldUm: Matrix4, worldToIndex: Matrix4, epsilon = 1e-7): void {
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += indexToWorldUm[row * 4 + inner]! * worldToIndex[inner * 4 + column]!;
      }
      const expected = row === column ? 1 : 0;
      if (!Number.isFinite(value) || Math.abs(value - expected) > epsilon) {
        throw new Error('index_to_world_um and world_to_index are not inverse affines');
      }
    }
  }
}
