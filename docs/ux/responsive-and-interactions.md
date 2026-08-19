# Responsive and interaction behavior

Status: accepted

## UX-025 — Responsive strategy

- Desktop provides the complete workspace with all three orthogonal slices visible simultaneously.
- Tablet reflows to one dominant anatomical view at a time with immediate access to the other views; region navigation and analysis use drawers/panels.
- Phone provides a reduced exploration mode with one anatomical view at a time, feature/region search, values, and sharing. It is not required to reproduce the full desktop workspace.

## UX-026 — Feature switching

- Keep the current feature rendered while a newly requested feature loads.
- Signal the loading state clearly in context.
- Swap to the new feature atomically when its required data are ready.
- If another feature is requested before completion, cancel or supersede the previous request when technically possible.

## UX-027 — Loading and cache behavior

- Render the application shell immediately.
- Initial-load placeholders should be local to the components awaiting data.
- Cached data should appear without celebratory or noisy cache-hit UI.
- Show transfer/progress information only for meaningfully large operations.

## UX-028 — Error behavior

- Prefer localized component-level errors with retry actions and expandable technical details.
- Failure of a secondary view must not break otherwise usable primary views.
- Dataset/release failures are workspace-level errors and must provide a route back to a valid state.
- Local-import errors should distinguish warnings from fatal validation errors and identify the offending file/field/value when possible.

## UX-029 — URL state vs local preferences

Persist scientific state in the URL and interface preferences locally.

URL/shareable state includes dataset/release, feature, representation, coordinates, selected regions, mapping/statistic, color encoding, and active scientific view state where appropriate.

Local-only preferences include drawer widths, whether a settings panel was left open, theme/density preferences, and similar non-scientific interface state.

## UX-030 — Keyboard interaction

Use semantic HTML and standard keyboard interaction first, augmented by a small discoverable shortcut set.

Suggested launch shortcuts:

- `/`: focus the relevant search surface.
- `Esc`: close transient UI or leave focus/maximized mode.
- Arrow keys: move through slices while an anatomical view has keyboard focus.
- `Enter` / `Space`: standard activation/selection behavior.
- `?`: show keyboard-shortcut help.

All important actions must remain available without keyboard shortcuts.

## UX-031 — Scientific accessibility

- Choose perceptually appropriate default colormaps; avoid rainbow defaults.
- Never encode important state by color alone.
- Selection identity should combine categorical color with outline/marker/form cues.
- Color scales must expose numerical ticks, values, and units.
- Launch does not require a broad preset-based accessibility theme system if these fundamentals are satisfied.

## UX-032 — Resizable panels

Support only controlled resizing where it materially helps scientific exploration.

- Region-browser width may be resizable.
- Analytical-band height is resizable/expandable.
- Settings-panel width may be resizable if implementation cost remains small.
- Arbitrary docking, rearranging, or free-form IDE-style layout management is out of scope.
