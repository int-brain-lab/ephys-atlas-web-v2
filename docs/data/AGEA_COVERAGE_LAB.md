# AGEA coverage lab

Status: runbook for the local exploratory UX lab requested on 2026-09-06.

The lab investigates Q19 using the original hash-pinned IBL volumes and their
supplied 200 µm anatomical labels. It is available only in Vite development mode
at `/app/?lab=agea-coverage`. It is not an AGEA scientific release, a production
dataset reader, or a new application renderer boundary. Q19 remains open.

## Run locally

First acquire the inputs and prepare the transport files using the
[AGEA audit reproduction commands](AGEA.md#reproduction). With those existing
files, run from the repository root:

```bash
uv run --project builder --extra test --locked python -m tools.agea_coverage_lab \
  --source artifacts/agea-metadata-sizing --transport artifacts/agea-browser-benchmark
AGEA_LAB_DIR=../artifacts/agea-browser-benchmark npm --prefix web run dev -- \
  --host 127.0.0.1 --port 4190
```

Open `http://127.0.0.1:4190/app/?lab=agea-coverage`. The environment variable is
resolved from Vite's `web/` working directory. No data is copied under
`web/public/`, and no source files are fetched automatically when opening the
lab. Missing configuration produces an explicit error. The configured server
serves only the declared local lab resources under `/__agea_lab__/`.

Preparation verifies all pinned source hashes, experiment order against the
source table and every declared compressed experiment hash. It adds a compact
lab metadata bundle, a signed int32 region-ID volume, and a uint16 measurement
count per voxel beside the existing experiment binaries. The original benchmark
files remain unchanged. Region IDs/names come from the pinned iblatlas region
table indexed by the supplied label volume. The aggregate count includes
measured zero and is divided by all 4,345 experiments, including experiments
with missing values at that position.

## Review alignment

Open `/app/?lab=agea-coverage&mode=alignment` after re-running preparation. This mode
uses the application's retained projection viewport factory and the pinned
website projection pack, not a separate anatomy renderer. Preparation adds the
verified float32 `image.npy` transport and fixed-transform evidence. It checks
the exact 20:1 native-index relationship and reports the larger AGEA extent;
it does not approve a reference-space identity for publication.

The lab uses the atlas website's shared dark-theme tokens. The default review
is a short guided pass, with experiment browsing and diagnostics collapsed:

1. Compare the white website outlines with the reference image in all three
   planes. Use **Website outlines** to toggle the overlay for comparison.
2. Optionally add a comment, then choose **Looks consistent**, **Unsure**, or
   **Mismatch**. Each button saves the current coordinates and advances to the
   next starting location. The five locations cover midline, striatum,
   hippocampus, cerebellum and anterior extent. **Previous**, **Next**, and the
   location selector allow navigation without recording a judgment.
3. **Download alignment review** before leaving. Notes are page-local; reload
   clears them. The last location does not wrap to the start. Saved notes can
   be revisited, and exported notes include their location label, exact cursor,
   experiment, source hashes, affine, displayed planes and non-acceptance flags.

For closer inspection:

- Click a slice to move the shared world cursor; arrow keys move by 200 µm
  in-plane, and sliders use native 10 µm navigation. Locations are starting
  points, not certified landmarks.
- **More overlay options** contains blinking, opacity and coarse AGEA label
  boundaries (orange, off by default). Explicit overlay choices persist in URLs.
- **Slice coordinates** and **Coordinates & source evidence** expose requested,
  displayed and coarse plane positions and labels. Coarse sampling and sparse
  website outlines can legitimately produce different planes and labels.
- Choose **Selected expression** and expand **Change experiment** to compare
  genes. Measured zero stays valid, including unlabelled voxels; `-1` stays
  missing. Missing-expression stripes alone are not registration evidence.
- **Other investigation tools** retains the original coverage, mask-comparison
  and aggregate-frequency modes.

The supplied reference image and labels were generated from CCF anatomy. Their
agreement is a coordinate/rendering check, **not independent validation of the
expression's biological registration or historical reference-space vintage**.
No transform fitting, scientific release or production dataset registration is
performed here. Q19 remains open.

## Coverage controls

1. Search by gene symbol or experiment ID. Repeated symbols remain separate
   experiment choices. Results are paginated in groups of 30; the sort menu can
   rank by the fraction of measured voxels without an anatomical label.
2. Start with **Coverage**. Positive and zero measurements have separate colors
   for labelled/unlabelled positions. `-1` is missing; other negative or
   nonfinite values would be marked unexpected. Neither category is silently
   reclassified as anatomical outside.
3. Move the shared ML/DV/AP index sliders or click a voxel. Arrow keys move
   within a focused slice. The inspector shows source indices, source-loader
   world coordinates, signed region ID/name, expression, category and aggregate
   measurement coverage. Plane axes and their increasing-index directions are
   displayed explicitly; these source-index views do not establish registration
   against the production 10 µm anatomy.
4. Use **Expression** for values and **Mask comparison** to compare all measured
   voxels with the subset whose supplied label is nonzero. The color range is
   initially shared, linear, from zero to the maximum over all measured voxels.
   **Recompute masked color range** changes only the masked panel's upper bound
   to the labelled maximum. This is an exploratory display control, not an
   approved release palette or distribution selection.
5. Use **Across experiments** to display the fraction with a measurement at
   each position. This is a coverage frequency, not mean gene expression. The
   counts/histograms below remain explicitly for the selected experiment.
6. Compare counts, means, medians, 5th/95th percentiles and full ranges. The
   two histograms use shared 48-bin edges over `[0, max(all measured)]`; the last
   bin includes its upper edge. Each curve is normalized by its own measured
   population, so unequal group sizes do not obscure shape differences.
   Category percentages use the full spatial grid as denominator. Empty
   populations display unavailable statistics, not fabricated zeros.
7. Toggle thin **Label boundaries** to inspect the underlying categories. These
   contours come from adjacent cells in the supplied coarse label map. They
   are not regenerated production anatomy or a finer-resolution registration.

Gene, shared cursor, mode, outline visibility and rescaling are URL-persisted.
**Download inspection report** exports the source hashes, grid, exact selected
experiment, voxel and exploratory analysis as JSON. It does not publish or
approve a scientific selection. Browser-local report downloads are the only
write action in the interface.

## Loading and limits

The lab verifies size/SHA-256 before decoding metadata or binary resources and
checks decoded lengths. Only the selected experiment is fetched; at most two
decoded experiment arrays are retained in memory. It deliberately does not
fill persistent Cache Storage while browsing. Switching experiments cancels
superseded work, clears stale expression and permits retry after a failure.
The two small shared label/frequency arrays remain loaded.

The existing Canvas volume painter draws the source-index diagnostic planes;
alignment mode uses the application's retained registered projection factory.
Neither adds a renderer facade. Measurements use original, unnormalized source
energy values. The processed variant remains outside this lab.

## Verification

The ordinary gate includes pure category, population, histogram-edge, coordinate
and URL tests plus the browser's missing-configuration behavior. It requires no
real AGEA download. After preparing the real data, run:

```bash
npx --prefix web playwright test --config web/playwright.agea-lab.config.ts
just check
```

The dedicated Chromium suite exercises real search/disambiguation, one-volume
loading, mask/frequency modes, click/keyboard navigation, URL reload, report
download, desktop/mobile sizing, corruption recovery and stale-request rejection.
Generated visual review images stay in ignored `artifacts/`.
