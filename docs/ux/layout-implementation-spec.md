# Layout implementation specification

Status: accepted implementation contract for the first HTML/CSS pass

This document translates the accepted UX direction into an implementation-oriented layout and CSS contract. It is intentionally about HTML/CSS structure, geometry, visual hierarchy, responsive composition, and implementation sequence. It does **not** specify data loading, scientific rendering, 3D, or detailed application behavior.

The visual reference is the accepted dark scientific-instrument mockup, but the mockup is art direction rather than a pixel-perfect target. The real browser implementation becomes the source of truth once reviewed.

## 1. Implementation strategy

Build from the outside inward:

1. responsive empty shell;
2. visual tokens and reusable panel/control primitives;
3. header/context bar;
4. region browser and selected-region area using representative static content;
5. generic anatomical view frame and three empty slice frames;
6. secondary-view slot and compact global-distribution band;
7. compact analysis launcher with a responsive comparison tray/sheet;
8. settings panel;
9. feature catalogue and secondary drawers/popovers;
10. replace representative content with real application state/data incrementally.

Every block should go through the same cycle before moving on: semantic markup -> visual styling -> responsive behavior -> interaction states -> browser screenshot review.

Do not postpone responsive work until the end. Each block is complete only when its layout behavior is acceptable in all supported composition regimes.

## 2. Relationship to the current frontend foundation

The integrated `main` implementation has the intended high-level separation:
`app.ts`, core/domain/application/data/rendering modules, `ui/app-shell.ts`,
Playwright, and a single `styles.css` entry point.

Do not rewrite the TypeScript architecture for this work. Evolve `AppShell` and split the existing stylesheet as the visual surface grows.

`web/src/styles.css` should remain the CSS entry point imported by the application, but become primarily an import/layer manifest rather than the location of all rules.

Recommended structure:

```text
web/src/
  styles.css
  styles/
    tokens.css
    reset.css
    base.css
    layout/
      app-shell.css
      workspace.css
      responsive.css
    components/
      panel.css
      controls.css
      app-header.css
      region-browser.css
      selected-regions.css
      view-frame.css
      secondary-view.css
      distribution.css
      analysis.css
      settings-panel.css
      overlays.css
    utilities.css
```

Do not create a home-grown utility framework. `utilities.css` should remain tiny and contain only genuinely cross-cutting helpers such as visually-hidden text.

Use cascade layers to make ownership/order explicit:

```css
@layer reset, base, layout, components, utilities;
```

Component files should own component appearance; layout files should own macro geometry. Avoid putting feature-specific styling into `app-shell.css`.

## 3. Semantic DOM regions

The exact TypeScript construction is flexible, but the rendered document should have approximately this semantic structure:

```html
<div class="atlas-app" data-layout="wide">
  <header class="app-header">...</header>

  <main class="app-body">
    <aside class="region-pane" aria-label="Brain regions">...</aside>

    <section class="workspace" aria-label="Atlas workspace">
      <section class="slice-strip" aria-label="Orthogonal brain slices">
        <section class="view-frame" data-view="coronal">...</section>
        <section class="view-frame" data-view="sagittal">...</section>
        <section class="view-frame" data-view="horizontal">...</section>
      </section>

      <section class="context-strip">
        <section class="secondary-view">...</section>
        <section class="distribution-band">...</section>
      </section>

      <section class="analysis-panel" data-state="compact">...</section>
    </section>

    <aside class="settings-pane" aria-label="Visualization settings">...</aside>
  </main>
</div>
```

Transient drawers/popovers should be siblings at the shell level or use the Popover/Dialog APIs where appropriate rather than being deeply nested inside unrelated components.

Important geometry rules:

- every Grid/Flex child that may shrink must receive `min-width: 0` where necessary;
- scrolling belongs to the pane that owns the content, not to arbitrary inner descendants;
- desktop is a viewport application (`100dvh`) with controlled internal scrolling;
- absolute positioning is reserved for genuine overlays inside scientific views: crosshairs, hover labels, view badges, maximize controls, etc.;
- macro layout must use Grid/Flex, never absolute positioning.

## 4. Desktop macro layout

### Wide desktop

Starting composition target: roughly `>= 1480px` viewport width. This is a tuning value, not a sacred platform breakpoint.

