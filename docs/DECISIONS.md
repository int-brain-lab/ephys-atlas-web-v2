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
