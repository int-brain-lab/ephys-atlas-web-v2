export type OperationStatusState = 'loading' | 'error' | 'ready' | 'empty';
export type OperationStatusVariant = 'centered' | 'compact' | 'inline';

export interface OperationStatusUpdate {
  readonly state: OperationStatusState;
  readonly title: string;
  readonly detail?: string;
  readonly retry?: () => void;
}

/** A small, persistent status view for asynchronous UI operations. */
export class OperationStatus {
  readonly element: HTMLElement;

  private readonly spinner: HTMLSpanElement;
  private readonly announcement: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLParagraphElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly externalAnnouncement: HTMLElement | undefined;
  private retryAction: (() => void) | undefined;

  constructor(variant: OperationStatusVariant, announcementHost?: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'operation-status';
    root.dataset.variant = variant;
    root.dataset.state = 'ready';
    root.hidden = true;

    this.spinner = document.createElement('span');
    this.spinner.className = 'operation-status__spinner';
    this.spinner.setAttribute('aria-hidden', 'true');

    this.announcement = document.createElement('div');
    this.announcement.className = 'operation-status__announcement';
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-atomic', 'true');
    this.announcement.tabIndex = -1;
    // Busy view contents may defer descendant live regions. Keep their
    // announcements outside that subtree while preserving visible status text.
    if (announcementHost) {
      this.announcement.removeAttribute('role');
      this.announcement.removeAttribute('aria-atomic');
      this.externalAnnouncement = document.createElement('div');
      this.externalAnnouncement.className = 'operation-status__live';
      this.externalAnnouncement.setAttribute('role', 'status');
      this.externalAnnouncement.setAttribute('aria-atomic', 'true');
      announcementHost.append(this.externalAnnouncement);
    }

    this.title = document.createElement('strong');
    this.title.className = 'operation-status__title';

    this.detail = document.createElement('p');
    this.detail.className = 'operation-status__detail';
    this.detail.hidden = true;

    this.announcement.append(this.title, this.detail);

    this.retryButton = document.createElement('button');
    this.retryButton.className = 'operation-status__retry';
    this.retryButton.type = 'button';
    this.retryButton.textContent = 'Retry';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () => {
      const retry = this.retryAction;
      if (!retry) return;
      this.retryButton.hidden = true;
      this.announcement.focus({ preventScroll: true });
      retry();
    });

    root.append(this.spinner, this.announcement, this.retryButton);
    this.element = root;
  }

  update(update: OperationStatusUpdate): void {
    this.element.dataset.state = update.state;
    this.element.hidden = update.state === 'ready';

    if (this.title.textContent !== update.title) this.title.textContent = update.title;

    const detail = update.detail ?? '';
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    this.detail.hidden = detail.length === 0;

    if (this.externalAnnouncement) {
      const text = update.state === 'ready' ? '' : [update.title, detail].filter(Boolean).join(' ');
      if (this.externalAnnouncement.textContent !== text) this.externalAnnouncement.textContent = text;
    }
    this.retryAction = update.retry;
    this.retryButton.hidden = update.state !== 'error' || update.retry === undefined;
  }
}
