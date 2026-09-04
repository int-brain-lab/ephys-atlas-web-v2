import type { DatasetCatalog, DatasetCatalogEntry } from '../data/contracts.js';
import type { DatasetNavigationContext, ExactDatasetRef } from '../domain/types.js';

export interface DataChooserSelection {
  readonly navigation: DatasetNavigationContext;
  readonly dataset: ExactDatasetRef;
}

export type NavigationRecoveryAction = 'catalog' | 'default' | 'edition' | 'custom';

export interface NavigationRecovery {
  readonly message: string;
  readonly canReturnToEdition: boolean;
  readonly canOpenExactAsCustom: boolean;
}

export interface DataChooserModel {
  readonly catalog: DatasetCatalog | null;
  readonly catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly error?: string | null;
  readonly navigation: DatasetNavigationContext;
  readonly dataset: { readonly datasetId: string; readonly releaseId: string | null };
  readonly recovery?: NavigationRecovery | null;
}

type Stage = 'project' | 'context' | 'dataset';
type DraftContext = 'edition' | 'custom' | 'local';
let chooserSequence = 0;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  return result;
}

/** Phone-width, staged project/context/release navigation with one atomic result. */
export class DataChooser {
  readonly element = node('div', 'data-chooser');
  private readonly trigger = node('button', 'data-chooser__trigger');
  private readonly primary = node('span', 'data-chooser__primary');
  private readonly secondary = node('span', 'data-chooser__secondary');
  private readonly panel = node('div', 'data-chooser__panel');
  private readonly heading = node('h2', 'data-chooser__heading');
  private readonly status = node('p', 'data-chooser__status');
  private readonly choices = node('div', 'data-chooser__choices');
  private model: DataChooserModel | null = null;
  private stage: Stage = 'project';
  private projectId = '';
  private context: DraftContext = 'custom';
  private editionId: string | undefined;

  constructor(
    private readonly onSelect: (selection: DataChooserSelection) => void,
    private readonly onOpen: () => void = () => undefined,
    private readonly onRecover: (action: NavigationRecoveryAction) => void = () => undefined,
  ) {
    const id = `data-chooser-${++chooserSequence}`;
    this.trigger.type = 'button';
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', id);
    const label = node('span', 'data-chooser__label');
    label.textContent = 'Data';
    const copy = node('span', 'data-chooser__copy');
    copy.append(this.primary, this.secondary);
    const chevron = node('span', 'data-chooser__chevron');
    chevron.setAttribute('aria-hidden', 'true');
    this.trigger.append(label, copy, chevron);

    this.panel.id = id;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-labelledby', `${id}-heading`);
    this.panel.hidden = true;
    this.heading.id = `${id}-heading`;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.choices.setAttribute('role', 'group');
    this.choices.setAttribute('aria-labelledby', this.heading.id);
    this.panel.append(this.heading, this.status, this.choices);
    this.element.append(this.trigger, this.panel);

    this.trigger.addEventListener('click', this.toggle);
    this.trigger.addEventListener('keydown', this.onTriggerKeyDown);
    this.panel.addEventListener('keydown', this.onPanelKeyDown);
    document.addEventListener('pointerdown', this.onOutsidePointerDown);
  }

  update(model: DataChooserModel): void {
    this.model = model;
    const navigation = model.navigation;
    const dataset = model.catalog?.datasets.find(({ id }) => id === model.dataset.datasetId);
    const projectId = navigation.kind === 'local' ? undefined : navigation.projectId;
    const project = model.catalog?.projects.find(({ id }) => id === projectId);
    const release = dataset?.releases.find(({ id }) => id === model.dataset.releaseId);
    const editionId = navigation.kind === 'edition' ? navigation.editionId : undefined;
    const contextLabel = navigation.kind === 'edition'
      ? project?.editions.find(({ id }) => id === editionId)?.label ?? editionId
      : navigation.kind === 'custom' ? 'Custom versions' : 'Local browser data';
    this.primary.textContent = navigation.kind === 'local'
      ? `My data / ${dataset?.title ?? model.dataset.datasetId}`
      : `${project?.title ?? projectId} / ${dataset?.title ?? model.dataset.datasetId}`;
    this.secondary.textContent = model.recovery
      ? 'Navigation unavailable / open to recover'
      : `${contextLabel} / ${release?.label ?? model.dataset.releaseId ?? 'Choose release'}`;
    this.trigger.setAttribute('aria-label', `Data: ${this.primary.textContent}, ${this.secondary.textContent}`);
    this.trigger.setAttribute('aria-busy', String(model.catalogStatus === 'idle' || model.catalogStatus === 'loading'));
    if (!this.panel.hidden) {
      const previousButtons = this.choiceButtons();
      const focusedIndex = document.activeElement instanceof HTMLButtonElement
        ? previousButtons.indexOf(document.activeElement)
        : -1;
      this.render(false);
      if (focusedIndex >= 0) {
        const nextButtons = this.choiceButtons();
        nextButtons[Math.min(focusedIndex, nextButtons.length - 1)]?.focus();
      }
    }
  }

