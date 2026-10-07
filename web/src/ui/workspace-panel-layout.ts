import { element } from './dom-helpers.js';
import { LAYOUT_PREFERENCES_KEY, PANEL_WIDTH_LIMITS, clampPanelWidth, parseLayoutPreferences,
  serializeLayoutPreferences, type LayoutPanel, type LayoutPreferences } from '../application/layout-preferences.js';

/** Owns panel preferences and interactions; the shell supplies its responsive mode. */
export class WorkspacePanelLayoutController {
  private readonly panelCollapseButtons = new Map<LayoutPanel, HTMLButtonElement>();
  private readonly panelRestoreButtons = new Map<LayoutPanel, HTMLButtonElement>();
  private readonly panelResizeHandles = new Map<LayoutPanel, HTMLElement>();
  private readonly layoutPreferences: LayoutPreferences;
  private cancelResize: (() => void) | null = null;

  constructor(private readonly app: HTMLElement, private readonly pane: (panel: LayoutPanel) => HTMLElement,
    private readonly layoutMode: () => string, private readonly announce: (text: string) => void) {
    this.layoutPreferences = this.loadLayoutPreferences();
  }

  registerCollapse(panel: LayoutPanel, button: HTMLButtonElement): void {
    button.addEventListener('click', () => this.setCollapsed(panel, true, true));
    this.panelCollapseButtons.set(panel, button);
  }

  dispose(): void { this.cancelResize?.(); }

  createRestoreButton(panel: LayoutPanel): HTMLButtonElement {
    const label = panel === 'regions' ? 'Brain regions' : 'Visualization settings';
    const button = element('button', `panel-restore panel-restore--${panel}`);
    button.type = 'button';
    if (panel === 'regions') button.dataset.helpAnchor = 'regions';
    button.textContent = panel === 'regions' ? '›' : '‹';
    button.setAttribute('aria-label', `Show ${label}`);
    button.setAttribute('aria-controls', panel === 'regions' ? 'regions-pane' : 'settings-pane');
    button.setAttribute('aria-keyshortcuts', panel === 'regions' ? '[' : ']');
    button.addEventListener('click', () => this.setCollapsed(panel, false, true));
    this.panelRestoreButtons.set(panel, button);
    return button;
  }

