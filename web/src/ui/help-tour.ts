import regionalTourHtml from '../../content/help/tour-regional.md';
import volumeTourHtml from '../../content/help/tour-volume.md';
import type { RepresentationKind } from '../domain/types.js';

export type HelpTourAnchor = 'context' | 'navigation' | 'regions' | 'values' | 'actions';

interface HelpTourStep {
  readonly id: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly anchor: HelpTourAnchor;
}

interface HelpTourOptions {
  readonly root: HTMLElement;
  readonly resolveTarget: (anchor: HelpTourAnchor) => HTMLElement | null;
}

const EXPLICIT_HEADING_ID = /\s*\{#([a-z][a-z0-9-]*)\}\s*$/;
const REGIONAL_STEP_ANCHORS: readonly HelpTourAnchor[] = ['context', 'navigation', 'regions', 'values', 'actions'];
const VOLUME_STEP_ANCHORS: readonly HelpTourAnchor[] = ['context', 'navigation', 'navigation', 'values', 'actions'];

function parseSteps(html: string, anchors: readonly HelpTourAnchor[]): readonly HelpTourStep[] {
  const source = document.createElement('div');
  source.innerHTML = html;
  const headings = [...source.querySelectorAll<HTMLHeadingElement>('h2')];
  if (headings.length !== anchors.length) {
    throw new Error(`Help tour must contain exactly ${anchors.length} level-two headings`);
  }

  return headings.map((heading, index) => {
    const rawTitle = heading.textContent ?? '';
    const match = EXPLICIT_HEADING_ID.exec(rawTitle);
    if (!match?.[1]) throw new Error(`Help tour heading is missing an explicit ID: ${rawTitle}`);
    const body = document.createElement('div');
    let node = heading.nextSibling;
    while (node && !(node instanceof HTMLHeadingElement && node.tagName === 'H2')) {
      const next = node.nextSibling;
      body.append(node);
      node = next;
    }
    return {
      id: match[1],
      title: rawTitle.replace(EXPLICIT_HEADING_ID, ''),
      bodyHtml: body.innerHTML,
      anchor: anchors[index]!,
    };
  });
}

const STEPS: Readonly<Record<RepresentationKind, readonly HelpTourStep[]>> = {
  regional: parseSteps(regionalTourHtml, REGIONAL_STEP_ANCHORS),
  volume: parseSteps(volumeTourHtml, VOLUME_STEP_ANCHORS),
};

export class HelpTour {
  private readonly overlay: HTMLElement;
  private readonly spotlight: HTMLElement;
  private readonly card: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private representation: RepresentationKind = 'regional';
  private stepIndex = 0;
  private target: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private resizeFrame: number | null = null;

  constructor(private readonly options: HelpTourOptions) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'help-tour';
    this.overlay.hidden = true;

    this.spotlight = document.createElement('div');
    this.spotlight.className = 'help-tour__spotlight';
    this.spotlight.setAttribute('aria-hidden', 'true');

    this.card = document.createElement('section');
    this.card.className = 'help-tour__card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'false');
    this.card.setAttribute('aria-labelledby', 'help-tour-title');
    this.card.setAttribute('aria-describedby', 'help-tour-body');

    const top = document.createElement('div');
    top.className = 'help-tour__top';
    this.progress = document.createElement('span');
    this.progress.className = 'help-tour__progress';
    this.progress.setAttribute('aria-live', 'polite');
    const skip = document.createElement('button');
    skip.className = 'help-tour__skip';
    skip.type = 'button';
    skip.textContent = 'Skip tour';
    skip.addEventListener('click', () => this.stop());
    top.append(this.progress, skip);

    this.title = document.createElement('h2');
    this.title.id = 'help-tour-title';
    this.body = document.createElement('div');
    this.body.id = 'help-tour-body';
    this.body.className = 'help-tour__body';

    const controls = document.createElement('div');
    controls.className = 'help-tour__controls';
    this.backButton = document.createElement('button');
    this.backButton.type = 'button';
    this.backButton.textContent = 'Back';
    this.backButton.addEventListener('click', () => this.move(-1));
    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'help-tour__next';
    this.nextButton.addEventListener('click', () => this.move(1));
    controls.append(this.backButton, this.nextButton);
    this.card.append(top, this.title, this.body, controls);
    this.overlay.append(this.spotlight, this.card);
    this.options.root.append(this.overlay);
  }

  get active(): boolean {
    return !this.overlay.hidden;
  }

  start(representation: RepresentationKind, returnFocus: HTMLElement | null): void {
    this.representation = representation;
    this.stepIndex = 0;
    this.returnFocus = returnFocus;
    this.overlay.hidden = false;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('resize', this.onResize);
    this.renderStep();
    this.nextButton.focus();
  }

  stop(restoreFocus = true): void {
    if (!this.active) return;
    this.clearTarget();
    this.overlay.hidden = true;
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('resize', this.onResize);
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }

  destroy(): void {
    this.stop(false);
    this.overlay.remove();
  }

  private move(delta: number): void {
    const steps = STEPS[this.representation];
    const next = this.stepIndex + delta;
    if (next >= steps.length) {
      this.stop();
      return;
    }
    this.stepIndex = Math.max(0, next);
    this.renderStep();
    this.nextButton.focus();
  }

  private renderStep(): void {
    const steps = STEPS[this.representation];
    const step = steps[this.stepIndex]!;
    this.clearTarget();
    this.target = this.options.resolveTarget(step.anchor);
    this.target?.setAttribute('data-help-highlighted', 'true');
    this.progress.textContent = `Step ${this.stepIndex + 1} of ${steps.length}`;
    this.title.textContent = step.title;
    this.body.innerHTML = step.bodyHtml;
    this.backButton.disabled = this.stepIndex === 0;
    this.nextButton.textContent = this.stepIndex === steps.length - 1 ? 'Done' : 'Next';
    this.card.dataset.step = step.id;
    this.position();
  }

  private clearTarget(): void {
    this.target?.removeAttribute('data-help-highlighted');
    this.target = null;
  }

  private position(): void {
    const padding = 12;
    const gap = 12;
    const targetBounds = this.target?.getBoundingClientRect();
    const fallback = new DOMRect(window.innerWidth / 2 - 1, window.innerHeight / 2 - 1, 2, 2);
    const bounds = targetBounds && targetBounds.width > 0 && targetBounds.height > 0 ? targetBounds : fallback;
    const spotlightPadding = 5;
    this.spotlight.style.left = `${Math.max(0, bounds.left - spotlightPadding)}px`;
    this.spotlight.style.top = `${Math.max(0, bounds.top - spotlightPadding)}px`;
    this.spotlight.style.width = `${Math.min(window.innerWidth, bounds.width + spotlightPadding * 2)}px`;
    this.spotlight.style.height = `${Math.min(window.innerHeight, bounds.height + spotlightPadding * 2)}px`;

    this.card.style.left = `${padding}px`;
    this.card.style.top = `${padding}px`;
    const cardBounds = this.card.getBoundingClientRect();
    const maxX = Math.max(padding, window.innerWidth - cardBounds.width - padding);
    const maxY = Math.max(padding, window.innerHeight - cardBounds.height - padding);
    let x = bounds.left;
    let y = bounds.bottom + gap;
    if (y + cardBounds.height > window.innerHeight - padding) y = bounds.top - cardBounds.height - gap;
    if (y < padding) {
      const right = bounds.right + gap;
      const left = bounds.left - cardBounds.width - gap;
      x = right + cardBounds.width <= window.innerWidth - padding ? right : left;
      y = bounds.top;
    }
    x = Math.min(maxX, Math.max(padding, x));
    y = Math.min(maxY, Math.max(padding, y));
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
  }

  private readonly onResize = (): void => {
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.position();
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.stop();
  };
}
