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

function allowedKeys(
  record: JsonObject,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`${context} contains unsupported ${key}`);
  required(record, requiredKeys, context);
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
    exactKeys(record, ['path', 'media_type', 'bytes', 'sha256', 'codec'], 'encoded resource');
    if (typeof record.path !== 'string' || !record.path || record.path.startsWith('/')
      || record.path.split('/').includes('..')) fail('encoded resource path is invalid');
    if (typeof record.media_type !== 'string' || !record.media_type) fail('encoded resource media type is invalid');
    if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0) fail('encoded resource byte length is invalid');
    if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail('encoded resource SHA-256 is invalid');
    allowedKeys(codec, ['name', 'decoded_bytes'], ['level'], 'resource codec');
    if (!Number.isSafeInteger(codec.decoded_bytes) || Number(codec.decoded_bytes) < 0) fail('decoded resource byte length is invalid');
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

function distributionSemantics(
  value: unknown,
  populationCount: number,
  regionalCount: number | null,
  context: string,
  minimum: number | null,
  maximum: number | null,
): void {
  const distribution = object(value, `${context} distribution`);
  const binnings = array(distribution.binnings, `${context} binnings`).map((item) => object(item, `${context} binning`));
  if (binnings.length === 0) fail(`${context} binnings must not be empty`);
  unique(binnings.map((binning) => binning.id), `${context} binning id`);
  const scaleIdentities = new Map<string, string>();
  const domainIdentities = new Map<string, string>();
  const endpointsByDomain = new Map<string, readonly [number, number]>();
  for (const binning of binnings) {
    const scale = object(binning.scale, `${context} scale`);
    const scaleKind = String(scale.kind);
    if (!['linear', 'log', 'symlog'].includes(scaleKind)) fail(`${context} scale kind is invalid`);
    if (scaleKind === 'symlog' && (!(typeof scale.linear_threshold === 'number')
      || !Number.isFinite(scale.linear_threshold) || scale.linear_threshold <= 0)) {
      fail(`${context} signed-log threshold is invalid`);
    }
    const scaleIdentity = scaleKind === 'symlog' ? `${scaleKind}:${String(scale.linear_threshold)}` : scaleKind;
    if (scaleIdentities.has(scaleKind) && scaleIdentities.get(scaleKind) !== scaleIdentity) {
      fail(`${context} uses inconsistent ${scaleKind} specifications`);
    }
    scaleIdentities.set(scaleKind, scaleIdentity);
    const domain = object(binning.domain, `${context} domain`);
    const domainKind = String(domain.kind);
    if (!['full', 'focused'].includes(domainKind)) fail(`${context} domain kind is invalid`);
    const edges = array(binning.edges, `${context} edges`) as number[];
    increasing(edges, `${context} edges`);
    const endpoints = [edges[0]!, edges.at(-1)!] as const;
    const existingEndpoints = endpointsByDomain.get(domainKind);
    if (existingEndpoints !== undefined
      && (existingEndpoints[0] !== endpoints[0] || existingEndpoints[1] !== endpoints[1])) {
      fail(`${context} raw domain endpoints differ across scales`);
    }
    endpointsByDomain.set(domainKind, endpoints);
    if (scaleKind === 'log' && edges.some((edge) => edge <= 0)) fail(`${context} log edges must be positive`);
    if (scaleKind === 'log' && minimum !== null && minimum <= 0) fail(`${context} log scale requires a strictly positive population`);
    let domainIdentity = domainKind;
    if (domainKind === 'focused') {
      const bounds = numberArray(domain.bounds, 2, `${context} focused bounds`);
      if (bounds[1]! <= bounds[0]! || edges[0] !== bounds[0] || edges.at(-1) !== bounds[1]) {
        fail(`${context} focused bounds must equal the distribution endpoints`);
      }
      domainIdentity = `${domainKind}:${bounds[0]}:${bounds[1]}`;
    }
    if (domainIdentities.has(domainKind) && domainIdentities.get(domainKind) !== domainIdentity) {
      fail(`${context} uses inconsistent ${domainKind} specifications`);
    }
    domainIdentities.set(domainKind, domainIdentity);
    if (binning.id !== `${scaleKind}-${domainKind}`) fail(`${context} binning id is not canonical`);
    const counts = integers(binning.global_counts, `${context} global counts`);
    const underflow = Number(binning.global_underflow_count);
    const overflow = Number(binning.global_overflow_count);
    if (counts.length !== edges.length - 1 || counts.some((count) => !Number.isSafeInteger(count) || count < 0)
      || !Number.isSafeInteger(underflow) || underflow < 0
      || !Number.isSafeInteger(overflow) || overflow < 0
      || underflow + counts.reduce((sum, count) => sum + count, 0) + overflow !== populationCount) {
      fail(`${context} global counts do not conserve the population`);
    }
    if (domainKind === 'full' && (underflow !== 0 || overflow !== 0)) fail(`${context} full-domain tails must be zero`);
    if (regionalCount === null) {
      if (binning.regional_counts !== undefined || binning.regional_count_layout !== undefined) {
        fail(`${context} volume binning cannot contain regional counts`);
      }
    } else {
      expect(binning.regional_count_layout, 'underflow-bins-overflow', `${context} regional count layout`);
      const regional = object(binning.regional_counts, `${context} regional counts`);
      const shape = integers(regional.shape, `${context} regional count shape`);
      if (regional.dtype !== 'uint32' || shape.length !== 2
        || shape[0] !== regionalCount || shape[1] !== counts.length + 2) {
        fail(`${context} regional count array shape or dtype is invalid`);
      }
    }
  }
  if (!binnings.some((binning) => binning.id === 'linear-full')) fail(`${context} is missing linear-full`);
  for (const scale of scaleIdentities.keys()) {
    for (const domain of domainIdentities.keys()) {
      if (!binnings.some((binning) => binning.id === `${scale}-${domain}`)) {
        fail(`${context} binnings do not form a rectangular cross-product`);
      }
    }
  }
  const full = endpointsByDomain.get('full')!;
  const focused = endpointsByDomain.get('focused');
  if (focused && (focused[0] < full[0] || focused[1] > full[1])) {
    fail(`${context} focused domain must lie inside the full domain`);
  }
  if (minimum !== null && full[0] > minimum) fail(`${context} full domain does not enclose the declared minimum`);
  if (maximum !== null && full[1] < maximum) fail(`${context} full domain does not enclose the declared maximum`);
}

