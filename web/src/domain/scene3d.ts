import type { BrainCameraPose } from './types.js';

const MAX_CAMERA_COMPONENT_UM = 10_000_000;
const EPSILON = 1e-9;

function vector(value: readonly number[]): readonly [number, number, number] | null {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component) || Math.abs(component) > MAX_CAMERA_COMPONENT_UM)) return null;
  return value.map((component) => Math.round(component * 1000) / 1000) as [number, number, number];
}

function lengthSquared(value: readonly number[]): number {
  return value.reduce((sum, component) => sum + component * component, 0);
}

export function normalizeBrainCameraPose(value: BrainCameraPose | null): BrainCameraPose | null {
  if (value === null) return null;
  const positionUm = vector(value.positionUm);
  const targetUm = vector(value.targetUm);
  const up = vector(value.up);
  if (!positionUm || !targetUm || !up) return null;
  const view = positionUm.map((component, index) => component - targetUm[index]!) as [number, number, number];
  const cross = [
    view[1] * up[2] - view[2] * up[1],
    view[2] * up[0] - view[0] * up[2],
    view[0] * up[1] - view[1] * up[0],
  ];
  const viewLengthSquared = lengthSquared(view);
  const upLengthSquared = lengthSquared(up);
  if (viewLengthSquared <= EPSILON || upLengthSquared <= EPSILON
    || lengthSquared(cross) <= EPSILON * viewLengthSquared * upLengthSquared) return null;
  const upLength = Math.sqrt(upLengthSquared);
  return { positionUm, targetUm, up: up.map((component) => Math.round(component / upLength * 1000) / 1000) as [number, number, number] };
}

export function normalizeScene3DExplode(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000 : 0;
}