  createResizeHandle(panel: LayoutPanel): HTMLElement {
    const limits = PANEL_WIDTH_LIMITS[panel];
    const handle = element('div', `panel-resize-handle panel-resize-handle--${panel}`);
    const label = panel === 'regions' ? 'Resize brain regions panel' : 'Resize visualization settings panel';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', label);
    handle.setAttribute('aria-controls', panel === 'regions' ? 'regions-pane' : 'settings-pane');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(limits.min));
    handle.setAttribute('aria-valuemax', String(limits.max));
    handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');
    handle.addEventListener('pointerdown', (event) => this.startPanelResize(panel, handle, event));
    handle.addEventListener('dblclick', () => this.resetPanelWidth(panel));
    handle.addEventListener('keydown', (event) => this.onPanelResizeKeyDown(panel, event));
    this.panelResizeHandles.set(panel, handle);
    return handle;
  }

  private loadLayoutPreferences(): LayoutPreferences {
    try {
      return parseLayoutPreferences(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY));
    } catch {
      return parseLayoutPreferences(null);
    }
  }

  private persistLayoutPreferences(): void {
    try {
      window.localStorage.setItem(LAYOUT_PREFERENCES_KEY, serializeLayoutPreferences(this.layoutPreferences));
    } catch {
      // Layout preferences are optional; storage denial must not affect the viewer.
    }
  }

  applyPreferences(): void {
    this.applyPanelWidth('regions', this.layoutPreferences.regionsWidth);
    this.applyPanelWidth('settings', this.layoutPreferences.settingsWidth);
    this.syncControls();
  }

  private applyPanelWidth(panel: LayoutPanel, width: number | null): void {
    const property = panel === 'regions' ? '--region-pane-width' : '--settings-pane-width';
    if (width === null) this.app.style.removeProperty(property);
    else this.app.style.setProperty(property, `${clampPanelWidth(panel, width)}px`);
    this.syncPanelResizeValue(panel);
  }

  private panelWidth(panel: LayoutPanel): number {
    const pane = this.pane(panel);
    return clampPanelWidth(panel, pane.getBoundingClientRect().width);
  }

  isInline(panel: LayoutPanel): boolean {
    return panel === 'regions'
      ? this.layoutMode() === 'wide' || this.layoutMode() === 'compact'
      : this.layoutMode() === 'wide';
  }

  isCollapsed(panel: LayoutPanel): boolean {
    return panel === 'regions'
      ? this.layoutPreferences.regionsCollapsed
      : this.layoutPreferences.settingsCollapsed;
  }

  setCollapsed(panel: LayoutPanel, collapsed: boolean, moveFocus = false): void {
    if (!this.isInline(panel)) return;
    if (panel === 'regions') this.layoutPreferences.regionsCollapsed = collapsed;
    else this.layoutPreferences.settingsCollapsed = collapsed;
    this.persistLayoutPreferences();
    this.syncControls();
    this.announce(`${panel === 'regions' ? 'Brain regions' : 'Visualization settings'} panel ${collapsed ? 'collapsed' : 'expanded'}`);
    if (moveFocus) {
      const target = collapsed ? this.panelRestoreButtons.get(panel) : this.panelCollapseButtons.get(panel);
      window.requestAnimationFrame(() => target?.focus());
    }
  }

  syncControls(): void {
    for (const panel of ['regions', 'settings'] as const) {
      const inline = this.isInline(panel);
      const collapsed = inline && this.isCollapsed(panel);
      const pane = this.pane(panel);
      this.app.dataset[panel === 'regions' ? 'regionPanelCollapsed' : 'settingsPanelCollapsed'] = String(collapsed);
      pane.inert = collapsed;
      pane.setAttribute('aria-hidden', String(collapsed));
      const collapse = this.panelCollapseButtons.get(panel);
      collapse?.setAttribute('aria-expanded', String(!collapsed));
      collapse?.setAttribute('aria-label', `Hide ${panel === 'regions' ? 'Brain regions' : 'Visualization settings'}`);
      const restore = this.panelRestoreButtons.get(panel);
      if (restore) restore.hidden = !collapsed;
      this.syncPanelResizeValue(panel);
    }
  }

  private syncPanelResizeValue(panel: LayoutPanel): void {
    const handle = this.panelResizeHandles.get(panel);
    if (!handle || !this.isInline(panel)) return;
    const saved = panel === 'regions' ? this.layoutPreferences.regionsWidth : this.layoutPreferences.settingsWidth;
    const width = saved ?? this.panelWidth(panel);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  }

  private setPanelWidth(panel: LayoutPanel, width: number, persist: boolean): void {
    const clamped = clampPanelWidth(panel, width);
    if (panel === 'regions') this.layoutPreferences.regionsWidth = clamped;
    else this.layoutPreferences.settingsWidth = clamped;
    this.applyPanelWidth(panel, clamped);
    if (persist) this.persistLayoutPreferences();
  }

  private resetPanelWidth(panel: LayoutPanel): void {
    if (panel === 'regions') this.layoutPreferences.regionsWidth = null;
    else this.layoutPreferences.settingsWidth = null;
    this.applyPanelWidth(panel, null);
    this.persistLayoutPreferences();
    window.requestAnimationFrame(() => this.syncPanelResizeValue(panel));
    this.announce(`${panel === 'regions' ? 'Brain regions' : 'Visualization settings'} panel width reset`);
  }

  private startPanelResize(panel: LayoutPanel, handle: HTMLElement, event: PointerEvent): void {
    if (event.button !== 0 || !this.isInline(panel) || this.isCollapsed(panel)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.panelWidth(panel);
    this.cancelResize?.();
    this.app.dataset.panelResizing = panel;
    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      this.setPanelWidth(panel, startWidth + (panel === 'regions' ? delta : -delta), false);
    };
    const finish = (): void => {
      this.cancelResize = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      delete this.app.dataset.panelResizing;
      this.persistLayoutPreferences();
    };
    this.cancelResize = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  private onPanelResizeKeyDown(panel: LayoutPanel, event: KeyboardEvent): void {
    if (!this.isInline(panel) || this.isCollapsed(panel)) return;
    const limits = PANEL_WIDTH_LIMITS[panel];
    let width: number | null = null;
    if (event.key === 'Home') width = limits.min;
    if (event.key === 'End') width = limits.max;
    if (event.key === 'ArrowLeft') width = this.panelWidth(panel) + (panel === 'regions' ? -12 : 12);
    if (event.key === 'ArrowRight') width = this.panelWidth(panel) + (panel === 'regions' ? 12 : -12);
    if (width === null) return;
    event.preventDefault();
    this.setPanelWidth(panel, width, true);
  }

}
