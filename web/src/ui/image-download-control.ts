import { element } from './dom-helpers.js';
import { trackOnce } from '../analytics.js';

export interface ImageDownloadRequest {
  filename: string;
  vector: boolean;
  defaultFormat: 'svg' | 'png';
  hasColorbar: boolean;
  exportImage(format: 'svg' | 'png', includeColorbar: boolean): Promise<Blob>;
}

/** One-click image download with a small, nonmodal options menu. */
export class ImageDownloadControl {
  readonly element = element('span', 'image-download');
  readonly button = element('button', 'view-frame__download');
  private readonly toggle = element('button', 'image-download__toggle');
  private readonly options = element('div', 'image-download__options');
  private readonly colorbar = element('input');
  private readonly svgButton = element('button', 'image-download__format');
  private readonly pngButton = element('button', 'image-download__format');
  private readonly status = element('p', 'image-download__status');
  private generation = 0;
  private busy = false;

  constructor(private readonly view: string, private readonly request: () => ImageDownloadRequest | null) {
    this.button.type = this.toggle.type = this.svgButton.type = this.pngButton.type = 'button';
    this.button.setAttribute('aria-label', `Download ${view} image`);
    this.button.title = `Download ${view} image`;
    this.button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>';
    this.toggle.textContent = '▾';
    this.toggle.setAttribute('aria-label', `Image download options for ${view}`);
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-controls', `image-download-options-${view}`);
    this.toggle.title = 'Image download options';
    this.options.id = `image-download-options-${view}`;
    this.options.setAttribute('role', 'group');
    this.options.setAttribute('aria-label', `Image download options for ${view}`);
    this.options.hidden = true;
    const caption = element('p', 'image-download__caption');
    caption.textContent = 'Transparent · no crosshair';
    const label = element('label', 'image-download__colorbar');
    this.colorbar.type = 'checkbox';
    label.append(this.colorbar, ' Include colorbar');
    this.svgButton.textContent = 'Download SVG';
    const svgHint = element('small');
    svgHint.textContent = 'Editable regions; embedded volume';
    svgHint.id = `image-download-svg-hint-${view}`;
    this.svgButton.append(svgHint);
    this.pngButton.textContent = 'Download PNG';
    const pngHint = element('small');
    pngHint.textContent = 'Bitmap · 2400-pixel longest edge';
    pngHint.id = `image-download-png-hint-${view}`;
    this.pngButton.append(pngHint);
    // Keep the action names brief for assistive technology, too.
    this.svgButton.setAttribute('aria-label', 'Download SVG');
    this.pngButton.setAttribute('aria-label', 'Download PNG');
    this.svgButton.setAttribute('aria-describedby', svgHint.id);
    this.pngButton.setAttribute('aria-describedby', pngHint.id);
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.options.append(caption, label, this.svgButton, this.pngButton, this.status);
    this.element.append(this.button, this.toggle);
    document.body.append(this.options);
    this.button.addEventListener('click', () => { void this.download(); });
    this.toggle.addEventListener('click', () => this.options.hidden ? this.open() : this.close());
    this.svgButton.addEventListener('click', () => { void this.download('svg'); });
    this.pngButton.addEventListener('click', () => { void this.download('png'); });
    document.addEventListener('pointerdown', this.onOutsidePointer);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  setTitle(label: string, format: 'svg' | 'png'): void {
    this.button.title = `Download ${label} image as ${format.toUpperCase()}`;
    this.button.setAttribute('aria-description', `Downloads ${format.toUpperCase()}`);
  }

  close(): void {
    this.options.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
  }

  destroy(): void {
    this.generation += 1;
    this.close();
    this.options.remove();
    document.removeEventListener('pointerdown', this.onOutsidePointer);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
  }

  private open(): void {
    const request = this.request();
    this.svgButton.hidden = request?.vector === false;
    this.colorbar.disabled = !request?.hasColorbar;
    this.options.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    const bounds = this.element.getBoundingClientRect();
    const width = this.options.offsetWidth;
    const height = this.options.offsetHeight;
    this.options.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    this.options.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - height - 8))}px`;
  }

  private async download(format?: 'svg' | 'png'): Promise<void> {
    if (this.busy) return;
    const request = this.request();
    if (!request) return;
    const selectedFormat = format ?? request.defaultFormat;
    const generation = ++this.generation;
    this.busy = true;
    this.button.disabled = this.toggle.disabled = true;
    this.button.setAttribute('aria-busy', 'true');
    this.status.hidden = true;
    this.close();
    try {
      if (selectedFormat === 'svg' && !request.vector) throw new Error('Use PNG for this view.');
      const blob = await request.exportImage(selectedFormat, request.hasColorbar && this.colorbar.checked);
      if (generation !== this.generation) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${request.filename}.${selectedFormat}`;
      link.click();
      trackOnce('download_started');
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.status.textContent = error instanceof Error ? error.message : 'Image export failed.';
      this.status.hidden = false;
      this.open();
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.button.disabled = this.toggle.disabled = false;
        this.button.removeAttribute('aria-busy');
      }
    }
  }

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.element.contains(event.target) && !this.options.contains(event.target)) this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.options.hidden) return;
    event.preventDefault();
    this.close();
    this.toggle.focus();
  };
  private readonly onResize = (): void => this.close();
}
