import type { DistributionBinning, FeaturePayload } from '../data/contracts.js';
import type { ColorRange, StatisticId } from '../domain/types.js';
import type { ScaleSpec } from '../domain/scale-spec.js';
import { scalarColorGradient } from '../application/scalar-colormap.js';
import {
  clampRangeHandle,
  colorRangeDomain,
  placeRangeLabels,
  rangePosition,
  rangeValueAtPosition,
  rangeSliderStep,
  translateRangeWindowByPosition,
  type NumericRange,
} from './color-range.js';

export interface ColorRangeControlModel {
  feature: FeaturePayload;
  statistic: StatisticId;
  effectiveRange: NumericRange;
  mode: ColorRange['mode'];
  colormap: string;
  divergingCenter?: number;
  unit: string | null;
  context: string;
  enabled: boolean;
  axisScale: ScaleSpec;
  histogram: DistributionBinning | undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function formatScalar(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 100_000 || magnitude < 0.001)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, {
    minimumSignificantDigits: 3,
    maximumSignificantDigits: 3,
  }).format(value);
}

export class ColorRangeControl {
  readonly element = element('figure', 'color-legend');

  private readonly context = element('div', 'color-legend__context');
  private readonly tailSummary = element('div', 'color-legend__tails');
  private readonly reset = element('button', 'color-legend__reset');
  private readonly bar = element('div', 'color-legend__bar');
  private readonly histogram = element('div', 'color-range__histogram');
  private readonly minSlider = this.createSlider('min', 'Minimum color value');
  private readonly maxSlider = this.createSlider('max', 'Maximum color value');
  private readonly minLabel = this.createValueLabel('min');
  private readonly maxLabel = this.createValueLabel('max');
  private readonly valueLabels = element('div', 'color-range__active-labels');
  private readonly domainMinLabel = element('span', 'color-legend__domain-minimum');
  private readonly domainMaxLabel = element('span', 'color-legend__domain-maximum');
  private readonly unit = element('span', 'color-legend__unit');
  private readonly exactEditor = element('form', 'color-range__exact');
  private readonly exactTitle = element('label', 'color-range__exact-label');
  private readonly exactInput = element('input', 'color-range__exact-input');

  private exactBound: 'min' | 'max' = 'min';
  private dragMode: 'min' | 'max' | 'window' | null = null;
  private dragOriginPosition = 0;
  private dragOriginRange: NumericRange | null = null;
  private commitFrame: number | null = null;
  private histogramSignature = '';
  private domain: NumericRange | null = null;
  private range: NumericRange | null = null;
  private axisScale: ScaleSpec = { kind: 'linear' };
  private readonly labelResizeObserver = new ResizeObserver(() => this.positionValueLabels());

  constructor(
    private readonly setRange: (range: ColorRange) => void,
    private readonly resetColormap: () => void,
  ) {
    this.element.setAttribute('aria-label', 'Feature color legend');
    const header = element('div', 'color-legend__header');
    this.reset.type = 'button';
    this.reset.textContent = 'Reset';
    this.reset.addEventListener('click', this.setAutomaticRange);
    header.append(this.context, this.tailSummary, this.reset);

    this.histogram.setAttribute('aria-hidden', 'true');
    const selectedRange = element('span', 'color-range__selection');
    const minHandle = element('span', 'color-range__handle color-range__handle--min');
    const maxHandle = element('span', 'color-range__handle color-range__handle--max');
    this.bar.addEventListener('pointerdown', this.startDrag);
    this.bar.addEventListener('pointermove', this.moveDrag);
    this.bar.addEventListener('pointerup', this.endDrag);
    this.bar.addEventListener('pointercancel', this.endDrag);
    this.bar.append(this.histogram, selectedRange, this.minSlider, this.maxSlider, minHandle, maxHandle);

    this.valueLabels.append(this.minLabel, this.maxLabel);
    this.labelResizeObserver.observe(this.valueLabels);
    const labels = element('figcaption', 'color-legend__labels');
    labels.append(this.domainMinLabel, this.unit, this.domainMaxLabel);

    this.exactEditor.hidden = true;
    this.exactEditor.addEventListener('submit', this.submitExactRange);
    this.exactInput.type = 'number';
    this.exactInput.step = 'any';
    this.exactInput.addEventListener('keydown', this.onExactKeyDown);
    this.exactTitle.append('Minimum ', this.exactInput);
    const apply = element('button', 'color-range__exact-apply');
    apply.type = 'submit';
    apply.textContent = 'Apply';
    const cancel = element('button', 'color-range__exact-cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', this.closeExactEditor);
    this.exactEditor.append(this.exactTitle, apply, cancel);

    this.element.append(header, this.valueLabels, this.bar, labels, this.exactEditor);
  }

