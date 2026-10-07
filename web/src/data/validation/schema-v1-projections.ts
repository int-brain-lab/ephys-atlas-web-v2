/** Schema-v1 projections semantic checks; the release contract is unchanged. */

import {
  type JsonObject,
  fail,
  object,
  array,
  integers,
  exactKeys,
  allowedKeys,
  expect,
  unique,
  increasing,
} from './schema-v1-common.js';
import { affineSemantics } from './schema-v1-volume.js';

export function registeredSemantics(document: JsonObject): void {
  allowedKeys(document, [
    'id', 'kind', 'reference_space_id', 'grid_id', 'world_slice_axis', 'slice_count',
    'slice_shape', 'view_box', 'plane_index_to_world_um', 'voxel_edge_extent_um',
    'display_slices', 'resource_index',
  ], ['world_to_plane_index'], 'registered projection');
  expect(document.kind, 'registered-slice-stack', 'registered projection kind');
  const id = String(document.id);
  const expectedAxis = PROJECTION_AXES[id];
  if (expectedAxis === undefined || document.world_slice_axis !== expectedAxis) fail('registered projection world axis is invalid');
  const shape = [Number(document.slice_count), ...integers(document.slice_shape, 'registered slice shape')];
  affineSemantics(document.plane_index_to_world_um, shape, document.voxel_edge_extent_um, document.world_to_plane_index);
  const matrix = document.plane_index_to_world_um as number[];
  const row = { ml: 0, ap: 1, dv: 2 }[expectedAxis]!;
  if (matrix[row * 4] === 0) fail('registered slice coordinate does not map to its world axis');
  const slices = integers(document.display_slices, 'display slices');
  if (slices.some((value, index) => value >= shape[0]! || (index > 0 && slices[index - 1]! >= value))) fail('registered display slices are invalid');
}

export function registeredResourceIndexSemantics(document: JsonObject): void {
  exactKeys(document, ['schema_version', 'format', 'projection_id', 'resources'], 'registered SVG resource index');
  expect(document.schema_version, '1.0', 'registered SVG resource-index schema version');
  expect(document.format, 'atlas-registered-svg-resource-index-v1', 'registered SVG resource-index format');
  const resources = array(document.resources, 'registered SVG resources').map((value) => object(value, 'registered SVG resource'));
  unique(resources.map((entry) => entry.pack_id), 'registered SVG pack id');
  unique(resources.map((entry) => object(entry.resource, 'registered SVG encoded resource').path), 'registered SVG resource path');
  const allSlices: number[] = [];
  for (const entry of resources) {
    exactKeys(entry, ['pack_id', 'slice_indices', 'resource'], 'registered SVG resource');
    const slices = integers(entry.slice_indices, 'registered SVG slice indices');
    increasing(slices, 'registered SVG resource slices');
    const resource = object(entry.resource, 'registered SVG encoded resource');
    expect(resource.media_type, 'application/vnd.ibl.indexed-svg', 'registered SVG media type');
    expect(object(resource.codec, 'registered SVG codec').name, 'gzip', 'registered SVG codec');
    allSlices.push(...slices);
  }
  increasing(allSlices, 'registered SVG resource-index slices');
}

export function staticSemantics(document: JsonObject): void {
  exactKeys(document, ['id', 'kind', 'view_box', 'path_count', 'fragment'], 'static projection');
  expect(document.kind, 'static-regional-map', 'static projection kind');
  if (JSON.stringify(document.view_box) !== JSON.stringify([60, 20, 340, 300])) fail('static projection view box is invalid');
  if (document.path_count !== STATIC_PATH_COUNTS[String(document.id)]) fail('static projection path count is invalid');
  const resource = object(object(document.fragment, 'static fragment').resource, 'static fragment resource');
  if (resource.media_type !== 'image/svg+xml' || object(resource.codec, 'static fragment codec').name !== 'gzip') fail('static fragment must be gzip SVG');
}

export function packSemantics(document: JsonObject): void {
  exactKeys(document, [
    'schema_version', 'format', 'pack_id', 'immutable', 'reference_space_id',
    'mappings', 'projections', 'provenance',
  ], 'projection pack');
  expect(document.schema_version, '1.0', 'projection-pack schema version');
  expect(document.format, 'atlas-projection-pack-v1', 'projection-pack format');
  expect(document.immutable, true, 'projection-pack immutability');
  const mappings = array(document.mappings, 'projection mappings');
  if (new Set(mappings).size !== 3 || !['allen', 'beryl', 'cosmos'].every((mapping) => mappings.includes(mapping))) fail('projection mappings are incomplete');
  const projections = array(document.projections, 'projections').map((item) => object(item, 'projection'));
  const ids = projections.map((projection) => projection.id);
  if (new Set(ids).size !== 5 || !['coronal', 'sagittal', 'horizontal', 'top', 'swanson'].every((id) => ids.includes(id))) fail('projection identities are incomplete');
  for (const projection of projections) {
    if (projection.kind === 'registered-slice-stack') {
      if (projection.reference_space_id !== document.reference_space_id) fail('projection reference space differs from pack');
      registeredSemantics(projection);
    } else staticSemantics(projection);
  }
}

export const PROJECTION_AXES: Readonly<Record<string, string>> = { coronal: 'ap', sagittal: 'ml', horizontal: 'dv' };

export const STATIC_PATH_COUNTS: Readonly<Record<string, number>> = { top: 114, swanson: 808 };
