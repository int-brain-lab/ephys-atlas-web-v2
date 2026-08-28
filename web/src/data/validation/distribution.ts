import type {
  BinaryArrayDescriptor,
  DistributionBinning,
  DistributionDomainSpec,
  DistributionCounts,
  RepresentationDisplay,
  ScalarDistribution,
} from '../contracts.js';
import type { ScaleSpec } from '../../domain/scale-spec.js';
import { parseBinaryArray } from './binary.js';
import { array, object, string, unique } from './primitives.js';

export const DISTRIBUTION_BIN_RULE = 'left-closed-right-open-last-closed' as const;

export interface DistributionBinningResource {
  id: string;
  scale: ScaleSpec;
  domain: DistributionDomainSpec;
  edges: readonly number[];
  global: DistributionCounts;
  regionalCounts?: BinaryArrayDescriptor;
  binRule: typeof DISTRIBUTION_BIN_RULE;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${context} fields are unsupported or incomplete`);
  }
}

function finite(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function nonnegativeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

export function parseScaleSpec(value: unknown, context: string): ScaleSpec {
  const raw = object(value, context);
  if (raw.kind === 'linear') {
    exactKeys(raw, ['kind'], context);
    return { kind: 'linear' };
  }
  if (raw.kind === 'log') {
    exactKeys(raw, ['kind'], context);
    return { kind: 'log' };
  }
  if (raw.kind === 'symlog') {
    exactKeys(raw, ['kind', 'linear_threshold'], context);
    const linearThreshold = finite(raw.linear_threshold, `${context}.linear_threshold`);
    if (linearThreshold <= 0) throw new Error(`${context}.linear_threshold must be positive`);
    return { kind: 'symlog', linearThreshold };
  }
  throw new Error(`${context}.kind is unsupported`);
}

export function parseDistributionDomainSpec(value: unknown, context: string): DistributionDomainSpec {
  const raw = object(value, context);
  if (raw.kind === 'full') {
    exactKeys(raw, ['kind'], context);
    return { kind: 'full' };
  }
  if (raw.kind === 'focused') {
    exactKeys(raw, ['kind', 'bounds'], context);
    const values = array(raw.bounds, `${context}.bounds`);
    if (values.length !== 2) throw new Error(`${context}.bounds must contain two finite numbers`);
    const bounds = values.map((item, index) => finite(item, `${context}.bounds[${index}]`)) as [number, number];
    if (bounds[1] <= bounds[0]) throw new Error(`${context}.bounds must be strictly increasing`);
    return { kind: 'focused', bounds };
  }
  throw new Error(`${context}.kind is unsupported`);
}

function finiteEdges(value: unknown, context: string): number[] {
  const edges = array(value, context).map((item, index) => finite(item, `${context}[${index}]`));
  if (edges.length < 2 || edges.some((edge, index) => index > 0 && edge <= edges[index - 1]!)) {
    throw new Error(`${context} must be strictly increasing`);
  }
  return edges;
}

function countArray(value: unknown, context: string): number[] {
  return array(value, context).map((item, index) => nonnegativeInteger(item, `${context}[${index}]`));
}

export function parseDistributionBinning(
  value: unknown,
  context: string,
  requireRegionalCounts: boolean,
): DistributionBinningResource {
  const raw = object(value, context);
  exactKeys(raw, requireRegionalCounts
    ? [
        'id', 'scale', 'domain', 'edges', 'global_counts', 'global_underflow_count',
        'global_overflow_count', 'regional_counts', 'regional_count_layout', 'bin_rule',
      ]
    : [
        'id', 'scale', 'domain', 'edges', 'global_counts', 'global_underflow_count',
        'global_overflow_count', 'bin_rule',
      ], context);
  const scale = parseScaleSpec(raw.scale, `${context}.scale`);
  const domain = parseDistributionDomainSpec(raw.domain, `${context}.domain`);
  const id = string(raw.id, `${context}.id`);
  if (id !== `${scale.kind}-${domain.kind}`) throw new Error(`${context}.id must match its scale and domain`);
  const edges = finiteEdges(raw.edges, `${context}.edges`);
  if (scale.kind === 'log' && edges.some((edge) => edge <= 0)) {
    throw new Error(`${context}.edges must be positive for log scale`);
  }
  if (domain.kind === 'focused' && (edges[0] !== domain.bounds[0] || edges.at(-1) !== domain.bounds[1])) {
    throw new Error(`${context}.edges must match focused bounds exactly`);
  }
  const binCounts = countArray(raw.global_counts, `${context}.global_counts`);
  if (binCounts.length !== edges.length - 1) {
    throw new Error(`${context}.global_counts must contain one count per bin`);
  }
  const underflowCount = nonnegativeInteger(raw.global_underflow_count, `${context}.global_underflow_count`);
  const overflowCount = nonnegativeInteger(raw.global_overflow_count, `${context}.global_overflow_count`);
  if (domain.kind === 'full' && (underflowCount !== 0 || overflowCount !== 0)) {
    throw new Error(`${context} full-domain tails must be zero`);
  }
  if (raw.bin_rule !== DISTRIBUTION_BIN_RULE) throw new Error(`${context}.bin_rule is unsupported`);
  let regionalCounts: BinaryArrayDescriptor | undefined;
  if (requireRegionalCounts) {
    if (raw.regional_count_layout !== 'underflow-bins-overflow') {
      throw new Error(`${context}.regional_count_layout is unsupported`);
    }
    regionalCounts = parseBinaryArray(raw.regional_counts, `${context}.regional_counts`);
    if (regionalCounts.dtype !== 'uint32') throw new Error(`${context}.regional_counts must use uint32`);
  }
  return {
    id,
    scale,
    domain,
    edges,
    global: { binCounts, underflowCount, overflowCount },
    ...(regionalCounts ? { regionalCounts } : {}),
    binRule: DISTRIBUTION_BIN_RULE,
  };
}

function specIdentity(spec: ScaleSpec): string {
  return spec.kind === 'symlog' ? `${spec.kind}:${spec.linearThreshold}` : spec.kind;
}

function domainIdentity(domain: DistributionDomainSpec): string {
  return domain.kind === 'focused' ? `${domain.kind}:${domain.bounds[0]}:${domain.bounds[1]}` : domain.kind;
}

export function validateDistributionBinningSet(
  binnings: readonly Pick<DistributionBinning, 'id' | 'scale' | 'domain' | 'edges' | 'global'>[],
  populationCount: number,
  context: string,
  populationMinimum?: number | null,
  populationMaximum?: number | null,
): void {
  if (binnings.length === 0) throw new Error(`${context}.binnings must not be empty`);
  unique(binnings.map((binning) => binning.id), `${context}.binnings ids`);
  const scaleByKind = new Map<string, string>();
  const domainByKind = new Map<string, string>();
  const endpointsByDomain = new Map<string, readonly [number, number]>();
  for (const binning of binnings) {
    if (binning.id !== `${binning.scale.kind}-${binning.domain.kind}`) {
      throw new Error(`${context}.${binning.id} id must match its scale and domain`);
    }
    const existingScale = scaleByKind.get(binning.scale.kind);
    const scale = specIdentity(binning.scale);
    if (existingScale !== undefined && existingScale !== scale) {
      throw new Error(`${context} must use one ${binning.scale.kind} scale specification`);
    }
    scaleByKind.set(binning.scale.kind, scale);
    const existingDomain = domainByKind.get(binning.domain.kind);
    const domain = domainIdentity(binning.domain);
    if (existingDomain !== undefined && existingDomain !== domain) {
      throw new Error(`${context} must use one ${binning.domain.kind} domain specification`);
    }
    domainByKind.set(binning.domain.kind, domain);
    const endpoints = [binning.edges[0]!, binning.edges.at(-1)!] as const;
    const existingEndpoints = endpointsByDomain.get(binning.domain.kind);
    if (existingEndpoints !== undefined
      && (existingEndpoints[0] !== endpoints[0] || existingEndpoints[1] !== endpoints[1])) {
      throw new Error(`${context} raw ${binning.domain.kind} endpoints must be identical across scales`);
    }
    endpointsByDomain.set(binning.domain.kind, endpoints);
    if (binning.domain.kind === 'focused'
      && (endpoints[0] !== binning.domain.bounds[0] || endpoints[1] !== binning.domain.bounds[1])) {
      throw new Error(`${context}.${binning.id} edges must match focused bounds exactly`);
    }
    if (binning.domain.kind === 'full'
      && (binning.global.underflowCount !== 0 || binning.global.overflowCount !== 0)) {
      throw new Error(`${context}.${binning.id} full-domain tails must be zero`);
    }
    if (binning.scale.kind === 'log' && populationMinimum !== undefined
      && populationMinimum !== null && populationMinimum <= 0) {
      throw new Error(`${context}.${binning.id} log scale requires a strictly positive population`);
    }
    const total = binning.global.underflowCount
      + binning.global.binCounts.reduce((sum, count) => sum + count, 0)
      + binning.global.overflowCount;
    if (total !== populationCount) throw new Error(`${context}.${binning.id} does not conserve the population`);
  }
  if (!binnings.some((binning) => binning.id === 'linear-full')) {
    throw new Error(`${context} must include linear-full`);
  }
  for (const scale of scaleByKind.keys()) {
    for (const domain of domainByKind.keys()) {
      if (!binnings.some((binning) => binning.id === `${scale}-${domain}`)) {
        throw new Error(`${context} scale and domain combinations must form a rectangular cross-product`);
      }
    }
  }
  const full = endpointsByDomain.get('full')!;
  const focused = endpointsByDomain.get('focused');
  if (focused && (focused[0] < full[0] || focused[1] > full[1])) {
    throw new Error(`${context} focused domain must lie inside the full domain`);
  }
  if (populationMinimum !== undefined && populationMinimum !== null && full[0] > populationMinimum) {
    throw new Error(`${context} full domain does not enclose the population minimum`);
  }
  if (populationMaximum !== undefined && populationMaximum !== null && full[1] < populationMaximum) {
    throw new Error(`${context} full domain does not enclose the population maximum`);
  }
}

function parseMaterializedScaleSpec(value: unknown, context: string): ScaleSpec {
  const raw = object(value, context);
  if (raw.kind === 'linear') return { kind: 'linear' };
  if (raw.kind === 'log') return { kind: 'log' };
  if (raw.kind === 'symlog') {
    const linearThreshold = finite(raw.linearThreshold, `${context}.linearThreshold`);
    if (linearThreshold <= 0) throw new Error(`${context}.linearThreshold must be positive`);
    return { kind: 'symlog', linearThreshold };
  }
  throw new Error(`${context}.kind is unsupported`);
}

function parseMaterializedDomainSpec(value: unknown, context: string): DistributionDomainSpec {
  const raw = object(value, context);
  if (raw.kind === 'full') return { kind: 'full' };
  if (raw.kind === 'focused') {
    const values = array(raw.bounds, `${context}.bounds`);
    if (values.length !== 2) throw new Error(`${context}.bounds must contain two finite numbers`);
    const bounds = values.map((item, index) => finite(item, `${context}.bounds[${index}]`)) as [number, number];
    if (bounds[1] <= bounds[0]) throw new Error(`${context}.bounds must be strictly increasing`);
    return { kind: 'focused', bounds };
  }
  throw new Error(`${context}.kind is unsupported`);
}

function parseMaterializedCounts(value: unknown, bins: number, context: string): DistributionCounts {
  const raw = object(value, context);
  const binCounts = countArray(raw.binCounts, `${context}.binCounts`);
  if (binCounts.length !== bins) throw new Error(`${context}.binCounts must contain one count per bin`);
  return {
    binCounts,
    underflowCount: nonnegativeInteger(raw.underflowCount, `${context}.underflowCount`),
    overflowCount: nonnegativeInteger(raw.overflowCount, `${context}.overflowCount`),
  };
}

/** Parse and semantically validate the normalized in-memory distribution contract. */
export function parseMaterializedDistribution(
  value: unknown,
  regionCount: number,
  regionalPopulationCounts?: readonly number[],
): ScalarDistribution {
  const raw = object(value, 'feature.distribution');
  const binnings: DistributionBinning[] = array(raw.binnings, 'feature.distribution.binnings')
    .map((item, index) => {
      const context = `feature.distribution.binnings[${index}]`;
      const binning = object(item, context);
      const edges = finiteEdges(binning.edges, `${context}.edges`);
      const scale = parseMaterializedScaleSpec(binning.scale, `${context}.scale`);
      const domain = parseMaterializedDomainSpec(binning.domain, `${context}.domain`);
      const id = string(binning.id, `${context}.id`);
      if (id !== `${scale.kind}-${domain.kind}`) throw new Error(`${context}.id must match its scale and domain`);
      if (binning.binRule !== DISTRIBUTION_BIN_RULE) throw new Error(`${context}.binRule is unsupported`);
      if (scale.kind === 'log' && edges.some((edge) => edge <= 0)) {
        throw new Error(`${context}.edges must be positive for log scale`);
      }
      const bins = edges.length - 1;
      const global = parseMaterializedCounts(binning.global, bins, `${context}.global`);
      const regional = array(binning.regional, `${context}.regional`).map((counts, row) => (
        parseMaterializedCounts(counts, bins, `${context}.regional[${row}]`)
      ));
      if (regional.length !== regionCount) throw new Error(`${context}.regional must match regionIds`);
      return { id, scale, domain, edges, global, regional, binRule: DISTRIBUTION_BIN_RULE };
    });
  const populationCount = binnings.length === 0
    ? 0
    : binnings[0]!.global.underflowCount
      + binnings[0]!.global.binCounts.reduce((sum, count) => sum + count, 0)
      + binnings[0]!.global.overflowCount;
  validateDistributionBinningSet(binnings, populationCount, 'feature.distribution');
  if (regionalPopulationCounts !== undefined) {
    if (regionalPopulationCounts.length !== regionCount) {
      throw new Error('feature.statistics.count length must match regionIds');
    }
    for (const binning of binnings) {
      binning.regional?.forEach((counts, row) => {
        const total = counts.underflowCount
          + counts.binCounts.reduce((sum, count) => sum + count, 0)
          + counts.overflowCount;
        if (total !== regionalPopulationCounts[row]) {
          throw new Error(`feature.distribution.${binning.id} region ${row} does not conserve its population`);
        }
      });
    }
  }
  return { binnings };
}

export function validateDistributionMatchesDisplay(
  binnings: readonly DistributionBinningResource[],
  display: RepresentationDisplay,
  context: string,
): void {
  const declared = new Set<string>();
  for (const scale of display.scales) {
    for (const domain of display.distributionDomains) declared.add(`${scale.kind}-${domain.kind}`);
  }
  const actual = new Set(binnings.map((binning) => binning.id));
  if (declared.size !== actual.size || [...declared].some((id) => !actual.has(id))) {
    throw new Error(`${context} binnings do not match the representation display contract`);
  }
  for (const binning of binnings) {
    const scale = display.scales.find((candidate) => candidate.kind === binning.scale.kind);
    const domain = display.distributionDomains.find((candidate) => candidate.kind === binning.domain.kind);
    if (!scale || specIdentity(scale) !== specIdentity(binning.scale)
      || !domain || domainIdentity(domain) !== domainIdentity(binning.domain)) {
      throw new Error(`${context}.${binning.id} differs from the representation display contract`);
    }
  }
}
