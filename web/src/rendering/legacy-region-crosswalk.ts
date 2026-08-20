import type { MappingName } from './types.js';

export interface LegacyRegionCrosswalk {
  atlasIdToLegacyIndex: ReadonlyMap<number, number>;
  legacyIndexToAtlasId: ReadonlyMap<number, number>;
}

/**
 * Decode the v1 `regions.json` table which defines the numeric suffix used by
 * classes such as `beryl_region_42`. Those suffixes are BrainRegions row
 * indices, not Allen atlas IDs.
 */
export function parseLegacyRegionCrosswalk(raw: unknown, mapping: MappingName): LegacyRegionCrosswalk {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid legacy region table');
  }
  const entries = (raw as Record<string, unknown>)[mapping];
  if (!Array.isArray(entries)) throw new Error(`Legacy region table has no ${mapping} mapping`);

  const atlasIdToLegacyIndex = new Map<number, number>();
  const legacyIndexToAtlasId = new Map<number, number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const atlasId = record.atlas_id;
    const legacyIndex = record.idx;
    if (!Number.isInteger(atlasId) || !Number.isInteger(legacyIndex)) continue;
    atlasIdToLegacyIndex.set(atlasId as number, legacyIndex as number);
    legacyIndexToAtlasId.set(legacyIndex as number, atlasId as number);
  }
  if (!atlasIdToLegacyIndex.size) throw new Error(`Legacy ${mapping} region table is empty`);
  return { atlasIdToLegacyIndex, legacyIndexToAtlasId };
}
