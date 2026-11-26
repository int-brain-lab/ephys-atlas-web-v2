import type { RegionalFeaturePayload } from '../../data/contracts.js';
import { poolRows } from '../../data/region-aggregate.js';

/** One feature in a two-region crossplot, in z-units across all regions of the parcellation. */
export interface PairPoint {
  featureId: string;
  z1: number;
  z2: number;
  /** Standard error of each region mean, in the same z-units. */
  sem1: number;
  sem2: number;
  /** Cohen's d of region 2 versus region 1 (pooled within-region SD). */
  d: number;
}

/** Cohen (1988) benchmarks: negligible < 0.2 ≤ small < 0.5 ≤ medium < 0.8 ≤ large. */
export const COHEN_BENCHMARKS = [0.2, 0.5, 0.8] as const;

/**
 * Z-score each feature's regional means across regions and pair two regions.
 *
 * Prototype normalization: (mean - mean of region means) / SD of region means.
 * The reference is the release's own regions (parent rows appended on the fly
 * are excluded). Features lacking mean/std/count, or regions without channels,
 * are skipped.
 */
export function pairPoints(
  features: readonly RegionalFeaturePayload[],
  a: string,
  b: string,
  releaseRowCount?: number,
): PairPoint[] {
  const points: PairPoint[] = [];
  for (const feature of features) {
    const { mean, std, count } = feature.statistics;
    if (!mean || !std || !count) continue;
    const index = new Map(feature.regionIds.map((id, row) => [id, row]));
    const rows = (id: string) => (index.has(id) ? [index.get(id)!] : []);
    const finite = mean.slice(0, releaseRowCount).filter(Number.isFinite);
    const mu = finite.reduce((sum, value) => sum + value, 0) / finite.length;
    const sigma = Math.sqrt(finite.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (finite.length - 1));
    const { m: m1, s: s1, n: n1 } = poolRows(mean, std, count, rows(a));
    const { m: m2, s: s2, n: n2 } = poolRows(mean, std, count, rows(b));
    if (!(sigma > 0) || ![m1, m2, s1, s2].every(Number.isFinite) || n1 < 2 || n2 < 2) continue;
    const pooled = Math.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2));
    points.push({
      featureId: feature.featureId,
      z1: (m1 - mu) / sigma,
      z2: (m2 - mu) / sigma,
      sem1: s1 / Math.sqrt(n1) / sigma,
      sem2: s2 / Math.sqrt(n2) / sigma,
      d: pooled > 0 ? (m2 - m1) / pooled : 0,
    });
  }
  return points.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
}

/** Provisional LFP / AP / waveform grouping by feature id (ibleatools feature models). */
export function featureGroup(id: string): 'lfp' | 'ap' | 'waveform' {
  if (/^(psd_|rms_lf|aperiodic_|decay_)/.test(id)) return 'lfp';
  if (/^(rms_ap|cor_ratio|channel_labels)$/.test(id)) return 'ap';
  return 'waveform';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADII = [2.5, 4, 6, 8.5];

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Render the z-score crossplot (marker size = Cohen's d class) and a ranked list. */
export function renderPair(
  target: HTMLElement,
  points: readonly PairPoint[],
  labels: { region1: string; region2: string; feature(id: string): string; current: string | null },
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
  for (const p of [...points].reverse()) {
    const tip = `${labels.feature(p.featureId)}\nz: ${p.z1.toFixed(2)} → ${p.z2.toFixed(2)}  ·  d = ${p.d.toFixed(2)}`;
    const group = svg('g', { 'data-pair-feature': p.featureId, 'data-group': featureGroup(p.featureId),
      'data-tip': tip, class: 'region-pair__point' });
    if (p.featureId === labels.current) group.classList.add('is-current');
    const [x, y] = [sx(p.z1), sy(p.z2)];
    group.append(
      svg('line', { x1: sx(p.z1 - p.sem1), y1: y, x2: sx(p.z1 + p.sem1), y2: y }),
      svg('line', { x1: x, y1: sy(p.z2 - p.sem2), x2: x, y2: sy(p.z2 + p.sem2) }),
      svg('circle', { cx: x, cy: y, r: RADII[COHEN_BENCHMARKS.filter((t) => Math.abs(p.d) >= t).length]! }),
    );
    plot.append(group);
  }
  const list = document.createElement('ol');
  list.className = 'region-pair__list';
  for (const p of points.slice(0, 15)) {
    const item = document.createElement('li');
    item.dataset.pairFeature = p.featureId;
    item.dataset.group = featureGroup(p.featureId);
    item.textContent = `${labels.feature(p.featureId)} — d = ${p.d.toFixed(2)}`;
    list.append(item);
  }
  const caption = document.createElement('p');
  caption.className = 'region-pair__caption';
  caption.innerHTML = `${points.length} features · z-scored across regions (prototype) · bars ±1 SEM · `
    + 'marker size: |d| &lt; 0.2, small, medium, large · '
    + '<span data-group="lfp">● LFP</span> <span data-group="ap">● AP</span> <span data-group="waveform">● waveform</span>';
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
