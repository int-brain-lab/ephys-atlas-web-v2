import aboutHtml from '../../content/help/about.md';
import conceptsHtml from '../../content/help/concepts.md';
import gettingStartedHtml from '../../content/help/getting-started.md';
import moreGuidanceHtml from '../../content/help/more-guidance.md';
import regionalHtml from '../../content/help/regional.md';
import shortcutsHtml from '../../content/help/shortcuts.md';
import volumeHtml from '../../content/help/volume.md';
import type { RepresentationKind } from '../domain/types.js';

const EXPLICIT_HEADING_ID = /\s*\{#([a-z][a-z0-9-]*)\}\s*$/;

function renderMarkdown(html: string): HTMLElement {
  const content = document.createElement('div');
  content.className = 'help-guide__markdown';
  content.innerHTML = html;

  for (const heading of content.querySelectorAll<HTMLHeadingElement>('h2, h3, h4, h5, h6')) {
    const text = heading.textContent ?? '';
    const match = EXPLICIT_HEADING_ID.exec(text);
    if (!match?.[1]) continue;
    heading.textContent = text.replace(EXPLICIT_HEADING_ID, '');
    heading.id = `help-${match[1]}`;
  }

  for (const link of content.querySelectorAll<HTMLAnchorElement>('a')) {
    const url = new URL(link.href, window.location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported Help link protocol: ${url.protocol}`);
    }
    if (url.origin !== window.location.origin) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${link.textContent ?? 'External link'} (opens in a new tab)`);
    }
  }
  return content;
}

function details(label: string, html: string, className?: string): HTMLDetailsElement {
  const disclosure = document.createElement('details');
  disclosure.className = ['help-guide__disclosure', className].filter(Boolean).join(' ');
  const summary = document.createElement('summary');
  summary.textContent = label;
  disclosure.append(summary, renderMarkdown(html));
  return disclosure;
}

export class HelpGuide {
  readonly dialog: HTMLDialogElement;
  private readonly representationDetails: HTMLDetailsElement;
  private representationContent: HTMLElement;
  private representation: RepresentationKind | null = null;

  constructor(onStartTour: () => void) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'info-dialog help-dialog';
    this.dialog.setAttribute('aria-labelledby', 'help-dialog-title');

    const header = document.createElement('header');
    header.className = 'info-dialog__header';
    const title = document.createElement('h2');
    title.id = 'help-dialog-title';
    title.textContent = 'Help & getting started';
    const close = document.createElement('button');
    close.className = 'info-dialog__close';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.dialog.close());
    header.append(title, close);

    const content = document.createElement('div');
    content.className = 'info-dialog__content help-guide__content';
    const gettingStarted = document.createElement('section');
    gettingStarted.className = 'help-guide__getting-started';
    gettingStarted.append(renderMarkdown(gettingStartedHtml));

    const tourAction = document.createElement('div');
    tourAction.className = 'help-guide__tour-action';
    const tourCopy = document.createElement('div');
    const tourTitle = document.createElement('strong');
    tourTitle.textContent = 'New to the atlas?';
    const tourDescription = document.createElement('span');
    tourDescription.textContent = 'Follow five short steps on the real interface.';
    tourCopy.append(tourTitle, tourDescription);
    const tourButton = document.createElement('button');
    tourButton.type = 'button';
    tourButton.textContent = 'Show me the essentials';
    tourButton.addEventListener('click', onStartTour);
    tourAction.append(tourCopy, tourButton);
    gettingStarted.append(tourAction);

    this.representationDetails = details('Using regional data', regionalHtml, 'help-guide__current-mode');
    this.representationContent = this.representationDetails.querySelector('.help-guide__markdown')!;

    const reference = document.createElement('div');
    reference.className = 'help-guide__reference';
    reference.append(
      this.representationDetails,
      details('Concepts and terminology', conceptsHtml),
      details('Keyboard shortcuts', shortcutsHtml),
      details('More guidance', moreGuidanceHtml),
      details('About and credits', aboutHtml),
    );
    content.append(gettingStarted, reference);
    this.dialog.append(header, content);
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }

  render(representation: RepresentationKind): void {
    if (representation === this.representation) return;
    this.representation = representation;
    const regional = representation === 'regional';
    this.representationDetails.querySelector('summary')!.textContent = regional
      ? 'Using regional data'
      : 'Using volume data';
    this.representationContent.replaceWith(renderMarkdown(regional ? regionalHtml : volumeHtml));
    this.representationContent = this.representationDetails.querySelector('.help-guide__markdown')!;
  }
}
