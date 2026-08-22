# Legacy curated atlas slice assets

Status: **inactive runtime; pinned cutover source evidence**. D023 supersedes
these bundles as current v2 runtime geometry. The approved D031 cutover may
ingest the exact Top/Swanson bytes as static-map build inputs after license
coverage is confirmed. The default viewer currently makes no request to the
legacy atlas host.

This note pins the exact legacy SVG-fragment bundles used by IBL Ephys Atlas Web v1 and validated for the v2 anatomical-view integration.

## Provenance

The five files were downloaded from the deployed v1 atlas on 2026-08-19 from:

`https://atlas.internationalbrainlab.org/data/json/`

They are deployment/runtime artifacts, not files present in the current `int-brain-lab/ephys-atlas-web` source tree. The historical generation code explicitly notes that the generated slice JSON received additional manual processing, so these deployed files are the authoritative curated artifacts. Do not regenerate or resimplify them casually.

The inspected v1 source checkout is
`int-brain-lab/ephys-atlas-web@1d908bea095be2616a750d939d143f3b4db2a641`.
Its `index.html` declares `viewBox="60 20 340 300"` for both Top (lines
393-400) and Swanson (lines 362-366). The source repository's MIT `LICENSE` has
SHA-256
`4a51f3da8e143b69bcba5e1e50fc01469339790fdea96f634f4895ca30393ca5`;
the inspected `index.html` has SHA-256
`677135c3a5bbdbd07c1a8c6b202eb636758d3e73bb535ddabeeb545044fe53eb`.

No separate license declaration was found inside the deployed curated JSON
fragments. Before publishing derived production Top/Swanson assets, confirm
that the repository MIT license covers those official deployment artifacts and
preserve the required copyright/license notice. Until then, the exact bytes may
be pinned and tested as source evidence, while published fixtures remain
synthetic.

## Exact inventory

| bundle | raw bytes | entries | SVG paths | index coverage | SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| `slices_coronal.json` | 34,228,762 | 658 | 103,604 | even indices `2..1316` | `d237f222830791b4f4fc44b0f3d49aa86f3fe4a34988f480ec492b66b4b3dff2` |
| `slices_sagittal.json` | 26,269,579 | 517 | 72,943 | even indices `54..1086` | `5a32a2669cea9e5b73f3df39f9781d66fd6a4bfeffe4ac6639adcae34bcb8c4e` |
| `slices_horizontal.json` | 26,759,095 | 370 | 91,544 | even indices `16..754` | `f553ae1fb3eac079851e5adbcaa37e52db8e3660552737cd61c52f09033a5ed2` |
| `slices_top.json` | 40,173 | 1 | 114 | key `0` | `4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30` |
| `slices_swanson.json` | 192,565 | 1 | 808 | key `0` | `347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba` |

Total raw size: 87,490,174 bytes (83.44 MiB).

## Format facts validated against the files

Each bundle is a JSON object whose keys are slice indices encoded as strings and whose values are bare SVG `<path/>` fragments, not complete `<svg>` documents. The orthogonal bundles contain contiguous even-numbered keys across the coverage ranges above. `top` and `swanson` each contain one fragment under key `"0"`.

Every parsed path in all five files carries an `allen_region_<id>`, `beryl_region_<id>`, and `cosmos_region_<id>` class. No embedded `<svg>`, `<style>`, `<script>`, or wrapper `<g>` elements were found in the fragment values.

The Top/Swanson key `"0"` is a container convention, not a scientific slice
index. The v2 static-map descriptor must omit slice/world/affine fields and
declare the pinned view box directly.

The companion deployed `regions.json` is no longer fetched at runtime. Its
BrainRegions row crosswalk is pinned by SHA-256 and joined to authoritative
ontology names, hierarchy, and RGB in the committed browser asset documented
by `docs/frontend/ALLEN_REGION_METADATA.md`.

The v2 frontend keeps scientific 10 um navigation/coordinate calibration separate from this display-asset inventory. The odd SVG slices were deliberately omitted from the legacy bundles to reduce file size: slicing is primarily a user navigation/display convenience here, not a scientifically critical 10 um anatomical measurement. The UI therefore preserves the full scientific index domains with `step=1`, including odd indices. `LegacyCuratedSvgSliceRenderer` independently chooses the nearest available curated SVG fragment for display (normally at 20 um spacing), while coordinates, URL state, and linked-guide navigation continue to use the requested 10 um index. The chosen SVG index is exposed only as renderer/debug metadata (`data-asset-index`).

## Historical fallback decision

The implementation repository records the immutable inventory and hashes but
does not duplicate the 83.44 MiB of legacy deployment artifacts. The modular
`LegacyCuratedSvgSliceRenderer` remains available in source, but it is not
constructed by `main.ts` and its deployed host is not contacted by default.

A release copy is valid only if all five SHA-256 hashes above match. Do not use the historical generation script as a substitute for the curated deployed files.
