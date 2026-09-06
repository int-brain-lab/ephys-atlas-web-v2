export type Triple = [number, number, number];
export type Mode = 'coverage' | 'expression' | 'comparison' | 'frequency';
export type Axis = 'coronal' | 'sagittal' | 'horizontal';
export const AXES: Axis[] = ['coronal', 'sagittal', 'horizontal'];
// Raw storage is ML,DV,AP. Plane X/Y follow the existing volume slice renderer.
export const PLANES: Record<Axis, { fixed: number; x: number; y: number }> = {
  coronal: { fixed: 2, x: 0, y: 1 }, sagittal: { fixed: 0, x: 2, y: 1 },
  horizontal: { fixed: 1, x: 0, y: 2 },
};
export const CATEGORIES = [
  { label: 'Positive · labelled', color: '#1e9caa' },
  { label: 'Zero · labelled', color: '#a7e2d6' },
  { label: 'Positive · unlabelled', color: '#ef9751' },
  { label: 'Zero · unlabelled', color: '#edc9a8' },
  { label: 'Missing · labelled', color: '#bb78c7' },
  { label: 'Missing · unlabelled', color: '#18283a' },
  { label: 'Unexpected value', color: '#ff3056' },
] as const;
export function category(value: number, label: number): number {
  if (value === -1) return label !== 0 ? 4 : 5;
  if (!Number.isFinite(value) || value < 0) return 6;
  return (label !== 0 ? 0 : 2) + (value === 0 ? 1 : 0);
}
export function offset(point: Triple, shape: Triple): number {
  return (point[0] * shape[1] + point[1]) * shape[2] + point[2];
}
export function planePoint(axis: Axis, x: number, y: number, cursor: Triple): Triple {
  const point: Triple = [...cursor];
  point[PLANES[axis].x] = x; point[PLANES[axis].y] = y;
  return point;
}
export interface Stats { count: number; min: number | null; max: number | null; mean: number | null; q05: number | null; median: number | null; q95: number | null }
export function statistics(values: number[]): Stats {
  if (!values.length) return { count: 0, min: null, max: null, mean: null, q05: null, median: null, q95: null };
  values.sort((a, b) => a - b);
  const quantile = (p: number): number => {
    const index = (values.length - 1) * p;
    const low = Math.floor(index);
    return values[low]! + (values[Math.ceil(index)]! - values[low]!) * (index - low);
  };
  return { count: values.length, min: values[0]!, max: values.at(-1)!,
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    q05: quantile(.05), median: quantile(.5), q95: quantile(.95) };
}
export function analyze(values: Float32Array, labels: Int32Array) {
  if (values.length !== labels.length) throw new Error('Label and expression lengths disagree');
  const groups: [number[], number[]] = [[], []];
  const counts = Array<number>(CATEGORIES.length).fill(0);
  values.forEach((v, i) => {
    const c = category(v, labels[i]!); counts[c]!++;
    if (c < 4) groups[labels[i] !== 0 ? 0 : 1].push(v);
  });
  const labelled = statistics(groups[0]); const unlabelled = statistics(groups[1]);
  const all = statistics([...groups[0], ...groups[1]]);
  const upper = all.max && all.max > 0 ? all.max : 1;
  const bins = groups.map(group => {
    const out = Array<number>(48).fill(0);
    for (const v of group) out[Math.min(47, Math.floor(v / upper * 48))]!++;
    return out;
  });
  return { counts, labelled, unlabelled, all, upper, bins };
}
export interface LabState { gene: string; cursor: Triple; mode: Mode; rescale: boolean; outlines: boolean }
export function readState(search: string, shape: Triple, ids: readonly string[]): LabState {
  const params = new URLSearchParams(search);
  const raw = params.get('voxel')?.split(',').map(Number);
  const cursor = shape.map((n, i) => raw?.length === 3 && Number.isInteger(raw[i])
    ? Math.max(0, Math.min(n - 1, raw[i]!)) : Math.floor(n / 2)) as Triple;
  const mode = params.get('mode');
  return { gene: ids.includes(params.get('gene') ?? '') ? params.get('gene')! : ids[0]!, cursor,
    mode: mode === 'expression' || mode === 'comparison' || mode === 'frequency' ? mode : 'coverage',
    rescale: params.get('rescale') === '1', outlines: params.get('outlines') !== '0' };
}
export function writeState(state: LabState, base: string): string {
  const url = new URL(base);
  url.searchParams.set('lab', 'agea-coverage'); url.searchParams.set('gene', state.gene);
  url.searchParams.set('voxel', state.cursor.join(',')); url.searchParams.set('mode', state.mode);
  url.searchParams.set('rescale', state.rescale ? '1' : '0'); url.searchParams.set('outlines', state.outlines ? '1' : '0');
  return url.toString();
}
