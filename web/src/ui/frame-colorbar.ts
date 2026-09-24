import { scalarColorGradient } from '../application/scalar-colormap.js';
import { formatScalar, type ColorRangeControlModel } from './color-range-control.js';

/** Read-only vertical colorbar overlaid on a view frame; CSS shows it only when the frame is maximized. */
export class FrameColorbar {
  readonly element = document.createElement('figure');

  private readonly bar = document.createElement('div');
  private readonly maxLabel = document.createElement('span');
  private readonly minLabel = document.createElement('span');
  private readonly unit = document.createElement('figcaption');

  constructor() {
    this.element.className = 'frame-colorbar';
    this.element.setAttribute('aria-label', 'Colorbar');
    this.bar.className = 'frame-colorbar__bar';
    this.maxLabel.className = 'frame-colorbar__maximum';
    this.minLabel.className = 'frame-colorbar__minimum';
    this.unit.className = 'frame-colorbar__unit';
    this.element.append(this.unit, this.maxLabel, this.bar, this.minLabel);
    this.element.hidden = true;
  }

  /** Mirror the settings legend model; `null` or disabled feature colors hide the bar. */
  render(model: ColorRangeControlModel | null): void {
    this.element.hidden = !model?.enabled;
    if (!model?.enabled) return;
    const { colormap, effectiveRange, axisScale, divergingCenter } = model;
    this.bar.style.background = scalarColorGradient(colormap, effectiveRange, axisScale, divergingCenter, 9, '0deg');
    this.maxLabel.textContent = formatScalar(effectiveRange[1]);
    this.minLabel.textContent = formatScalar(effectiveRange[0]);
    this.unit.textContent = model.unit ?? '';
    this.unit.hidden = !model.unit;
  }
}
