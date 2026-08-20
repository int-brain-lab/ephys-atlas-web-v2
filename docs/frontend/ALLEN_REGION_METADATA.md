# Allen region metadata and colors

The browser-owned Allen anatomy identity asset is
`web/public/atlas/allen-ccf-2017/regions.json`.

It is separate from scientific feature arrays and from SVG geometry. The asset
joins the exact BrainRegions row indices used by the pinned curated v1 SVGs to
the ontology fields supplied by the pinned `iblatlas` source:

- Allen atlas ID, acronym, and full name;
- parent atlas ID and ontology depth;
- official RGB color serialized as lowercase `#rrggbb`;
- whether a node belongs to the selected mapping or is an Allen hierarchy
  container added to make a reduced mapping parent-closed;
- legacy SVG/BrainRegions row index.

## Provenance and identity

- atlas: Allen Mouse CCF 2017;
- `iblatlas` commit: `52083adf44825d0622a503705e095699a5957587`;
- legacy deployed region-crosswalk SHA-256:
  `9fca5fe4feeb368c715853c25a97667cb199d5a7ce160385771833ba61cedfc8`;
- emitted asset SHA-256:
  `71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b`;
- emitted rows: 2,195 Allen, 787 Beryl, and 35 Cosmos before the browser
  selects the canonical negative-ID left hemisphere;
- browser-visible left trees: 1,097 Allen nodes; 393 Beryl nodes (306 mapping
  regions and 87 Allen containers); and 17 Cosmos nodes (10 mapping regions
  and 7 Allen containers).

The legacy crosswalk contributes only the numeric SVG row domain. Names,
hierarchy, and RGB are re-read from the pinned `iblatlas` `BrainRegions`
table; the historical deployed hex strings are not treated as color authority.
For Beryl and Cosmos, the generator walks each mapping region's real Allen
parent chain and emits the missing ancestors as `mapping_member: false`.
Consequently every left catalog has one signed root and is parent-closed;
container rows provide navigation only and are not selectable mapping values.

Rebuild with `just atlas-regions`. The generator verifies the legacy input hash
before writing and is deterministic. Review and update the recorded emitted
hash if an explicitly approved atlas/tool pin changes.

## Browser behavior

`Feature values` preserves the scientific statistic/colormap/range overlay.
`Allen anatomy` paints regions from ontology colors and shows the complete
left structural inventory and color swatches in the region browser. The mode
is persisted as `colors=anatomy` in URL state. Selection and hover remain
independent outlines/states and never replace either color source.

The browser orders rows from `parent_id`, derives hierarchy depth rather than
trusting display metadata, and supports the full Allen depth instead of
clamping all descendants below `grey` to one indentation level.

The same renderer presentation contract supplies colors to the default
generated anatomy-pack renderer and the inactive legacy fallback. Neither renderer owns the
color-mode state or scientific feature data.