  render(model: ColorRangeControlModel): void {
    this.axisScale = model.axisScale;
    this.domain = colorRangeDomain(model.feature, model.statistic, model.effectiveRange, model.histogram);
    this.range = model.effectiveRange;
    const interactive = model.enabled && this.domain !== null;
    const rangeInsideViewport = this.domain !== null
      && model.effectiveRange[0] >= this.domain[0]
      && model.effectiveRange[1] <= this.domain[1];
    this.minSlider.disabled = !interactive || !rangeInsideViewport;
    this.maxSlider.disabled = !interactive || !rangeInsideViewport;
    this.minLabel.disabled = !interactive;
    this.maxLabel.disabled = !interactive;
    this.reset.hidden = model.mode !== 'fixed';
    this.element.hidden = !interactive;
    if (!interactive || !this.domain) {
      this.cancelPendingCommit();
      this.exactEditor.hidden = true;
      return;
    }

    for (const slider of [this.minSlider, this.maxSlider]) {
      slider.min = String(this.domain[0]);
      slider.max = String(this.domain[1]);
    }
    this.syncSliderValues();
    this.updatePresentation();
    this.renderHistogram(model.feature, model.statistic, model.histogram);
    this.bar.dataset.axisScale = this.axisScale.kind;
    this.bar.dataset.distributionDomain = model.histogram?.domain.kind ?? 'none';
    this.bar.dataset.rangeEditable = String(rangeInsideViewport);
    this.bar.title = rangeInsideViewport
      ? ''
      : 'A color bound is outside this viewport. Choose Full or enter an exact value to edit it.';
    this.context.textContent = model.context;
    const below = model.histogram?.global.underflowCount ?? 0;
    const above = model.histogram?.global.overflowCount ?? 0;
    this.tailSummary.hidden = model.histogram?.domain.kind !== 'focused' || (below === 0 && above === 0);
    this.tailSummary.textContent = this.tailSummary.hidden
      ? ''
      : `${below.toLocaleString()} below · ${above.toLocaleString()} above`;
    this.bar.dataset.colormap = model.colormap;
    this.bar.style.setProperty(
      '--color-range-gradient',
      scalarColorGradient(model.colormap, model.effectiveRange, model.axisScale, model.divergingCenter),
    );
    this.unit.textContent = model.unit ?? '';
  }

  commitCurrentRange(): void {
    this.cancelPendingCommit();
    this.commitFixedRange();
  }

  hide(): void {
    this.cancelPendingCommit();
    this.exactEditor.hidden = true;
    this.element.hidden = true;
  }

  readonly setAutomaticRange = (): void => {
    this.cancelPendingCommit();
    this.setRange({ mode: 'auto' });
    this.resetColormap();
  };

  destroy(): void {
    this.cancelPendingCommit();
    this.labelResizeObserver.disconnect();
  }

