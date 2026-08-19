import type { DatasetCatalog, DatasetManifest, FeaturePayload } from '../data/contracts.js';
import type { AppState, DatasetRef, ParcellationId, RepresentationKind, SliceAxis, StatisticId } from '../domain/types.js';
import type { SliceRenderer } from '../rendering/interfaces.js';

export interface AppShellCallbacks {
  setDataset(ref: DatasetRef): void;
  setFeature(featureId: string | null, representation?: RepresentationKind): void;
  setParcellation(parcellation: ParcellationId): void;
  setStatistic(statistic: StatisticId): void;
  setColormap(colormap: string): void;
  setSlice(axis: SliceAxis, index: number): void;
  clearSelection(): void;
  importLocal(files: FileList): Promise<void>;
}

export interface ShellModel {
  state: AppState;
  catalog: DatasetCatalog | null;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
}

const AXES: readonly SliceAxis[] = ['coronal', 'sagittal', 'horizontal'];

function option(value: string, label = value): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

function replaceOptions(select: HTMLSelectElement, values: readonly { value: string; label: string }[], selected: string | null): void {
  const previous = select.value;
  select.replaceChildren(...values.map((item) => option(item.value, item.label)));
  const desired = selected ?? previous;
  if (desired && values.some((item) => item.value === desired)) select.value = desired;
}

export class AppShell {
  private readonly datasetSelect: HTMLSelectElement;
  private readonly releaseSelect: HTMLSelectElement;
  private readonly featureSelect: HTMLSelectElement;
  private readonly representationSelect: HTMLSelectElement;
  private readonly parcellationSelect: HTMLSelectElement;
  private readonly statisticSelect: HTMLSelectElement;
  private readonly colormapSelect: HTMLSelectElement;
  private readonly selectionList: HTMLUListElement;
  private readonly status: HTMLElement;
  private readonly sliceTargets = new Map<SliceAxis, HTMLElement>();
  private model: ShellModel | null = null;

  constructor(
    root: HTMLElement,
    private readonly callbacks: AppShellCallbacks,
    private readonly renderer: SliceRenderer,
  ) {
    root.replaceChildren();

    const header = document.createElement('header');
    header.className = 'app-header';
    const brand = document.createElement('div');
    brand.className = 'brand';
    const title = document.createElement('h1');
    title.textContent = 'IBL Ephys Atlas';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Web v2';
    brand.append(title, subtitle);
    header.append(brand);

    const layout = document.createElement('div');
    layout.className = 'app-layout';
    const sidebar = document.createElement('aside');
    sidebar.className = 'controls';
    sidebar.setAttribute('aria-label', 'Atlas controls');

    this.datasetSelect = this.controlSelect(sidebar, 'Dataset', 'dataset-select');
    this.releaseSelect = this.controlSelect(sidebar, 'Release', 'release-select');
    this.featureSelect = this.controlSelect(sidebar, 'Feature', 'feature-select');
    this.representationSelect = this.controlSelect(sidebar, 'Representation', 'representation-select');
    this.parcellationSelect = this.controlSelect(sidebar, 'Parcellation', 'parcellation-select');
    this.statisticSelect = this.controlSelect(sidebar, 'Statistic', 'statistic-select');
    this.colormapSelect = this.controlSelect(sidebar, 'Colormap', 'colormap-select');

    const importSection = document.createElement('section');
    importSection.className = 'control-group';
    const importLabel = document.createElement('label');
    importLabel.htmlFor = 'local-import';
    importLabel.textContent = 'Local dataset';
    const importInput = document.createElement('input');
    importInput.id = 'local-import';
    importInput.type = 'file';
    importInput.multiple = true;
    importInput.setAttribute('webkitdirectory', '');
    importInput.setAttribute('directory', '');
    importSection.append(importLabel, importInput);
    sidebar.append(importSection);

    const selectedSection = document.createElement('section');
    selectedSection.className = 'selection-panel';
    const selectedHeader = document.createElement('div');
    selectedHeader.className = 'section-heading';
    const selectedTitle = document.createElement('h2');
    selectedTitle.textContent = 'Selected regions';
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', () => this.callbacks.clearSelection());
    selectedHeader.append(selectedTitle, clearButton);
    this.selectionList = document.createElement('ul');
    this.selectionList.className = 'selection-list';
    selectedSection.append(selectedHeader, this.selectionList);
    sidebar.append(selectedSection);

    const main = document.createElement('main');
    main.className = 'workspace';
    const viewerHeader = document.createElement('div');
    viewerHeader.className = 'workspace-heading';
    const viewerTitle = document.createElement('h2');
    viewerTitle.textContent = 'Linked slices';
    this.status = document.createElement('p');
    this.status.className = 'status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    viewerHeader.append(viewerTitle, this.status);

    const sliceGrid = document.createElement('div');
    sliceGrid.className = 'slice-grid';
    for (const axis of AXES) sliceGrid.append(this.createSlicePanel(axis));
    main.append(viewerHeader, sliceGrid);
    layout.append(sidebar, main);
    root.append(header, layout);

    this.bindEvents(importInput);
  }

