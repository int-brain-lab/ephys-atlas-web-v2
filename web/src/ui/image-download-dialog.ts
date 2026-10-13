import { element, heading } from './dom-helpers.js';
import { trackOnce } from '../analytics.js';

export interface ImageDownloadRequest {
  label: string;
  filename: string;
  vector: boolean;
  hasColorbar: boolean;
  exportImage(format: 'svg' | 'png', includeColorbar: boolean): Promise<Blob>;
}

/** A small per-view export dialog, separate from scientific data downloads. */
export class ImageDownloadDialog {
  readonly dialog = element('dialog', 'info-dialog image-download-dialog');
  private readonly content = element('div', 'info-dialog__content');
  private generation = 0;

  constructor() {
    this.dialog.setAttribute('aria-labelledby', 'image-download-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Download image', 2);
    title.id = 'image-download-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(title, close);
    this.dialog.append(header, this.content);
    this.dialog.addEventListener('cancel', () => { this.generation += 1; });
  }

  open(request: ImageDownloadRequest): void {
    const generation = ++this.generation;
    const description = element('p');
    description.textContent = `${request.label} · transparent background · no crosshair. PNG uses a 2400-pixel longest edge.`;
    const option = element('label', 'image-download-dialog__option');
    const colorbar = element('input');
    colorbar.type = 'checkbox';
    colorbar.disabled = !request.hasColorbar;
    option.append(colorbar, ' Include colorbar');
    const actions = element('div', 'image-download-dialog__actions');
    const status = element('p');
    status.setAttribute('role', 'status');
    const formats: Array<'svg' | 'png'> = request.vector ? ['svg', 'png'] : ['png'];
    for (const format of formats) {
      const button = element('button');
      button.type = 'button';
      button.textContent = `Download ${format.toUpperCase()}`;
      button.addEventListener('click', () => {
        const buttons = actions.querySelectorAll('button');
        buttons.forEach((item) => { item.disabled = true; });
        colorbar.disabled = true;
        status.textContent = 'Preparing image…';
        void request.exportImage(format, colorbar.checked).then((blob) => {
          if (generation !== this.generation) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${request.filename}.${format}`;
          link.click();
          trackOnce('download_started');
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = 'Image downloaded.';
        }).catch((error: unknown) => {
          if (generation === this.generation) status.textContent = error instanceof Error ? error.message : 'Image export failed.';
        }).finally(() => {
          if (generation !== this.generation) return;
          buttons.forEach((item) => { item.disabled = false; });
          colorbar.disabled = !request.hasColorbar;
        });
      });
      actions.append(button);
    }
    const details = element('p');
    details.textContent = request.vector
      ? 'SVG keeps regions as editable vectors and embeds any visible volume as a PNG. PNG combines the visible layers into one bitmap.'
      : 'PNG preserves the current 3D camera, colors, lighting, and opacity.';
    this.content.replaceChildren(description, option, actions, details, status);
    this.dialog.showModal();
  }

  close(): void { this.generation += 1; this.dialog.close(); }
  destroy(): void { this.close(); this.dialog.remove(); }
}
