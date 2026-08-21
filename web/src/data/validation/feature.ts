import type { ParcellationId, StatisticId } from '../../domain/types.js';
import { SCHEMA_VERSION, type FeatureDescriptor } from '../contracts.js';
import { parseBinaryArray } from './binary.js';
import {
  array,
  dtype,
  nullableRange,
  numberArray,
  object,
  parcellation,
  plainString,
  statistic,
  string,
  unique,
} from './primitives.js';

function parseRegionalParcellation(value: unknown, context: string) {
  const item = object(value, context);
  return {
    parcellationId: parcellation(item.parcellation_id, `${context}.parcellation_id`),
    summary: string(item.summary, `${context}.summary`),
    values: parseBinaryArray(item.values, `${context}.values`),
    statistics: string(item.statistics, `${context}.statistics`),
  };
}

export function parseFeatureDescriptor(value: unknown, path: string): FeatureDescriptor {
  const root = object(value, `feature ${path}`);
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`${path}.schema_version must be ${SCHEMA_VERSION}`);
  const representations = object(root.representations, `${path}.representations`);
  const valueSemantics = object(root.value_semantics, `${path}.value_semantics`);
  array(root.artifacts, `${path}.artifacts`);
  const featureId = string(root.id, `${path}.id`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(featureId)) throw new Error(`${path}.id has an invalid format`);
  if (root.display !== undefined) {
    const display = object(root.display, `${path}.display`);
    if (display.colormap !== undefined) plainString(display.colormap, `${path}.display.colormap`);
    if (display.range !== undefined) numberArray(display.range, 2, `${path}.display.range`);
  }
  const descriptor: FeatureDescriptor = {
    id: featureId,
    path,
    label: string(root.label, `${path}.label`),
    description: plainString(root.description, `${path}.description`),
    unit: root.unit === null ? null : plainString(root.unit, `${path}.unit`),
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
    if (regional.format !== 'ephys-atlas-regional-v0.1') throw new Error(`${path} has unsupported regional format`);
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
      format: 'ephys-atlas-regional-v0.1',
      parcellations: mappings,
    };
  }

  if (representations.volume !== undefined) {
    const volume = object(representations.volume, `${path}.representations.volume`);
    if (volume.format !== 'ephys-atlas-chunked-volume-v0.1') throw new Error(`${path} has unsupported volume format`);
    if (volume.layout !== 'chunks3d' && volume.layout !== 'orthogonal_slice_packs') throw new Error(`${path}.volume.layout is unsupported`);
    const grid = object(volume.grid, `${path}.volume.grid`);
    const arrayDescriptor = object(volume.array, `${path}.volume.array`);
    const shape = numberArray(grid.shape, 3, `${path}.volume.grid.shape`) as [number, number, number];
    if (shape.some((item) => !Number.isInteger(item) || item <= 0)) throw new Error(`${path}.volume.grid.shape must contain positive integers`);
    const axisOrder = array(grid.axis_order, `${path}.volume.grid.axis_order`).map((item, i) => string(item, `${path}.volume.grid.axis_order[${i}]`));
    if (axisOrder.length !== 3) throw new Error(`${path}.volume.grid.axis_order must have three entries`);
    const normalizedAxes = axisOrder.map((item) => item.toLowerCase());
    unique(normalizedAxes, `${path}.volume.grid.axis_order`);
    if (!['ap', 'ml', 'dv'].every((axis) => normalizedAxes.includes(axis))) {
      throw new Error(`${path}.volume.grid.axis_order must contain ap, ml, and dv`);
    }
    const voxelSizeUm = numberArray(grid.voxel_size_um, 3, `${path}.volume.grid.voxel_size_um`) as [number, number, number];
    if (voxelSizeUm.some((item) => item <= 0)) throw new Error(`${path}.volume.grid.voxel_size_um must be positive`);
    const originUm = numberArray(grid.origin_um, 3, `${path}.volume.grid.origin_um`) as [number, number, number];
    const indexToWorldUm = numberArray(grid.index_to_world_um, 16, `${path}.volume.grid.index_to_world_um`);
    if (arrayDescriptor.order !== 'C') throw new Error(`${path}.volume.array.order must be C`);
    if (arrayDescriptor.endianness !== 'little' && arrayDescriptor.endianness !== 'not-applicable') throw new Error(`${path}.volume.array.endianness is unsupported`);
    if (arrayDescriptor.nonfinite !== 'preserve' && arrayDescriptor.nonfinite !== 'forbid') throw new Error(`${path}.volume.array.nonfinite is unsupported`);
    const resource = volume.layout === 'chunks3d'
      ? object(volume.chunks, `${path}.volume.chunks`)
      : object(volume.slice_packs, `${path}.volume.slice_packs`);
    descriptor.representations.volume = {
      kind: 'volume',
      format: 'ephys-atlas-chunked-volume-v0.1',
      layout: volume.layout,
      grid: {
        shape,
        axisOrder: axisOrder as [string, string, string],
        coordinateSystem: string(grid.coordinate_system, `${path}.volume.grid.coordinate_system`),
        voxelSizeUm,
        originUm,
        indexToWorldUm,
      },
      array: {
        dtype: dtype(arrayDescriptor.dtype, `${path}.volume.array.dtype`),
        endianness: arrayDescriptor.endianness,
        order: 'C',
        nonfinite: arrayDescriptor.nonfinite,
      },
      resource,
      ...(typeof volume.statistics === 'string' ? { statistics: volume.statistics } : {}),
      ...(volume.value_range === undefined ? {} : { valueRange: nullableRange(volume.value_range, `${path}.volume.value_range`) }),
    };
  }

  if (!descriptor.representations.regional && !descriptor.representations.volume) {
    throw new Error(`${path} must provide regional and/or volume representation`);
  }
  return descriptor;
}
