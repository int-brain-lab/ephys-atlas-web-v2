# Integration status

Status: integrated on `main`. Historical workstream handoff documents remain useful evidence, while this file and `docs/DECISIONS.md` describe the accepted cross-workstream state.

## Integrated components

- Data/schema: schema v0.1, deterministic builder/validator/packager, provenance model, source adapters, golden regional+volume fixture.
- Viewer: TypeScript/Vite state/data foundation, responsive Phase-1 through Phase-4 UI, linked curated SVG anatomy, URL state, local import/cache foundations.
- Rendering: lower-level SVG renderer, calibrated scientific/display transforms, storage-neutral volume source/Canvas2D renderer, volume benchmarks, technology-neutral 3-D contracts/evaluation.
- Publishing: capability credentials, resumable staged upload, external schema validation, immutable publication, static public read path, deployment examples.
- UX: accepted responsive shell/header/region-browser/anatomical-view specifications and browser review contracts.

## Resolved integration boundaries

### Dataset contract

The browser no longer defines a separate provisional scientific schema. Published HTTP and local-import sources both consume schema v0.1:

1. publication catalog -> immutable `manifest.json`;
2. manifest -> feature metadata and dataset-level parcellation indices;
3. feature metadata -> regional typed arrays/statistics and/or volume descriptor;
4. transport-specific source decodes the same resource graph into browser payloads.

`web/public/fixtures/ephys_atlas_channels/golden-v0.1/` is a browser-served copy of the builder golden fixture and exercises this graph. It is synthetic and must not be presented as scientific data.

### Rendering

The frontend `SliceRenderer` / `SliceRenderModel` facade is retained. The rendering workstream's `SvgSliceRenderer` sits below the legacy curated-asset adapter, rather than defining a second application renderer abstraction.

The five authoritative deployed v1 curated bundles have been inventoried and pinned by raw byte size, entry/path counts, coverage, and SHA-256 in `docs/frontend/LEGACY_CURATED_ASSETS.md` and `web/src/rendering/legacy-slice-assets.ts`. Orthogonal SVGs are display-downsampled to even indices; scientific navigation, coordinates, URL state, and linked guides remain on the full 10 um index domains. The adapter validates the loaded orthogonal index inventory before rendering and exposes the chosen display slice as `data-asset-index`.

Scientific regional/volume coordinates and hand-tuned legacy SVG display calibration remain separate. Display calibration must never be used as a volume affine.

### Volumes

Scientific grid metadata is independent of storage layout. Schema v0.1 declares `layout` and currently permits:

- `chunks3d` — deterministic builder/reference representation;
- `orthogonal_slice_packs` — browser-oriented representation to benchmark on real encoding volumes.

The production layout is not frozen. Real-data transfer/request/decode benchmarks decide it. The browser consumes `VolumeSliceSource`, so the physical choice does not leak into application state.

### Publishing

Publishing validates prepared release directories via the data validator; it does not duplicate scientific schema logic. Public release reads remain static and immutable. Mutable aliases/catalogs are control metadata outside immutable releases.

## Current source evidence

The private paper source confirms the supported channel-feature loading path in `sources/examples/04_load_channel_features.py`: project `ea_active`, explicit/resolveable vintage, `download_tables`, then `read_features_from_disk`; its example currently uses raw features (`load_denoised=False`).

The paper source's encoding-volume documentation describes `brainwide_ephys_atlas_25um.npz` as a `(456, 528, 320, N)` float16 volume with `feature_names`, per-feature mean/std, `grid_shape`, and 25 um resolution; `2026_W12` has 41 features. This resolves file contents but does not by itself establish the complete scientific index-to-world affine, so release metadata must still come from an authoritative atlas/producer transform rather than shape inference.

## Remaining launch work

### Data

- Build `ephys_atlas_channels` from the chosen current/paper vintage and settle raw-vs-denoised/QC/units with authoritative scientific input.
- Define and build `ephys_atlas_clusters` launch population/features.
- Define the exact `brainwide_map` launch product rather than conflating paper selection/aggregates with legacy website files.
- Confirm encoding-volume scientific affine/outside-brain semantics and benchmark real artifact layouts.
- Pin immutable paper-facing source vintages at submission freeze.

### Viewer

- Replace representative Phase-3 region rows with real parcellation metadata and decoded regional values.
- Connect region hover/selection and feature coloring to renderer interaction/state.
- Implement histogram/distribution/comparison UI from schema-v0.1 statistics.
- Copy the five pinned curated SVG bundles, byte-for-byte, into a versioned immutable v2 asset release instead of relying on the legacy host.
- Add the real volume source adapter after layout benchmarking.
- Keep 3-D behind the regional + volume launch-critical path.

### Operations

- Choose the production public URL/domain/object-storage arrangement.
- Re-test public encoding-volume CORS/Range behavior when the final bucket is available.
- Configure the publishing validator command and deployment secrets/backups when remote publishing is deployed.

## Active workstreams

Only three active conversations/workstreams continue after integration:

1. Integration / release;
2. Data / schema / reproducibility;
3. Viewer (frontend + rendering + UX).

Publishing is parked until deployment work requires it. The old UX/rendering/publishing branches are historical references, not independent product streams.