```text
┌────────────────────────────── header ──────────────────────────────┐
│ dataset  release  feature  representation  mapping/stat  actions │
├─────────────┬──────────────────────────────────────┬───────────────┤
│             │ coronal      sagittal     horizontal │               │
│   regions   ├──────────────┬───────────────────────┤   settings    │
│             │ secondary    │ global distribution   │               │
│  selected   ├──────────────┴───────────────────────┤               │
│             │ analysis / comparison                │               │
└─────────────┴──────────────────────────────────────┴───────────────┘
```

Recommended starting dimensions:

- app header: `52–58px`;
- region pane: `clamp(250px, 17vw, 292px)`;
- settings pane: `clamp(286px, 19vw, 326px)`;
- gaps between major panels: `6–8px`;
- outer shell inset: `6–8px` rather than large page margins;
- center workspace: always `minmax(0, 1fr)`.

The application should feel spatially continuous. Avoid large gutters or isolated white/bright cards.

Suggested shell grid shape:

```css
.app-body {
  display: grid;
  grid-template-columns:
    clamp(15.625rem, 17vw, 18.25rem)
    minmax(0, 1fr)
    clamp(17.875rem, 19vw, 20.375rem);
  gap: var(--space-2);
  min-height: 0;
}
```

### Slice strip

The three slices use unequal widths based on display geometry rather than equal thirds.

Starting ratio:

```css
.slice-strip {
  display: grid;
  grid-template-columns:
    minmax(0, 1.15fr)
    minmax(0, 1.5fr)
    minmax(0, 0.9fr);
  gap: var(--space-2);
}
```

Sagittal is largest, coronal intermediate, horizontal narrowest. Tune these ratios against the real calibrated assets once integrated.

### Workspace vertical structure

In normal exploration, the slices dominate. The secondary view/global distribution row is smaller, and comparison is represented by a compact launcher band.

A useful starting point is:

```css
.workspace {
  display: grid;
  grid-template-rows:
    minmax(17rem, 1fr)
    clamp(9rem, 21vh, 12rem);
  gap: var(--space-2);
  min-height: 0;
  padding-bottom: calc(2.25rem + var(--space-2));
}
```

The exact row values must be tuned using 900px and 800px-high browser screenshots.

Opening analysis does not resize the workspace. Desktop and tablet use a
nonmodal comparison tray anchored immediately above the persistent launcher,
so the atlas and region browser remain interactive while the comparison is
visible. Strong elevation, a cyan top edge, a distinct header, selected-region
count, slide-up motion, and an explicit minimize control make its overlay state
clear. Phones present the same content as a modal bottom sheet with a backdrop.
Comparison content scrolls inside the tray or sheet without changing scientific
view geometry.

## 5. Responsive composition regimes

Do not continuously squeeze the desktop layout to phone width. Use explicit composition changes.

The following breakpoints are **initial engineering values** and should be adjusted when real screenshots reveal where the scientific views become unusable.

### Regime A — wide desktop: `>= 1480px`

- region pane visible;
- three linked slices visible;
- settings pane visible;
- secondary/global-distribution strip visible;
- compact analysis launcher visible; comparison opens as an anchored nonmodal tray.

### Regime B — compact desktop: `1100px–1479px`

- region pane remains visible;
- three linked slices remain visible;
- settings becomes an overlay/drawer opened from the context bar;
- center workspace gains the reclaimed width;
- comparison retains the anchored nonmodal tray behavior.

This regime is important for 1280px and 1440px laptop/desktop screens.

### Regime C — tablet / narrow workspace: `760px–1099px`

- region pane becomes a drawer;
- settings remains a drawer;
- one anatomical slice is dominant at a time;
- Coronal / Sagittal / Horizontal switching remains immediate;
- secondary views are accessible through the same view-switching mechanism;
- analysis remains available through the compact launcher and nonmodal tray;
- controls use touch-appropriate target sizes.

### Regime D — phone: `< 760px`

This is intentionally a reduced explorer, not a compressed desktop application.

- one anatomical/scientific view at a time;
- compact header with dataset/feature context and overflow actions;
- regions and settings are drawers/sheets;
- comparison opens as a bounded bottom sheet;
- search, value inspection, selection, and share remain available;
- large comparison tables and dense multi-panel layouts are not required to appear simultaneously.

Use media queries for composition changes and container queries for component-internal adaptation when useful.

Do not create many micro-breakpoints. Start with these regimes and add another only when a concrete layout failure demonstrates the need.

## 6. Visual system: dark scientific instrument

