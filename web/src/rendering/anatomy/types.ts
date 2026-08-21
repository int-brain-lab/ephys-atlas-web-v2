import type { Matrix4, SliceAxis, ViewBox, WorldAxis } from '../../core/spatial.js';

export const ANATOMY_AXES = ['coronal', 'sagittal', 'horizontal'] as const satisfies readonly SliceAxis[];

export interface PackArtifact {
  packIndex: number;
  firstSliceIndex: number;
  sliceCount: number;
  path: string;
  bytes: number;
  uncompressedBytes: number;
  sha256: string;
  mediaType?: string;
  packId?: string;
  firstDisplayIndex?: number;
}

export interface PackSet {
  packDepth: 8 | 16 | 32;
  packs: readonly PackArtifact[];
}

export interface AnatomyProjection {
  axis: SliceAxis;
  fixedWorldAxis: WorldAxis;
  planeAxes: readonly [WorldAxis, WorldAxis];
  sliceCount: number;
  displaySliceIndices?: readonly number[];
  displaySliceCount?: number;
  sliceShape: readonly [number, number];
  viewBox: ViewBox;
  planeIndexToWorldUm: Matrix4;
  worldToPlaneIndex: Matrix4;
  packSets: Readonly<Partial<Record<'8' | '16' | '32', PackSet>>>;
}

export interface AnatomySynchronizationSentinel {
  name: string;
  worldUm: readonly [number, number, number];
  projectionIndices: Readonly<Record<SliceAxis, readonly [number, number, number]>>;
}

export interface AnatomyPackManifest {
  format: 'anatomy-pack-v1' | 'anatomy-pack-v2' | 'anatomy-pack-v3';
  schemaVersion: '1.0' | '2.0' | '3.0';
  packId: string;
  immutable: true;
  createdAt: string;
  projections: Readonly<Record<SliceAxis, AnatomyProjection>>;
  source: Readonly<Record<string, unknown>>;
  coordinateSystem: Readonly<Record<string, unknown>>;
  provenance: Readonly<Record<string, unknown>>;
  validation: Readonly<Record<string, unknown>>;
  synchronizationSentinels: readonly AnatomySynchronizationSentinel[];
  parent?: Readonly<Record<string, unknown>>;
  sampling?: Readonly<Record<string, unknown>>;
}
