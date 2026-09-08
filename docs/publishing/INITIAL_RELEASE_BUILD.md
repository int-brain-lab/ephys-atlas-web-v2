# Initial deployment release build

Status: runbook for the D074 initial IBL review deployment; commands inspected
against the current CLI. Execution logs and build-session evidence belong under
the ignored `artifacts/deployment-20260908/` directory.
Run from the repository root on clean Linux `main` after the implementation,
curator configuration and this runbook are committed. The accepted scientific
inputs come from `data/development-bundle-v5.json`; output release IDs come from
[`initial-curator.json`](../../data/deployment/initial-curator.json).

This rebuild preserves input vintage, populations, transforms, distribution
selections and geometry. New release and pack provenance must name the actual
build commit/environment. Do not copy the preview releases to new identifiers.
Do not use `--paper-snapshot`; this edition is the initial IBL review, not the
final paper freeze. AWS permissions are independent of these local builds.

## Session and pinned inputs

Use one Bash session. The timestamp is captured once and recorded for exact
repetition. All output paths must be new; retain failed outputs for diagnosis
and choose a coherent new build identity if output bytes need to change.

```bash
set -euo pipefail
test "$(uname -s)" = Linux
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
atlas_build_commit="$(git rev-parse HEAD)"
atlas_build_root="${ATLAS_BUILD_ROOT:-artifacts/deployment-20260908}"
atlas_release_root="$atlas_build_root/releases"
atlas_created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
atlas_ibleatools_commit=9bfa0623a16bc7a989a6b27a589887641beee0a8
atlas_iblatlas_commit=52083adf44825d0622a503705e095699a5957587
mkdir -p "$atlas_build_root"
uv run --project builder --extra scientific --locked python - "$atlas_build_root/build-session.json" "$atlas_build_commit" "$atlas_created_at" <<'PY'
import importlib.metadata, json, pathlib, sys
from ephys_atlas_builder.build_environment import build_environment
pins = {'ibleatools': '9bfa0623a16bc7a989a6b27a589887641beee0a8',
        'iblatlas': '52083adf44825d0622a503705e095699a5957587'}
for package, expected in pins.items():
    source = json.loads(importlib.metadata.distribution(package).read_text('direct_url.json'))
    assert source['vcs_info']['commit_id'] == expected, (package, source)
record = dict(commit=sys.argv[2], created_at=sys.argv[3], environment=build_environment(), scientific_pins=pins)
with pathlib.Path(sys.argv[1]).open('x') as stream:
    json.dump(record, stream, indent=2)
    stream.write('\n')
PY
```

On resuming this same build, load the recorded timestamp and commit rather than
running the session-creation block again. Require `HEAD` still to match that
commit. For a new build after a code fix, set `ATLAS_BUILD_ROOT` to a new ignored
directory and retain the prior output as diagnostic evidence.
The reviewed cluster manifest records `ibleatools` commit `fffe0c...`,
but both the committed lock and the installed package pin are `9bfa062...`.
The cluster loader executes installed `ephysatlas.cells` and `ephysatlas.anatomy`;
the new command therefore records the actual locked code pin. The cluster
source table, 14-feature catalog, all-row population and D050 selection remain
unchanged. Do not falsely copy the historical code pin into new provenance.

A read-only comparison in `/home/cyrille/GIT/IBL/ibleatools` found identical Git
blobs at both commits for the two modules used by this loader:
`src/ephysatlas/cells.py` = `7b10cfc94a8f0fd4808340f775742e90a208637c` and
`src/ephysatlas/anatomy.py` = `9d652b14fc470b25b4f48c44fc8592273a35511b`.
The only Python file changed between those commits is `src/ephysatlas/data.py`,
in the encoding-volume download helper, which this cluster loader does not
call. This supports source equivalence for the cluster path; it does not
replace comparing the rebuilt outputs below.

Verify the exact local inputs before building. This check reads the pinned
source metadata and all files it declares; it does not refresh `latest`.