  destroy(): void {
    this.close();
    this.trigger.removeEventListener('click', this.toggle);
    this.trigger.removeEventListener('keydown', this.onTriggerKeyDown);
    this.panel.removeEventListener('keydown', this.onPanelKeyDown);
    document.removeEventListener('pointerdown', this.onOutsidePointerDown);
  }

  close(restoreFocus = false): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    delete this.element.dataset.open;
    if (restoreFocus) this.trigger.focus();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  private readonly toggle = (): void => this.panel.hidden ? this.open() : this.close();

  private open(focusChoices = false): void {
    this.onOpen();
    this.resetDraft();
    this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.element.dataset.open = 'true';
    this.render(focusChoices);
  }

  private resetDraft(): void {
    const navigation = this.model?.navigation;
    this.stage = 'project';
    this.context = navigation?.kind ?? 'custom';
    this.projectId = navigation && navigation.kind !== 'local' ? navigation.projectId : '';
    this.editionId = navigation?.kind === 'edition' ? navigation.editionId
      : navigation?.kind === 'custom' ? navigation.baseEditionId : undefined;
  }

  private render(focusChoices = true): void {
    this.choices.replaceChildren();
    const model = this.model;
    const catalog = model?.catalog;
    this.heading.textContent = this.stage === 'project' ? 'Choose project'
      : this.stage === 'context' ? 'Choose edition or custom versions'
      : 'Choose dataset and exact version';
    if (!catalog) {
      this.status.textContent = model?.catalogStatus === 'error'
        ? `Projects unavailable: ${model.error ?? 'The catalog could not be loaded.'}`
        : 'Loading projects…';
      if (model?.catalogStatus === 'error') {
        this.addChoice('Retry catalog', 'Load and validate the public catalog again', () => this.recover('catalog'));
        if (focusChoices) this.choiceButtons()[0]?.focus();
      }
      return;
    }
    this.status.textContent = model.recovery
      ? `Navigation unavailable: ${model.recovery.message}`
      : this.stage === 'project' ? 'Step 1 of 3'
        : this.stage === 'context' ? 'Step 2 of 3' : 'Step 3 of 3';
    if (this.stage === 'project') this.renderProjects(catalog);
    if (this.stage === 'context') this.renderContexts(catalog);
    if (this.stage === 'dataset') this.renderDatasets(catalog);
    if (focusChoices) this.choiceButtons()[0]?.focus();
  }

  private renderProjects(catalog: DatasetCatalog): void {
    const recovery = this.model?.recovery;
    if (recovery) {
      this.addChoice('Use catalog default', 'Replace the invalid request with the catalog-owned default', () => this.recover('default'));
      if (recovery.canReturnToEdition) {
        this.addChoice('Return to edition', 'Use the exact release mapped by the requested edition', () => this.recover('edition'));
      }
      if (recovery.canOpenExactAsCustom) {
        this.addChoice('Open exact release as custom', 'Keep the requested immutable release outside coordinated edition context', () => this.recover('custom'));
      }
    }
    const publishedIds = new Set(catalog.datasets.filter(({ source }) => source === 'published').map(({ id }) => id));
    for (const project of catalog.projects.filter(({ datasetIds }) => datasetIds.some((id) => publishedIds.has(id)))) {
      this.addChoice(project.title, project.description ?? project.id, () => {
        const current = this.model?.navigation;
        const sameProject = current?.kind !== 'local' && current?.projectId === project.id;
        this.projectId = project.id;
        this.context = sameProject ? current.kind : 'custom';
        this.editionId = sameProject && current.kind === 'edition' ? current.editionId
          : sameProject && current.kind === 'custom' ? current.baseEditionId : undefined;
        this.stage = 'context';
        this.render();
      }, project.id === this.projectId && this.context !== 'local');
    }
    if (catalog.datasets.some(({ source }) => source === 'local')) {
      this.addChoice('My data', 'Releases stored only in this browser', () => {
        this.context = 'local';
        this.projectId = '';
        this.editionId = undefined;
        this.stage = 'dataset';
        this.render();
      }, this.context === 'local');
    }
  }

