export interface ImageExportOptions {
  readonly format: 'svg' | 'png';
  readonly longestEdge?: number;
  readonly colorbar?: SVGSVGElement;
}

export function imageExportSize(width: number, height: number, longestEdge = 2400): { width: number; height: number } {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) throw new RangeError('Image dimensions must be positive');
  if (!Number.isInteger(longestEdge) || longestEdge < 1 || longestEdge > 8192) throw new RangeError('Export longest edge must be an integer from 1 to 8192');
  const scale = longestEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const PRESENTATION_PROPERTIES = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'vector-effect', 'paint-order', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'color', 'stop-color', 'stop-opacity',
  'display', 'clip-path', 'mask', 'filter',
] as const;

/** Resolve stylesheet presentation while attached; the clone has no pointer hover. */
export function inlineSvgPresentation(svg: SVGSVGElement): void {
  const snapshots = [svg, ...svg.querySelectorAll<SVGElement>('*')].map((element) => {
    const style = getComputedStyle(element);
    return { element, resolved: PRESENTATION_PROPERTIES.map((name) => [name, style.getPropertyValue(name)] as const) };
  });
  for (const { element, resolved } of snapshots) {
    element.removeAttribute('style');
    element.removeAttribute('class');
    for (const [name, value] of resolved) if (value) element.setAttribute(name, value);
  }
}

function appendColorbar(svg: SVGSVGElement, source: SVGSVGElement): void {
  const [x = 0, y = 0, width = 1, height = 1] = svg.getAttribute('viewBox')!.split(/[ ,]+/).map(Number);
  const bar = source.cloneNode(true) as SVGSVGElement;
  // UI-generated legends are already standalone; attached SVGs may need CSS resolved.
  if (source.isConnected && source.parentElement) {
    bar.style.position = 'absolute';
    bar.style.pointerEvents = 'none';
    bar.style.visibility = 'hidden';
    source.parentElement.append(bar);
    try { inlineSvgPresentation(bar); } finally { bar.remove(); }
  }
  const bounds = source.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
  const barWidth = bounds?.[2] ?? Number(source.getAttribute('width'));
  const barHeight = bounds?.[3] ?? Number(source.getAttribute('height'));
  if (!(barWidth && barWidth > 0 && barHeight && barHeight > 0)) throw new Error('Colorbar has no exportable dimensions');
  const gap = width * 0.025;
  const displayedHeight = width * barHeight / barWidth;
  bar.setAttribute('x', String(x));
  bar.setAttribute('y', String(y + height + gap));
  bar.setAttribute('width', String(width));
  bar.setAttribute('height', String(displayedHeight));
  svg.append(bar);
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height + gap + displayedHeight}`);
}

export async function exportSvgImage(svg: SVGSVGElement, options: ImageExportOptions): Promise<Blob> {
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (options.colorbar) appendColorbar(svg, options.colorbar);
  const bounds = svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
  const size = imageExportSize(bounds?.[2] ?? 0, bounds?.[3] ?? 0, options.longestEdge);
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  if (options.format === 'svg') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Export image could not be rasterized'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export requires a Canvas 2D context');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    return await canvasPngBlob(canvas);
  } finally { URL.revokeObjectURL(url); }
}

export function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png');
  });
}
