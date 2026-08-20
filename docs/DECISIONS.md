# Decision log

## D001 — Separate v2

Build v2 in this repository independently of the legacy `int-brain-lab/ephys-atlas-web`. Keep v1 deployable as fallback through launch.

## D002 — Frontend stack

Use TypeScript + Vite with plain web-platform UI code. Do not use React or another frontend framework by default.

## D003 — Launch dataset scope

Launch-critical: `ephys_atlas_channels`, `ephys_atlas_clusters`, `ephys_atlas_volumes`, `brainwide_map`, and `local`.

AGEA, MERFISH, and large point datasets can follow after launch.

## D004 — Statistics

Launch supports descriptive/basic statistics and visual comparison only. No inferential statistical tests are required. The design should permit more advanced tests later.

## D005 — Releases

Published dataset releases are immutable. Mutable aliases such as `latest` may point to an immutable release. The paper-facing default should resolve to an immutable publication snapshot.

## D006 — Legacy compatibility

Backward compatibility with old custom buckets/URLs is low priority because the existing site has had very limited use. Prefer a clean v2 contract. Keep v1 online temporarily rather than compromising v2 architecture.

## D007 — SVG slices

Reuse existing curated SVG assets where practical. Their manually tuned alignment is acceptable for display; document calibration explicitly and avoid treating it as canonical geometry.

## D008 — 3D

3D technology is undecided and explicitly renderer-agnostic. Datoviz is one candidate, not a requirement. 3D is lower priority than the regional/volume viewer and data pipeline.

## D009 — Publishing auth

Retain a capability-based publishing model for launch rather than introducing full user accounts/OAuth. Existing v1 auth should be studied and modernized rather than copied blindly.

## D010 — Canonical S3 sources versus browser transport

Treat the current `ea_active` S3 products as canonical scientific inputs for Ephys Atlas channel features and encoding volumes. Prefer direct HTTP/object-store consumption when the canonical object format meets browser performance, CORS, and access requirements. Do not require the browser to consume a canonical object directly if its physical layout causes excessive download, decode, or memory cost; in that case, derive a deterministic web-optimized representation with explicit provenance back to the pinned source object.

## D011 — Dynamic feature catalog

Do not hard-code the Ephys Atlas feature list into the frontend. The list may change with a new vintage before submission, so feature discovery, metadata, ordering, and availability must come from the dataset/release manifest or equivalent catalog.

## D012 — Development latest versus paper vintage

Development and staging may follow the latest available `ea_active` vintage. The paper-facing production release must pin an exact immutable source vintage and record it in provenance metadata.

## D013 — Volume geometry versus physical layout

Schema v0.1 keeps scientific volume geometry, dtype, axis order, and affine metadata independent of the browser storage layout. A volume release declares a physical `layout`; `chunks3d` is the current deterministic builder/reference layout and `orthogonal_slice_packs` is an allowed browser-optimized layout. Do not freeze 3-D chunks as the only launch transport until real-data browser benchmarks meet the rendering budgets.

## D014 — Frontend renderer boundary

The frontend-owned `SliceRenderer` / `SliceRenderModel` interface is the application boundary. SVG, volume, Canvas2D, and future 3-D implementations live below that facade. The lower-level rendering workstream must not introduce a competing application state or renderer facade.

## D015 — One dataset contract for published and local data

Published HTTP releases and browser-imported local releases use the same schema-v0.1 manifest, feature metadata, regional binary arrays, statistics, and volume descriptors. Local storage changes transport only; it does not define a second scientific data format.

## D016 — Curated SVG identity versus navigation sampling

Treat the five deployed v1 curated SVG-fragment bundles as immutable display assets whose exact byte sizes, SHA-256 hashes, path counts, entry counts, and index coverage are pinned in the v2 repository. The orthogonal SVG bundles contain even indices only and therefore represent a display-downsampled anatomical layer. Preserve the full 10 um regional navigation/coordinate domains independently; the renderer may select the nearest curated display slice without changing URL state, scientific coordinates, or linked-guide state. Publish the exact pinned bytes into an immutable v2 asset location rather than regenerating them.

## D017 — Single-main development after integration

The parallel exploration phase is over. `main` is the sole active product-development branch and durable source of truth. Routine data, viewer, rendering, publishing, documentation, and release work proceeds sequentially on `main` with CI/`just check` as the integration gate. Do not maintain persistent `work/*` or `agent/*` product branches or require pull requests for this project's routine workflow unless the repository owner explicitly changes this policy.

## D018 — Scientific release choices are explicit inputs

Dataset builders must not inherit scientifically material defaults when those defaults could change the meaning or reproducibility of a release. In particular, raw versus denoised channel features, source vintage, population/QC recipe, paper-snapshot status, and authoritative volume geometry are explicit release inputs/metadata. If an authoritative choice is unresolved, test the machinery with synthetic/pinned fixtures and block the scientific production release rather than guessing.