  private renderContexts(catalog: DatasetCatalog): void {
    this.addBack('Projects', 'Back to project choices', 'project');
    const project = catalog.projects.find(({ id }) => id === this.projectId);
    for (const edition of project?.editions ?? []) {
      this.addChoice(edition.label, edition.description ?? edition.id, () => {
        this.context = 'edition';
        this.editionId = edition.id;
        this.stage = 'dataset';
        this.render();
      }, this.context === 'edition' && edition.id === this.editionId);
    }
    this.addChoice('Browse custom versions', 'Choose an exact release independently', () => {
      this.context = 'custom';
      this.stage = 'dataset';
      this.render();
    }, this.context === 'custom');
  }

  private renderDatasets(catalog: DatasetCatalog): void {
    this.addBack(this.context === 'local' ? 'Projects' : 'Edition or custom',
      this.context === 'local' ? 'Back to project choices' : 'Back to edition choices',
      this.context === 'local' ? 'project' : 'context');
    const project = catalog.projects.find(({ id }) => id === this.projectId);
    const datasets = catalog.datasets.filter((dataset) => this.context === 'local'
      ? dataset.source === 'local'
      : dataset.source === 'published' && project?.datasetIds.includes(dataset.id));
    for (const dataset of datasets) this.renderReleases(dataset, project?.title);
  }

  private renderReleases(dataset: DatasetCatalogEntry, projectTitle?: string): void {
    const project = this.model?.catalog?.projects.find(({ id }) => id === this.projectId);
    const mappedRelease = project?.editions.find(({ id }) => id === this.editionId)?.datasetReleases.get(dataset.id);
    for (const release of dataset.releases) {
      const detail = [dataset.title, release.status, `Immutable ID ${release.id}`].filter(Boolean).join(' · ');
      this.addChoice(release.label, release.description ?? dataset.description ?? detail, () => {
        const editionMatch = this.context === 'edition' && mappedRelease === release.id;
        const navigation: DatasetNavigationContext = dataset.source === 'local' ? { kind: 'local' }
          : editionMatch ? { kind: 'edition', projectId: this.projectId, editionId: this.editionId! }
            : { kind: 'custom', projectId: this.projectId, ...(this.editionId ? { baseEditionId: this.editionId } : {}) };
        this.onSelect({ navigation, dataset: { datasetId: dataset.id, releaseId: release.id } });
        this.close(true);
      }, dataset.id === this.model?.dataset.datasetId && release.id === this.model.dataset.releaseId,
      `${projectTitle ?? 'My data'} · ${detail}`);
    }
  }

  private addBack(label: string, description: string, stage: Stage): void {
    this.addChoice(`← ${label}`, description, () => { this.stage = stage; this.render(); }, false, undefined, true);
  }

  private recover(action: NavigationRecoveryAction): void {
    this.close(true);
    this.onRecover(action);
  }

  private addChoice(label: string, description: string, activate: () => void, selected = false, metadata?: string, back = false): void {
    const button = node('button', back ? 'data-chooser__back' : 'data-chooser__option');
    button.type = 'button';
    button.dataset.chooserItem = 'true';
    if (selected) button.setAttribute('aria-current', 'true');
    const title = node('span', 'data-chooser__option-label');
    title.textContent = label;
    const detail = node('span', 'data-chooser__option-description');
    detail.textContent = description;
    button.append(title, detail);
    if (metadata) {
      const meta = node('span', 'data-chooser__option-metadata');
      meta.textContent = metadata;
      button.append(meta);
    }
    button.addEventListener('click', activate);
    this.choices.append(button);
  }

  private choiceButtons(): HTMLButtonElement[] {
    return [...this.choices.querySelectorAll<HTMLButtonElement>('[data-chooser-item]')];
  }

  private readonly onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (this.panel.hidden) this.open(true);
    const buttons = this.choiceButtons();
    buttons[event.key === 'ArrowUp' ? buttons.length - 1 : 0]?.focus();
  };

  private readonly onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = this.choiceButtons();
    if (!buttons.length) return;
    event.preventDefault();
    const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1)
        : current <= 0 ? buttons.length - 1 : current - 1;
    buttons[index]?.focus();
  };

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    if (!this.panel.hidden && event.target instanceof Node && !this.element.contains(event.target)) this.close();
  };
}
