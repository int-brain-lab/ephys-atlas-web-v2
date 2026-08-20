# Indexed SVG pack experiment

Status: codec accepted by D026; production v3 integration and measurements are
in progress. The normative sampling, manifest, and runtime contract is
`docs/rendering/ANATOMY_PACK_V3_CONTRACT.md`.

## Goal

Remove the runtime JSON-object-to-SVG serialization step while retaining SVG
geometry, delegated region picking, selection, and cross-projection guides. A
pack stores a small fixed index followed by the exact concatenated UTF-8 SVG
fragments. The browser can validate the index once and decode only the requested
fragment from the decompressed pack bytes.

This changes transport and preparation only. Slice indices, world coordinates,
atlas IDs, affines, topology, and coverage remain governed by the anatomy-pack
contract.

## Version 1 wire layout

All numeric values are little-endian. The 28-byte header is:

| offset | type | meaning |
| ---: | --- | --- |
| 0 | 4 bytes | magic `ISVG` |
| 4 | uint8 | version `1` |
| 5 | uint8 | flags, currently `0` |
| 6 | uint16 | header size, `28` |
| 8 | uint16 | projection identity byte length |
| 10 | uint16 | pack identity byte length |
| 12 | uint32 | slice entry count |
| 16 | uint32 | index-table offset |
| 20 | uint32 | fragment-payload offset |
| 24 | uint32 | fragment-payload byte length |

The two non-empty UTF-8 identities follow the header. Each 20-byte index entry
then contains `int32 slice_index`, `float64 world_coordinate_um`, `uint32
offset`, and `uint32 length`. Slice indices are strictly increasing. Entries
must describe the complete payload contiguously without gaps, overlap, or
trailing bytes. The payload is the concatenation of the indexed UTF-8 SVG
fragments.

The Python codec in `tools/svg_pack/` provides deterministic encode/decode for
builders and validation. `web/src/rendering/svg-pack.ts` provides both a full
validator/decoder and an indexed browser reader whose header/table parse does
not decode every SVG string.

## Initial size evidence

Encoding the three default depth-16 packs from
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1` produced:

| projection / pack | current JSON gzip | indexed SVG gzip | delta |
| --- | ---: | ---: | ---: |
| coronal / 41 | 342,498 B | 344,394 B | +0.6% |
| sagittal / 34 | 298,106 B | 299,024 B | +0.3% |
| horizontal / 25 | 517,748 B | 520,571 B | +0.5% |

The experiment is therefore approximately transfer-neutral for these packs.
Its expected benefit is eliminating JSON parsing, structured path allocation,
and SVG reserialization—not reducing compressed bytes.

## Adoption gate

Before replacing the active JSON pack transport:

1. generate the complete corpus deterministically from the pinned anatomy
   source and validate byte size/SHA plus every existing scientific gate;
2. parse and decode in a worker where measurements show a benefit;
3. benchmark input-to-paint p50/p95 across median, p95, and maximum slices,
   including pack-boundary reversals;
4. confirm final-request correctness, picking, coloring, selection, and linked
   guides under burst navigation;
5. enforce byte-bounded source and retained-DOM caches and record heap use over
   a 100-slice sweep;
6. update the anatomy manifest/schema and every producer/consumer together if
   the experiment is accepted.

The first phase-level browser evidence and reproduction command are recorded in
`docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md`.
