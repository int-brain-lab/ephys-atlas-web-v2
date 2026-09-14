# Allen region metadata and colors

The web repository remains the authoritative producer of the Allen anatomy
identity asset at
`web/public/atlas/allen-ccf-2017/regions.json`.

Its renderer-neutral serialized contract and strict independent Python reader
are owned by `ibl-atlas-assets`. The browser now consumes that same contract
through a small TypeScript adapter; this does not move application state, UI,
fetching, caching, or rendering out of this repository.

It is separate from scientific feature arrays and from SVG geometry. The asset
joins the exact BrainRegions row indices used by the pinned curated v1 SVGs to
the ontology fields supplied by the pinned `iblatlas` source:

- Allen atlas ID, acronym, and full name;
- parent atlas ID and ontology depth;
- official RGB color serialized as lowercase `#rrggbb`;
- whether a node belongs to the selected mapping or is an Allen hierarchy
  container added to make a reduced mapping parent-closed;
- source SVG/BrainRegions row index and its authoritative signed Allen/Beryl/
  Cosmos target atlas IDs, retained as generation provenance but not parsed
  into the browser's runtime region model.

## Provenance and identity

- atlas: Allen Mouse CCF 2017;
- reference space: `allen-ccf-2017` (explicit in the catalog so independent
  consumers never infer its coordinate identity);
- `iblatlas` commit: `52083adf44825d0622a503705e095699a5957587`;
- legacy deployed region-crosswalk SHA-256:
  `9fca5fe4feeb368c715853c25a97667cb199d5a7ce160385771833ba61cedfc8`;
- emitted asset SHA-256:
  `0b4e18949950ddd99ed98ea06c80bc469c5e1c0fb2379dcf1afa02cc66ebd8a4`;
- emitted rows: 2,195 Allen, 787 Beryl, and 35 Cosmos before the browser
  selects the canonical negative-ID left hemisphere;
- browser-visible left trees: 1,097 Allen nodes; 393 Beryl nodes (306 mapping
  regions and 87 Allen containers); and 17 Cosmos nodes (10 mapping regions
  and 7 Allen containers).

The legacy crosswalk contributes only the numeric SVG row domain. Names,
hierarchy, and RGB are re-read from the pinned `iblatlas` `BrainRegions`
table; the historical deployed hex strings are not treated as color authority.
`mapped_atlas_ids` records the pinned `Allen-lr`, `Beryl-lr`, and `Cosmos-lr`
target for every common row. This lets the offline static-map compiler resolve
legacy class suffixes completely, including rows that are not themselves
members of a reduced mapping, without shipping the crosswalk to the browser.
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

The pinned metadata and tree swatches retain the official RGB values exactly.
On the dark anatomical canvas only, achromatic near-white entries such as
`root` (`#ffffff`) and `fiber tracts` (`#cccccc`) are mapped to muted slate
display colors. Chromatic Allen colors are unchanged. This presentation-only
mapping avoids large white regions dominating the view without changing atlas
identity or scientific feature colors.

The adapter validates the full signed physical inventory, source indexes,
mapping targets, parent/depth relationships, hemisphere closure, provenance,
and exact Allen/Beryl/Cosmos mapping set before exposing the same three views
as `ibl-atlas-assets`: physical, canonical left (including void), and logical
hemisphere-independent/right (including void). The application explicitly uses
the left view. Its grey-matter UI projection continues to order nodes from
stable parent IDs and supports the full Allen depth instead of clamping all
descendants below `grey` to one indentation level.

The same regional presentation contract supplies colors to all five views in
the active projection pack. The viewport owns neither color-mode state nor
scientific feature data, and there is no legacy renderer fallback.
