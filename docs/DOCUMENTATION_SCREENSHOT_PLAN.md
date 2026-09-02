# Documentation screenshot plan

Status: active implementation plan; no documentation screenshots are generated
or enforced yet.

## Objective

Add a small set of useful viewer screenshots to the reader-facing documentation
without creating a manual capture workflow or presenting synthetic fixtures as
scientific results. Screenshots should help readers recognize the interface and
locate important controls; prose and executable examples remain the authority
for behavior.

The first implementation uses only deterministic test data. Real scientific
screenshots are a separate, later publication task because they require an
approved immutable release and recorded provenance.

## Initial image set

Generate four images from browser scenarios rather than taking them by hand:

1. **Desktop overview** — the complete viewer at a fixed desktop viewport,
   showing the overall workspace and navigation.
2. **Linked anatomical views** — a locator-based crop of the coordinated
   coronal, sagittal, and horizontal views.
3. **Encoding and distribution controls** — a locator-based crop showing the
   scale, colormap, comparison, and distribution interface.
4. **Local import preview** — the deterministic local-archive review state
   before the user confirms import.

Prefer focused crops for explanations because they remain legible in the docs.
Keep the full-application image as orientation, not as the sole illustration.
Do not add screenshots for states that are clearer as text, code, or a semantic
browser test.

Every image generated in this first lane must be captioned **Synthetic
demonstration data** wherever it appears. The canonical
`fixtures/golden-v1/` release and deterministic authoring fixtures are test-only
inputs and must not be described as measured or published IBL data.

## Proposed implementation

Add a dedicated Playwright configuration and test suite under `web/`, separate
from the ordinary browser suite:

```text
web/playwright.docs.config.ts
web/test/docs-screenshots/docs-screenshots.spec.ts
docs/assets/generated/
```

The capture suite should reuse the existing test-only local-release server and
mount `fixtures/golden-v1/` directly. It must not copy the fixture into
`web/public/`, introduce a browser fallback dataset, or depend on a deployed
origin.

Each capture case declares:

- one stable application route and deterministic setup sequence;
- a fixed viewport and device scale factor;
- the expected application-ready state;
- a page or semantic locator capture boundary;
- the fixture/archive identity used by the scenario.

Before capture, wait for application readiness, document fonts, and the
specific visible state under test. Disable animations and transitions, hide the
text caret, and avoid arbitrary timeouts. Use semantic locators for component
crops rather than pixel coordinates.

Use Playwright screenshot assertions so the committed PNG is both the
documentation asset and the reviewed snapshot. Configure a small documented
pixel tolerance only for unavoidable browser rasterization differences; do not
mask meaningful application content merely to make the comparison pass.

## Commands and completion gate

Add these repository commands:

- `just docs-screenshots` regenerates the committed images intentionally by
  running Playwright with snapshot updates enabled.
- `just docs-screenshots-check` performs the same captures without updating
  files and fails on missing or changed images.

`just docs-screenshots-check` should become part of `just check` after the four
baseline images have been visually reviewed and accepted. CI then detects
stale screenshots whenever a relevant UI change alters the generated output.
The update command remains an explicit developer action; normal checks must
never rewrite repository files.

Keep a generated manifest beside the PNG files. It records stable capture
inputs such as the fixture identity, route, viewport, device scale factor, and
capture key. Do not include timestamps, local paths, or the current Git commit,
because those values create unrelated churn without improving reproducibility.

## Documentation integration

Embed the overview and focused viewer crops in
[`guides/using-the-viewer.md`](guides/using-the-viewer.md). Embed the import
preview in
[`data/CUSTOM_DATA_TUTORIAL.md`](data/CUSTOM_DATA_TUTORIAL.md). Keep captions,
labels, and explanatory callouts in Markdown instead of drawing them into the
PNG; this keeps prose searchable, accessible, and easy to update.

Use concise alt text that explains the interface purpose rather than repeating
every visible label. The surrounding guide must still make sense if images do
not load. Generated images should use stable descriptive filenames so links do
not change during ordinary regeneration.

## Real scientific screenshots

Do not mix real-data screenshots into the deterministic synthetic lane. A
future real-data capture may be added only when it can name an approved,
immutable release rather than a mutable alias such as `latest`. Its nearby
caption or durable metadata must record at least the release identity and make
the scientific source clear.

Real-data captures may be refreshed deliberately for a release or
documentation milestone, but they should not be regenerated implicitly by the
synthetic `just check` lane or require production network access in CI.

## Delivery sequence

1. Implement the dedicated Playwright configuration, capture cases, manifest,
   and the two `just` recipes.
2. Generate the four synthetic images twice from a clean state and confirm the
   second run has no diff.
3. Inspect every image at its rendered documentation size and at full
   resolution; confirm responsive composition, readable crops, correct dark
   theme, and absence of transient loading/error UI.
4. Add the images, captions, and alt text to the two reader guides.
5. Add the non-mutating screenshot check to `just check`, build the strict docs
   site, and run the complete local gate.
6. Commit the capture machinery, generated assets, documentation integration,
   and accepted baselines as one coherent vertical slice.

## Acceptance criteria

- all four images are produced without manual browser interaction;
- regeneration is deterministic on the repository's pinned Playwright browser;
- the ordinary check detects drift and never updates snapshots;
- component images are bounded by semantic locators, not hand-tuned crop
  coordinates;
- all first-lane images are visibly identified as synthetic demonstration data;
- no synthetic fixture becomes a runtime default or public scientific asset;
- the guides remain understandable and accessible without the images;
- the strict documentation build and `just check` pass.

Screenshot comparison is documentation and visual-regression evidence only. It
does not replace assertions for scientific identity, coordinates, transforms,
integrity, or rendered values.