```bash
uv run --project builder --extra scientific --locked python - <<'PY'
import hashlib, json
from pathlib import Path

def check(path, expected):
    with Path(path).open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert actual == expected, (str(path), actual, expected)

pins = {
 'data/source/ephys_atlas_channels/2026_W32/source.json': 'eb6a9b74ee9ecbc1cc3d05361092f775dc8355a33b5b7ad2b0d87dbada0a0e91',
 'data/source/ephys_atlas_clusters/sha256-9b5e55215b306f26/source.json': '0127c71c6d796859719c7bab1e1c2e5a1be60266206d32833a2260946040e000',
 'docs/data/CHANNELS_DISTRIBUTION_SELECTION.json': 'f6022554201f56bdb2b15e8d0c460af98d919adc3bfa5638eff2bf760c6c2690',
 'docs/data/CLUSTERS_CATALOG_SELECTION.json': '666a2a4acacf9253d7af2579a827b36825cf82a23db1b0fd9e8ed1a60f86e8e0',
 'docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json': 'f52d705035627d547b50ed17e7dd59765a2ba90ea60819960ba8fabe85db2bb4',
 'docs/data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json': '9dccacce7c85d52ded41f563a7517cce1657d157046a16409cb28b4ac68915e5',
 'docs/data/AGEA_ALIGNMENT_REVIEW.json': 'fcb112e889e94459fc14b426ae6c1844c4133e6285e2da114f7cea24f9d69782',
 'docs/data/NATIVE_3D_SELECTION.json': '3dedc5e1a87757a3e2ffdb52bc0ea502083d289ceac98252b2a31afa3b57455b',
 'web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a/manifest.json': '4aeab256be79588fb6b9032bb9482479e227a1fa5499060db037318882e5fe9d',
 'web/public/atlas/allen-ccf-2017/regions.json': 'aa5615bdf76493a815ad20bd77441998415b13272bc58101cd8da674848ed3ad',
 '/home/cyrille/GIT/IBL/atlas/data/json/slices_top.json': '4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30',
 '/home/cyrille/GIT/IBL/atlas/data/json/slices_swanson.json': '347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba',
}
for path, expected in pins.items():
    check(path, expected)
    if path.startswith('data/source/'):
        for resource in json.loads(Path(path).read_text())['files']:
            item = Path(path).parent / resource['path']
            assert item.stat().st_size == resource['bytes'], item
            check(item, resource['sha256'])

bundle = json.loads(Path('data/development-bundle-v5.json').read_text())
bwm = next(a for a in bundle['artifacts'] if a['role'] == 'brainwide_map')
manifest_path = Path(bwm['destination']) / 'manifest.json'
check(manifest_path, bwm['root_manifest']['sha256'])
for source in json.loads(manifest_path.read_text())['provenance']['sources']:
    if source.get('path', '').endswith('.pqt'):
        check(Path('/home/cyrille/GIT/IBL/atlas/data/pqt') / source['path'], source['sha256'])
selection = json.loads(Path('docs/data/NATIVE_3D_SELECTION.json').read_text())
review = Path('artifacts/mesh-native-review-v1')
check(review / 'manifest.json', selection['review_manifest_sha256'])
manifest = json.loads((review / 'manifest.json').read_text())
check(review / manifest['validation']['report']['path'], selection['review_report_sha256'])
check(review / manifest['lods'][0]['resource']['path'], selection['geometry_resource_sha256'])
print('Pinned source bytes verified')
PY
```

## Regional releases

The commands reproduce the reviewed manifests' builder arguments except for
new IDs, timestamp, output root and actual current code provenance. Channel
features remain dynamically resolved from the locked scientific catalog.