function summarySemantics(document: JsonObject): void {
  const total = Number(document.total_voxel_count);
  const valid = Number(document.valid_voxel_count);
  if (total !== product(integers(document.grid_shape, 'volume summary grid shape'))) fail('volume summary total differs from grid shape');
  if (total !== valid + Number(document.outside_voxel_count) + Number(document.missing_voxel_count)) fail('volume summary counts are not exhaustive');
  const statistics = Object.values(object(document.valid_statistics, 'volume statistics'));
  if (valid === 0 ? statistics.some((value) => value !== null) : statistics.some((value) => value === null)) fail('volume valid statistics nullability is invalid');
  if (valid > 0) distributionSemantics(
    document.distribution,
    valid,
    null,
    'volume',
    object(document.valid_statistics, 'volume statistics').min as number | null,
    object(document.valid_statistics, 'volume statistics').max as number | null,
  );
  else if (document.distribution !== undefined) fail('empty volume population cannot declare a distribution');
}

function statisticsSemantics(document: JsonObject): void {
  const regional = object(document.regional_summary, 'regional summary');
  const fields = array(regional.fields, 'regional summary fields');
  const values = object(regional.values, 'regional summary values');
  const shape = integers(values.shape, 'regional summary shape');
  if (shape.length !== 2 || shape[1] !== fields.length) fail('regional summary shape does not match fields');
  const populationCount = Number(object(document.global, 'global statistics').count);
  const global = object(document.global, 'global statistics');
  const descriptive = ['min', 'max', 'mean', 'std', 'median'].map((field) => global[field]);
  if (populationCount === 0 && descriptive.some((value) => value !== null)) {
    fail('empty regional population descriptive statistics must be null');
  }
  if (populationCount > 0 && descriptive.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    fail('nonempty regional population descriptive statistics cannot be null');
  }
  if (document.distribution !== undefined) distributionSemantics(
    document.distribution,
    populationCount,
    shape[0]!,
    'regional',
    global.min as number | null,
    global.max as number | null,
  );
  else if (populationCount > 0) fail('nonempty regional population requires a distribution');
  if (populationCount === 0 && document.distribution !== undefined) {
    fail('empty regional population must omit its distribution');
  }
}