  render(model: ShellModel): void {
    this.model = model;
    const { state, catalog, manifest, feature } = model;
    const view = state.view;

    const datasets = catalog?.datasets.map((entry) => ({ value: entry.id, label: entry.title })) ?? [];
    replaceOptions(this.datasetSelect, datasets, view.dataset.datasetId);

    const datasetEntry = catalog?.datasets.find((entry) => entry.id === view.dataset.datasetId);
    const releases = datasetEntry?.releases.map((release) => ({ value: release.id, label: release.label })) ?? [];
    replaceOptions(this.releaseSelect, releases, view.dataset.releaseId ?? manifest?.dataset.release ?? null);
    this.releaseSelect.disabled = releases.length <= 1;

    const features = manifest?.features.map((item) => ({ value: item.id, label: item.label })) ?? [];
    replaceOptions(this.featureSelect, features, view.featureId);
    this.featureSelect.disabled = features.length === 0;

    const selectedFeature = manifest?.features.find((item) => item.id === view.featureId);
    const representations: { value: string; label: string }[] = [];
    if (selectedFeature?.representations.regional) representations.push({ value: 'regional', label: 'Regional' });
    if (selectedFeature?.representations.volume) representations.push({ value: 'volume', label: 'Volume' });
    replaceOptions(this.representationSelect, representations, view.representation);
    this.representationSelect.disabled = representations.length <= 1;

    replaceOptions(
      this.parcellationSelect,
      (manifest?.parcellations ?? ['allen', 'beryl', 'cosmos']).map((id) => ({ value: id, label: id[0]?.toUpperCase() + id.slice(1) })),
      view.parcellation,
    );
    this.parcellationSelect.disabled = view.representation !== 'regional';

    const statistics = selectedFeature?.statistics ?? ['mean'];
    replaceOptions(this.statisticSelect, statistics.map((id) => ({ value: id, label: id })), view.coloring.statistic);
    replaceOptions(this.colormapSelect, ['viridis', 'magma', 'plasma', 'inferno'].map((id) => ({ value: id, label: id })), view.coloring.colormap);

    this.selectionList.replaceChildren(...view.selection.map((regionId) => {
      const item = document.createElement('li');
      item.textContent = regionId;
      return item;
    }));
    if (!view.selection.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-selection';
      empty.textContent = 'None';
      this.selectionList.append(empty);
    }

    const status = state.runtime.error
      ? state.runtime.error
      : state.runtime.datasetStatus === 'loading'
        ? 'Loading dataset…'
        : manifest
          ? `${manifest.dataset.title} · ${manifest.dataset.release}`
          : 'Loading catalog…';
    this.status.textContent = status;

    for (const axis of AXES) {
      const target = this.sliceTargets.get(axis);
      if (!target) continue;
      void this.renderer.render(target, {
        axis,
        sliceIndex: view.slices[axis],
        slices: view.slices,
        cursor: view.cursor,
        parcellation: view.parcellation,
        selectedRegionIds: view.selection,
        feature,
      });
      const output = target.parentElement?.querySelector('output');
      if (output) output.textContent = String(view.slices[axis]);
      const slider = target.parentElement?.querySelector<HTMLInputElement>('input[type="range"]');
      if (slider) slider.value = String(view.slices[axis]);
    }
  }

  destroy(): void {
    this.renderer.destroy?.();
  }

  private controlSelect(parent: HTMLElement, labelText: string, id: string): HTMLSelectElement {
    const group = document.createElement('div');
    group.className = 'control-group';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    const select = document.createElement('select');
    select.id = id;
    group.append(label, select);
    parent.append(group);
    return select;
  }

  private createSlicePanel(axis: SliceAxis): HTMLElement {
    const section = document.createElement('section');
    section.className = 'slice-panel';
    section.setAttribute('aria-labelledby', `${axis}-heading`);
    const heading = document.createElement('div');
    heading.className = 'slice-heading';
    const title = document.createElement('h3');
    title.id = `${axis}-heading`;
    title.textContent = axis[0]?.toUpperCase() + axis.slice(1);
    const output = document.createElement('output');
    output.htmlFor = `${axis}-slider`;
    output.textContent = '0';
    heading.append(title, output);

    const target = document.createElement('div');
    target.className = 'slice-target';
    target.dataset.axis = axis;
    target.setAttribute('role', 'img');
    target.setAttribute('aria-label', `${axis} brain slice`);
    this.sliceTargets.set(axis, target);

    const slider = document.createElement('input');
    slider.id = `${axis}-slider`;
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1000';
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', `${axis} slice index`);
    slider.addEventListener('input', () => this.callbacks.setSlice(axis, Number(slider.value)));
    section.append(heading, target, slider);
    return section;
  }

  private bindEvents(importInput: HTMLInputElement): void {
    this.datasetSelect.addEventListener('change', () => {
      const entry = this.model?.catalog?.datasets.find((item) => item.id === this.datasetSelect.value);
      if (!entry) return;
      this.callbacks.setDataset({ datasetId: entry.id, releaseId: entry.defaultRelease || null });
    });
    this.releaseSelect.addEventListener('change', () => {
      const current = this.model?.state.view.dataset;
      if (!current) return;
      this.callbacks.setDataset({ datasetId: current.datasetId, releaseId: this.releaseSelect.value || null });
    });
    this.featureSelect.addEventListener('change', () => {
      const feature = this.model?.manifest?.features.find((item) => item.id === this.featureSelect.value);
      if (!feature) return;
      const representation: RepresentationKind = feature.representations.regional ? 'regional' : 'volume';
      this.callbacks.setFeature(feature.id, representation);
    });
    this.representationSelect.addEventListener('change', () => {
      this.callbacks.setFeature(this.model?.state.view.featureId ?? null, this.representationSelect.value as RepresentationKind);
    });
    this.parcellationSelect.addEventListener('change', () => this.callbacks.setParcellation(this.parcellationSelect.value as ParcellationId));
    this.statisticSelect.addEventListener('change', () => this.callbacks.setStatistic(this.statisticSelect.value as StatisticId));
    this.colormapSelect.addEventListener('change', () => this.callbacks.setColormap(this.colormapSelect.value));
    importInput.addEventListener('change', () => {
      if (importInput.files?.length) void this.callbacks.importLocal(importInput.files);
      importInput.value = '';
    });
  }
}
