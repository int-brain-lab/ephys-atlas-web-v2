export interface ContextMenuOption {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  group?: string;
  keywords?: string;
  disabled?: boolean;
}

export interface ContextMenuConfig {
  fieldName: string;
  label: string;
  keyShortcuts?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  multiselectable?: boolean;
  onOpen(menu: ContextMenu): void;
  onSelect(option: ContextMenuOption): void;
}

let menuSequence = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class ContextMenu {
  readonly field: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly value: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly search: HTMLInputElement | null;
  private readonly list: HTMLElement;
  private options: readonly ContextMenuOption[] = [];
  private selectedIds = new Set<string>();

  constructor(private readonly config: ContextMenuConfig) {
    const panelId = `context-menu-${++menuSequence}`;
    this.field = element('div', 'context-field context-menu');
    this.field.dataset.contextField = config.fieldName;

    const label = element('dt', 'context-field__label');
    label.textContent = config.label;
    const data = element('dd', 'context-field__data');
    this.trigger = element('button', 'context-menu__trigger');
    this.trigger.type = 'button';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', panelId);
    if (config.keyShortcuts) this.trigger.setAttribute('aria-keyshortcuts', config.keyShortcuts);
    this.value = element('span', 'context-field__value');
    this.value.textContent = '—';
    this.meta = element('span', 'context-field__release');
    this.meta.hidden = true;
    const chevron = element('span', 'context-menu__chevron');
    chevron.setAttribute('aria-hidden', 'true');
    this.trigger.append(this.value, this.meta, chevron);

    this.panel = element('div', 'context-menu__panel');
    this.panel.id = panelId;
    this.panel.dataset.open = 'false';
    this.panel.setAttribute('aria-hidden', 'true');
    this.panel.inert = true;
    let search: HTMLInputElement | null = null;
    if (config.searchable) {
      const searchWrap = element('div', 'context-menu__search-wrap');
      const searchIcon = element('span', 'context-menu__search-icon');
      searchIcon.textContent = '⌕';
      searchIcon.setAttribute('aria-hidden', 'true');
      search = element('input', 'context-menu__search');
      search.type = 'search';
      search.autocomplete = 'off';
      search.spellcheck = false;
      search.placeholder = config.searchPlaceholder ?? `Search ${config.label.toLocaleLowerCase()}`;
      search.setAttribute('aria-label', search.placeholder);
      searchWrap.append(searchIcon, search);
      this.panel.append(searchWrap);
    }
    this.search = search;
    this.list = element('div', 'context-menu__list');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', config.label);
    if (config.multiselectable) this.list.setAttribute('aria-multiselectable', 'true');
    this.panel.append(this.list);
    data.append(this.trigger, this.panel);
    this.field.append(label, data);

    this.trigger.addEventListener('click', this.toggle);
    this.trigger.addEventListener('keydown', this.onTriggerKeyDown);
    this.panel.addEventListener('keydown', this.onPanelKeyDown);
    this.search?.addEventListener('input', this.filter);
    document.addEventListener('pointerdown', this.onDocumentPointerDown);
  }

  setDisplay(value: string, meta = ''): void {
    this.value.textContent = value;
    this.value.title = value;
    this.meta.textContent = meta;
    this.meta.title = meta;
    this.meta.hidden = !meta;
    this.trigger.setAttribute('aria-label', `${this.config.label}: ${value}${meta ? `, ${meta}` : ''}`);
  }

  setOptions(options: readonly ContextMenuOption[], selectedIds: readonly string[], disabled = false): void {
    const signature = JSON.stringify(options);
    const selection = JSON.stringify(selectedIds);
    if (this.list.dataset.options !== signature || this.list.dataset.selection !== selection) {
      this.options = options;
      this.selectedIds = new Set(selectedIds);
      this.renderOptions();
      this.list.dataset.options = signature;
      this.list.dataset.selection = selection;
    }
    this.trigger.disabled = disabled || options.length === 0;
    if (this.trigger.disabled) this.close();
  }

  get isOpen(): boolean {
    return this.panel.dataset.open === 'true';
  }

  open(focusOptions = false): void {
    if (this.trigger.disabled || this.isOpen) return;
    this.config.onOpen(this);
    this.panel.dataset.open = 'true';
    this.panel.setAttribute('aria-hidden', 'false');
    this.panel.inert = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.field.dataset.open = 'true';
    if (this.search) {
      this.search.value = '';
      this.filter();
      this.search.focus();
    } else if (focusOptions) {
      this.focusOption(0);
    }
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.panel.dataset.open = 'false';
    this.panel.setAttribute('aria-hidden', 'true');
    this.panel.inert = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    delete this.field.dataset.open;
    if (restoreFocus) this.trigger.focus();
  }

  destroy(): void {
    this.trigger.removeEventListener('click', this.toggle);
    this.trigger.removeEventListener('keydown', this.onTriggerKeyDown);
    this.panel.removeEventListener('keydown', this.onPanelKeyDown);
    this.search?.removeEventListener('input', this.filter);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
  }

  private renderOptions(): void {
    const fragment = document.createDocumentFragment();
    let previousGroup: string | undefined;
    for (const option of this.options) {
      if (option.group && option.group !== previousGroup) {
        const group = element('div', 'context-menu__group');
        group.textContent = option.group;
        group.dataset.contextGroup = option.group;
        fragment.append(group);
        previousGroup = option.group;
      }
      const button = element('button', 'context-menu__option');
      button.type = 'button';
      button.dataset.contextOption = option.id;
      button.dataset.search = `${option.label} ${option.description ?? ''} ${option.detail ?? ''} ${option.keywords ?? ''}`.toLocaleLowerCase();
      button.dataset.group = option.group ?? '';
      button.disabled = option.disabled === true;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(this.selectedIds.has(option.id)));
      button.tabIndex = -1;
      const copy = element('span', 'context-menu__option-copy');
      const label = element('span', 'context-menu__option-label');
      label.textContent = option.label;
      copy.append(label);
      if (option.description) {
        const description = element('span', 'context-menu__option-description');
        description.textContent = option.description;
        copy.append(description);
      }
      if (option.detail) {
        const detail = element('span', 'context-menu__option-detail');
        detail.textContent = option.detail;
        copy.append(detail);
      }
      const check = element('span', 'context-menu__option-check');
      check.textContent = this.selectedIds.has(option.id) ? '✓' : '';
      check.setAttribute('aria-hidden', 'true');
      button.append(copy, check);
      button.addEventListener('click', () => {
        this.config.onSelect(option);
        this.close(true);
      });
      fragment.append(button);
    }
    this.list.replaceChildren(fragment);
    this.filter();
  }

  private readonly toggle = (): void => {
    if (this.isOpen) this.close();
    else this.open();
  };

  private readonly onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.open(true);
    if (!this.search) this.focusOption(event.key === 'ArrowUp' ? -1 : 0);
  };

  private readonly onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = this.visibleOptionButtons();
    if (!options.length) return;
    event.preventDefault();
    const current = document.activeElement instanceof HTMLButtonElement ? options.indexOf(document.activeElement) : -1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowDown' ? Math.min(options.length - 1, current + 1)
      : current <= 0 ? options.length - 1 : current - 1;
    options[next]?.focus();
  };

  private readonly filter = (): void => {
    const query = this.search?.value.trim().toLocaleLowerCase() ?? '';
    const visibleGroups = new Set<string>();
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.context-menu__option')) {
      const visible = !query || (button.dataset.search ?? '').includes(query);
      button.hidden = !visible;
      if (visible && button.dataset.group) visibleGroups.add(button.dataset.group);
    }
    for (const group of this.list.querySelectorAll<HTMLElement>('.context-menu__group')) {
      group.hidden = !visibleGroups.has(group.dataset.contextGroup ?? '');
    }
    this.list.dataset.empty = String(this.visibleOptionButtons().length === 0);
  };

  private visibleOptionButtons(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('.context-menu__option:not([hidden]):not(:disabled)')];
  }

  private focusOption(index: number): void {
    const options = this.visibleOptionButtons();
    const normalized = index < 0 ? options.length - 1 : index;
    options[normalized]?.focus();
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.isOpen && event.target instanceof Node && !this.field.contains(event.target)) this.close();
  };
}
