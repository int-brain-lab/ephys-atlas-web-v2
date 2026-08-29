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

Browser history records changes of scientific context, not every shareable
refinement. User-committed dataset/release, feature, representation, and
parcellation changes create checkpoints. Coordinates, selected regions,
ordering, statistics, and color controls refine the current checkpoint. Back
and Forward restore the complete URL state; they are not a substitute for a
general undo/redo system. See D029.

## UX-030 — Keyboard interaction

Use semantic HTML and standard keyboard interaction first, augmented by a small discoverable shortcut set.

Implemented launch shortcuts:

- `Shift + Down` / `Shift + Up`: select the next/previous feature in manifest order without wrapping.
- `/`: open the feature catalogue and focus its search field.
- `[` / `]`: toggle the brain-regions / visualization-settings panel. At
  drawer breakpoints the same keys toggle the existing drawers.
- `Esc`: close transient UI or leave focus/maximized mode.
- Arrow keys: move through slices while an anatomical view has keyboard focus.
- `Enter` / `Space`: standard activation/selection behavior.
- `?`: show Help and its keyboard-shortcut reference.

Global shortcuts do not fire while the user is editing text or another form
control, or while a modal dialog is open. Feature changes retain their normal
URL persistence, representation fallback, stale-load cancellation, and bounded
adjacent-feature prefetch behavior. Feature boundaries do not wrap. Help is
also available from the visible Help header action or the phone overflow menu.

All important actions remain available without keyboard shortcuts.

## UX-031 — Scientific accessibility

- Choose perceptually appropriate default colormaps; avoid rainbow defaults.
- Never encode important state by color alone.
- Selection identity should combine categorical color with outline/marker/form cues.
- Color scales must expose numerical ticks, values, and units.
- Launch does not require a broad preset-based accessibility theme system if these fundamentals are satisfied.

## UX-032 — Resizable panels

Support only controlled resizing where it materially helps scientific exploration.

- Inline region-browser and settings-panel widths are resizable within bounded
  ranges; dragging, focused-separator arrow keys, and double-click reset are
  supported.
- Either inline panel may be collapsed from its header and restored from a
  small edge control. The center workspace receives the released width.
- Width and collapse preferences persist locally, never in scientific share
  URLs. Saved widths are clamped before use.
- Analytical-band height is resizable/expandable.
- Tablet and phone retain the existing drawer composition rather than exposing
  resize handles.
- Arbitrary docking, rearranging, or free-form IDE-style layout management is out of scope.

## UX-033 — Task-first Help

Help uses repository-owned Markdown as its reviewable content source. Its
primary surface is a four-step Quick Start organized around user tasks rather
than a miniature reconstruction of the application. Regional and volume
guidance follows the active representation; concepts, shortcuts, and credits
use progressive disclosure below the Quick Start.

The browser renders only a constrained trusted Markdown subset and rejects raw
HTML and images. Help remains usable without the walkthrough, video, or an
external documentation site.

An optional five-step “Show me the essentials” walkthrough is launched from
Help. Its representation-specific copy also lives in repository-owned Markdown;
typed TypeScript configuration maps those steps to stable interface anchors.
The walkthrough highlights the real control that is visible in the current
responsive layout, never simulates the application, and does not open panels or
change scientific state, workspace state, or URL identity. It exposes progress,
Back, Next, Skip, and Done controls. Escape dismisses it and returns focus to the
visible Help entry point. The walkthrough is restartable and is not shown
automatically on first visit.
