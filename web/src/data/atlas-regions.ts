import type { ParcellationId } from '../domain/types.js';
import type { RegionMetadata } from './contracts.js';
import { ResourceFetcher, type ResourceIntegrity } from './cache.js';

// Version the stable public path so browsers cannot reuse an older catalog
// whose schema predates the shared physical/left/logical view contract.
export const ALLEN_ATLAS_REGIONS_URL = '/atlas/allen-ccf-2017/regions.json?v=5';

export interface AtlasRegion extends RegionMetadata {
  readonly parentId: string | null;
  readonly depth: number;
  readonly colorHex: string;
  readonly mappingMember: boolean;
  readonly mappedAtlasIds: Readonly<Record<ParcellationId, number>>;
}

type AtlasRegionMappings = Readonly<Record<ParcellationId, readonly AtlasRegion[]>>;

/**
 * Renderer-neutral `ibl-atlas-regions-v1` data adapted to TypeScript.
 *
 * These views deliberately match `ibl-atlas-assets`: physical preserves every
 * signed row, left includes void plus negative IDs, and logical includes void
 * plus one positive/right row for each hemisphere-independent identity.
 */
export interface AtlasRegionCatalog {
  readonly atlas: string;
  readonly referenceSpaceId: 'allen-ccf-2017';
  readonly physical: AtlasRegionMappings;
  readonly left: AtlasRegionMappings;
  readonly logical: AtlasRegionMappings;
}

