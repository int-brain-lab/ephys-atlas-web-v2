import { resolveDatasetNavigation, selectNavigationDataset, selectNavigationProject, type ResolvedDatasetNavigation } from '../application/dataset-navigation.js';
import { ContextMenu, type ContextMenuOption } from './context-menu.js';
import { presentDatasetInProject } from './dataset-presentation.js';
import type { DatasetCatalog } from '../data/contracts.js';
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

/** One catalog-ordered dataset chooser at every viewport width. */
export class DataChooser {
  readonly element: HTMLElement;
  private readonly menu: ContextMenu;
  private selectedId: string | undefined;
  private selections = new Map<string, DataChooserSelection>();

  constructor(
    onSelect: (selection: DataChooserSelection) => void,
    onOpen: () => void = () => undefined,
    onRecover: (action: NavigationRecoveryAction) => void = () => undefined,
    private readonly localActions: readonly (ContextMenuOption & { localOnly?: boolean })[] = [],
    onLocalAction: (id: string) => void = () => undefined,
  ) {
    this.menu = new ContextMenu({
      fieldName: 'data', label: 'Data',
      onOpen,
      onSelect: ({ id }) => {
        if (id === this.selectedId) return;
        if (id.startsWith('recovery:')) onRecover(id.slice(9) as NavigationRecoveryAction);
        else {
          const selection = this.selections.get(id);
          if (selection) onSelect(selection);
          else onLocalAction(id);
        }
      },
    });
    this.element = this.menu.field;
  }

  update(model: DataChooserModel): void {
    const { catalog, navigation, dataset, recovery } = model;
    const currentDataset = catalog?.datasets.find(({ id }) => id === dataset.datasetId);
    const projectId = navigation.kind === 'local' ? undefined : navigation.projectId;
    const project = catalog?.projects.find(({ id }) => id === projectId);
    const title = currentDataset ? presentDatasetInProject(currentDataset.title, project?.title) : dataset.datasetId;
    const release = currentDataset?.releases.find(({ id }) => id === dataset.releaseId);
    const status = release?.status === 'development' ? 'Development data'
      : release?.status === 'legacy' ? 'Preserved legacy data' : '';
    this.menu.setDisplay(`${navigation.kind === 'local' ? 'My data' : project?.title ?? 'Data'} / ${title}`,
      recovery ? 'Navigation unavailable · open to recover' : navigation.kind === 'local' ? 'Stored only in this browser' : status);
    const options: ContextMenuOption[] = [];
    this.selections.clear();
    const addSelection = (id: string, resolved: ResolvedDatasetNavigation, option: ContextMenuOption): void => {
      this.selections.set(id, { navigation: resolved.context,
        dataset: { datasetId: resolved.dataset.id, releaseId: resolved.releaseId } });
      options.push(option);
    };
    if (catalog) {
      for (const group of catalog.projects) {
        for (const id of group.datasetIds) {
          const entry = catalog.datasets.find((item) => item.id === id && item.source === 'published');
          if (!entry) continue;
          // Cross-project selection starts from that project's catalog-owned context.
          // Within a project, retain the current coordinated/custom baseline.
          const initial = selectNavigationProject(catalog, group.id);
          const current = group.id === projectId && !recovery
            ? resolveDatasetNavigation(catalog, dataset.datasetId, dataset.releaseId ?? undefined, navigation)
            : initial;
          const resolved = current.dataset.id === id ? current : selectNavigationDataset(catalog, current, id);
          addSelection(id, resolved, { id, label: presentDatasetInProject(entry.title, group.title),
            group: group.title, ...(entry.description ? { detail: entry.description } : {}) });
        }
      }
      for (const entry of catalog.datasets.filter(({ source }) => source === 'local')) {
        for (const release of entry.releases) {
          const id = JSON.stringify([entry.id, release.id]);
          addSelection(id, resolveDatasetNavigation(catalog, entry.id, release.id, { kind: 'local' }), {
            id, label: release.label, group: 'My data', description: 'Stored only in this browser',
            metadata: `Immutable release ID · ${release.id}`,
          });
        }
      }
    }
    if (model.catalogStatus === 'error') options.push({ id: 'recovery:catalog', label: 'Retry catalog', group: 'Catalog recovery' });
    if (recovery) {
      options.push({ id: 'recovery:default', label: 'Use catalog default', group: 'Navigation recovery' });
      if (recovery.canReturnToEdition) options.push({ id: 'recovery:edition', label: 'Use snapshot version', group: 'Navigation recovery' });
      if (recovery.canOpenExactAsCustom) options.push({ id: 'recovery:custom', label: 'Use requested version', group: 'Navigation recovery' });
    }
    options.push(...this.localActions.filter(({ localOnly }) => !localOnly || navigation.kind === 'local'));
    this.selectedId = recovery ? undefined : navigation.kind === 'local'
      ? JSON.stringify([dataset.datasetId, dataset.releaseId]) : dataset.datasetId;
    this.menu.setOptions(options, this.selectedId ? [this.selectedId] : [], {
      emptyMessage: model.catalogStatus === 'error' ? `Data unavailable: ${model.error ?? 'Catalog failed'}` : 'Loading datasets…',
      busy: model.catalogStatus === 'loading' || model.catalogStatus === 'idle',
      statusMessage: model.catalogStatus === 'error' ? `Data unavailable: ${model.error ?? 'Catalog failed'}`
        : model.catalogStatus === 'loading' || model.catalogStatus === 'idle' ? 'Loading datasets…' : undefined,
    });
  }

  get isOpen(): boolean { return this.menu.isOpen; }
  close(restoreFocus = false): void { this.menu.close(restoreFocus); }
  destroy(): void { this.menu.destroy(); }
}
