# Data sources and release notes

This document records current source-of-truth information that constrains the v2 data pipeline. Detailed format decisions remain owned by the data/schema workstream.

## Ephys Atlas channel features

Current canonical project: `ea_active`.

The private paper repository documents the current loading path in:

    paper-ephys-atlas/sources/examples/04_load_channel_features.py

That example uses `ephysatlas.data` from `ibleatools`, resolves/downloads a weekly vintage, and loads the feature tables from:

    aggregates/atlas/features/ea_active/<YYYY_Www>/agg_full/

The feature list is not assumed stable before submission. The web application and dataset manifests must therefore be catalog-driven rather than hard-coding a fixed feature enum.

During development, `latest` may resolve to the most recent available weekly vintage. The paper-facing release must pin an exact immutable vintage/release.

## Ephys Atlas encoding volumes

Current canonical source prefix:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/

`ibleatools` documents weekly encoding-volume releases under:

    encoding_volumes/{project}/{label}/brainwide_ephys_atlas_25um.npz

with `ea_active` as the actively updated project. The current documented volume is approximately 500 MB and contains a 4-D 25 um atlas volume.

A project collaborator recommends that v2 use the latest available encoding volumes from this source during development and switch the source location to the public bucket when released. An HTTP object interface is expected to be available.

Important distinction: the S3 object is the canonical scientific source, but it is not automatically the optimal browser wire format. Before committing to direct browser consumption of the current `.npz`, measure:

- exact object/file layout
- HTTP Range support
- CORS and authentication behavior on the current private bucket and future public bucket
- bytes required to show one feature/slice
- decode cost and memory usage in target browsers

If direct access satisfies launch performance budgets, prefer it because it removes a redundant publication transform. If the monolithic NPZ forces large downloads or poor random access, derive a deterministic chunked web representation from the pinned S3 vintage while retaining provenance back to the canonical S3 object.

## Vintage policy

`ea_active` is expected to be recomputed again before submission. Therefore:

- development/staging may follow a mutable `latest` alias;
- feature catalogs must tolerate additions/removals between vintages;
- published releases are immutable;
- the paper release pins the exact source vintage(s) used to generate or serve the website;
- manifests record the source project, vintage/label, source object(s), and builder version when a transform is used.

## Known references

- `int-brain-lab/ibleatools`, `src/ephysatlas/data.py`
- `int-brain-lab/ibleatools`, `docs/source/how-to/s3-architecture.rst`
- private paper repository, `sources/examples/04_load_channel_features.py`

## Open validation tasks

The data/schema and rendering workstreams should jointly validate the direct-volume-serving proposal before freezing the volume format. In particular, confirm the future public HTTP URL convention and CORS policy, then benchmark direct NPZ access against a chunked representation using realistic slice navigation and feature switching.