```bash
uv run --project builder --extra scientific --locked ephys-atlas-data build-channels 2026_W32 \
  --release-id 2026_W32-ibl-review-20260908-v1 \
  --feature-mode both --population inside --histogram-bins 50 \
  --parcellation allen --parcellation beryl --parcellation cosmos \
  --distribution-selection docs/data/CHANNELS_DISTRIBUTION_SELECTION.json \
  --created-at "$atlas_created_at" \
  --ibleatools-commit "$atlas_ibleatools_commit" --iblatlas-commit "$atlas_iblatlas_commit" \
  --builder-commit "$atlas_build_commit" --source-root data/source --release-root "$atlas_release_root"

uv run --project builder --extra scientific --locked ephys-atlas-data build-clusters sha256-9b5e55215b306f26 \
  --release-id sha256-9b5e55215b306f26-ibl-review-20260908-v1 \
  --project ibl_neuropixel_brainwide_01 --population all --histogram-bins 50 \
  --parcellation allen --parcellation beryl --parcellation cosmos \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION.json \
  --distribution-selection docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json \
  --created-at "$atlas_created_at" \
  --ibleatools-commit "$atlas_ibleatools_commit" --iblatlas-commit "$atlas_iblatlas_commit" \
  --builder-commit "$atlas_build_commit" --source-root data/source --release-root "$atlas_release_root"

uv run --project builder --extra scientific --locked ephys-atlas-data build-brainwide-map legacy-v1-1d908bea \
  --release-id legacy-v1-1d908bea-ibl-review-20260908-v1 \
  --histogram-bins 50 \
  --distribution-selection docs/data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json \
  --created-at "$atlas_created_at" --builder-commit "$atlas_build_commit" \
  --source-dir /home/cyrille/GIT/IBL/atlas/data/pqt --release-root "$atlas_release_root"
```

Brain-Wide Map stays the frozen five-family legacy Beryl dataset. The builder
verifies its pinned Parquet sources, including `beryl_regions.pqt`; it does not
regenerate a current paper-pipeline result.

## Compare regional output with the reviewed releases

Before treating recipes as preserved, compare every non-root-manifest file,
including numeric arrays, statistics, feature metadata, selections and region
metadata. The root manifest changes identity/build provenance by design. Any
other difference stops the release for investigation; it is not implicit
approval of new scientific values. Preserve the comparison output as evidence.

```bash
uv run --project builder --extra scientific --locked python - "$atlas_release_root" <<'PYCOMPARE'
import hashlib, json, sys
from pathlib import Path
bundle = json.loads(Path('data/development-bundle-v5.json').read_text())
curator = json.loads(Path('data/deployment/initial-curator.json').read_text())
release_ids = {row['dataset_id']: row['default_release'] for row in curator['datasets']}
root = Path(sys.argv[1])
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
def inventory(directory):
    return {str(path.relative_to(directory)): digest(path)
            for path in directory.rglob('*')
            if path.is_file() and path != directory / 'manifest.json'}
for artifact in bundle['artifacts']:
    if artifact['role'] not in ('channels', 'clusters', 'brainwide_map'):
        continue
    previous = Path(artifact['destination'])
    assert digest(previous / 'manifest.json') == artifact['root_manifest']['sha256']
    dataset = artifact['identity']['dataset_id']
    rebuilt = root / dataset / release_ids[dataset]
    before, after = inventory(previous), inventory(rebuilt)
    differences = sorted(path for path in before.keys() | after.keys()
                         if before.get(path) != after.get(path))
    print(json.dumps(dict(dataset=dataset, compared_files=len(before), differences=differences)))
    assert not differences, f'{dataset}: stop and investigate changed scientific output'
PYCOMPARE
```

## Projection and native mesh packs

Reuse the validated sparse registered parent, unchanged Top/Swanson source
bytes and licensed crosswalk. Do not regenerate annotation geometry or edit
parent manifests. The projection CLI discovers the checked-out commit itself;
it has **no `--builder-commit` option**.

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.projection_pack.build \
  --registered-parent web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a \
  --regions web/public/atlas/allen-ccf-2017/regions.json \
  --top /home/cyrille/GIT/IBL/atlas/data/json/slices_top.json \
  --swanson /home/cyrille/GIT/IBL/atlas/data/json/slices_swanson.json \
  --created-at "$atlas_created_at" --output "$atlas_build_root/projection-pack"

uv run --project builder --extra test --locked python -m tools.mesh_pack.build_native_selected \
  --review artifacts/mesh-native-review-v1 \
  --selection docs/data/NATIVE_3D_SELECTION.json \
  --builder-commit "$atlas_build_commit" --output "$atlas_build_root/mesh-pack"
