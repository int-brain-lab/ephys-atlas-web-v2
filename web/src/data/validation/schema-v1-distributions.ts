/** Schema-v1 distributions semantic checks; the release contract is unchanged. */

import {
  type JsonObject,
  fail,
  object,
  array,
  numberArray,
  integers,
  expect,
  unique,
  product,
  increasing,
} from './schema-v1-common.js';

export function distributionSemantics(
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

export function summarySemantics(document: JsonObject): void {
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
  if (valid === 0 && document.regional_distributions !== undefined) {
    fail('empty volume population cannot declare regional distributions');
  }
  if (document.regional_distributions !== undefined) {
    const globalBinnings = array(
      object(document.distribution, 'volume distribution').binnings,
      'volume binnings',
    ).map((item) => object(item, 'volume binning'));
    const columnsById = new Map(globalBinnings.map((binning) => [
      String(binning.id),
      array(binning.edges, 'volume binning edges').length + 1,
    ]));
    const companions = array(document.regional_distributions, 'volume regional distributions')
      .map((item) => object(item, 'volume regional distribution'));
    unique(companions.map((item) => item.parcellation_id), 'volume regional-distribution parcellation id');
    for (const companion of companions) {
      if (Number(companion.assigned_valid_voxel_count) + Number(companion.unassigned_valid_voxel_count) !== valid) {
        fail('volume regional-distribution counts do not conserve valid voxels');
      }
      const binnings = array(companion.binnings, 'volume regional-distribution binnings')
        .map((item) => object(item, 'volume regional-distribution binning'));
      const ids = binnings.map((binning) => String(binning.binning_id));
      unique(ids, 'volume regional-distribution binning id');
      if (ids.length !== columnsById.size || ids.some((id) => !columnsById.has(id))) {
        fail('volume regional-distribution binnings must exactly match global binnings');
      }
      for (const binning of binnings) {
        const counts = object(binning.regional_counts, 'volume regional-distribution counts');
        const shape = integers(counts.shape, 'volume regional-distribution count shape');
        if (counts.dtype !== 'uint32' || shape.length !== 2
          || shape[1] !== columnsById.get(String(binning.binning_id))) {
          fail('volume regional-distribution count array shape or dtype is invalid');
        }
      }
    }
  }
}

export function statisticsSemantics(document: JsonObject): void {
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

export function featureDisplaySemantics(document: JsonObject): void {
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
    if ((representation.colormap === 'coolwarm' || representation.colormap === 'berlin')
      && representation.diverging_center === undefined) {
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