The accepted visual direction is a continuous dark navy/blue-black scientific workspace, not a generic SaaS dashboard.

Core principles:

- scientific data should be the most colorful content on screen;
- UI chrome should use restrained blue/neutral accents;
- avoid large white or light-gray surfaces;
- panels are separated mainly by subtle luminance shifts and fine borders;
- avoid excessive card nesting;
- control backgrounds should be integrated into the surrounding surface;
- bright accent colors used for selected regions must not leak into generic UI controls.

Starting palette (subject to browser review):

```css
:root {
  color-scheme: dark;

  --color-bg: #071019;
  --color-surface-1: #0a1621;
  --color-surface-2: #0d1b27;
  --color-surface-3: #112331;
  --color-surface-hover: #142a3a;

  --color-text: #e6edf4;
  --color-text-secondary: #9cafbf;
  --color-text-muted: #6f8495;

  --color-border: rgb(163 194 216 / 12%);
  --color-border-strong: rgb(163 194 216 / 22%);

  --color-accent: #55a7f7;
  --color-accent-soft: rgb(85 167 247 / 14%);
  --color-focus: #78bdff;
}
```

These are implementation seeds, not a branding decision. Tune the actual colors in the browser while preserving the luminance hierarchy.

Do not use the selected-feature colormap for generic controls. Scientific colormaps and region-selection categorical colors belong to the data layer.

## 7. Spacing, radius, typography, controls

Use a small tokenized spacing scale rather than arbitrary local values.

Starting scale:

```css
:root {
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.5rem;   /* 24px */

  --radius-sm: 4px;
  --radius-md: 7px;
  --radius-lg: 10px;
}
```

This is a dense scientific interface. Prefer compact spacing and information density over oversized consumer-app controls.

Typography starting points:

- body/data UI: `13px` desktop, with `14px` where readability requires it;
- small labels/metadata: `11–12px`;
- panel headings: `11–12px`, optionally uppercase with restrained tracking;
- primary feature/dataset values: `13–14px`, medium weight;
- numerical data should use `font-variant-numeric: tabular-nums`;
- use the existing system/Inter-compatible stack; do not introduce a remote font dependency merely to match a mockup.

Desktop controls may be approximately `30–34px` high. Tablet/touch regimes should increase important target heights toward `40–44px` without globally making the desktop UI loose.

## 8. Panel primitive

Define a restrained panel primitive used by region/settings/view/analysis surfaces.

A panel should normally have:

- one surface color;
- one subtle border;
- modest radius;
- no heavy shadow;
- compact header;
- explicit overflow behavior.

Avoid "card inside card inside card" composition. Subsections inside a panel should normally use spacing and separator lines rather than another rounded rectangle.

The anatomical view frame is a specialized panel with a visualization viewport and overlay layer, but should inherit the same surface/border language.

## 9. CSS ownership and selector rules

Enforce these practices from the beginning:

- prefer class selectors;
- avoid styling by IDs;
- avoid selectors deeper than roughly 2–3 levels;
- do not depend on DOM position for component identity;
- avoid `!important`;
- component state uses `data-*` attributes or explicit classes;
- JS should not assign arbitrary presentation properties directly;
- inline/CSS-variable values are acceptable for genuine runtime data or geometry, e.g. `--value-position`, `--analysis-height`, `--region-pane-width`;
- use `:focus-visible` for strong keyboard focus;
- hover styling should not be the only indicator of an interactive element;
- include `prefers-reduced-motion` handling before adding decorative motion.

Preferred state examples:

```css
.region-row[data-selected="true"] { ... }
.view-frame[data-state="loading"] { ... }
.analysis-panel[data-state="expanded"] { ... }
```

Avoid selectors such as:

```css
.sidebar .section .list .row .label span { ... }
```

Prefer component-owned names such as:

```css
.region-row__label { ... }
```

Use BEM-like element suffixes where they improve clarity, but do not impose a ceremonial naming methodology across the whole project.

## 10. Scrolling and resizing

Desktop shell uses the viewport height and internal scrolling.

- region list scrolls inside the region pane;
- settings content scrolls inside the settings pane/drawer;
- the anatomical canvases/SVGs do not create page scroll;
- comparison content scrolls internally within its tray or phone sheet;
- avoid nested scrolling regions unless the inner scroll has a clear scientific purpose.

Resizable UI is intentionally limited:

