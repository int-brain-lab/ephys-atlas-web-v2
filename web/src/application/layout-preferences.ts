export type LayoutPanel = 'regions' | 'settings';

export interface LayoutPreferences {
  regionsWidth: number | null;
  settingsWidth: number | null;
  regionsCollapsed: boolean;
  settingsCollapsed: boolean;
}

export const LAYOUT_PREFERENCES_KEY = 'ibl-ephys-atlas:layout:v1';

export const PANEL_WIDTH_LIMITS: Readonly<Record<LayoutPanel, { min: number; max: number }>> = {
  regions: { min: 250, max: 420 },
  settings: { min: 280, max: 440 },
};

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  regionsWidth: null,
  settingsWidth: null,
  regionsCollapsed: false,
  settingsCollapsed: false,
};

export function clampPanelWidth(panel: LayoutPanel, width: number): number {
  const limits = PANEL_WIDTH_LIMITS[panel];
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

export function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  if (raw === null) return { ...DEFAULT_LAYOUT_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_LAYOUT_PREFERENCES };
    return {
      regionsWidth: parseWidth(parsed.regionsWidth, 'regions'),
      settingsWidth: parseWidth(parsed.settingsWidth, 'settings'),
      regionsCollapsed: parsed.regionsCollapsed === true,
      settingsCollapsed: parsed.settingsCollapsed === true,
    };
  } catch {
    return { ...DEFAULT_LAYOUT_PREFERENCES };
  }
}

export function serializeLayoutPreferences(preferences: LayoutPreferences): string {
  return JSON.stringify(preferences);
}

function parseWidth(value: unknown, panel: LayoutPanel): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampPanelWidth(panel, value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
