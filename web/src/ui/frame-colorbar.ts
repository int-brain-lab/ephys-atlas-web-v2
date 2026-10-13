import { scalarColorNormalize, scalarColorValueAtNormalized, scalarPaletteGradient } from '../application/scalar-colormap.js';
import { colorMappingLabel, formatScalar, type ColorRangeControlModel } from './color-range-control.js';
import { paletteCssColor } from '../application/colormap-palettes.js';

/** Read-only vertical colorbar overlaid on a view frame; CSS shows it only when the frame is maximized. */
export class FrameColorbar {
  readonly element = document.createElement('figure');

  private readonly bar = document.createElement('div');
  private readonly maxLabel = document.createElement('span');
  private readonly minLabel = document.createElement('span');
  private readonly middleLabel = document.createElement('span');
  private readonly unit = document.createElement('figcaption');
  private model: ColorRangeControlModel | null = null;

  constructor() {
    this.element.className = 'frame-colorbar';
    this.element.setAttribute('aria-label', 'Colorbar');
    this.bar.className = 'frame-colorbar__bar';
    this.maxLabel.className = 'frame-colorbar__maximum';
    this.minLabel.className = 'frame-colorbar__minimum';
    this.middleLabel.className = 'frame-colorbar__middle';
    this.unit.className = 'frame-colorbar__unit';
    this.bar.append(this.middleLabel);
    this.element.append(this.unit, this.maxLabel, this.bar, this.minLabel);
    this.element.hidden = true;
  }

  /** Mirror the settings legend model; `null` or disabled feature colors hide the bar. */
  render(model: ColorRangeControlModel | null): void {
    this.model = model?.enabled ? model : null;
    this.element.hidden = !model?.enabled;
    if (!model?.enabled) return;
    const { colormap, effectiveRange, axisScale, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles } = model;
    this.bar.style.background = scalarPaletteGradient(
      colormap, effectiveRange, axisScale, divergingCenter, colorMapping, pseudoLogStrength, '0deg', colorQuantiles,
    );
    const lower = scalarColorNormalize(effectiveRange[0], effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles);
    const upper = scalarColorNormalize(effectiveRange[1], effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles);
    const middle = lower === null || upper === null ? null : scalarColorValueAtNormalized(
      (lower + upper) / 2, effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles,
    );
    this.middleLabel.textContent = middle === null ? '' : formatScalar(middle);
    this.maxLabel.textContent = formatScalar(effectiveRange[1]);
    this.minLabel.textContent = formatScalar(effectiveRange[0]);
    this.unit.textContent = `${model.unit ?? ''}${colorMapping === 'match' ? '' : `${model.unit ? ' · ' : ''}${colorMapping === 'pseudolog' ? 'Pseudo-log' : colorMappingLabel(colorMapping, pseudoLogStrength)}`}`;
    this.unit.hidden = !this.unit.textContent;
  }

  /** Self-contained vector legend using the same palette interval as the UI. */
  exportSvg(): SVGSVGElement | undefined {
    const model = this.model;
    if (!model) return undefined;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 600 100');
    svg.setAttribute('data-export-colorbar', 'true');
    const gradient = document.createElementNS(ns, 'linearGradient');
    gradient.id = 'export-colorbar-gradient';
    const { colormap, effectiveRange, axisScale, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles } = model;
    const first = scalarColorNormalize(effectiveRange[0], effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles) ?? 0;
    const last = scalarColorNormalize(effectiveRange[1], effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles) ?? 1;
    for (let index = 0; index <= 64; index += 1) {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', String(index / 64));
      stop.setAttribute('stop-color', paletteCssColor(colormap, first + (last - first) * index / 64));
      gradient.append(stop);
    }
    const defs = document.createElementNS(ns, 'defs');
    defs.append(gradient);
    const bar = document.createElementNS(ns, 'rect');
    bar.setAttribute('x', '40');
    bar.setAttribute('y', '34');
    bar.setAttribute('width', '520');
    bar.setAttribute('height', '20');
    bar.setAttribute('fill', 'url(#export-colorbar-gradient)');
    const text = (content: string, x: number, y: number, anchor: string) => {
      const label = document.createElementNS(ns, 'text');
      label.textContent = content;
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', anchor);
      label.setAttribute('font-family', 'sans-serif');
      label.setAttribute('font-size', '14');
      label.setAttribute('fill', '#475569');
      return label;
    };
    const middle = scalarColorValueAtNormalized((first + last) / 2, effectiveRange, axisScale, colormap, divergingCenter, colorMapping, pseudoLogStrength, colorQuantiles);
    svg.append(defs, bar, text(this.unit.textContent ?? '', 300, 20, 'middle'),
      text(formatScalar(effectiveRange[0]), 40, 76, 'start'),
      text(middle === null ? '' : formatScalar(middle), 300, 76, 'middle'),
      text(formatScalar(effectiveRange[1]), 560, 76, 'end'));
    return svg;
  }
}
