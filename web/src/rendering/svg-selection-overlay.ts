import type { RegionalSliceFrame } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TINY_REGION_PIXELS = 12;
let nextMaskId = 0;

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

/** Copy geometry only, including nested transforms; never duplicate asset IDs. */
function geometry(source: SVGPathElement, root: SVGSVGElement): SVGPathElement {
  const path = svgElement('path');
  path.setAttribute('d', source.getAttribute('d') ?? '');
  path.setAttribute('fill-rule', getComputedStyle(source).fillRule);
  const transforms: string[] = [];
  for (let node: Element | null = source; node && node !== root; node = node.parentElement) {
    const transform = node.getAttribute('transform');
    if (transform) transforms.unshift(transform);
  }
  if (transforms.length) path.setAttribute('transform', transforms.join(' '));
  return path;
}

/** Presentation-only focus above anatomy; selected fills and scalar pixels stay intact. */
export class SvgSelectionOverlay {
  private readonly layer = svgElement('g');
  private readonly locator = svgElement('g');
  private readonly status = document.createElement('p');
  private readonly resizeObserver: ResizeObserver;
  private frame: RegionalSliceFrame | null = null;
  private paths: readonly SVGPathElement[] = [];
  private signature = '';
  private locatorTimer: ReturnType<typeof setTimeout> | null = null;
  private locatorRegion: number | null = null;
  private readonly maskId = `projection-selection-mask-${++nextMaskId}`;

  constructor(private readonly svg: SVGSVGElement, guideLayer: SVGGElement) {
    this.layer.classList.add('projection-selection');
    this.layer.setAttribute('pointer-events', 'none');
    this.layer.setAttribute('aria-hidden', 'true');
    this.locator.classList.add('projection-selection__locator');
    this.locator.setAttribute('pointer-events', 'none');
    this.locator.setAttribute('aria-hidden', 'true');
    svg.insertBefore(this.layer, guideLayer);
    // Locator annotations sit above crosshairs, while anatomical outlines sit below.
    svg.append(this.locator);
    this.status.className = 'projection-selection-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    svg.parentElement?.append(this.status);
    this.resizeObserver = new ResizeObserver(() => {
      this.updatePresence();
      if (this.locatorRegion !== null) this.drawLocator(this.locatorRegion);
    });
    this.resizeObserver.observe(svg);
  }

  update(frame: RegionalSliceFrame, index: ReadonlyMap<number, readonly SVGPathElement[]>): void {
    const ids = [...(frame.selectedRegionIds ?? [])];
    const paths = ids.flatMap(id => [...(index.get(id) ?? [])]);
    const signature = `${frame.axis}/${frame.mapping}/${frame.index}/${ids.join(',')}`;
    const changed = signature !== this.signature || paths.length !== this.paths.length
      || paths.some((path, position) => path !== this.paths[position]);
    this.frame = frame;
    this.signature = signature;
    this.paths = paths;
    if (!changed) return;
    this.layer.replaceChildren();
    this.clearLocator();
    if (paths.length) this.drawOutlines(frame, paths, [...new Set([...index.values()].flatMap(paths => [...paths]))]);
    this.updatePresence();
    const last = ids.at(-1);
    if (last !== undefined) this.showLocator(Math.abs(last), false);
  }

  locate(regionId: number): void {
    if ([...(this.frame?.selectedRegionIds ?? [])].some(id => Math.abs(id) === Math.abs(regionId))) {
      this.showLocator(Math.abs(regionId), true);
    }
  }

  clear(): void {
    this.frame = null;
    this.paths = [];
    this.signature = '';
    this.layer.replaceChildren();
    this.clearLocator();
    this.status.hidden = true;
    this.status.textContent = '';
  }

  dispose(): void {
    this.clear();
    this.resizeObserver.disconnect();
    this.layer.remove();
    this.locator.remove();
    this.status.remove();
  }

  private drawOutlines(frame: RegionalSliceFrame, paths: readonly SVGPathElement[], anatomy: readonly SVGPathElement[]): void {
    const defs = svgElement('defs');
    const mask = svgElement('mask');
    mask.id = this.maskId;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    mask.setAttribute('mask-type', 'luminance');
    const { x, y, width, height } = frame.viewBox;
    for (const [name, value] of Object.entries({ x, y, width, height })) mask.setAttribute(name, String(value));
    const background = svgElement('rect');
    for (const [name, value] of Object.entries({ x, y, width, height })) background.setAttribute(name, String(value));
    background.setAttribute('fill', 'white');
    mask.append(background);
    // Restrict dimming to anatomy and cut out the selected union. This preserves
    // exact selected pixels in regional and volume views, including nested geometry.
    const contextMask = mask.cloneNode(false) as SVGMaskElement;
    contextMask.id = `${this.maskId}-context`;
    for (const source of anatomy) {
      const silhouette = geometry(source, this.svg);
      silhouette.setAttribute('fill', 'white');
      silhouette.setAttribute('stroke', 'none');
      contextMask.append(silhouette);
    }
    const context = background.cloneNode(false) as SVGRectElement;
    context.classList.add('projection-selection__context');
    context.setAttribute('fill', 'black');
    context.setAttribute('fill-opacity', '0.28');
    context.setAttribute('mask', `url(#${contextMask.id})`);
    const outlines = svgElement('g');
    outlines.setAttribute('mask', `url(#${this.maskId})`);
    const outer = svgElement('g');
    outer.classList.add('projection-selection__outer');
    const inner = svgElement('g');
    inner.classList.add('projection-selection__inner');
    for (const source of paths) {
      const cutout = geometry(source, this.svg);
      cutout.setAttribute('fill', 'black');
      cutout.setAttribute('stroke', 'none');
      mask.append(cutout);
      contextMask.append(cutout.cloneNode(true));
      outer.append(geometry(source, this.svg));
      inner.append(geometry(source, this.svg));
    }
    defs.append(mask, contextMask);
    outlines.append(outer, inner);
    this.layer.append(defs, context, outlines);
  }

