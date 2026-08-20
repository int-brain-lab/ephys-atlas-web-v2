# Allen region metadata and colors

The browser-owned Allen anatomy identity asset is
`web/public/atlas/allen-ccf-2017/regions.json`.

It is separate from scientific feature arrays and from SVG geometry. The asset
joins the exact BrainRegions row indices used by the pinned curated v1 SVGs to
the ontology fields supplied by the pinned `iblatlas` source:

- Allen atlas ID, acronym, and full name;
- parent atlas ID and ontology depth;
- official RGB color serialized as lowercase `#rrggbb`;
- legacy SVG/BrainRegions row index.

## Provenance and identity

- atlas: Allen Mouse CCF 2017;
- `iblatlas` commit: `52083adf44825d0622a503705e095699a5957587`;
- legacy deployed region-crosswalk SHA-256:
  `9fca5fe4feeb368c715853c25a97667cb199d5a7ce160385771833ba61cedfc8`;
- emitted asset SHA-256:
  `3243b07e978e349ab9cc8601e23aeb12c9b2cc0f71f1a7894dce4d2dcfee3e38`;
- emitted rows: 2,195 Allen, 614 Beryl, and 22 Cosmos before the browser
  selects the canonical negative-ID left hemisphere;
- browser-visible left rows: 1,097 Allen, 306 Beryl, and 10 Cosmos.

The legacy crosswalk contributes only the numeric SVG row domain. Names,
hierarchy, and RGB are re-read from the pinned `iblatlas` `BrainRegions`
table; the historical deployed hex strings are not treated as color authority.

Rebuild with `just atlas-regions`. The generator verifies the legacy input hash
before writing and is deterministic. Review and update the recorded emitted
hash if an explicitly approved atlas/tool pin changes.

## Browser behavior

`Feature values` preserves the scientific statistic/colormap/range overlay.
`Allen anatomy` paints regions from ontology colors and shows the complete
left structural inventory and color swatches in the region browser. The mode
is persisted as `colors=anatomy` in URL state. Selection and hover remain
independent outlines/states and never replace either color source.

The same renderer presentation contract supplies colors to the current curated
SVG renderer and the generated anatomy-pack renderer. Neither renderer owns the
color-mode state or scientific feature data.