function featureDisplaySemantics(document: JsonObject): void {
  const representations = object(document.representations, 'feature representations');
  const display = object(document.display, 'feature display');
  for (const kind of ['regional', 'volume'] as const) {
    const present = representations[kind] !== undefined;
    if (present !== (display[kind] !== undefined)) fail(`feature ${kind} display/representation presence differs`);
    if (!present) continue;
    const representation = object(display[kind], `feature ${kind} display`);
    const scales = array(representation.scales, `feature ${kind} scales`).map((item) => object(item, 'feature scale'));
    const scaleKinds = scales.map((scale) => String(scale.kind));
    if (scaleKinds.some((scale) => !['linear', 'log', 'symlog'].includes(scale))) {
      fail(`feature ${kind} scale kind is invalid`);
    }
    unique(scaleKinds, `feature ${kind} scale kind`);
    if (scaleKinds[0] !== 'linear' || !scaleKinds.includes(String(representation.preferred_scale))) {
      fail(`feature ${kind} scales or preferred scale are invalid`);
    }
    for (const scale of scales) {
      if (scale.kind === 'symlog' && (!(typeof scale.linear_threshold === 'number')
        || !Number.isFinite(scale.linear_threshold) || scale.linear_threshold <= 0)) {
        fail(`feature ${kind} signed-log threshold is invalid`);
      }
    }
    const domains = array(representation.distribution_domains, `feature ${kind} domains`)
      .map((item) => object(item, 'feature distribution domain'));
    const domainKinds = domains.map((domain) => String(domain.kind));
    if (domainKinds.some((domain) => !['full', 'focused'].includes(domain))) {
      fail(`feature ${kind} distribution domain kind is invalid`);
    }
    unique(domainKinds, `feature ${kind} domain kind`);
    if (domainKinds[0] !== 'full' || !domainKinds.includes(String(representation.preferred_distribution_domain))) {
      fail(`feature ${kind} domains or preferred domain are invalid`);
    }
    if (representation.diverging_center !== undefined
      && (typeof representation.diverging_center !== 'number' || !Number.isFinite(representation.diverging_center))) {
      fail(`feature ${kind} diverging center must be finite`);
    }
    if (representation.colormap === 'coolwarm' && representation.diverging_center === undefined) {
      fail(`preferred diverging ${kind} palette requires a center`);
    }
    for (const domain of domains) {
      if (domain.kind === 'focused') {
        const bounds = numberArray(domain.bounds, 2, `feature ${kind} focus bounds`);
        if (bounds[1]! <= bounds[0]!) fail(`feature ${kind} focus bounds are invalid`);
      }
    }
    if (representation.range !== undefined) {
      const valueRange = numberArray(representation.range, 2, `feature ${kind} display range`);
      if (valueRange[1]! <= valueRange[0]!) fail(`feature ${kind} display range must be increasing`);
      if (scaleKinds.includes('log') && valueRange[0]! <= 0) {
        fail(`feature ${kind} display range shared with log must be positive`);
      }
    }
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

function registeredResourceIndexSemantics(document: JsonObject): void {
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

function staticSemantics(document: JsonObject): void {
  exactKeys(document, ['id', 'kind', 'view_box', 'path_count', 'fragment'], 'static projection');
  expect(document.kind, 'static-regional-map', 'static projection kind');
  if (JSON.stringify(document.view_box) !== JSON.stringify([60, 20, 340, 300])) fail('static projection view box is invalid');
  if (document.path_count !== STATIC_PATH_COUNTS[String(document.id)]) fail('static projection path count is invalid');
  const resource = object(object(document.fragment, 'static fragment').resource, 'static fragment resource');
  if (resource.media_type !== 'image/svg+xml' || object(resource.codec, 'static fragment codec').name !== 'gzip') fail('static fragment must be gzip SVG');
}

function packSemantics(document: JsonObject): void {
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

function meshPackSemantics(document: JsonObject): void {
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

  const groups = array(document.explode_groups, 'mesh explode groups').map((value) => object(value, 'mesh explode group'));
  unique(groups.map((group) => group.signed_group_id), 'mesh explode group id');
  const groupById = new Map(groups.map((group) => [Number(group.signed_group_id), group]));
  const regions = array(document.regions, 'mesh regions').map((value) => object(value, 'mesh region'));
  unique(regions.map((region) => region.feature_id), 'mesh feature id');
  unique(regions.map((region) => region.signed_allen_id), 'mesh signed Allen id');
  if (regions.some((region, index) => region.feature_id !== index)) fail('mesh feature IDs must be contiguous in manifest order');
  const signsBySource = new Map<number, Set<number>>();
  for (const region of regions) {
    const sourceId = Number(region.source_allen_id);
    const signedId = Number(region.signed_allen_id);
    const sign = region.hemisphere === 'left' ? -1 : 1;
    if (signedId !== sign * sourceId) fail(`mesh signed Allen identity is inconsistent for feature ${String(region.feature_id)}`);
    if (!active.includes(sourceId) || !inventory.includes(sourceId) || excluded.includes(sourceId)) fail(`mesh region ${sourceId} is outside the declared source scope`);
    const mappings = object(region.mappings, 'mesh mappings');
    if (mappings.allen !== signedId) fail(`mesh Allen mapping differs from signed identity ${signedId}`);
    for (const name of ['beryl', 'cosmos'] as const) {
      const mapped = mappings[name];
      if (mapped !== null && (typeof mapped !== 'number' || !Number.isInteger(mapped)
        || mapped === sign * 997 || (mapped < 0) !== (sign < 0))) fail(`mesh ${name} mapping is invalid for signed identity ${signedId}`);
    }
    const groupId = Number(region.signed_explode_group_id);
    const group = groupById.get(groupId);
    if (!group || group.hemisphere !== region.hemisphere || (groupId < 0) !== (sign < 0)) fail(`mesh explode group is inconsistent for signed identity ${signedId}`);
    const bounds = object(region.bounds, 'mesh bounds');
    const minimum = numberArray(bounds.minimum_um, 3, 'mesh minimum bounds');
    const maximum = numberArray(bounds.maximum_um, 3, 'mesh maximum bounds');
    const centroid = numberArray(region.centroid_um, 3, 'mesh centroid');
    if (minimum.some((low, axis) => low > maximum[axis]! || centroid[axis]! < low || centroid[axis]! > maximum[axis]!)) fail(`mesh centroid or bounds are invalid for signed identity ${signedId}`);
    const signs = signsBySource.get(sourceId) ?? new Set<number>();
    signs.add(sign);
    signsBySource.set(sourceId, signs);
  }
  if (signsBySource.size !== active.length) fail('mesh region coverage differs from active Allen scope');

  const lods = array(document.lods, 'mesh LODs').map((value) => object(value, 'mesh LOD'));
  const lodIds = lods.map((lod) => lod.id);
  unique(lodIds, 'mesh LOD id');
  if (!lodIds.includes(document.default_lod_id)) fail('mesh default LOD is absent');
  if (document.upgrade_lod_id !== null && (!lodIds.includes(document.upgrade_lod_id) || document.upgrade_lod_id === document.default_lod_id)) fail('mesh upgrade LOD is absent or duplicates the default');
  const validation = object(document.validation, 'mesh validation');
  unique([...lods.map((lod) => object(lod.resource, 'mesh resource').path), object(validation.report, 'mesh report').path], 'mesh resource path');
  const sourceTriangles = regions.reduce((total, region) => total + Number(region.triangle_count), 0);
  for (const lod of lods) {
    const triangles = Number(lod.triangle_count);
    if (triangles > sourceTriangles || !close(Number(lod.actual_triangle_ratio), triangles / sourceTriangles)) fail(`mesh LOD ${String(lod.id)} triangle ratio is inconsistent`);
    const decoder = object(lod.decoder, 'mesh decoder');
    if (decoder.encoding === 'raw-v1' && (decoder.position_bits !== 0 || decoder.normal_bits !== 0)) fail('raw mesh LOD cannot declare quantization bits');
    if (decoder.encoding === 'meshopt-quantized-v1' && (decoder.position_bits !== 14 || decoder.normal_bits !== 8)) fail('meshopt mesh LOD must use the reviewed 14/8-bit quantization');
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
      featureDisplaySemantics(document);
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
    case 'mesh-pack.schema.json':
      meshPackSemantics(document);
      break;
    default:
      fail(`unknown schema ${schemaName}`);
  }
}
