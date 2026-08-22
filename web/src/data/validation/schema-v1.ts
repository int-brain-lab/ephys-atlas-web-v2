/** Semantic validator used by the staged cross-language schema-v1 corpus. */

type JsonObject = Record<string, unknown>;

const DTYPE_BYTES: Readonly<Record<string, number>> = {
  uint8: 1,
  int16: 2,
  uint16: 2,
  float16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};
const PROJECTION_AXES: Readonly<Record<string, string>> = { coronal: 'ap', sagittal: 'ml', horizontal: 'dv' };
const STATIC_PATH_COUNTS: Readonly<Record<string, number>> = { top: 114, swanson: 808 };

function fail(message: string): never {
  throw new Error(`schema v1: ${message}`);
}

function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object`);
  return value as JsonObject;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) fail(`${context} must be an array`);
  return value;
}

function numberArray(value: unknown, length: number, context: string): number[] {
  const result = array(value, context);
  if (result.length !== length || result.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    fail(`${context} must contain ${length} finite numbers`);
  }
  return result as number[];
}

function integers(value: unknown, context: string): number[] {
  const result = array(value, context);
  if (result.some((item) => typeof item !== 'number' || !Number.isInteger(item))) fail(`${context} must contain integers`);
  return result as number[];
}

function required(record: JsonObject, keys: readonly string[], context: string): void {
  for (const key of keys) if (!(key in record)) fail(`${context} is missing ${key}`);
}

function exactKeys(record: JsonObject, keys: readonly string[], context: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`${context} contains unsupported ${key}`);
  required(record, keys, context);
}

function expect(value: unknown, expected: unknown, context: string): void {
  if (value !== expected) fail(`${context} must equal ${String(expected)}`);
}

function unique(values: readonly unknown[], context: string): void {
  const normalized = values.map((value) => JSON.stringify(value));
  if (new Set(normalized).size !== normalized.length) fail(`duplicate ${context}`);
}

function product(values: readonly number[]): number {
  return values.reduce((total, value) => total * value, 1);
}

function increasing(values: readonly number[], context: string): void {
  if (values.some((value) => !Number.isFinite(value))) fail(`${context} must be finite`);
  if (values.slice(1).some((value, index) => values[index] === undefined || values[index]! >= value)) {
    fail(`${context} must be strictly increasing`);
  }
}

function resourceSemantics(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) resourceSemantics(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as JsonObject;
  if (['path', 'media_type', 'bytes', 'sha256', 'codec'].every((key) => key in record)) {
    const codec = object(record.codec, 'resource codec');
    required(codec, ['name', 'decoded_bytes'], 'resource codec');
    if (codec.name === 'none') {
      if (codec.decoded_bytes !== record.bytes) fail('uncompressed resource has unequal encoded and decoded lengths');
      if ('level' in codec) fail('uncompressed resource cannot declare compression level');
    } else if (codec.name !== 'gzip') fail('unsupported resource codec');
  }
  if (record.format === 'raw-binary-array-v1') {
    required(record, ['resource', 'dtype', 'shape', 'order', 'endianness'], 'binary array');
    const dtype = String(record.dtype);
    const bytes = DTYPE_BYTES[dtype];
    if (bytes === undefined) fail(`unsupported binary dtype ${dtype}`);
    const shape = integers(record.shape, 'binary shape');
    const resource = object(record.resource, 'binary resource');
    const codec = object(resource.codec, 'binary codec');
    if (codec.decoded_bytes !== product(shape) * bytes) fail('binary decoded length does not match dtype and shape');
    const endianness = dtype === 'uint8' ? 'not-applicable' : 'little';
    expect(record.endianness, endianness, 'binary endianness');
  }
  for (const child of Object.values(record)) resourceSemantics(child);
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 + 1e-10 * Math.abs(right);
}

function affineSemantics(matrixValue: unknown, shape: number[], extentValue: unknown, inverseValue?: unknown): void {
  const matrix = numberArray(matrixValue, 16, 'affine');
  const extent = numberArray(extentValue, 6, 'voxel-edge extent');
  if (matrix.slice(12).some((value, index) => value !== [0, 0, 0, 1][index])) fail('affine homogeneous row is invalid');
  const inverse = new Array<number>(16).fill(0);
  inverse[15] = 1;
  for (let row = 0; row < 3; row += 1) {
    const columns = [0, 1, 2].filter((column) => matrix[row * 4 + column] !== 0);
    if (columns.length !== 1) fail('affine spatial row is not a signed permutation');
    const column = columns[0]!;
    const scale = matrix[row * 4 + column]!;
    const translation = matrix[row * 4 + 3]!;
    inverse[column * 4 + row] = 1 / scale;
    inverse[column * 4 + 3] = -translation / scale;
  }
  for (let column = 0; column < 3; column += 1) {
    if ([0, 1, 2].filter((row) => matrix[row * 4 + column] !== 0).length !== 1) {
      fail('affine spatial column is not a signed permutation');
    }
  }
  if (inverseValue !== undefined) {
    const declared = numberArray(inverseValue, 16, 'inverse affine');
    if (declared.some((value, index) => !close(value, inverse[index]!))) fail('declared affine inverse is invalid');
  }
  const derived: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    const column = [0, 1, 2].find((candidate) => matrix[row * 4 + candidate] !== 0)!;
    const scale = matrix[row * 4 + column]!;
    const translation = matrix[row * 4 + 3]!;
    const edges = [translation - scale * 0.5, translation + scale * (shape[column]! - 0.5)];
    derived.push(Math.min(...edges), Math.max(...edges));
  }
  if (extent.some((value, index) => !close(value, derived[index]!))) fail('voxel-edge extent is invalid');
}

function volumeSemantics(document: JsonObject): void {
  expect(document.format, 'ephys-atlas-volume-v1', 'volume format');
  const grid = object(document.grid, 'volume grid');
  const shape = integers(grid.shape, 'volume shape');
  if (shape.length !== 3 || shape.some((size) => size <= 0)) fail('volume shape must contain three positive integers');
  affineSemantics(grid.index_to_world_um, shape, grid.voxel_edge_extent_um, grid.world_to_index);
  const validity = object(document.validity, 'volume validity');
  if (validity.kind === 'mask') {
    const mask = object(validity.mask, 'validity mask');
    if (mask.dtype !== 'uint8' || JSON.stringify(mask.shape) !== JSON.stringify(shape)) fail('validity mask dtype or shape is invalid');
    const codes = object(validity.codes, 'validity codes');
    unique([codes.valid, codes.outside, codes.missing], 'validity code');
  } else if (validity.kind !== 'sentinel') fail('volume validity discriminant is invalid');
}

function summarySemantics(document: JsonObject): void {
  const total = Number(document.total_voxel_count);
  const valid = Number(document.valid_voxel_count);
  if (total !== product(integers(document.grid_shape, 'volume summary grid shape'))) fail('volume summary total differs from grid shape');
  if (total !== valid + Number(document.outside_voxel_count) + Number(document.missing_voxel_count)) fail('volume summary counts are not exhaustive');
  const statistics = Object.values(object(document.valid_statistics, 'volume statistics'));
  if (valid === 0 ? statistics.some((value) => value !== null) : statistics.some((value) => value === null)) fail('volume valid statistics nullability is invalid');
  if (document.histogram !== undefined) {
    const histogram = object(document.histogram, 'volume histogram');
    const edges = numberArray(histogram.edges, array(histogram.edges, 'volume edges').length, 'volume edges');
    const counts = integers(histogram.counts, 'volume histogram counts');
    increasing(edges, 'volume histogram edges');
    if (counts.length !== edges.length - 1 || counts.reduce((sum, count) => sum + count, 0) !== valid) fail('volume histogram counts are invalid');
  }
}

function statisticsSemantics(document: JsonObject): void {
  const regional = object(document.regional_summary, 'regional summary');
  const fields = array(regional.fields, 'regional summary fields');
  const values = object(regional.values, 'regional summary values');
  const shape = integers(values.shape, 'regional summary shape');
  if (shape.length !== 2 || shape[1] !== fields.length) fail('regional summary shape does not match fields');
  if (document.histogram !== undefined) {
    const histogram = object(document.histogram, 'regional histogram');
    const edges = array(histogram.edges, 'regional histogram edges') as number[];
    const counts = integers(histogram.global_counts, 'regional histogram counts');
    increasing(edges, 'regional histogram edges');
    if (counts.length !== edges.length - 1 || counts.reduce((sum, count) => sum + count, 0) !== Number(object(document.global, 'global statistics').count)) fail('regional histogram counts are invalid');
  }
}

function indexSemantics(document: JsonObject): void {
  const layout = document.layout;
  const entries = array(layout === 'chunks3d' ? document.chunks : document.packs, 'volume resources').map((item) => object(item, 'volume resource'));
  unique(entries.map((entry) => object(entry.resource, 'resource').path), 'volume resource path');
  for (const entry of entries) {
    const decoded = object(entry.decoded, 'decoded block');
    const shape = integers(decoded.shape, 'decoded block shape');
    const bytes = DTYPE_BYTES[String(decoded.dtype)];
    if (bytes === undefined || object(object(entry.resource, 'resource').codec, 'codec').decoded_bytes !== product(shape) * bytes) fail('volume decoded block length is invalid');
  }
  if (layout === 'chunks3d') unique(entries.map((entry) => entry.origin), 'chunk origin');
  else if (layout === 'orthogonal_slice_packs') {
    if (new Set(entries.map((entry) => entry.axis)).size !== 3) fail('slice packs must cover three axes');
    for (const entry of entries) {
      const decoded = object(entry.decoded, 'decoded block');
      if (array(decoded.storage_axes, 'storage axes')[0] !== entry.axis || integers(decoded.shape, 'decoded shape')[0] !== entry.slice_count) fail('slice-pack axis or count is invalid');
    }
  } else fail('volume layout is invalid');
}

function registeredSemantics(document: JsonObject): void {
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

function registeredResourceIndexSemantics(document: JsonObject): void {
  expect(document.format, 'atlas-registered-svg-resource-index-v1', 'registered SVG resource-index format');
  const resources = array(document.resources, 'registered SVG resources').map((value) => object(value, 'registered SVG resource'));
  unique(resources.map((entry) => entry.pack_id), 'registered SVG pack id');
  unique(resources.map((entry) => object(entry.resource, 'registered SVG encoded resource').path), 'registered SVG resource path');
  const allSlices: number[] = [];
  for (const entry of resources) {
    const slices = integers(entry.slice_indices, 'registered SVG slice indices');
    increasing(slices, 'registered SVG resource slices');
    const resource = object(entry.resource, 'registered SVG encoded resource');
    expect(resource.media_type, 'application/vnd.ibl.indexed-svg', 'registered SVG media type');
    expect(object(resource.codec, 'registered SVG codec').name, 'gzip', 'registered SVG codec');
    allSlices.push(...slices);
  }
  increasing(allSlices, 'registered SVG resource-index slices');
}

function staticSemantics(document: JsonObject): void {
  exactKeys(document, ['id', 'kind', 'view_box', 'path_count', 'fragment'], 'static projection');
  expect(document.kind, 'static-regional-map', 'static projection kind');
  if (JSON.stringify(document.view_box) !== JSON.stringify([60, 20, 340, 300])) fail('static projection view box is invalid');
  if (document.path_count !== STATIC_PATH_COUNTS[String(document.id)]) fail('static projection path count is invalid');
  const resource = object(object(document.fragment, 'static fragment').resource, 'static fragment resource');
  if (resource.media_type !== 'image/svg+xml' || object(resource.codec, 'static fragment codec').name !== 'gzip') fail('static fragment must be gzip SVG');
}

function packSemantics(document: JsonObject): void {
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

export function validateSchemaV1Document(value: unknown, schemaName: string): void {
  const document = object(value, schemaName);
  resourceSemantics(document);
  switch (schemaName) {
    case 'alias.schema.json':
      exactKeys(document, ['schema_version', 'dataset_id', 'alias', 'release_id'], 'alias');
      expect(document.schema_version, '1.0', 'schema version');
      break;
    case 'artifact.schema.json':
      required(document, ['id', 'role', 'resource'], 'artifact');
      break;
    case 'catalog.schema.json': {
      const datasets = array(document.datasets, 'catalog datasets').map((item) => object(item, 'dataset'));
      unique(datasets.map((dataset) => dataset.dataset_id), 'catalog dataset id');
      for (const dataset of datasets) {
        const releases = array(dataset.releases, 'catalog releases').map((item) => object(item, 'release'));
        const ids = releases.map((release) => release.release_id);
        unique(ids, 'catalog release id');
        if (dataset.default_release !== undefined && !ids.includes(dataset.default_release)) fail('catalog default release is absent');
      }
      break;
    }
    case 'provenance.schema.json':
      required(document, ['sources', 'builder', 'recipe'], 'provenance');
      break;
    case 'regional.schema.json': {
      expect(document.format, 'ephys-atlas-regional-v1', 'regional format');
      const parcellations = array(document.parcellations, 'regional parcellations').map((item) => object(item, 'parcellation'));
      unique(parcellations.map((item) => item.parcellation_id), 'regional parcellation id');
      break;
    }
    case 'statistics.schema.json':
      statisticsSemantics(document);
      break;
    case 'volume-summary.schema.json':
      summarySemantics(document);
      break;
    case 'volume-resource-index.schema.json':
      indexSemantics(document);
      break;
    case 'volume.schema.json':
      volumeSemantics(document);
      break;
    case 'feature.schema.json': {
      const representations = object(document.representations, 'feature representations');
      if (representations.regional !== undefined) validateSchemaV1Document(representations.regional, 'regional.schema.json');
      if (representations.volume !== undefined) validateSchemaV1Document(representations.volume, 'volume.schema.json');
      break;
    }
    case 'dataset.schema.json': {
      const features = array(document.features, 'dataset features').map((item) => object(item, 'feature'));
      unique(features.map((item) => item.id), 'feature id');
      unique(features.map((item) => object(object(item.descriptor, 'descriptor').resource, 'resource').path), 'feature path');
      break;
    }
    case 'registered-projection.schema.json':
      registeredSemantics(document);
      break;
    case 'registered-svg-resource-index.schema.json':
      registeredResourceIndexSemantics(document);
      break;
    case 'static-projection.schema.json':
      staticSemantics(document);
      break;
    case 'projection-pack.schema.json':
      packSemantics(document);
      break;
    default:
      fail(`unknown schema ${schemaName}`);
  }
}
