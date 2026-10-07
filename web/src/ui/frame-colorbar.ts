import { scalarColorNormalize, scalarColorValueAtNormalized, scalarPaletteGradient } from '../application/scalar-colormap.js';
import { colorMappingLabel, formatScalar, type ColorRangeControlModel } from './color-range-control.js';

/** Read-only vertical colorbar overlaid on a view frame; CSS shows it only when the frame is maximized. */
export class FrameColorbar {
  readonly element = document.createElement('figure');

  private readonly bar = document.createElement('div');
  private readonly maxLabel = document.createElement('span');
  private readonly minLabel = document.createElement('span');
  private readonly middleLabel = document.createElement('span');
  private readonly unit = document.createElement('figcaption');

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
}
