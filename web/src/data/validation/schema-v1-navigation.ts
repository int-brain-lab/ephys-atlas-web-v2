import { type JsonObject, array, expect, exactKeys, fail, integers, numberArray, object } from './schema-v1-common.js';

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

function determinant3(m: number[]): number {
  return m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!)
    - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!)
    + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
}

export function regionNavigationSemantics(document: JsonObject): void {
  exactKeys(document, ['schema_version', 'format', 'navigation_id', 'immutable', 'reference_space_id', 'projection_pack', 'grid', 'mappings', 'provenance'], 'region navigation');
  expect(document.schema_version, '1.0', 'schema version');
  expect(document.format, 'atlas-region-navigation-v1', 'region navigation format');
  expect(document.immutable, true, 'region navigation immutable');
  for (const key of ['navigation_id', 'reference_space_id']) {
    if (typeof document[key] !== 'string' || !IDENTIFIER.test(document[key] as string)) fail(`region navigation ${key} is invalid`);
  }
  const binding = object(document.projection_pack, 'projection pack binding');
  exactKeys(binding, ['pack_id', 'manifest_sha256'], 'projection pack binding');
  if (typeof binding.pack_id !== 'string' || !IDENTIFIER.test(binding.pack_id) || typeof binding.manifest_sha256 !== 'string' || !SHA256.test(binding.manifest_sha256)) fail('projection pack binding is invalid');

  const grid = object(document.grid, 'navigation grid');
  exactKeys(grid, ['grid_id', 'shape', 'storage_axes', 'index_to_world_um'], 'navigation grid');
  if (typeof grid.grid_id !== 'string' || !IDENTIFIER.test(grid.grid_id)) fail('navigation grid id is invalid');
  const shape = integers(grid.shape, 'navigation grid shape');
  if (shape.length !== 3 || shape.some((size) => size <= 0)) fail('navigation grid shape must contain three positive integers');
  const axes = array(grid.storage_axes, 'navigation storage axes');
  if (JSON.stringify(axes) !== JSON.stringify(['ap', 'ml', 'dv'])) fail('navigation storage axes must be [ap, ml, dv]');
  const matrix = numberArray(grid.index_to_world_um, 16, 'navigation affine');
  if (matrix.slice(12).some((value, index) => value !== [0, 0, 0, 1][index])) fail('navigation affine homogeneous row is invalid');
  if (!Number.isFinite(determinant3(matrix)) || determinant3(matrix) === 0) fail('navigation affine must be nonsingular');

  const mappings = object(document.mappings, 'navigation mappings');
  exactKeys(mappings, ['allen', 'beryl', 'cosmos'], 'navigation mappings');
  for (const name of ['allen', 'beryl', 'cosmos']) {
    const descriptor = object(mappings[name], `${name} navigation array`);
    exactKeys(descriptor, ['format', 'resource', 'dtype', 'shape', 'order', 'endianness'], `${name} navigation array`);
    expect(descriptor.format, 'raw-binary-array-v1', `${name} navigation array format`);
    expect(descriptor.dtype, 'int32', `${name} navigation array dtype`);
    expect(descriptor.order, 'C', `${name} navigation array order`);
    expect(descriptor.endianness, 'little', `${name} navigation array endianness`);
    const dims = integers(descriptor.shape, `${name} navigation array shape`);
    if (dims.length !== 2 || dims[0]! < 1 || dims[0]! > 3000 || dims[1] !== 4) fail(`${name} navigation array shape must be [n, 4] with 1 <= n <= 3000`);
    const resource = object(descriptor.resource, `${name} navigation resource`);
    const codec = object(resource.codec, `${name} navigation resource codec`);
    if (resource.media_type !== 'application/octet-stream' || resource.bytes !== dims[0]! * 16 || codec.name !== 'none' || codec.decoded_bytes !== dims[0]! * 16) fail(`${name} navigation resource encoding or byte length is invalid`);
  }
  const provenance = object(document.provenance, 'navigation provenance');
  if (!Array.isArray(provenance.sources) || provenance.sources.length < 1 || !provenance.builder || !provenance.recipe) fail('navigation provenance is invalid');
}
