import type { ParcellationId, StatisticId } from '../../domain/types.js';
import {
  SCHEMA_VERSION,
  type FeatureDescriptor,
  type RepresentationDisplay,
} from '../contracts.js';
import { parseBinaryArray, parseEncodedResource } from './binary.js';
import {
  array,
  dtype,
  numberArray,
  object,
  parcellation,
  plainString,
  statistic,
  string,
  unique,
} from './primitives.js';
import { validateSchemaV1Document } from './schema-v1.js';
import { parseArtifactDescriptors } from './artifact.js';
import { parseDistributionDomainSpec, parseScaleSpec } from './distribution.js';

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function deriveSignedPermutationInverse(matrix: readonly number[]): number[] {
  const inverse = new Array<number>(16).fill(0);
  inverse[15] = 1;
  for (let row = 0; row < 3; row += 1) {
    const column = [0, 1, 2].find((candidate) => matrix[row * 4 + candidate] !== 0)!;
    const scale = matrix[row * 4 + column]!;
    inverse[column * 4 + row] = 1 / scale;
    const translation = -matrix[row * 4 + 3]! / scale;
    inverse[column * 4 + 3] = Object.is(translation, -0) ? 0 : translation;
  }
  return inverse;
}

function parseRegionalParcellation(value: unknown, context: string) {
  const item = object(value, context);
  const statistics = object(item.statistics, `${context}.statistics`);
  const statisticsResource = parseEncodedResource(
    statistics.resource,
    `${context}.statistics.resource`,
  );
  return {
    parcellationId: parcellation(item.parcellation_id, `${context}.parcellation_id`),
    summary: string(item.summary, `${context}.summary`),
    values: parseBinaryArray(item.values, `${context}.values`),
    statistics: statisticsResource.path,
    statisticsResource,
  };
}

function parseRepresentationDisplay(value: unknown, context: string): RepresentationDisplay {
  const raw = object(value, context);
  const supported = new Set([
    'colormap', 'range', 'scales', 'preferred_scale',
    'distribution_domains', 'preferred_distribution_domain',
  ]);
  if (Object.keys(raw).some((key) => !supported.has(key))) throw new Error(`${context} contains unsupported fields`);
  const scales = array(raw.scales, `${context}.scales`)
    .map((item, index) => parseScaleSpec(item, `${context}.scales[${index}]`));
  if (scales.length === 0 || scales[0]?.kind !== 'linear') {
    throw new Error(`${context}.scales must declare linear first`);
  }
  unique(scales.map((scale) => scale.kind), `${context}.scales kinds`);
  const preferredScale = raw.preferred_scale;
  if (preferredScale !== 'linear' && preferredScale !== 'log' && preferredScale !== 'symlog') {
    throw new Error(`${context}.preferred_scale is unsupported`);
  }
  if (!scales.some((scale) => scale.kind === preferredScale)) {
    throw new Error(`${context}.preferred_scale must be available`);
  }
  const distributionDomains = array(raw.distribution_domains, `${context}.distribution_domains`)
    .map((item, index) => parseDistributionDomainSpec(item, `${context}.distribution_domains[${index}]`));
  if (distributionDomains.length === 0 || distributionDomains[0]?.kind !== 'full') {
    throw new Error(`${context}.distribution_domains must declare full first`);
  }
  unique(distributionDomains.map((domain) => domain.kind), `${context}.distribution_domains kinds`);
  const preferredDistributionDomain = raw.preferred_distribution_domain;
  if (preferredDistributionDomain !== 'full' && preferredDistributionDomain !== 'focused') {
    throw new Error(`${context}.preferred_distribution_domain is unsupported`);
  }
  if (!distributionDomains.some((domain) => domain.kind === preferredDistributionDomain)) {
    throw new Error(`${context}.preferred_distribution_domain must be available`);
  }
  let range: readonly [number, number] | undefined;
  if (raw.range !== undefined) {
    const parsed = numberArray(raw.range, 2, `${context}.range`) as [number, number];
    if (parsed[1] <= parsed[0]) throw new Error(`${context}.range must be strictly increasing`);
    if (scales.some((scale) => scale.kind === 'log') && parsed[0] <= 0) {
      throw new Error(`${context}.range shared with log must be positive`);
    }
    range = parsed;
  }
  return {
    ...(raw.colormap !== undefined ? { colormap: string(raw.colormap, `${context}.colormap`) } : {}),
    ...(range ? { range } : {}),
    scales,
    preferredScale,
    distributionDomains,
    preferredDistributionDomain,
  };
}

