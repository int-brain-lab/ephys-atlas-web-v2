interface Point {
  x: number;
  y: number;
}

export function smoothHistogramPath(
  values: readonly number[],
  maxValue: number,
  close: boolean,
  width = 1000,
  height = 100,
): string {
  if (values.length === 0) return '';
  const binWidth = width / values.length;
  const y = (value: number): number => {
    const ratio = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
    return height - ratio * (height - 5);
  };
  const points: Point[] = [
    { x: 0, y: height },
    ...values.map((value, index) => ({ x: (index + 0.5) * binWidth, y: y(value) })),
    { x: width, y: height },
  ];
  const tangents = monotoneTangents(points);
  let path = `M ${format(points[0]!.x)} ${format(points[0]!.y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const span = end.x - start.x;
    path += ` C ${format(start.x + span / 3)} ${format(start.y + tangents[index]! * span / 3)}`;
    path += ` ${format(end.x - span / 3)} ${format(end.y - tangents[index + 1]! * span / 3)}`;
    path += ` ${format(end.x)} ${format(end.y)}`;
  }
  return close ? `${path} Z` : path;
}

function monotoneTangents(points: readonly Point[]): number[] {
  const secants = points.slice(0, -1).map((point, index) => (
    (points[index + 1]!.y - point.y) / (points[index + 1]!.x - point.x)
  ));
  const tangents = new Array<number>(points.length).fill(0);
  tangents[0] = secants[0] ?? 0;
  tangents[tangents.length - 1] = secants.at(-1) ?? 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = secants[index - 1]!;
    const after = secants[index]!;
    if (before === 0 || after === 0 || before * after < 0) continue;
    const beforeWidth = points[index]!.x - points[index - 1]!.x;
    const afterWidth = points[index + 1]!.x - points[index]!.x;
    const beforeWeight = 2 * afterWidth + beforeWidth;
    const afterWeight = afterWidth + 2 * beforeWidth;
    tangents[index] = (beforeWeight + afterWeight) / (beforeWeight / before + afterWeight / after);
  }
  return tangents;
}

function format(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
