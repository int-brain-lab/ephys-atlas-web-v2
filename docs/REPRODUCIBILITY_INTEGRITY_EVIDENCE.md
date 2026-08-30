# Reproducibility and integrity evidence

Status: measured locally on 2026-08-31. This record covers deterministic
fixture and real-bundle rebuilding, validation of available ignored artifacts,
corrupt-cache recovery, and cold/warm retained-viewport behavior. It makes no
publication or scientific-selection claim.

## Deterministic fixtures

The golden release and both public-authoring fixtures were built twice in
isolated temporary directories through the production builder APIs. Both runs
matched each other and the committed bytes.

| artifact | files / ZIP entries | bytes | SHA-256 or tree fingerprint |
| --- | ---: | ---: | --- |
| `fixtures/golden-v1/` | 22 files | 27,572 | `4a1a83ad03a56c1da6d68c054c8b504f49de38844f17a1d1952157a1b8a61c5b` |
| `fixtures/golden-v1.ibl-ephys-atlas.zip` | 22 | 10,558 | `474d12c6abcdcc6acec17890cf96158ce8f55a484362f1b6d303460aea372d68` |
| `fixtures/authored-regional-v1.ibl-ephys-atlas.zip` | 8 | 4,491 | `377e570d27f79ce988bdd1818de874182b4ce2605d7a256a37aa3c17e821f1dd` |
| `fixtures/authored-volume-v1.ibl-ephys-atlas.zip` | 13 | 6,878 | `361e3c1e2b0b6849bbfc5088ad15b4575a523f26383b0e3655e701d41484dc84` |

The directory fingerprint is SHA-256 over the sorted sequence of relative
path, byte length, and per-file SHA-256 records. The corresponding committed
regressions are in
[`tests/test_builder.py`](../tests/test_builder.py),
[`tests/test_bundle.py`](../tests/test_bundle.py), and
[`tests/test_public_authoring.py`](../tests/test_public_authoring.py).

## Real local releases and bundles

All 25 ignored release directories containing a root manifest were checked
individually with `just data-validate PATH`. Seventeen current-schema releases
passed complete schema-v1 graph validation. Eight intentionally retained,
superseded development artifacts failed the current contract:

- `brainwide_map/legacy-v1-1d908bea`;
- `ephys_atlas_channels/2026_W32`;
- `ephys_atlas_clusters/sha256-9b5e55215b306f26`;
- the cluster `firing-defaults-v1`, `hist-axis-v1`, and `value-scale-v1`
  variants;
- `ephys_atlas_volumes/2026_W26-candidate-depth4` and
  `2026_W26-candidate-depth8`.

These eight failures are historical evidence, not current release candidates.
Their feature descriptors either omit the now-required `display` object or use
the removed `display.scale` property. They were not modified or promoted.

The representative current regional and volume releases were bundled twice
with [`benchmarks/local_import/corpus.py`](../benchmarks/local_import/corpus.py).
Both runs matched the existing ignored benchmark archives byte-for-byte:

| archive | bytes | SHA-256 |
| --- | ---: | --- |
| `channels-q14.ibl-ephys-atlas.zip` | 8,733,904 | `bd7ab813c0b2ae08f86258e9bd58083950afe1313dd88e511341e9db3fef4c5f` |
| `volumes-depth4-q14.ibl-ephys-atlas.zip` | 489,970,107 | `34bce77c0e00af700bec50594742f35c0f328c9a93571e113eb2afa45f847b08` |

`corpus.json` was identical between the two reproduction runs. It did not
byte-match the pre-existing index because this audit invoked the builder with
absolute source paths; archive bytes and scientific resource graphs were
unchanged.

Five available valid browser-import bundles passed
`just data-bundle-validate PATH`: the smoke archive, the near-1-GiB archive,
the exact-20,000-entry archive, and both real archives. Their respective
SHA-256 values were:

- `b25b80f18687603bc96458d127434addf645d7e7973208346651cd7bbd241b65`;
- `62f90427174e143c8eda39c40d7e4553dfc3dfdee6fb3b2517135490b98a9ac7`;
- `5dffad2ec4cd759d0863e3b102d91fb9d8bbbe8c49d187bcfb61712a2ea19d0c`;
- `bd7ab813c0b2ae08f86258e9bd58083950afe1313dd88e511341e9db3fef4c5f`;
- `34bce77c0e00af700bec50594742f35c0f328c9a93571e113eb2afa45f847b08`.

## Mesh, cache, and warm-state checks

All four available ignored schema-v1 mesh-pack directories passed
`just mesh-pack-validate PATH`. The D042 primary/repeat trees were identical
with fingerprint
`922a6ff821acc01f9d0012981ca7d608e7b10473f3698432489a881ee8b1247b`;
the production candidate/rebuild packs were identical with fingerprint
`d6c3f310b7e389d73a5c662ac1aa149fdd3bed048cf6214910337d6b42343b20`.

`npm run test:unit` passed all 256 tests. The integrity cases in
[`web/test/unit/cache.test.js`](../web/test/unit/cache.test.js) and
[`web/test/unit/mesh-pack-source.test.js`](../web/test/unit/mesh-pack-source.test.js)
covered corrupt persistent-hit eviction, verified retry, HTTP-cache bypass,
non-admission of invalid bytes, and corrupt mesh-cache replacement.

`just benchmark-anatomy` passed its 20 measured sequences in headless Chromium
151 on Linux. Across the four cases, cold commit p50 was 11.2--14.0 ms,
same-pack commit p50 was 1.5--2.3 ms, and retained-revisit commit p50 was
0.7--1.1 ms, with no observed long tasks. The recipe and measurement method are
defined in
[`web/test/anatomy-benchmark/navigation.spec.ts`](../web/test/anatomy-benchmark/navigation.spec.ts).

## Commands and limitations

The campaign used locked environments and repository recipes:

```text
uv run --project builder --extra test --locked python -
just data-validate PATH
just data-bundle-validate PATH
just mesh-pack-validate PATH
npm run test:unit
just benchmark-anatomy
```

Temporary fixture and bundle outputs were automatically removed. Existing
ignored releases and artifacts were read and validated in place; no user data
was deleted. Historical releases were not rebuilt because their obsolete
contracts and source-selection state are retained evidence rather than current
build targets. The browser timing is a local cold/same-pack/retained comparison,
not a production-origin HTTP-cache or CDN measurement.