```

D070 packaging validates the hash-bound review graph and reuses its geometry
bytes verbatim: 966,645 triangles, 1,140 components and the reviewed movement
assignments. It requires clean Linux `main` at the exact supplied commit. The
current compiler derives a new pack ID from the selected geometry, selection,
commit and environment; read that ID from the output rather than hardcoding
`ibl-native-d070-b5f5abc7d0bb3575` from the older preview.

## AGEA and volumes

The production mode implements the accepted D074 original-value recipe:
4,345 experiments, all measured nonnegative voxels valid, `-1` missing,
no coarse-label outside mask, and the unchanged source affine. It records the
current clean Linux `main` commit itself. Source directory
`artifacts/agea-metadata-sizing` must contain these exact inputs; the builder
verifies their SHA-256 before materializing the release:

| File | SHA-256 |
| --- | --- |
| `gene-expression.bin` | `86b4997133435f830c33941e443d86baf1ef4195a8eb6343f5a9df2523f8e69d` |
| `gene-expression.pqt` | `90433973765b0361921c48dc70bce8291885c427d23d930b1eb6617348024572` |
| `label.npy` | `0a09957f2e6b9c70081928e15587e9f3b97382ac7a79baa2788160206ad8a81a` |
| `image.npy` | `665d671ad51976e9e0680da43eab8b74d5d6e84c11c230be31451c00d3ea71ba` |

Unlike the regional builders, AGEA takes a new output directory and adds
`releases/agea/<id>` beneath it. Build to a separate new directory, then move
the immutable dataset subtree into the common release root without changing
bytes or IDs. Retain the generated helper catalog as build evidence; the
committed initial curator owns the final multi-dataset catalog.

```bash
uv run --project builder --extra test --locked python -m tools.agea_preview \
  --production --release-id agea-original-20260908-v1 \
  --source artifacts/agea-metadata-sizing \
  --alignment-review docs/data/AGEA_ALIGNMENT_REVIEW.json \
  --created-at "$atlas_created_at" --output "$atlas_build_root/agea-build"
test ! -e "$atlas_release_root/agea"
mv "$atlas_build_root/agea-build/releases/agea" "$atlas_release_root/agea"
```

The curator deliberately excludes ephys volumes until the real-origin Q5
measurement establishes their production transport. Do not promote the W26
candidate by renaming it during this build.

Compare decoded AGEA value and validity bytes against the reviewed local
release. The existing preview reused gzip transport with OS header byte `0x03`;
the current writer emits `0xff`. This changes served-byte hashes even when the
compressed body and decoded scientific bytes are identical. Record both encoded
and decoded comparisons; never treat a different gzip hash alone as proof of
changed scientific values. Rebuilt manifests must describe their actual new
served bytes. Production packaging must also include the alignment-review and
builder-source files referenced by provenance; validate the complete publication
graph, not only the release schema.

## Validation and evidence

Each regional build performs schema validation. Run production preflight on
all completed scientific releases from the same clean commit, plus pack
validators; these commands do not upload anything.

```bash
just production-release-preflight \
  "$atlas_release_root/ephys_atlas_channels/2026_W32-ibl-review-20260908-v1" \
  "$atlas_release_root/ephys_atlas_clusters/sha256-9b5e55215b306f26-ibl-review-20260908-v1" \
  "$atlas_release_root/brainwide_map/legacy-v1-1d908bea-ibl-review-20260908-v1" \
  "$atlas_release_root/agea/agea-original-20260908-v1"

uv run --project builder --extra test --locked python -m tools.projection_pack.validate "$atlas_build_root/projection-pack"
uv run --project builder --extra test --locked python -m tools.mesh_pack.validate "$atlas_build_root/mesh-pack"
```

Record
output manifest SHA-256/size, derived pack IDs, validator output and the build
session record. Compare regional feature inventory and numeric resource hashes
to the reviewed releases; any difference requires explanation before upload,
particularly the cluster code-pin discrepancy noted above. Build the initial
catalog with the committed curator only when every referenced immutable release
passes. Complete `just check` on the same commit before declaring build and
publication machinery ready. Publication remains a separate operator step in
[Local publisher operations](LOCAL_PUBLISHER.md).
