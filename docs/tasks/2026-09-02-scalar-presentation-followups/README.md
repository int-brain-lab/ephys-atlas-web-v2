# Scalar-presentation follow-ups

Status: planned handoff; no implementation has started.

## Context

This handoff records a repository-owner review of several follow-up viewer
refinements. The work is deliberately split into small tasks so inexpensive or
low-effort agents can implement one bounded behavior at a time without making
scientific or product choices.

The pinned v1 checkout at `int-brain-lab/ephys-atlas-web@1d908bea` exposed
`mean`, `median`, `std`, `min`, and `max` as peer regional statistics and
offered Magma, YlGn, YlOrRd, Reds, Purples, Blues, Cividis, Viridis, and
Coolwarm. V2 currently exposes Mean, Median, Minimum, and Maximum for coloring,
has only Viridis, Cividis, and Magma in its palette registry, and stores a
release-owned optional `display.colormap` without resolving it as an automatic
viewer preference.

Volume regional distributions are intentionally excluded from this work.
D050 and LS03-03 define the current volume distribution as global and
valid-voxel-only. Adding anatomical regional populations would require a new
scientific and release-contract decision.

## Accepted behavior

- A volume pointer over a voxel classified exactly as `outside` shows no
  tooltip. Keep valid-voxel, missing-value, unsupported-validity, and
  out-of-grid inspection behavior unchanged.
- Add regional `std` as an ordinary selectable statistic, matching v1 and the
  behavior of Mean, Median, Minimum, and Maximum. Do not special-case its
  coloring, sorting, tooltip, selected-region marker, or URL behavior.
- Expand the palette registry to Viridis, Cividis, Magma, Plasma, Inferno,
  Blues, YlOrRd, and Coolwarm. The first seven are sequential; Coolwarm is
  diverging. Pin lookup-table provenance and keep SVG, Canvas, legends, and
  controls on the same registry.
- Treat the existing representation-level `display.colormap` as the preferred
  palette. An automatic viewer selection resolves to that preference and
  falls back to Viridis when it is absent. An explicit user palette overrides
  Auto, persists across feature changes, and is written to URL v4; an omitted
  `cmap` means Auto. Reset returns to Auto.
- Diverging normalization has an explicit finite, release-owned center. Use a
  representation display field named `diverging_center`. A release may declare
  it even when its preferred palette is sequential, thereby allowing an
  explicit diverging user choice. A preferred diverging palette requires it.
  When it is absent, diverging palettes are unavailable rather than silently
  centering on the arithmetic midpoint.
- When the active range straddles the center, map the lower and upper sides
  independently to `[0, 0.5]` and `[0.5, 1]`. If a manual range lies wholly
  below or above the center, use only `[0, 0.5]` or `[0.5, 1]` respectively.
  Equality at a range boundary maps that boundary to `0.5`. Apply the same
  normalization to regional SVG, volume Canvas, and color legends.
- Do not assign preferred palettes or diverging centers to the real channel,
  cluster, Brain-Wide Map, or volume feature catalogs in this task. Those
  feature-by-feature scientific presentation choices are deferred to Q16 and
  require a reviewed future immutable release.
- Replace the region-row fill bar with a dot on a faint shared track. Its
  linear domain is the finite minimum and maximum of the selected regional
  statistic across the active parcellation. It is independent of observation
  histogram domains, value-scale transforms, color bounds, and manual color
  range. A degenerate domain places every finite value at the center. Show the
  shared statistic/domain once near the region list and retain exact value,
  unit, title, and accessible-label disclosure per row.

## Implementation plan

Land each numbered task as a coherent green commit. Tasks 1, 2, and 3 are
independent. Task 4 depends on task 3. Task 5 depends on tasks 3 and 4. Task 6
is independent of the palette work. Task 7 is deferred and must not be started
under this handoff.

### 1. Hide outside-brain volume tooltips

Scope:

- In the application inspection path, hide the active projection tooltip and
  return when `VolumeInspection.status === 'outside'`.
- Do not suppress `missing`, `out-of-grid`, or `unsupported-validity`.
- Update synthetic Playwright coverage to prove both the hidden outside case
  and a retained non-outside diagnostic case. Update the opt-in real-volume
  assertion that currently expects an outside tooltip.

Likely seams: `web/src/app.ts`, `web/test/browser/volume.spec.ts`, and
`web/test/volume-candidate/volume-candidate.spec.ts`.

Acceptance: repeated pointer movement over outside-brain voxels never leaves a
stale tooltip visible; valid and diagnostic inspections retain their current
content.

### 2. Add `std` as a selectable regional statistic

Scope:

- Add `std` to `StatisticId`/`ColorStatisticId`, supported display-statistic
  parsing, regional materialization, settings options, and URL parsing.
- Offer it only when the loaded regional statistics contain it, exactly as for
  the existing optional statistics.
- Reuse the ordinary value map, coloring, ordering, tooltip, selected-region
  marker, formatting, and comparison behavior. Keep `count` non-colorable.
- Add unit coverage for parsing/materialization and URL round-trip plus a
  browser assertion for selection, coloring/list update, and `stat=std`.

Likely seams: `web/src/domain/types.ts`, `web/src/data/contracts.ts`,
`web/src/data/validation/primitives.ts`, `web/src/data/regional-loader.ts`,
`web/src/url/url-state.ts`, `web/src/ui/app-shell.ts`, and their existing unit
and browser tests.

