import type { RegionalFeaturePayload } from '../../data/contracts.js';
import { poolRows, populationSd, sampleSd, type Moments } from '../../data/region-aggregate.js';

/** One feature in a two-region crossplot, in full-population z-units. */
export interface PairPoint {
  featureId: string;
  z1: number;
  z2: number;
  /** Standard error of each region mean, in the same z-units. */
  sem1: number;
  sem2: number;
  /**
   * Cohen's d of region 2 versus region 1 (pooled within-region sample SD).
   * NaN when both regions are constant but differ: the standardized effect is
   * undefined, so such features rank after every finite effect.
   */
  d: number;
}

/** Cohen (1988) benchmarks: negligible < 0.2 ≤ small < 0.5 ≤ medium < 0.8 ≤ large. */
export const COHEN_BENCHMARKS = [0.2, 0.5, 0.8] as const;

/**
 * Full-population moments of a release payload: its `global` count, mean and
 * population SD when present, otherwise pooled from all of its (disjoint) rows.
 */
export function populationMoments(payload: RegionalFeaturePayload): Moments {
  const { count, mean, std } = payload.global ?? {};
  if (count !== undefined && mean !== undefined && std !== undefined) return { n: count, mean, m2: count * std * std };
  const stats = payload.statistics;
  return stats.mean && stats.count
    ? poolRows(stats.mean, stats.std, stats.count, payload.regionIds.map((_, row) => row))
    : { n: 0, mean: NaN, m2: NaN };
}

/**
 * Pair two regions over all features, z-scored against the full population.
 *
 * z = (region mean − population mean) / population SD, identically on both
 * axes (owner decision, see docs). The population comes from `references`
 * (the unexpanded release payloads, index-aligned with `features`), else from
 * the feature itself. Features without mean/std/count, regions with fewer than
 * two observations, and features with a zero population SD are skipped.
 */
export function pairPoints(
  features: readonly RegionalFeaturePayload[],
  a: string,
  b: string,
  references?: readonly RegionalFeaturePayload[],
): PairPoint[] {
  const points: PairPoint[] = [];
  for (const [k, feature] of features.entries()) {
    const { mean, std, count } = feature.statistics;
    if (!mean || !std || !count) continue;
    const population = populationMoments(references?.[k] ?? feature);
    const [mu, sigma] = [population.mean, populationSd(population)];
    const index = new Map(feature.regionIds.map((id, row) => [id, row]));
    const pool = (id: string) => poolRows(mean, std, count, index.has(id) ? [index.get(id)!] : []);
    const [r1, r2] = [pool(a), pool(b)];
    if (!(sigma > 0) || !Number.isFinite(mu) || r1.n < 2 || r2.n < 2
      || ![r1.mean, r2.mean, r1.m2, r2.m2].every(Number.isFinite)) continue;
    const within = Math.sqrt((r1.m2 + r2.m2) / (r1.n + r2.n - 2));
    const diff = r2.mean - r1.mean;
    points.push({
      featureId: feature.featureId,
      z1: (r1.mean - mu) / sigma,
      z2: (r2.mean - mu) / sigma,
      sem1: sampleSd(r1) / Math.sqrt(r1.n) / sigma,
      sem2: sampleSd(r2) / Math.sqrt(r2.n) / sigma,
      d: within > 0 ? diff / within : diff === 0 ? 0 : NaN,
    });
  }
  const rank = (d: number) => (Number.isNaN(d) ? -1 : Math.abs(d));
  return points.sort((p, q) => rank(q.d) - rank(p.d));
}

export type FeatureGroup = 'lfp' | 'ap' | 'waveform' | 'other';

/** Datasets whose features follow the ephys-atlas channel feature models (the golden fixture mirrors them). */
const CHANNEL_FEATURE_DATASETS = new Set(['ephys_atlas_channels', 'ephys_atlas_volumes', 'golden_fixture']);
const WAVEFORM = /^(alpha_|depolarisation_|peak_to_trough_|polarity$|predepolarisation_|recovery_|repolarisation_|slowness_|spatial_spread_|spike_|tip_val$)/;

/**
 * Provisional LF / AP / waveform grouping (ibleatools feature models) for
 * channel-feature datasets; `.raw`/`.denoised` variants share their base group.
 * Unknown channel features are `other`; other datasets are not grouped (null).
 */
export function featureGroup(datasetId: string, id: string): FeatureGroup | null {
  if (!CHANNEL_FEATURE_DATASETS.has(datasetId)) return null;
  const base = id.replace(/\.(raw|denoised)$/, '');
  if (/^(psd_|rms_lf|aperiodic_|decay_)/.test(base)) return 'lfp';
  if (/^(rms_ap|cor_ratio|channel_labels)$/.test(base)) return 'ap';
  return WAVEFORM.test(base) ? 'waveform' : 'other';
}