export function parseFeatureDescriptor(value: unknown, path: string): FeatureDescriptor {
  const root = object(value, `feature ${path}`);
  validateSchemaV1Document(root, 'feature.schema.json');
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`${path}.schema_version must be ${SCHEMA_VERSION}`);
  const representations = object(root.representations, `${path}.representations`);
  const valueSemantics = object(root.value_semantics, `${path}.value_semantics`);
  const artifacts = parseArtifactDescriptors(root.artifacts, `${path}.artifacts`);
  const featureId = string(root.id, `${path}.id`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(featureId)) throw new Error(`${path}.id has an invalid format`);
  const rawDisplay = object(root.display, `${path}.display`);
  if (Object.keys(rawDisplay).some((key) => key !== 'regional' && key !== 'volume')) {
    throw new Error(`${path}.display contains unsupported representations`);
  }
  const display: FeatureDescriptor['display'] = {
    ...(rawDisplay.regional !== undefined
      ? { regional: parseRepresentationDisplay(rawDisplay.regional, `${path}.display.regional`) }
      : {}),
    ...(rawDisplay.volume !== undefined
      ? { volume: parseRepresentationDisplay(rawDisplay.volume, `${path}.display.volume`) }
      : {}),
  };
  const descriptor: FeatureDescriptor = {
    id: featureId,
    path,
    label: string(root.label, `${path}.label`),
    description: plainString(root.description, `${path}.description`),
    unit: root.unit === null ? null : plainString(root.unit, `${path}.unit`),
    display,
    artifacts,
    valueSemantics: {
      quantity: string(valueSemantics.quantity, `${path}.value_semantics.quantity`),
      transform: string(valueSemantics.transform, `${path}.value_semantics.transform`),
      sourcePopulation: string(valueSemantics.source_population, `${path}.value_semantics.source_population`),
      missingValues: string(valueSemantics.missing_values, `${path}.value_semantics.missing_values`),
      ...(valueSemantics.source_column !== undefined
        ? { sourceColumn: plainString(valueSemantics.source_column, `${path}.value_semantics.source_column`) }
        : {}),
      ...(valueSemantics.qc_filter !== undefined
        ? { qcFilter: plainString(valueSemantics.qc_filter, `${path}.value_semantics.qc_filter`) }
        : {}),
    },
    statistics: [],
    representations: {},
  };

  if (representations.regional !== undefined) {
    const regional = object(representations.regional, `${path}.representations.regional`);
    if (regional.format !== 'ephys-atlas-regional-v1') throw new Error(`${path} has unsupported regional format`);
    const mappings: Partial<Record<ParcellationId, ReturnType<typeof parseRegionalParcellation>>> = {};
    const stats = new Set<StatisticId>();
    const parcellations = array(regional.parcellations, `${path}.representations.regional.parcellations`);
    if (parcellations.length === 0) throw new Error(`${path}.representations.regional.parcellations must not be empty`);
    for (const [index, raw] of parcellations.entries()) {
      const parsed = parseRegionalParcellation(raw, `${path}.representations.regional.parcellations[${index}]`);
      if (mappings[parsed.parcellationId]) throw new Error(`${path} has duplicate ${parsed.parcellationId} regional representations`);
      mappings[parsed.parcellationId] = parsed;
      try { stats.add(statistic(parsed.summary, `${path}.summary`)); } catch { /* descriptor field need not be UI-visible */ }
    }
    descriptor.statistics = [...stats];
    descriptor.representations.regional = {
      kind: 'regional',
      format: 'ephys-atlas-regional-v1',
      parcellations: mappings,
    };
  }

  if (representations.volume !== undefined) {
    const volume = object(representations.volume, `${path}.representations.volume`);
    if (volume.format !== 'ephys-atlas-volume-v1') throw new Error(`${path} has unsupported volume format`);
    validateSchemaV1Document(volume, 'volume.schema.json');
    const encoding = object(volume.encoding, `${path}.volume.encoding`);
    if (encoding.layout !== 'chunks3d' && encoding.layout !== 'orthogonal_slice_packs') throw new Error(`${path}.volume.encoding.layout is unsupported`);
    const grid = object(volume.grid, `${path}.volume.grid`);
    const arrayDescriptor = object(volume.array, `${path}.volume.array`);
    const shape = numberArray(grid.shape, 3, `${path}.volume.grid.shape`) as [number, number, number];
    if (shape.some((item) => !Number.isInteger(item) || item <= 0)) throw new Error(`${path}.volume.grid.shape must contain positive integers`);
    const indexToWorldUm = numberArray(grid.index_to_world_um, 16, `${path}.volume.grid.index_to_world_um`);
    const derivedWorldToIndex = deriveSignedPermutationInverse(indexToWorldUm);
    const worldToIndex = grid.world_to_index === undefined
      ? derivedWorldToIndex
      : numberArray(grid.world_to_index, 16, `${path}.volume.grid.world_to_index`);
    const voxelEdgeExtentUm = numberArray(grid.voxel_edge_extent_um, 6, `${path}.volume.grid.voxel_edge_extent_um`) as [number, number, number, number, number, number];
    const worldNames = ['ml', 'ap', 'dv'] as const;
    const axisOrder = [0, 1, 2].map((column) => {
      const rows = [0, 1, 2].filter((row) => indexToWorldUm[row * 4 + column] !== 0);
      if (rows.length !== 1) throw new Error(`${path}.volume.grid.index_to_world_um must be a signed permutation`);
      return worldNames[rows[0]!]!;
    }) as ['ml' | 'ap' | 'dv', 'ml' | 'ap' | 'dv', 'ml' | 'ap' | 'dv'];
    unique(axisOrder, `${path}.volume.grid affine axes`);
    const voxelSizeUm = [0, 1, 2].map((column) => {
      const row = [0, 1, 2].find((candidate) => indexToWorldUm[candidate * 4 + column] !== 0)!;
      return Math.abs(indexToWorldUm[row * 4 + column]!);
    }) as [number, number, number];
    const originUm = [indexToWorldUm[3]!, indexToWorldUm[7]!, indexToWorldUm[11]!] as [number, number, number];
    if (arrayDescriptor.dtype !== 'float16' && arrayDescriptor.dtype !== 'float32') throw new Error(`${path}.volume.array.dtype is unsupported`);
    if (arrayDescriptor.order !== 'C') throw new Error(`${path}.volume.array.order must be C`);
    if (arrayDescriptor.endianness !== 'little' && arrayDescriptor.endianness !== 'not-applicable') throw new Error(`${path}.volume.array.endianness is unsupported`);
    const resourceIndex = object(encoding.resource_index, `${path}.volume.encoding.resource_index`);
    const summary = object(volume.summary, `${path}.volume.summary`);
    const resourceIndexResource = parseEncodedResource(resourceIndex.resource, `${path}.volume.encoding.resource_index.resource`);
    const summaryResource = parseEncodedResource(summary.resource, `${path}.volume.summary.resource`);
    const rawValidity = object(volume.validity, `${path}.volume.validity`);
    const validity = rawValidity.kind === 'sentinel'
      ? {
          kind: 'sentinel' as const,
          outsideValue: finiteNumber(rawValidity.outside_value, `${path}.volume.validity.outside_value`),
        }
      : (() => {
          const mask = parseBinaryArray(rawValidity.mask, `${path}.volume.validity.mask`);
          const codes = object(rawValidity.codes, `${path}.volume.validity.codes`);
          return {
            kind: 'mask' as const,
            mask: {
              resource: mask,
              shape: numberArray(mask.shape, 3, `${path}.volume.validity.mask.shape`) as [number, number, number],
            },
            codes: {
              valid: finiteNumber(codes.valid, `${path}.volume.validity.codes.valid`),
              outside: finiteNumber(codes.outside, `${path}.volume.validity.codes.outside`),
              missing: finiteNumber(codes.missing, `${path}.volume.validity.codes.missing`),
            },
          };
        })();
    const resourceIndexPath = resourceIndexResource.path;
    const summaryPath = summaryResource.path;
    descriptor.representations.volume = {
      kind: 'volume',
      format: 'ephys-atlas-volume-v1',
      layout: encoding.layout,
      grid: {
        referenceSpaceId: string(grid.reference_space_id, `${path}.volume.grid.reference_space_id`),
        gridId: string(grid.grid_id, `${path}.volume.grid.grid_id`),
        shape,
        axisOrder: axisOrder as [string, string, string],
        coordinateSystem: string(grid.reference_space_id, `${path}.volume.grid.reference_space_id`),
        voxelSizeUm,
        originUm,
        indexToWorldUm,
        worldToIndex,
        voxelEdgeExtentUm,
      },
      array: {
        dtype: dtype(arrayDescriptor.dtype, `${path}.volume.array.dtype`),
        endianness: arrayDescriptor.endianness,
        order: 'C',
      },
      resource: {},
      resourceIndexPath,
      resourceIndexResource,
      summaryPath,
      summaryResource,
      validity,
    };
  }

  if (!descriptor.representations.regional && !descriptor.representations.volume) {
    throw new Error(`${path} must provide regional and/or volume representation`);
  }
  if (descriptor.representations.regional && !descriptor.display?.regional) {
    throw new Error(`${path}.display.regional is required for the regional representation`);
  }
  if (descriptor.representations.volume && !descriptor.display?.volume) {
    throw new Error(`${path}.display.volume is required for the volume representation`);
  }
  if (descriptor.display?.regional && !descriptor.representations.regional) {
    throw new Error(`${path}.display.regional requires the regional representation`);
  }
  if (descriptor.display?.volume && !descriptor.representations.volume) {
    throw new Error(`${path}.display.volume requires the volume representation`);
  }
  return descriptor;
}