Acceptance: selecting Standard deviation behaves like the other four regional
statistics and survives reload through URL v4.

### 3. Expand and classify the palette registry

Scope:

- Add Plasma, Inferno, Blues, YlOrRd, and Coolwarm to the three existing
  palettes. Preserve the exact case-sensitive IDs `viridis`, `cividis`,
  `magma`, `plasma`, `inferno`, `Blues`, `YlOrRd`, and `coolwarm`.
- Extend palette definitions from sequential-only to
  `sequential | diverging`.
- Use pinned official Matplotlib lookup tables at the same provenance/version
  as the current tables, or update all tables and the provenance comment in one
  reviewed mechanical change.
- Add deterministic endpoint/midpoint and gradient tests. Do not change any
  feature default in this task.

Likely seams: `web/src/application/colormap-palettes.ts`,
`web/test/unit/scalar-colormap.test.js`, and browser settings coverage.

Acceptance: every registered palette renders identically across CSS gradients,
regional SVG, and volume Canvas; unknown palette fallback does not become a
path for release-owned preferences.

### 4. Resolve release-preferred palettes through Auto

Scope:

- Represent the persisted choice as Auto or an explicit registered palette;
  keep the resolved effective palette separate, following the existing
  scale/domain pattern.
- Change the default and omitted URL behavior to Auto. Preserve explicit
  `cmap=<id>` links and reject/canonicalize unregistered values without a
  silent mismatch between selector and rendering.
- Resolve Auto from the active representation's existing
  `RepresentationDisplay.colormap`, falling back to Viridis.
- Render `Auto (<resolved label>)` in settings. Explicit choices survive
  feature and representation changes; Reset restores Auto.
- Add pure resolution tests plus feature-switch, representation-specific,
  reset, and URL browser coverage using synthetic fixtures only.

Likely seams: domain types/defaults/actions, URL state, a new or existing
application presentation resolver, `web/src/app.ts`, `web/src/ui/app-shell.ts`,
fixture display metadata, and tests.

Acceptance: a synthetic feature switch changes the effective palette only
while Auto is active, without creating `cmap` URL noise.

### 5. Add explicit diverging-center machinery

Scope:

- Add optional finite `diverging_center` to the canonical scalar-display
  schema, bundled schema, Python and TypeScript contracts/parsers/semantic
  validators, shared valid/invalid corpus, builders, and synthetic fixture in
  one coherent schema-v1 change.
- Validate that a preferred diverging palette has a center. Allow a center with
  a sequential preferred palette so the user may explicitly select Coolwarm.
  Disable diverging palette choices when the active representation has no
  center.
- Implement the accepted piecewise normalization identically for regional SVG,
  volume Canvas, gradients, and color-range presentation. Cover straddling,
  below-center, above-center, boundary-equality, and degenerate-side cases.
- Use synthetic data only. Do not edit the D054 selection artifacts or rebuild
  any real release.

Acceptance: no diverging palette can imply an invented midpoint, and all
producer/consumer/schema copies remain identical and green.

### 6. Replace region fill bars with shared-domain dots

Scope:

- Extract a pure finite regional-statistic extent/position helper.
- Render a fixed-width faint track and one dot rather than a left-origin fill.
- Add one compact shared label that names the selected statistic and formatted
  lower/upper endpoints. Preserve exact row title/ARIA value disclosure.
- Center dots for a finite degenerate domain and retain the current missing-row
  behavior. Do not couple the track to Full/Focused, Linear/Log/Signed-log, or
  color-range changes.
- Cover negative, positive, mixed-sign, degenerate, missing, and parcellation-
  change inputs in unit tests, plus one Playwright interaction/accessibility
  path.

Likely seams: `web/src/ui/regional/model.ts`, `row-view.ts`, `tree-view.ts`,
`controller.ts`, `web/src/styles/components/region-browser.css`, and regional
unit/browser tests.

Acceptance: the graphic answers only where a region's selected statistic lies
among the active parcellation's regional values and no longer resembles an
unlabelled proportion.

### 7. Deferred: volume distributions by anatomical region

Do not implement this from the current handoff. A future decision must define
the pinned annotation authority, voxel-center sampling, Allen/Beryl/Cosmos
mapping, bilateral pooling, void handling, denominators, exact shared bin
edges, typed-resource shape, and release rebuild policy. The browser must not
download and scan a complete production volume to synthesize these curves.

## Risks and stop conditions

- Do not choose real feature palette preferences or diverging centers. Stop at
  Q16 and use synthetic fixtures for infrastructure tests.
- A diverging palette without an explicit center is unavailable, not
  midpoint-inferred.
- Keep one schema-v1 contract. Task 5 must update every producer, consumer,
  bundled schema, validator, and fixture together.
- Do not mutate D054 selection artifacts or existing immutable releases.
- The region dot track is comparative UI, not a probability, observation
  distribution, color legend, or scientific transform.
- Do not weaken D050/LS03-03 by adding volume regional curves opportunistically.
- Preserve URL-persisted explicit choices, responsive layout, keyboard access,
  and retained renderer identity.

## Verification for each implementation task

Run focused unit/browser tests while developing. Before declaring any task
complete, run `just check`, update this handoff's status and next steps, and
commit only the intended coherent files.

## Relevant commits

- Planning handoff — the commit containing this file; locate with
  `git log -1 -- docs/tasks/2026-09-02-scalar-presentation-followups/README.md`.
