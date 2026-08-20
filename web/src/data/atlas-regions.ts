import type { ParcellationId } from '../domain/types.js';
import type { RegionMetadata } from './contracts.js';

export const ALLEN_ATLAS_REGIONS_URL = '/atlas/allen-ccf-2017/regions.json';

export interface AtlasRegionCatalog {
  atlas: string;
  mappings: Readonly<Record<ParcellationId, readonly RegionMetadata[]>>;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function integer(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${context} must be an integer`);
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${context} must be a boolean`);
  return value;
}

export function parseAtlasRegionCatalog(value: unknown): AtlasRegionCatalog {
  const root = record(value, 'atlas regions');
  if (root.format !== 'ibl-atlas-regions-v1' || root.schema_version !== '1.0') {
    throw new Error('atlas regions format is unsupported');
  }
  const rawMappings = record(root.mappings, 'atlas regions mappings');
  const mappings = {} as Record<ParcellationId, readonly RegionMetadata[]>;
  for (const mapping of ['allen', 'beryl', 'cosmos'] as const) {
    const rawRows = rawMappings[mapping];
    if (!Array.isArray(rawRows)) throw new Error(`atlas regions has no ${mapping} mapping`);
    const seenIds = new Set<number>();
    const rows: RegionMetadata[] = [];
    for (const [position, raw] of rawRows.entries()) {
      const row = record(raw, `${mapping} regions[${position}]`);
      const atlasId = integer(row.atlas_id, `${mapping} regions[${position}].atlas_id`);
      if (atlasId >= 0) continue;
      if (seenIds.has(atlasId)) throw new Error(`${mapping} regions contains duplicate atlas id ${atlasId}`);
      seenIds.add(atlasId);
      const colorHex = string(row.color_hex, `${mapping} regions[${position}].color_hex`).toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(colorHex)) throw new Error(`${mapping} region ${atlasId} has invalid color`);
      const parentId = row.parent_id === null ? null : String(integer(row.parent_id, `${mapping} regions[${position}].parent_id`));
      rows.push({
        id: String(atlasId),
        atlasId,
        index: rows.length,
        legacyIndex: integer(row.idx, `${mapping} regions[${position}].idx`),
        acronym: string(row.acronym, `${mapping} regions[${position}].acronym`),
        name: string(row.name, `${mapping} regions[${position}].name`),
        parentId,
        depth: integer(row.depth, `${mapping} regions[${position}].depth`),
        colorHex,
        mappingMember: boolean(row.mapping_member, `${mapping} regions[${position}].mapping_member`),
      });
    }
    if (!rows.length) throw new Error(`${mapping} atlas region mapping is empty`);
    const ids = new Set(rows.map((row) => row.id));
    for (const row of rows) {
      if (row.parentId !== null && row.parentId !== undefined && !ids.has(row.parentId)) {
        throw new Error(`${mapping} region ${row.id} has missing parent ${row.parentId}`);
      }
    }
    mappings[mapping] = rows;
  }
  return { atlas: string(root.atlas, 'atlas regions atlas'), mappings };
}

export async function loadAtlasRegionCatalog(
  url = ALLEN_ATLAS_REGIONS_URL,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<AtlasRegionCatalog> {
  const response = await fetchImpl(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Allen atlas region metadata request failed (${response.status})`);
  return parseAtlasRegionCatalog(await response.json());
}