- region-pane width may be resized within min/max bounds;
- settings width may be resizable later if useful;
- no free docking or panel rearrangement.

Store these sizes as local UI preferences, not shareable scientific URL state.

## 11. Empty-shell Phase 1

Phase 1 deliberately contains almost no scientific content. Use labels/placeholders only where necessary to understand geometry.

Required visible regions:

- header/context bar placeholder;
- region pane placeholder;
- coronal view frame;
- sagittal view frame;
- horizontal view frame;
- secondary-view placeholder;
- distribution placeholder;
- compact analysis placeholder;
- settings placeholder or drawer depending on viewport.

Do **not** implement fake complex charts merely to make the page attractive. The empty layout itself must already have convincing proportions and visual hierarchy.

The shell should be testable independently of the data repository and renderer. Existing frontend state can continue to exist, but shell geometry must not require successful dataset loading.

### Phase-1 review viewports

Create Playwright screenshots at minimum for:

- `1680 × 1050` — wide desktop;
- `1440 × 900` — compact desktop;
- `1280 × 800` — compact laptop;
- `1024 × 768` — tablet/narrow composition;
- `390 × 844` — phone reduced composition.

The generated design mockup is **not** the screenshot-test golden image. Once the first real HTML/CSS shell is visually approved, that implementation becomes the baseline for visual regression tests.

### Phase-1 acceptance criteria

- no unexpected horizontal viewport scrolling;
- desktop shell uses the full available viewport without large dead margins;
- at 1680px the left and right panes can coexist without making the three slices useless;
- at 1440px and 1280px settings can move to a drawer and the three slice placeholders remain useful;
- around tablet width the composition switches intentionally to one primary anatomical view rather than merely shrinking three views;
- phone mode is visibly simplified rather than compressed;
- all panes have explicit overflow behavior;
- focus outlines are visible and not clipped;
- tab order follows semantic visual order;
- layout does not depend on data being loaded;
- empty-state surfaces already resemble the accepted dark scientific visual direction;
- resizing between regimes does not leave orphaned overlays/drawers or impossible geometry.

## 12. Subsequent implementation blocks

After Phase 1 is approved, proceed block by block in this order unless integration needs dictate otherwise:

### Phase 2 — context header

Implement real dataset/feature/representation context and action affordances. Keep release visually secondary. Do not yet overbuild the feature catalogue.

### Phase 3 — region browser

Use representative static rows first to settle density, long names, value bars, selected/active/hover states, scrolling, and responsive drawer behavior. Then connect real regions.

### Phase 4 — anatomical view frames

Implement reusable frame chrome, view titles, coordinates, maximize affordance, loading/error states, and renderer target. Integrate curated real SVG slices as soon as possible; this is where browser screenshots replace placeholder geometry.

### Phase 5 — secondary view + global distribution

Implement the shared secondary slot and compact distribution band. Use representative distributions before wiring full data if necessary.

### Phase 6 — analysis/comparison

Implement compact and expanded geometry first, then selected-region distribution small multiples and summary table.

### Phase 7 — settings

Implement the right-side wide-desktop pane plus compact-desktop/tablet drawer using the same component. Keep dataset/release, feature, representation, and parcellation in custom context-header pickers; reserve this pane for statistic and color encoding, and avoid generic form-page styling.

### Phase 8 — overlays and polish

Feature catalogue, Info, Download, Share, keyboard help, local-import summary, detailed loading/errors, accessibility polish, and final responsive tuning.

## 13. Lightweight UI lab

A small development-only UI gallery is recommended once individual components begin accumulating states. Do not add Storybook unless there is a demonstrated need.

A simple `ui-lab` dev entry or development query mode can render representative states such as:

- region row: normal / hover / active / selected / missing / very long name;
- view frame: empty / loading / ready / error / focused;
- panel: normal / collapsed / drawer;
- feature control: closed / loading / open / error;
- settings controls at narrow/wide component widths.

This exists to make CSS iteration and screenshot review cheap; it is not a second application architecture.

## 14. Definition of success

The first HTML/CSS milestone is successful when an empty or near-empty browser implementation already has the same qualities as the accepted visual direction: dark, calm, dense, scientific, spatially coherent, and centered on the anatomical workspace.

Only after that shell is approved should detailed scientific blocks be visually finalized. This avoids confusing layout problems with rendering/data problems and gives the rendering/data/frontend workstreams a stable surface to integrate into.
