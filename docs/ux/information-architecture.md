# UX information architecture

## IA-001 — Workspace hierarchy

Status: accepted

The default desktop experience uses a single scientific workspace with a strong visual hierarchy.

- Coronal, sagittal, and horizontal slices are the primary views and dominate the default workspace.
- Top, Swanson, and 3D are secondary views. They remain readily accessible but are not all permanently visible at the same time.
- All views share one scientific state: dataset/release, feature, mapping/statistic, color encoding, coordinates, hovered region, and selected regions.
- Region exploration and descriptive comparison remain tightly coupled to the primary slice workspace.
- Comparison may expand into a larger analysis workspace without becoming a separate application.
- Volume representations should reuse the same overall shell and state model where practical.

Rationale: preserve anatomical context and fast linked exploration without shrinking six views into competing thumbnails. This also matches the launch-critical vertical slice: regional feature -> linked slices -> region selection -> histogram/comparison.

## IA-002 — Dataset, release, and feature hierarchy

Status: accepted

Dataset and feature are primary exploration controls. Release/version is secondary context rather than a permanently prominent peer control.

- The currently selected dataset is always identifiable.
- Feature selection is optimized for frequent switching.
- The resolved immutable release/version is visible but visually subdued in normal exploration.
- A user can explicitly change release/version from dataset details or an adjacent secondary control.
- Paper-facing defaults should resolve to an immutable publication snapshot; aliases such as `latest` may be shown as aliases while still exposing the resolved immutable release.

Rationale: users commonly switch features, sometimes switch datasets, and rarely switch releases. The visual hierarchy should reflect that frequency without hiding provenance.

## IA-003 — Primary controls

Status: accepted

Use a compact top-level context bar plus an on-demand settings panel.

- Dataset and feature remain directly visible in the primary context bar.
- Mapping, statistic, colormap, range, scaling, and similar display controls live in an adjacent settings panel or popover that can stay open while tuning.
- The settings panel must not permanently reserve a large slice of horizontal workspace.
- The current mapping/statistic and important non-default encoding state must remain legible from the collapsed state.

Rationale: dataset and feature define the scientific object being explored; display encodings are frequently adjusted but should not compete permanently with anatomical views.

## IA-004 — Feature discovery

Status: accepted

Feature selection uses a compact picker that opens a substantially larger searchable catalogue.

- The collapsed control shows the current feature clearly.
- Opening it provides immediate text search plus hierarchical/categories browsing.
- Results expose useful metadata such as short description, unit, and representation type where available.
- Categories support scanning without forcing a deep tree interaction.
- Recent or previously used features may be surfaced as a convenience without replacing deterministic search/browse.

Rationale: a native select does not scale to a rich feature catalogue, while a permanently open catalogue would consume exploration space.

## IA-005 — Region navigation

Status: accepted

Use a hybrid region browser centered on a compact value-oriented list, with anatomical hierarchy available as context rather than as the sole primary navigation model.

- Region search supports names and acronyms.
- The principal list is optimized for scanning, selection, sorting/filtering, and reading the current feature value visually.
- Hierarchical Allen relationships remain accessible, including parent/child context around the active region.
- The design must allow compact visual encodings next to region names rather than relying only on numeric values.

Rationale: a pure hierarchy is anatomically faithful but inefficient for comparing feature values; a pure flat list loses anatomical context. The hybrid keeps both tasks efficient.

## IA-006 — Orthogonal slice layout

Status: accepted

The default desktop exploration layout presents coronal, sagittal, and horizontal slices in one horizontal band with unequal widths reflecting their geometry.

- Sagittal receives the largest horizontal allocation.
- Coronal receives an intermediate allocation.
- Horizontal is narrower.
- The three views share a common visual baseline/height where practical.
- Each view can be focused/maximized independently.
- The layout should derive from calibrated display geometry rather than arbitrary equal thirds.

Rationale: equal columns waste space because the views have materially different aspect ratios. A weighted band keeps all three linked views simultaneously useful.