  private createSlider(bound: 'min' | 'max', label: string): HTMLInputElement {
    const input = element('input', `color-range__slider color-range__slider--${bound}`);
    input.type = 'range';
    input.step = 'any';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => this.commitSliderRange(bound));
    input.addEventListener('keydown', (event) => this.onSliderKeyDown(event, bound));
    return input;
  }

  private createValueLabel(bound: 'min' | 'max'): HTMLButtonElement {
    const button = element('button', `color-legend__${bound === 'min' ? 'minimum' : 'maximum'} color-range__value`);
    button.type = 'button';
    button.setAttribute('aria-label', `Enter exact ${bound}imum color value`);
    button.addEventListener('click', () => this.openExactEditor(bound));
    return button;
  }

  private commitFixedRange(): void {
    const [min, max] = this.range ?? [NaN, NaN];
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) this.setRange({ mode: 'fixed', min, max });
  }

  private commitSliderRange(bound: 'min' | 'max'): void {
    if (!this.domain || !this.range) return;
    const slider = bound === 'min' ? this.minSlider : this.maxSlider;
    const other = bound === 'min' ? this.range[1] : this.range[0];
    const value = clampRangeHandle(bound, slider.valueAsNumber, other, this.domain, undefined, this.axisScale);
    this.range = bound === 'min' ? [value, other] : [other, value];
    this.syncSliderValues();
    this.updatePresentation();
    this.scheduleCommit();
  }

  private onSliderKeyDown(event: KeyboardEvent, bound: 'min' | 'max'): void {
    if (!this.domain || !this.range || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const slider = bound === 'min' ? this.minSlider : this.maxSlider;
    const other = bound === 'min' ? this.range[1] : this.range[0];
    const increment = (event.shiftKey ? 10 : 1) / 1_000;
    const nextValue = rangeValueAtPosition(
      rangePosition(slider.valueAsNumber, this.domain, this.axisScale) + direction * increment,
      this.domain,
      this.axisScale,
    );
    slider.value = String(clampRangeHandle(
      bound,
      nextValue,
      other,
      this.domain,
      rangeSliderStep(this.domain),
      this.axisScale,
    ));
    const value = slider.valueAsNumber;
    this.range = bound === 'min' ? [value, other] : [other, value];
    this.syncSliderValues();
    this.updatePresentation();
    this.commitCurrentRange();
  }

  private readonly startDrag = (event: PointerEvent): void => {
    if (!this.domain || this.minSlider.disabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.classList.contains('color-range__handle--min')) this.dragMode = 'min';
    else if (target?.classList.contains('color-range__handle--max')) this.dragMode = 'max';
    else if (target?.classList.contains('color-range__selection')) {
      this.dragMode = 'window';
      this.dragOriginPosition = this.positionAtClientX(event.clientX);
      this.dragOriginRange = this.range;
      this.bar.dataset.dragging = 'window';
    } else {
      const value = this.valueAtClientX(event.clientX);
      const position = rangePosition(value, this.domain, this.axisScale);
      this.dragMode = Math.abs(position - rangePosition(this.minSlider.valueAsNumber, this.domain, this.axisScale))
        <= Math.abs(position - rangePosition(this.maxSlider.valueAsNumber, this.domain, this.axisScale)) ? 'min' : 'max';
    }
    this.bar.setPointerCapture(event.pointerId);
    if (this.dragMode !== 'window') this.updateFromPointer(event.clientX);
    event.preventDefault();
  };

  private readonly moveDrag = (event: PointerEvent): void => {
    if (!this.dragMode || !this.bar.hasPointerCapture(event.pointerId)) return;
    this.updateFromPointer(event.clientX);
  };

  private readonly endDrag = (event: PointerEvent): void => {
    if (this.bar.hasPointerCapture(event.pointerId)) this.bar.releasePointerCapture(event.pointerId);
    this.dragMode = null;
    this.dragOriginRange = null;
    delete this.bar.dataset.dragging;
  };

  private updateFromPointer(clientX: number): void {
    if (!this.domain || !this.range || !this.dragMode) return;
    if (this.dragMode === 'window') {
      if (!this.dragOriginRange) return;
      const translated = translateRangeWindowByPosition(
        this.dragOriginRange,
        this.positionAtClientX(clientX) - this.dragOriginPosition,
        this.domain,
        this.axisScale,
      );
      this.range = translated;
    } else {
      const slider = this.dragMode === 'min' ? this.minSlider : this.maxSlider;
      const other = this.dragMode === 'min' ? this.range[1] : this.range[0];
      const value = clampRangeHandle(
        this.dragMode,
        this.valueAtClientX(clientX),
        other,
        this.domain,
        rangeSliderStep(this.domain),
        this.axisScale,
      );
      this.range = this.dragMode === 'min' ? [value, other] : [other, value];
    }
    this.syncSliderValues();
    this.updatePresentation();
    this.scheduleCommit();
  }

  private valueAtClientX(clientX: number): number {
    if (!this.domain) return 0;
    return rangeValueAtPosition(this.positionAtClientX(clientX), this.domain, this.axisScale);
  }

  private positionAtClientX(clientX: number): number {
    const bounds = this.bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  }

  private openExactEditor(bound: 'min' | 'max'): void {
    this.exactBound = bound;
    const value = String(bound === 'min' ? this.range?.[0] ?? '' : this.range?.[1] ?? '');
    this.exactTitle.firstChild?.remove();
    this.exactTitle.prepend(`${bound === 'min' ? 'Minimum' : 'Maximum'} `);
    this.exactInput.setAttribute('aria-label', `Exact ${bound}imum color value`);
    this.exactInput.value = value;
    this.exactInput.setCustomValidity('');
    this.exactEditor.hidden = false;
    this.exactInput.focus();
    this.exactInput.select();
  }

  private readonly closeExactEditor = (): void => {
    this.exactEditor.hidden = true;
    (this.exactBound === 'min' ? this.minLabel : this.maxLabel).focus();
  };

  private readonly submitExactRange = (event: SubmitEvent): void => {
    event.preventDefault();
    const value = this.exactInput.valueAsNumber;
    const other = this.exactBound === 'min' ? this.range?.[1] : this.range?.[0];
    const valid = Number.isFinite(value) && other !== undefined
      && (this.exactBound === 'min' ? value < other : value > other);
    if (!valid) {
      this.exactInput.setCustomValidity(this.exactBound === 'min'
        ? 'Minimum must be smaller than maximum'
        : 'Maximum must be larger than minimum');
      this.exactInput.reportValidity();
      return;
    }
    const min = this.exactBound === 'min' ? value : other;
    const max = this.exactBound === 'max' ? value : other;
    this.cancelPendingCommit();
    this.setRange({ mode: 'fixed', min, max });
    this.closeExactEditor();
  };

  private readonly onExactKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.closeExactEditor();
  };

  private renderHistogram(_feature: FeaturePayload, statistic: StatisticId, histogram: DistributionBinning | undefined): void {
    const counts = statistic !== 'count' ? histogram?.global.binCounts ?? [] : [];
    const edges = statistic !== 'count' ? histogram?.edges ?? [] : [];
    const signature = JSON.stringify([this.domain, this.axisScale, counts, edges]);
    if (signature === this.histogramSignature) return;
    this.histogramSignature = signature;
    const max = Math.max(0, ...counts);
    this.histogram.replaceChildren(...counts.map((count, index) => {
      const bin = element('span', 'color-range__histogram-bin');
      bin.style.setProperty('--histogram-height', `${max > 0 ? count / max * 100 : 0}%`);
      if (this.domain) {
        bin.style.setProperty('--histogram-left', `${rangePosition(edges[index] ?? this.domain[0], this.domain, this.axisScale) * 100}%`);
        bin.style.setProperty('--histogram-right', `${(1 - rangePosition(edges[index + 1] ?? this.domain[1], this.domain, this.axisScale)) * 100}%`);
      }
      return bin;
    }));
    this.histogram.dataset.empty = String(counts.length === 0);
  }

  private updatePresentation(): void {
    if (!this.domain || !this.range) return;
    const [min, max] = this.range;
    this.bar.style.setProperty('--range-low', `${rangePosition(min, this.domain, this.axisScale) * 100}%`);
    this.bar.style.setProperty('--range-high', `${rangePosition(max, this.domain, this.axisScale) * 100}%`);
    this.minLabel.textContent = formatScalar(min);
    this.maxLabel.textContent = formatScalar(max);
    this.domainMinLabel.textContent = formatScalar(this.domain[0]);
    this.domainMaxLabel.textContent = formatScalar(this.domain[1]);
    const minimumPosition = min < this.domain[0] ? 'below' : min > this.domain[1] ? 'above' : 'inside';
    const maximumPosition = max < this.domain[0] ? 'below' : max > this.domain[1] ? 'above' : 'inside';
    this.bar.dataset.minimumPosition = minimumPosition;
    this.bar.dataset.maximumPosition = maximumPosition;
    this.element.querySelector<HTMLElement>('.color-range__handle--min')!.dataset.position = minimumPosition;
    this.element.querySelector<HTMLElement>('.color-range__handle--max')!.dataset.position = maximumPosition;
    this.positionValueLabels();
  }

  private positionValueLabels(): void {
    if (!this.domain || !this.range) return;
    const trackWidth = this.valueLabels.clientWidth;
    if (!(trackWidth > 0)) return;
    const placement = placeRangeLabels(
      trackWidth,
      [
        rangePosition(this.range[0], this.domain, this.axisScale) * trackWidth,
        rangePosition(this.range[1], this.domain, this.axisScale) * trackWidth,
      ],
      [this.minLabel.offsetWidth, this.maxLabel.offsetWidth],
    );
    this.minLabel.style.left = `${placement.min.left}px`;
    this.maxLabel.style.left = `${placement.max.left}px`;
    this.minLabel.dataset.side = placement.min.side;
    this.maxLabel.dataset.side = placement.max.side;
    this.valueLabels.dataset.stacked = String(placement.stacked);
  }

  private syncSliderValues(): void {
    if (!this.domain || !this.range) return;
    this.minSlider.value = String(Math.max(this.domain[0], Math.min(this.domain[1], this.range[0])));
    this.maxSlider.value = String(Math.max(this.domain[0], Math.min(this.domain[1], this.range[1])));
  }

  private scheduleCommit(): void {
    if (this.commitFrame !== null) return;
    this.commitFrame = requestAnimationFrame(() => {
      this.commitFrame = null;
      this.commitFixedRange();
    });
  }

  private cancelPendingCommit(): void {
    if (this.commitFrame !== null) cancelAnimationFrame(this.commitFrame);
    this.commitFrame = null;
  }
}
