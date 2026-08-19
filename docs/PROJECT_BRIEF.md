# Project brief

## Goal

Build a separate v2 of the IBL Ephys Atlas web application while keeping the legacy site deployable as a fallback. The target is a credible production-ready release in roughly four weeks.

## Launch-critical capabilities

- datasets: `ephys_atlas_channels`, `ephys_atlas_clusters`, `ephys_atlas_volumes`, `brainwide_map`, `local`
- regional and volume representations
- Allen, Beryl, and Cosmos parcellations
- linked coronal, sagittal, and horizontal slices
- region search, browsing, hover, and selection
- feature search and metadata
- scalar coloring, colormap, and range controls
- descriptive statistics and visual region comparison; no inferential tests for launch
- URL-persisted/shareable state
- current-feature, selected-data, and whole-dataset downloads
- local browser import using the same dataset contract as published data
- remote publishing in v2 if feasible, without making it a blocker for the viewer launch

## Deferred / lower priority

- AGEA
- MERFISH
- large point-cloud workflows
- advanced inferential statistical tests
- a fully replaced 3D stack if it threatens the launch schedule

## Product principles

- prioritize fast interaction and feature switching
- minimize initial and per-click downloads
- keep scientific provenance explicit
- published releases are immutable; aliases such as `latest` may point to immutable releases
- desktop is primary; tablet should be usable; phone may provide a reduced experience
- current Chrome/Edge, Firefox, and Safari are target browsers