  private visiblePaths(): SVGPathElement[] {
    const bounds = this.svg.getBoundingClientRect();
    return this.paths.filter(path => {
      const rect = path.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right
        && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
  }

  private updatePresence(): void {
    const selected = new Set([...(this.frame?.selectedRegionIds ?? [])].map(Math.abs));
    const shown = new Set(this.visiblePaths().map(path => Math.abs(Number(path.getAttribute(`data-${this.frame?.mapping}-id`)))));
    this.layer.querySelector('.projection-selection__context')?.setAttribute('visibility', shown.size ? 'visible' : 'hidden');
    this.status.hidden = selected.size === 0 || shown.size === selected.size;
    const isStatic = this.frame?.axis === 'top' || this.frame?.axis === 'swanson';
    this.status.textContent = shown.size === 0
      ? selected.size === 1
        ? isStatic ? 'Selected region not represented in this map' : 'Selected region not on this slice'
        : isStatic ? 'Selected regions not represented in this map' : 'Selected regions not on this slice'
      : `${shown.size} of ${selected.size} selected regions shown`;
  }

  private locatorPath(regionId: number): SVGPathElement | undefined {
    const candidates = this.visiblePaths().filter(path => Math.abs(Number(path.getAttribute(`data-${this.frame?.mapping}-id`))) === regionId);
    // Prefer the feature hemisphere, then the largest fragment in that hemisphere.
    const left = candidates.filter(path => Number(path.getAttribute(`data-${this.frame?.mapping}-id`)) < 0);
    return (left.length ? left : candidates).sort((a, b) => {
      const aa = a.getBoundingClientRect(); const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    })[0];
  }

  private showLocator(regionId: number, force: boolean): void {
    const path = this.locatorPath(regionId);
    if (!path) return;
    const rect = path.getBoundingClientRect();
    if (!force && Math.max(rect.width, rect.height) >= TINY_REGION_PIXELS) return;
    this.clearLocator();
    this.locatorRegion = regionId;
    this.drawLocator(regionId);
    // A static, temporary annotation also works with reduced motion enabled.
    this.locatorTimer = setTimeout(() => this.clearLocator(), 5000);
  }

  private drawLocator(regionId: number): void {
    const source = this.locatorPath(regionId);
    const matrix = this.svg.getScreenCTM();
    if (!source || !matrix || !matrix.a || !matrix.d) return;
    const bounds = this.svg.getBoundingClientRect();
    const rect = source.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - bounds.left;
    const cy = rect.top + rect.height / 2 - bounds.top;
    const transform = matrix.inverse().translate(bounds.left, bounds.top);
    this.locator.setAttribute('transform', `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`);
    this.locator.replaceChildren();
    const ring = svgElement('circle');
    ring.classList.add('projection-selection__locator-ring');
    ring.setAttribute('cx', String(cx)); ring.setAttribute('cy', String(cy));
    const radius = Math.max(9, Math.hypot(rect.width, rect.height) / 2 + 5);
    ring.setAttribute('r', String(radius));
    const label = svgElement('text');
    label.classList.add('projection-selection__locator-label');
    label.setAttribute('x', String(Math.max(8, Math.min(bounds.width - 8, cx))));
    label.setAttribute('y', String(Math.max(14, cy - radius - 5)));
    label.textContent = this.frame?.regionLabels?.get(-regionId) ?? this.frame?.regionLabels?.get(regionId) ?? String(regionId);
    this.locator.append(ring, label);
    const halfLabel = label.getComputedTextLength() / 2 + 4;
    label.setAttribute('x', String(Math.max(halfLabel, Math.min(bounds.width - halfLabel, cx))));
  }

  private clearLocator(): void {
    if (this.locatorTimer !== null) clearTimeout(this.locatorTimer);
    this.locatorTimer = null;
    this.locatorRegion = null;
    this.locator.replaceChildren();
  }
}
