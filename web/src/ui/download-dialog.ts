import type { DatasetManifest, FeaturePayload } from '../data/contracts.js';
import type { AppState } from '../domain/types.js';
import { OperationStatus } from './operation-status.js';
import { element, formatBytes, heading, titleCaseToken } from './dom-helpers.js';

export interface DownloadDialogCallbacks {
  downloadCurrentFeature(): void;
  downloadArtifact(artifactId: string, featureId?: string): Promise<void>;
}

export interface DownloadDialogModel {
  readonly manifest: DatasetManifest | null;
  readonly feature: FeaturePayload | null;
  readonly state: AppState;
}

/** Owns the download dialog DOM and the lifecycle of its artifact rows. */
export class DownloadDialogController {
  readonly dialog: HTMLDialogElement;

  private readonly content: HTMLElement;
  private renderKey = '';
  private renderedManifest: DatasetManifest | null = null;
  private openingGeneration = 0;
  private disposed = false;

  constructor(private readonly callbacks: DownloadDialogCallbacks) {
    this.dialog = element('dialog', 'info-dialog download-dialog');
    this.dialog.setAttribute('aria-labelledby', 'download-dialog-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Download feature data', 2);
    title.id = 'download-dialog-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(title, close);
    this.content = element('div', 'info-dialog__content');
    this.dialog.append(header, this.content);
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
  }

  render(model: DownloadDialogModel): void {
    const { manifest, feature: payload, state } = model;
    const key = JSON.stringify([
      state.view.dataset, state.view.featureId, state.view.representation,
      state.view.parcellation, state.view.coloring.statistic, !!payload,
    ]);
    if (key === this.renderKey && manifest === this.renderedManifest) return;
    this.renderKey = key;
    this.renderedManifest = manifest;
    const feature = manifest?.features.find((item) => item.id === state.view.featureId);
    if (!manifest || !feature || !payload) {
      this.content.replaceChildren();
      return;
    }

    const intro = element('section', 'info-dialog__section download-dialog__intro');
    intro.append(heading(feature.label, 3), paragraph(
      'Downloads preserve the bytes declared by this immutable release. File descriptions identify their scope; presentation settings do not alter them.',
    ));
    if (state.runtime.datasetStatus === 'error' && state.runtime.error) {
      const error = element('p', 'download-dialog__error');
      error.setAttribute('role', 'alert');
      error.textContent = state.runtime.error;
      intro.append(error);
    }

    const sections: HTMLElement[] = [intro];
    if (payload.representation === 'regional') {
      const derived = element('section', 'info-dialog__section');
      derived.append(heading('Current view export', 3));
      derived.append(this.downloadButton(
        `Export ${titleCaseToken(state.view.parcellation)} ${titleCaseToken(state.view.coloring.statistic)} as CSV`,
        'Generated from the loaded regional values with dataset, release, feature, representation, parcellation, statistic, unit, and region context.',
        () => {
          this.callbacks.downloadCurrentFeature();
          this.close();
        },
      ));
      sections.push(derived);
    }

    sections.push(this.artifactSection('Feature artifacts', feature.artifacts, feature.id));
    if (manifest.artifacts.length) sections.push(this.artifactSection('Release artifacts', manifest.artifacts));
    this.content.replaceChildren(...sections);
  }

  show(): void {
    if (this.disposed || this.dialog.open) return;
    this.openingGeneration += 1;
    this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.openingGeneration += 1;
    this.close();
  }

  private artifactSection(
    title: string,
    artifacts: DatasetManifest['artifacts'],
    featureId?: string,
  ): HTMLElement {
    const section = element('section', 'info-dialog__section');
    section.append(heading(title, 3));
    if (!artifacts.length) {
      const empty = paragraph('This release declares no downloadable artifacts for the selected feature.');
      empty.className = 'download-dialog__empty';
      section.append(empty);
      return section;
    }

    const list = element('div', 'download-dialog__list');
    for (const artifact of artifacts) {
      const filename = artifact.resource.path.split('/').at(-1) ?? artifact.id;
      const description = artifact.description || `Declared ${titleCaseToken(artifact.role)} artifact`;
      const operation = new OperationStatus('inline');
      const button = this.downloadButton(
        description,
        `${titleCaseToken(artifact.role)} · ${filename} · ${formatBytes(artifact.resource.bytes)}`,
        async (target) => {
          if (this.disposed) return;
          const openingGeneration = this.openingGeneration;
          target.disabled = true;
          target.dataset.loading = 'true';
          operation.update({ state: 'loading', title: 'Downloading artifact…', detail: filename });
          try {
            await this.callbacks.downloadArtifact(artifact.id, featureId);
            operation.update({ state: 'ready', title: '' });
            // Only the opening that started this request may be dismissed.
            // Reopening the same-context dialog starts a new generation.
            if (
              target.isConnected && !this.disposed && this.dialog.open
              && openingGeneration === this.openingGeneration
            ) this.close();
          } catch (error) {
            operation.update({
              state: 'error', title: 'Couldn’t download this artifact',
              detail: error instanceof Error ? error.message : String(error),
              retry: () => button.click(),
            });
          } finally {
            target.disabled = false;
            delete target.dataset.loading;
          }
        },
      );
      button.dataset.artifactId = artifact.id;
      list.append(button, operation.element);
    }
    section.append(list);
    return section;
  }

  private downloadButton(
    label: string,
    detail: string,
    activate: (button: HTMLButtonElement) => void | Promise<void>,
  ): HTMLButtonElement {
    const button = element('button', 'download-dialog__item');
    button.type = 'button';
    const labelNode = element('strong');
    labelNode.textContent = label;
    const detailNode = element('span');
    detailNode.textContent = detail;
    button.append(labelNode, detailNode);
    button.addEventListener('click', () => void activate(button));
    return button;
  }
}

function paragraph(text: string): HTMLParagraphElement {
  const node = element('p');
  node.textContent = text;
  return node;
}
