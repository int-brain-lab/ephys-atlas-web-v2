# Regional volume-distribution candidate review

Status: active candidate evidence.

Artifact maturity: validated real local candidate evidence, 2026-09-17.
Neither candidate is staged, published, catalogued, uploaded, or assigned to a
mutable alias.

## Results

The candidates were built from implementation commit
`3806844c7ad8cf47360e32e6dde99ae8fd98d0c5` and the exact hash-pinned D077/D078
inputs. Both complete release graphs pass the schema-v1 validator and their
real-release Chromium suites.

| Candidate | Features | Files | Served bytes | Manifest SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `agea-processed-20260917-v3` | 4,345 | 34,772 | 923,911,483 | `8d91fb5ba2abc1a79f516e7ba115205cc3db2b8cd288edeedc0b8f5201360373` |
| `2026_W26-candidate-depth4-regional-20260917-v1` | 41 | 6,940 | 497,737,388 | `d828d1a50845ce148fbd0b035b5980567d12f9880b91595ffb0dd0dc3a25c293` |

AGEA has 1,172 Allen, 586 Beryl and 21 Cosmos physical rows. Every one of its
4,345 features assigns all 62,959 valid voxels and zero valid voxels remain
unassigned. Its 13,035 regional matrices use shape `rows × 66` (underflow, 64
bins, overflow).

W26 has 1,339 Allen, 613 Beryl and 21 Cosmos physical rows. Forty features
assign all 4,001,179 valid voxels; `peak_time_secs` assigns all 3,997,446 valid
voxels. Every mapping has zero unassigned valid voxels. Its 123 matrices use
shape `rows × 52` (underflow, 50 bins, overflow).

The browser checks prove the companion request is absent before selection,
occurs once after selection, and is reused when changing hemisphere. AGEA also
proves the processed bilateral-averaging disclosure and exact-count CSV export.
The full AGEA suite passes 5/5 tests; the full W26 candidate suite passes 7/7.

## Reproduction

The output directories must be absent before rebuilding. The AGEA source is
`artifacts/agea-metadata-sizing`; W26 is the pinned
`data/source/ephys_atlas_volumes/2026_W26` snapshot. Use the commands below
with the exact annotation whose SHA-256 is
`84e7cecea1b03af16e923c3639602b8324929f833425ba03582bf56f962ea0d4`.

```bash
uv run --project builder --extra test --locked python -m tools.agea_preview \
  --source artifacts/agea-metadata-sizing \
  --output artifacts/d078-regional-candidates/agea \
  --created-at 2026-09-17T12:26:26Z \
  --alignment-review docs/data/AGEA_ALIGNMENT_REVIEW.json \
  --processed --release-id agea-processed-20260917-v3

uv run --project builder --extra scientific --locked ephys-atlas-data build-volumes \
  2026_W26 --release-id 2026_W26-candidate-depth4-regional-20260917-v1 \
  --created-at 2026-09-17T12:26:26Z --layout orthogonal_slice_packs --pack-depth 4 \
  --geometry-selection docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json \
  --distribution-selection docs/data/VOLUME_2026_W26_DISTRIBUTION_SELECTION.json \
  --regional-distribution-selection docs/data/VOLUME_REGIONAL_DISTRIBUTION_SELECTION.json \
  --regional-annotation /path/to/allen-ccf-2017-50um-source/annotation_50.nrrd \
  --candidate --ibleatools-commit 9bfa0623a16bc7a989a6b27a589887641beee0a8 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 3806844c7ad8cf47360e32e6dde99ae8fd98d0c5 \
  --release-root artifacts/d078-regional-candidates/w26/releases
```

Run `just data-validate <release-directory>` for each output. Then run the
AGEA preview suite and W26 volume-candidate suite with
`EPHYS_ATLAS_REAL_RELEASE` pointing at the corresponding release (and
`EPHYS_ATLAS_REAL_FEATURE=rms_lf` for W26).

Production promotion remains Q19 owner work and requires a clean Linux `main`
rebuild and preflight. These branch-built artifacts are review candidates only.
