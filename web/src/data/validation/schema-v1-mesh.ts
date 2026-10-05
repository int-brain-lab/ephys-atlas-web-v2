/** Schema-v1 mesh semantic checks; the release contract is unchanged. */

import {
  type JsonObject,
  fail,
  object,
  array,
  numberArray,
  integers,
  expect,
  unique,
} from './schema-v1-common.js';
import { close } from './schema-v1-volume.js';

export function meshPackSemantics(document: JsonObject): void {
  expect(document.schema_version, '1.0', 'mesh-pack schema version');
  expect(document.format, 'atlas-mesh-pack-v1', 'mesh-pack format');
  expect(document.immutable, true, 'mesh-pack immutability');
  if (typeof document.reference_space_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(document.reference_space_id)) fail('mesh reference space is invalid');
  const coordinate = object(document.coordinate_system, 'mesh coordinate system');
  const transform = numberArray(coordinate.source_to_world_um, 16, 'mesh source-to-world transform');
  if (JSON.stringify(transform.slice(12)) !== JSON.stringify([0, 0, 0, 1])) fail('mesh source-to-world transform must be affine');
  const determinant = transform[0]! * (transform[5]! * transform[10]! - transform[6]! * transform[9]!)
    - transform[1]! * (transform[4]! * transform[10]! - transform[6]! * transform[8]!)
    + transform[2]! * (transform[4]! * transform[9]! - transform[5]! * transform[8]!);
  if (Math.abs(determinant) <= Number.EPSILON) fail('mesh source-to-world transform must be invertible');

  const scope = object(document.geometry_scope, 'mesh geometry scope');
  const active = integers(scope.active_allen_ids, 'mesh active Allen IDs');
  const excluded = integers(scope.excluded_allen_ids, 'mesh excluded Allen IDs');
  const sources = object(document.sources, 'mesh sources');
  const sourceGlb = object(sources.source_glb, 'mesh source GLB');
  const inventory = integers(sourceGlb.inventory_allen_ids, 'mesh source inventory');
  for (const [values, label] of [[active, 'active Allen IDs'], [excluded, 'excluded Allen IDs'], [inventory, 'source inventory']] as const) {
    if (values.some((value, index) => index > 0 && values[index - 1]! >= value)) fail(`mesh ${label} must be sorted and unique`);
  }
  if (active.some((id) => excluded.includes(id))) fail('mesh active and excluded Allen IDs overlap');

  const boundary = object(document.presentation_boundary, 'mesh presentation boundary');
  if (boundary.coordinate !== 'original-world-ml' || typeof boundary.threshold_um !== 'number' || !Number.isFinite(boundary.threshold_um)
    || boundary.threshold_um < 0 || !['left', 'right'].includes(String(boundary.on_plane_side))
    || !['provisional-test-only', 'provisional-review', 'reviewed'].includes(String(boundary.status))) fail('mesh presentation boundary is invalid');
  if (document.purpose === 'production' && boundary.status !== 'reviewed') fail('production mesh boundary must be reviewed');
  if (boundary.status === 'provisional-review' && document.purpose !== 'review-only') fail('review boundary requires review-only mesh purpose');
  if (boundary.status === 'provisional-test-only' && document.purpose !== 'test-only') fail('test boundary requires test-only mesh purpose');
  const presentations = array(document.presentations, 'mesh presentations').map((value) => object(value, 'mesh presentation'));
  unique(presentations.map((presentation) => presentation.presentation_id), 'mesh presentation id');
  if (presentations.some((presentation, index) => presentation.presentation_id !== index)) fail('mesh presentation IDs must be contiguous in manifest order');
  const signsBySource = new Map<number, Set<number>>();
  for (const presentation of presentations) {
    const sourceId = Number(presentation.source_allen_id);
    const signedId = Number(presentation.signed_allen_id);
    const sign = presentation.side === 'left' ? -1 : 1;
    if (signedId !== sign * sourceId) fail(`mesh signed Allen identity is inconsistent for presentation ${String(presentation.presentation_id)}`);
    if (!active.includes(sourceId) || !inventory.includes(sourceId) || excluded.includes(sourceId)) fail(`mesh presentation ${sourceId} is outside the declared source scope`);
    const mappings = object(presentation.mappings, 'mesh mappings');
    if (mappings.allen !== signedId) fail(`mesh Allen mapping differs from signed identity ${signedId}`);
    for (const name of ['beryl', 'cosmos'] as const) {
      const mapped = mappings[name];
      if (mapped !== null && (typeof mapped !== 'number' || !Number.isInteger(mapped)
        || mapped === sign * 997 || (mapped < 0) !== (sign < 0))) fail(`mesh ${name} mapping is invalid for signed identity ${signedId}`);
    }
    const signs = signsBySource.get(sourceId) ?? new Set<number>();
    signs.add(sign);
    signsBySource.set(sourceId, signs);
  }
  if (signsBySource.size !== active.length) fail('mesh presentation coverage differs from active Allen scope');
  const components = array(document.components, 'mesh components').map((value) => object(value, 'mesh component'));
  unique(components.map((component) => component.component_id), 'mesh component id');
  if (components.some((component, index) => component.component_id !== index)) fail('mesh component IDs must be contiguous in manifest order');
  for (const component of components) {
    const sourceId = Number(component.source_allen_id);
    if (!active.includes(sourceId)) fail(`mesh component ${sourceId} is outside declared source scope`);
    const left = component.left_presentation_id === null ? null : presentations[Number(component.left_presentation_id)];
    const right = component.right_presentation_id === null ? null : presentations[Number(component.right_presentation_id)];
    if ((!left && !right) || (left && (left.source_allen_id !== sourceId || left.side !== 'left')) || (right && (right.source_allen_id !== sourceId || right.side !== 'right'))) fail('mesh component presentation identity is invalid');
    if (component.lateralization === 'neutral' && (!left || !right)) fail('neutral mesh component requires both presentations');
    const bounds = object(component.bounds, 'mesh component bounds');
    const minimum = numberArray(bounds.minimum_um, 3, 'mesh component minimum bounds');
    const maximum = numberArray(bounds.maximum_um, 3, 'mesh component maximum bounds');
    const centroid = numberArray(component.centroid_um, 3, 'mesh component centroid');
    numberArray(component.explode_displacement_um, 3, 'mesh component displacement');
    if (minimum.some((low, axis) => low > maximum[axis]! || centroid[axis]! < low || centroid[axis]! > maximum[axis]!)) fail(`mesh component bounds are invalid for ${sourceId}`);
  }

  const lods = array(document.lods, 'mesh LODs').map((value) => object(value, 'mesh LOD'));
  const lodIds = lods.map((lod) => lod.id);
  unique(lodIds, 'mesh LOD id');
  if (!lodIds.includes(document.default_lod_id)) fail('mesh default LOD is absent');
  if (document.upgrade_lod_id !== null && (!lodIds.includes(document.upgrade_lod_id) || document.upgrade_lod_id === document.default_lod_id)) fail('mesh upgrade LOD is absent or duplicates the default');
  const validation = object(document.validation, 'mesh validation');
  unique([...lods.map((lod) => object(lod.resource, 'mesh resource').path), object(validation.report, 'mesh report').path], 'mesh resource path');
  const sourceTriangles = components.reduce((total, component) => total + Number(component.triangle_count), 0);
  for (const lod of lods) {
    const triangles = Number(lod.triangle_count);
    if (triangles > sourceTriangles || !close(Number(lod.actual_triangle_ratio), triangles / sourceTriangles)) fail(`mesh LOD ${String(lod.id)} triangle ratio is inconsistent`);
    const decoder = object(lod.decoder, 'mesh decoder');
    if (decoder.encoding === 'raw-v1' && (decoder.position_bits !== 0 || decoder.normal_bits !== 0)) fail('raw mesh LOD cannot declare quantization bits');
    if (decoder.encoding === 'meshopt-quantized-v1' && (decoder.position_bits !== 14 || decoder.normal_bits !== 8)) fail('meshopt mesh LOD must use the reviewed 14/8-bit quantization');
  }
}