/** Effect-size label; an undefined d means both regions are constant and differ. */
export const formatD = (d: number) => (Number.isNaN(d) ? 'd undefined (no within-region spread)' : `d = ${d.toFixed(2)}`);

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Marker radius: area ∝ |d|, capped at |d| = 3. */
export const markerRadius = (d: number) => 1.5 + 4.5 * Math.sqrt(Number.isNaN(d) ? 0 : Math.min(Math.abs(d), 3));

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Render the z-score crossplot (marker area ∝ |Cohen's d|) and a ranked list. */
export function renderPair(
  target: HTMLElement,
  points: readonly PairPoint[],
  labels: {
    region1: string; region2: string; current: string | null;
    feature(id: string): string; group(id: string): FeatureGroup | null;
  },
): void {
  const size = 600;
  const pad = 40;
  const lim = Math.max(1, ...points.flatMap((p) => [Math.abs(p.z1) + p.sem1, Math.abs(p.z2) + p.sem2])) * 1.05;
  const sx = (z: number) => pad + ((z + lim) / (2 * lim)) * (size - 2 * pad);
  const sy = (z: number) => size - pad - ((z + lim) / (2 * lim)) * (size - 2 * pad);
  const plot = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'region-pair__plot', role: 'img' });
  plot.append(
    svg('line', { x1: sx(-lim), y1: sy(-lim), x2: sx(lim), y2: sy(lim), class: 'region-pair__diagonal' }),
    svg('line', { x1: sx(0), y1: sy(-lim), x2: sx(0), y2: sy(lim), class: 'region-pair__axis' }),
    svg('line', { x1: sx(-lim), y1: sy(0), x2: sx(lim), y2: sy(0), class: 'region-pair__axis' }),
  );
  const xLabel = svg('text', { x: size / 2, y: size - 8, 'text-anchor': 'middle' });
  xLabel.textContent = `${labels.region1} (z)`;
  const yLabel = svg('text', { x: 14, y: size / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${size / 2})` });
  yLabel.textContent = `${labels.region2} (z)`;
  plot.append(xLabel, yLabel);
  const legendTitle = svg('text', { x: pad + 6, y: pad + 14 });
  legendTitle.textContent = "Cohen's |d|";
  plot.append(legendTitle);
  let legendX = pad + 92;
  for (const d of [...COHEN_BENCHMARKS, 2]) {
    const r = markerRadius(d);
    const label = svg('text', { x: legendX + r + 3, y: pad + 14 });
    label.textContent = `${d}`;
    plot.append(svg('circle', { cx: legendX, cy: pad + 10, r, class: 'region-pair__legend' }), label);
    legendX += 2 * r + 28;
  }
  for (const p of [...points].reverse()) {
    const tip = `${labels.feature(p.featureId)}\nz: ${p.z1.toFixed(2)} → ${p.z2.toFixed(2)}  ·  ${formatD(p.d)}`;
    const group = svg('g', { 'data-pair-feature': p.featureId, 'data-group': labels.group(p.featureId) ?? 'other',
      'data-tip': tip, class: 'region-pair__point' });
    group.classList.toggle('is-current', p.featureId === labels.current);
    group.classList.toggle('is-undefined', Number.isNaN(p.d));
    const [x, y] = [sx(p.z1), sy(p.z2)];
    group.append(
      svg('line', { x1: sx(p.z1 - p.sem1), y1: y, x2: sx(p.z1 + p.sem1), y2: y }),
      svg('line', { x1: x, y1: sy(p.z2 - p.sem2), x2: x, y2: sy(p.z2 + p.sem2) }),
      svg('circle', { cx: x, cy: y, r: markerRadius(p.d) }),
    );
    plot.append(group);
  }
  const list = document.createElement('ol');
  list.className = 'region-pair__list';
  for (const p of points.slice(0, 15)) {
    const item = document.createElement('li');
    item.dataset.pairFeature = p.featureId;
    item.dataset.group = labels.group(p.featureId) ?? 'other';
    item.textContent = `${labels.feature(p.featureId)} — ${formatD(p.d)}`;
    list.append(item);
  }
  const caption = document.createElement('p');
  caption.className = 'region-pair__caption';
  caption.innerHTML = `${points.length} features · z-scored against the full population · bars ±1 SEM (channels treated as independent) · `
    + 'marker area ∝ |d| (legend top-left) · '
    + '<span data-group="lfp">●</span> LF <span data-group="ap">●</span> AP <span data-group="waveform">●</span> Waveform '
    + '<span data-group="other">●</span> Other';
  const tooltip = document.createElement('div');
  tooltip.className = 'region-pair__tip';
  tooltip.hidden = true;
  plot.addEventListener('pointermove', (event) => {
    const text = (event.target as Element).closest('[data-tip]')?.getAttribute('data-tip');
    tooltip.hidden = !text;
    if (!text) return;
    const box = target.getBoundingClientRect();
    tooltip.textContent = text;
    tooltip.style.left = `${event.clientX - box.left + 12}px`;
    tooltip.style.top = `${event.clientY - box.top + 12}px`;
  });
  plot.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  target.replaceChildren(caption, plot, list, tooltip);
}
