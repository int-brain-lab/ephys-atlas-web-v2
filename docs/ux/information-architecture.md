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

## IA-007 — Hover, active region, and selection

Status: accepted

Hover, active region, and persistent selection are distinct interaction states.

- Hover is temporary and provides lightweight highlighting plus contextual information.
- Clicking a region toggles its persistent selection state.
- The most recently clicked/activated region is additionally the active region for contextual details and navigation.
- Persistent selection must not replace or obscure the feature's scalar color encoding.
- Selected regions are primarily indicated with outlines/accent marks or another non-destructive overlay.
- Selection behavior must work equivalently from slices, region lists, search results, and secondary anatomical views where supported.

Rationale: the basic comparison action should not require modifier keys, while the feature map must remain visually interpretable after selecting multiple regions.

## IA-008 — Selected-region summary

Status: accepted

Selected regions are shown in a compact dedicated area that can expand or scroll rather than consuming unlimited workspace.

- Show roughly 3–5 selected rows without expansion on a typical desktop layout.
- Each row should include a stable selection identifier/accent, acronym/name, compact visual value encoding, exact formatted value, and a remove action.
- Activating a selected row makes that region active and, where useful, recenters or reveals it in anatomical views.
- Clearing the full selection is an explicit nearby action.
- The design must remain usable for larger selections without turning into horizontal chips.

Rationale: region names and metadata are too information-dense for chips, while a permanently tall selection panel would penalize the common small-selection case.

## IA-009 — Global distribution band

Status: accepted

A compact analytical band sits below the primary anatomical views.

- Its default compact state contains the global feature distribution/histogram and selected-region markers or overlays.
- The distribution uses the same units and effective value transform/range context as the anatomical encoding where scientifically appropriate.
- Selection and hover should be linked bidirectionally between the distribution and anatomical/region views when feasible.
- The band can expand vertically into the comparison workspace.

Rationale: the distribution is scientific context rather than a configuration control and should remain continuously available without occupying a full panel.

## IA-010 — Comparison workspace

Status: accepted

Comparison is an expanded state of the analytical band, not a disconnected page or modal.

- The analytical band can expand by explicit control and optionally by drag-resizing.
- In expanded mode it may consume roughly 50–70% of the available vertical workspace.
- Primary slices remain visible above in reduced form so anatomical context is preserved.
- The workspace supports descriptive comparison of selected regions using appropriate distributions/plots and summary statistics.
- Launch does not require inferential statistical tests, but the layout should leave room for richer analyses later.
- Region selection remains shared with the rest of the application; entering comparison does not create a second selection state.

Rationale: comparison is a deeper phase of the same exploration task. Preserving anatomical context and shared state avoids the navigation discontinuity of a separate statistics page.

## IA-011 — Secondary anatomical views

Status: accepted

Top, Swanson, and 3D share a secondary-view slot instead of appearing simultaneously by default.

- The user can switch the slot among Top, Swanson, and 3D.
- The active secondary view participates in shared hover/selection state where technically supported.
- Any secondary view can be focused/maximized.
- Secondary views must remain readily discoverable without competing for equal permanent area with the three orthogonal slices.

Rationale: these views add valuable anatomical context but are not equally central to the launch-critical linked-slice workflow.

## IA-012 — Focus/maximized views

Status: accepted

Focusing a view enlarges it within the application shell while preserving essential scientific context.

- A focus/maximize affordance is available on each primary and secondary view.
- Focus mode retains the dataset/feature context bar and access to essential display controls.
- Active coordinates/region context remain visible.
- `Esc` restores the default workspace; double-click may be an additional direct manipulation shortcut where it does not conflict with view interaction.
- Arbitrary IDE-style docking and free panel rearrangement are out of scope for launch.

Rationale: users need detailed inspection without losing scientific state, but fully user-programmable layouts add substantial complexity with little launch benefit.
