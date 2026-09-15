# Shared atlas asset extraction checkpoint

Status: active cross-repository boundary, recorded 2026-09-15. This document does not change the
website's runtime assets, display sampling, defaults, or publication state.

## Proven boundary

The useful shared unit is an immutable renderer-neutral asset contract, not a cross-language viewer
runtime. The first two-consumer evidence now covers:

- the complete signed Allen/Beryl/Cosmos region catalog and its physical, canonical-left, and
  logical views;
- the D070 surface graph and exact vertex/face presentation fingerprints;
- registered coronal, sagittal, and horizontal projection manifests plus indexed SVG and exact
  `anatomy-slice-pack-v2` decoding; and
- projection-native scalar intensity blocks with bounded section decoding and explicit grid
  registration.

`ibl-datoviz` consumes the latter two contracts through a deterministic linked synthetic fixture
and a local real-asset parity run. `ibl-atlas-assets` verified this repository's complete
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1` anatomy-v2 graph in place: 3,260 slices across 205
resources, including every encoded and decoded hash, in about two seconds and 78 MB peak RSS. No
asset was copied and no website reference changed.

That integration caught a meaningful convention boundary: the extracted registered projection
shape is `[u, v]`, while a raster image is `[row=v, column=u]`; additionally, the sagittal plane's
AP direction is reversed relative to the scalar volume array. All three projection affines now
have an end-to-end consumer test instead of being accepted from shape equality alone. A real
offscreen native render combines these exact annotation paths with lazy official 10-um template
slices while retaining the existing 50-um dense 3-D volume.

## Ownership

| Repository | Owns |
| --- | --- |
| `iblatlas` | Scientific ontology, mappings, coordinates, source labels, and atlas computations. |
| `ibl-atlas-assets` | Shared schemas, immutable asset identities, strict renderer-neutral readers and validators, deterministic contract fixtures, and eventually generic asset builders/publication records. |
| `ephys-atlas-web-v2` | Current authoritative anatomy producer, browser transport/fetch/cache, retained web viewports, URL/application state, and production defaults. |
| `ibl-datoviz` | Python/native composition, desktop workers and caches, linked selection/hover, and GPU object lifetime. |
| Datoviz | Domain-neutral rendering, GUI, interaction, sampled-field, 3-D, OIT, and post-processing APIs. |

The packages should share bytes and semantics through versioned contracts and parity vectors. They
should not share Three.js/Datoviz rendering code, DOM/ImGui UI code, browser fetch policy, Python
threading, or one serialized command runtime.

## No-default-change rule

The web application's scientific cursor remains the native bilateral 10-um grid, and its reviewed
sparse runtime inventory remains the current 80-um display sampling. A desktop option to read
10-um intensity or boundary inputs does not authorize a browser default change. Grid resolution,
display-plane sampling, and transport encoding remain separate choices.

## Next extraction gate

Do not redirect the website merely because a second reader verifies the current graph. The local
reader/integration gate is now green; the next coherent task is immutable publication parity:

1. record the exact parent annotation/LUT and generated anatomy/projection pack commits, terms, and
   citations in a shared immutable asset-set entry;
2. reproduce the assets with a clean pinned builder and require byte identity where the encoding is
   intended to remain unchanged, otherwise record explicit semantic fingerprints and a versioned
   format change;
3. benchmark the shared published origin and verify immutable URL, served-byte, SHA-256, CORS, and
   opaque-gzip behavior; and
4. only after those gates pass, change one website asset reference to the shared immutable origin,
   prove unchanged pixels/interaction/performance, and delete the former local producer copy in a
   later commit.

The first migration candidate should be the registered projection asset graph because both native
and web consumers now exercise it. The optional 10-um scalar intensity transport should be
published and measured for desktop use independently; it is not a reason to triple the browser's
storage or alter its current anatomy display policy.

## Deliberately deferred

- a shared TypeScript/Python runtime package;
- automatic conversion between every atlas resolution;
- moving browser cache, request coalescing, UI, or rendering into the asset repository;
- redirecting production before a durable immutable origin exists; and
- changing the current web display resolution as part of extraction.
