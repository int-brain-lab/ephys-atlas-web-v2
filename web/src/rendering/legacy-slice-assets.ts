import type { SliceAxis } from '../domain/types.js';

export type LegacyCuratedProjection = SliceAxis | 'top' | 'swanson';

export interface LegacyCuratedSliceAsset {
  fileName: string;
  byteLength: number;
  sha256: string;
  entryCount: number;
  pathCount: number;
  minIndex: number;
  maxIndex: number;
  step: number | null;
}

// Exact inventory of the curated bundles downloaded from the deployed v1 atlas on 2026-08-19.
// These are provenance/integrity facts about the hand-tuned assets, not scientific calibration.
export const LEGACY_CURATED_SLICE_ASSETS: Readonly<Record<LegacyCuratedProjection, LegacyCuratedSliceAsset>> = {
  coronal: {
    fileName: 'slices_coronal.json',
    byteLength: 34_228_762,
    sha256: 'd237f222830791b4f4fc44b0f3d49aa86f3fe4a34988f480ec492b66b4b3dff2',
    entryCount: 658,
    pathCount: 103_604,
    minIndex: 2,
    maxIndex: 1316,
    step: 2,
  },
  sagittal: {
    fileName: 'slices_sagittal.json',
    byteLength: 26_269_579,
    sha256: '5a32a2669cea9e5b73f3df39f9781d66fd6a4bfeffe4ac6639adcae34bcb8c4e',
    entryCount: 517,
    pathCount: 72_943,
    minIndex: 54,
    maxIndex: 1086,
    step: 2,
  },
  horizontal: {
    fileName: 'slices_horizontal.json',
    byteLength: 26_759_095,
    sha256: 'f553ae1fb3eac079851e5adbcaa37e52db8e3660552737cd61c52f09033a5ed2',
    entryCount: 370,
    pathCount: 91_544,
    minIndex: 16,
    maxIndex: 754,
    step: 2,
  },
  top: {
    fileName: 'slices_top.json',
    byteLength: 40_173,
    sha256: '4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30',
    entryCount: 1,
    pathCount: 114,
    minIndex: 0,
    maxIndex: 0,
    step: null,
  },
  swanson: {
    fileName: 'slices_swanson.json',
    byteLength: 192_565,
    sha256: '347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba',
    entryCount: 1,
    pathCount: 808,
    minIndex: 0,
    maxIndex: 0,
    step: null,
  },
};

export const LEGACY_CURATED_SLICE_BASE_URL = 'https://atlas.internationalbrainlab.org/data/json/';

export interface LegacyCuratedSliceRange {
  min: number;
  max: number;
  step: number;
}

export function legacyCuratedSliceRange(axis: SliceAxis): LegacyCuratedSliceRange {
  const asset = LEGACY_CURATED_SLICE_ASSETS[axis];
  return { min: asset.minIndex, max: asset.maxIndex, step: asset.step ?? 1 };
}

export function nearestLegacyCuratedSliceIndex(axis: SliceAxis, requested: number): number {
  const { min, max, step } = legacyCuratedSliceRange(axis);
  const clamped = Math.min(max, Math.max(min, Math.round(requested)));
  const offset = Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, min + offset));
}

export function legacyCuratedSliceUrl(axis: SliceAxis, baseUrl = LEGACY_CURATED_SLICE_BASE_URL): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(LEGACY_CURATED_SLICE_ASSETS[axis].fileName, normalized).toString();
}