const MAPPINGS = ['allen', 'beryl', 'cosmos'] as const;
const ROOT_KEYS = new Set([
  'atlas', 'format', 'hemisphere_encoding', 'reference_space_id', 'mappings', 'provenance', 'schema_version',
]);
const ROW_KEYS = new Set([
  'acronym', 'atlas_id', 'color_hex', 'depth', 'idx', 'mapped_atlas_ids', 'mapping_member', 'name', 'parent_id',
]);

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>, context: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${context} has unsupported fields`);
  }
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function integer(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${context} must be an integer`);
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${context} must be a boolean`);
  return value;
}

function mappingIds(value: unknown, context: string): Readonly<Record<ParcellationId, number>> {
  const raw = record(value, context);
  exactKeys(raw, new Set(MAPPINGS), context);
  return {
    allen: integer(raw.allen, `${context}.allen`),
    beryl: integer(raw.beryl, `${context}.beryl`),
    cosmos: integer(raw.cosmos, `${context}.cosmos`),
  };
}

function parseRows(mapping: ParcellationId, value: unknown): readonly AtlasRegion[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`atlas regions has no ${mapping} mapping`);
  const rows: AtlasRegion[] = [];
  const ids = new Set<number>();
  const indexes = new Set<number>();
  for (const [position, raw] of value.entries()) {
    const context = `${mapping} regions[${position}]`;
    const row = record(raw, context);
    exactKeys(row, ROW_KEYS, context);
    const atlasId = integer(row.atlas_id, `${context}.atlas_id`);
    const index = integer(row.idx, `${context}.idx`);
    const depth = integer(row.depth, `${context}.depth`);
    if (index < 0) throw new Error(`${context}.idx must be non-negative`);
    if (depth < 0) throw new Error(`${context}.depth must be non-negative`);
    if (ids.has(atlasId)) throw new Error(`${mapping} regions contains duplicate atlas id ${atlasId}`);
    if (indexes.has(index)) throw new Error(`${mapping} regions contains duplicate index ${index}`);
    ids.add(atlasId);
    indexes.add(index);
    const colorHex = string(row.color_hex, `${context}.color_hex`);
    if (!/^#[0-9a-f]{6}$/.test(colorHex)) throw new Error(`${mapping} region ${atlasId} has invalid color`);
    const parent = row.parent_id;
    const parentId = parent === null ? null : integer(parent, `${context}.parent_id`);
    rows.push({
      id: String(atlasId),
      atlasId,
      index,
      acronym: string(row.acronym, `${context}.acronym`),
      name: string(row.name, `${context}.name`),
      parentId: parentId === null ? null : String(parentId),
      depth,
      colorHex,
      mappingMember: boolean(row.mapping_member, `${context}.mapping_member`),
      mappedAtlasIds: mappingIds(row.mapped_atlas_ids, `${context}.mapped_atlas_ids`),
    });
  }
  for (let position = 1; position < rows.length; position += 1) {
    const previous = rows[position - 1];
    const current = rows[position];
    if (previous !== undefined && current !== undefined && previous.index >= current.index) {
      throw new Error(`${mapping} regions must be sorted by index`);
    }
  }
  const byId = new Map(rows.map((row) => [row.atlasId, row]));
  for (const row of rows) {
    if (row.parentId === null) continue;
    const parent = byId.get(Number(row.parentId));
    if (!parent) throw new Error(`${mapping} region ${row.id} has missing parent ${row.parentId}`);
    if (parent.depth !== row.depth - 1) throw new Error(`${mapping} region ${row.id} has inconsistent parent depth`);
    if ((parent.atlasId < 0) !== (row.atlasId < 0)) {
      throw new Error(`${mapping} region ${row.id} crosses hemisphere parent`);
    }
  }
  if (!byId.has(0)) throw new Error(`${mapping} regions must contain the void row`);
  const positive = new Set(rows.filter((row) => row.atlasId > 0).map((row) => row.atlasId));
  const negative = new Set(rows.filter((row) => row.atlasId < 0).map((row) => -row.atlasId));
  if (positive.size !== negative.size || [...positive].some((id) => !negative.has(id))) {
    throw new Error(`${mapping} physical rows must have matching left/right IDs`);
  }
  return rows;
}

export function parseAtlasRegionCatalog(value: unknown): AtlasRegionCatalog {
  const root = record(value, 'atlas regions');
  exactKeys(root, ROOT_KEYS, 'atlas regions');
  if (root.format !== 'ibl-atlas-regions-v1' || root.schema_version !== '1.0') {
    throw new Error('atlas regions format is unsupported');
  }
  if (root.reference_space_id !== 'allen-ccf-2017') {
    throw new Error('atlas regions reference space is unsupported');
  }
  if (root.hemisphere_encoding !== 'signed atlas IDs; negative is left') {
    throw new Error('atlas regions hemisphere encoding is unsupported');
  }
  const provenance = record(root.provenance, 'atlas regions provenance');
  const commit = string(provenance.iblatlas_commit, 'atlas regions provenance.iblatlas_commit');
  const crosswalkHash = string(provenance.legacy_svg_crosswalk_sha256, 'atlas regions provenance.legacy_svg_crosswalk_sha256');
  const crosswalkUrl = string(provenance.legacy_svg_crosswalk_url, 'atlas regions provenance.legacy_svg_crosswalk_url');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('atlas regions provenance has invalid iblatlas commit');
  if (!/^[0-9a-f]{64}$/.test(crosswalkHash)) throw new Error('atlas regions provenance has invalid crosswalk hash');
  if (!/^https?:\/\/\S+$/.test(crosswalkUrl)) throw new Error('atlas regions provenance has invalid crosswalk URL');
  const rawMappings = record(root.mappings, 'atlas regions mappings');
  exactKeys(rawMappings, new Set(MAPPINGS), 'atlas regions mappings');
  const physical = {} as Record<ParcellationId, readonly AtlasRegion[]>;
  const left = {} as Record<ParcellationId, readonly AtlasRegion[]>;
  const logical = {} as Record<ParcellationId, readonly AtlasRegion[]>;
  for (const mapping of MAPPINGS) {
    const rows = parseRows(mapping, rawMappings[mapping]);
    physical[mapping] = rows;
    left[mapping] = rows.filter((row) => row.atlasId <= 0);
    logical[mapping] = rows.filter((row) => row.atlasId >= 0);
  }
  return {
    atlas: string(root.atlas, 'atlas regions atlas'),
    referenceSpaceId: 'allen-ccf-2017',
    physical,
    left,
    logical,
  };
}

export async function loadAtlasRegionCatalog(
  url = ALLEN_ATLAS_REGIONS_URL,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  integrity?: ResourceIntegrity,
): Promise<AtlasRegionCatalog> {
  if (!integrity) {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Allen atlas region metadata request failed (${response.status})`);
    return parseAtlasRegionCatalog(await response.json());
  }
  const response = await new ResourceFetcher(fetchImpl).fetch(url, { immutable: true, integrity });
  return parseAtlasRegionCatalog(await response.json());
}
