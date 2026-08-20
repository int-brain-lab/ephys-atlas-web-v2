import type { RegionMetadata } from './contracts.js';

export interface RegionHierarchyRow {
  region: RegionMetadata;
  depth: number;
  hasChildren: boolean;
}

/**
 * Order a parent-closed ontology inventory in preorder and derive display depth
 * from stable parent IDs. Source row order and the advisory `depth` field are
 * deliberately not hierarchy authorities.
 */
export function buildRegionHierarchy(regions: readonly RegionMetadata[]): readonly RegionHierarchyRow[] {
  const byId = new Map<string, RegionMetadata>();
  const position = new Map<string, number>();
  regions.forEach((region, index) => {
    if (byId.has(region.id)) throw new Error(`region hierarchy contains duplicate id ${region.id}`);
    byId.set(region.id, region);
    position.set(region.id, index);
  });

  const children = new Map<string, RegionMetadata[]>();
  const roots: RegionMetadata[] = [];
  for (const region of regions) {
    if (region.parentId === null || region.parentId === undefined) {
      roots.push(region);
      continue;
    }
    if (!byId.has(region.parentId)) {
      throw new Error(`region ${region.id} has missing parent ${region.parentId}`);
    }
    const siblings = children.get(region.parentId) ?? [];
    siblings.push(region);
    children.set(region.parentId, siblings);
  }

  const bySourceOrder = (left: RegionMetadata, right: RegionMetadata): number =>
    (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0);
  roots.sort(bySourceOrder);
  for (const siblings of children.values()) siblings.sort(bySourceOrder);

  const rows: RegionHierarchyRow[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (region: RegionMetadata, depth: number): void => {
    if (visiting.has(region.id)) throw new Error(`region hierarchy contains a cycle at ${region.id}`);
    if (visited.has(region.id)) return;
    visiting.add(region.id);
    const descendants = children.get(region.id) ?? [];
    rows.push({ region, depth, hasChildren: descendants.length > 0 });
    for (const child of descendants) visit(child, depth + 1);
    visiting.delete(region.id);
    visited.add(region.id);
  };
  for (const root of roots) visit(root, 0);

  if (visited.size !== regions.length) {
    const unresolved = regions.find((region) => !visited.has(region.id));
    if (unresolved) visit(unresolved, 0);
  }
  return rows;
}
