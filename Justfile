uv-test := "uv run --project builder --extra test --locked"
uv-docs := "uv run --project builder --extra docs --locked"
uv-publishing := "uv run --project publishing --extra test --locked"
uv-scientific := "uv run --project builder --extra scientific --locked"
uv-anatomy := "uv run --project builder --extra anatomy --extra scientific --extra test --locked"

# Install all locked local development dependencies in a fresh checkout.
bootstrap:
    uv sync --project builder --python 3.12 --extra anatomy --extra docs --extra scientific --extra test --locked
    uv sync --project publishing --python 3.12 --extra test --locked
    cd web && npm ci
    cd web && npx playwright install chromium

# Install every browser engine used by the opt-in cross-browser campaign.
bootstrap-cross-browser:
    cd web && npx playwright install chromium firefox webkit

# Install the exact scientific channel-builder environment (no sudo required).
bootstrap-scientific:
    uv sync --project builder --python 3.12 --extra scientific --locked

# Install the pinned atlas/vectorization benchmark environment (no sudo required).
bootstrap-anatomy:
    uv sync --project builder --python 3.12 --extra anatomy --extra scientific --extra test --locked

# Obtain any remotely resolved artifacts atomically, reuse valid local bytes, and validate.
data:
    {{uv-test}} python -m tools.development_bundle sync data/development-bundle-v4.json

# Run the descriptor-configured local catalog after complete available-graph validation.
dev:
    {{uv-test}} python -m tools.development_bundle run --cwd web data/development-bundle-v4.json -- npm run dev:real

# Builder/schema tests.
test-builder:
    {{uv-test}} python -m pytest -q tests

# Publishing service/client tests.
test-publishing:
    {{uv-publishing}} python -m pytest -q publishing/tests

# All Python gates used by CI.
test-python: test-builder test-publishing

# Validate documentation links, authorities, identifiers, and status registries.
docs-check:
    {{uv-test}} python -m tools.docs_check

# Render the reader-facing site and generated Python API reference locally.
# This target builds files under ignored site/; it does not deploy them.
docs-site:
    {{uv-docs}} mkdocs build --strict

# Preview the documentation website with live reload on the first free port at or above 8000.
docs-serve:
    #!/usr/bin/env bash
    set -euo pipefail
    port="$(
        {{uv-docs}} python - <<'PY'
    import socket

    for candidate in range(8000, 9000):
        with socket.socket() as probe:
            try:
                probe.bind(("0.0.0.0", candidate))
            except OSError:
                continue
        print(candidate)
        break
    else:
        raise SystemExit("no free documentation port found between 8000 and 8999")
    PY
    )"
    printf 'Documentation: http://127.0.0.1:%s/\n' "$port"
    if command -v tailscale >/dev/null 2>&1; then
        tailscale_name="$(tailscale status --self --json 2>/dev/null | {{uv-docs}} python -c 'import json, sys; print(json.load(sys.stdin).get("Self", {}).get("DNSName", "").rstrip("."))' 2>/dev/null || true)"
        if [[ -n "$tailscale_name" ]]; then
            printf 'Tailscale:     http://%s:%s/\n' "$tailscale_name" "$port"
        fi
    fi
    exec {{uv-docs}} mkdocs serve -a "0.0.0.0:$port"

# Execute every standalone public authoring example against synthetic inputs.
test-examples:
    {{uv-test}} python -m pytest -q tests/test_python_examples.py

# TypeScript, unit tests, and production build.
test-web:
    cd web && npm run typecheck
    cd web && npm run test:unit
    cd web && npm run test:rendering
    cd web && npm run build

# User-observable browser regression suite.
test-browser:
    cd web && npm run test:browser

# Regenerate the reviewed synthetic documentation screenshots and stable manifest.
docs-screenshots:
    cd web && node scripts/docs-screenshot-manifest.mjs
    cd web && npx playwright test --config playwright.docs.config.ts --update-snapshots

# Verify documentation screenshots without modifying their committed baselines.
docs-screenshots-check:
    cd web && node scripts/docs-screenshot-manifest.mjs --check
    cd web && npx playwright test --config playwright.docs.config.ts

# Run the portable browser matrix; native Safari remains a separate owner-host check.
test-browser-cross:
    cd web && npm run test:browser:cross

# Opt-in browser acceptance for the ignored local D038 Brain-Wide Map release.
test-brainwide-map-release:
    cd web && npm run test:brainwide-map-release

# Opt-in browser acceptance for the ignored local D044 cluster release.
test-cluster-release:
    cd web && npm run test:cluster-release

# Profile cold-pack, same-pack, and retained SVG navigation in Chromium.
benchmark-anatomy:
    cd web && npm run benchmark:anatomy

# Generate compact malformed ZIP cases for the opt-in local-import campaign.
benchmark-local-import-adversarial output="artifacts/local-import-benchmark/adversarial":
    {{uv-test}} python -m benchmarks.local_import.generate adversarial --output-dir "{{output}}"

# Generate one valid synthetic capacity case: ID=PAYLOAD_BYTES=ENTRIES.
benchmark-local-import-capacity case output="artifacts/local-import-benchmark/capacity":
    {{uv-test}} python -m benchmarks.local_import.generate capacity --output-dir "{{output}}" --case "{{case}}"

# Bundle one exact release: ID=regional|volume=PATH.
benchmark-local-import-real release output="artifacts/local-import-benchmark/real":
    {{uv-test}} python -m benchmarks.local_import.generate real --output-dir "{{output}}" --release "{{release}}"

# Run one generated corpus through the single-worker browser evidence harness.
benchmark-local-import-browser corpus output="artifacts/local-import-benchmark/evidence" project="":
    #!/usr/bin/env bash
    set -euo pipefail
    benchmark_corpus="$(realpath "{{corpus}}")"
    benchmark_output="$(realpath -m "{{output}}")"
    benchmark_args=()
    if [[ -n "{{project}}" ]]; then
        benchmark_args=(--project "{{project}}")
    fi
    cd web
    EPHYS_ATLAS_LOCAL_IMPORT_CORPUS="$benchmark_corpus" \
      EPHYS_ATLAS_LOCAL_IMPORT_BENCHMARK_OUTPUT="$benchmark_output" \
      npx playwright test --config playwright.local-import-benchmark.config.ts "${benchmark_args[@]}"

# Exercise the anatomy contract, generator, artifact validator, and comparison cases.
test-anatomy:
    {{uv-anatomy}} python -m pytest -q tests/test_anatomy_pack.py tests/test_anatomy_pack_schema.py tests/test_anatomy_compare.py tests/test_anatomy_smoothing_lab.py tests/test_top_reconstruction_lab.py tests/test_anatomy_pack_v2.py tests/test_anatomy_pack_v2_schema.py tests/test_svg_pack.py tests/test_sampled_svg_pack.py tests/test_projection_pack.py

# Exercise the unified mesh-pack contract, compiler, binary, and graph gates.
test-mesh-pack:
    {{uv-test}} python -m pytest -q tests/test_mesh_pack.py tests/test_schema_v1_contract.py

# Build a historical 25 um v1 anatomy pack from a clean commit.
anatomy-pack tolerance="15" depth="16" output="artifacts/anatomy-pack-v1":
    {{uv-anatomy}} python -m tools.anatomy_pack.build --tolerance-um {{tolerance}} --pack-depth {{depth}} --created-at 2026-08-20T00:00:00Z --output {{output}}

# Build the canonical bilateral 10 um v2 parent. Existing output is never replaced.
anatomy-pack-v2 depth="16" output="artifacts/anatomy-pack-v2":
    {{uv-anatomy}} python -m tools.anatomy_pack.build_v2 --pack-depth {{depth}} --created-at 2026-08-20T00:00:00Z --output {{output}}

# Derive a sparse indexed-SVG display corpus from one validated immutable v2 pack.
sampled-anatomy-pack parent output spacing="80" depth="8":
    {{uv-anatomy}} python -m tools.svg_pack.build_sampled --parent {{parent}} --output {{output}} --spacing-um {{spacing}} --pack-depth {{depth}} --created-at 2026-08-21T00:00:00Z

# Validate the complete files and checksums of one immutable v1 projection pack.
projection-pack-validate path:
    {{uv-test}} python -m tools.projection_pack.validate {{path}}

# Compile the tiny test-only mesh source; real inputs and outputs stay outside Git.
mesh-pack-fixture output="artifacts/mesh-pack-v1-fixture":
    {{uv-test}} python -m tools.mesh_pack.build --source-dir fixtures/mesh-pack-v1/source --output {{output}}

# Losslessly repackage the exact D042 compiled-full donor into schema v1.
mesh-pack-d042 donor="artifacts/mesh-d042-donor" output="artifacts/mesh-d042-schema-v1" projection="web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a/manifest.json":
    node web/scripts/repack-d042-mesh.mjs --donor-dir {{donor}} --projection-manifest {{projection}} --output {{output}} --builder-commit $(git rev-parse HEAD)

# Validate schema, resources, decoder identity, and the complete file graph.
mesh-pack-validate path:
    {{uv-test}} python -m tools.mesh_pack.validate {{path}}

# Validate the locally served D042 pack in Chromium and write ignored evidence.
validate-3d-local url="http://127.0.0.1:5173/" output="../artifacts/mesh-d042-browser-evidence":
    cd web && node scripts/validate-local-d042.mjs {{url}} {{output}}

# Validate every dataset and context view exposed by `just dev`.
validate-local-full url="http://localhost:5173/" output="../artifacts/local-full-browser-evidence":
    {{uv-test}} python -m tools.development_bundle run --cwd web data/development-bundle-v4.json -- node scripts/validate-local-full.mjs {{url}} {{output}}

# Generate the ignored, fully offline anatomy comparison lab.
anatomy-compare resolution="25":
    {{uv-anatomy}} python tools/anatomy_compare/build.py --resolution {{resolution}}

# Build the deterministic synthetic anatomy-smoothing evidence report offline.
anatomy-smoothing-lab tolerances="0,2.5,5,7.5,10,15,20" output="artifacts/anatomy-smoothing-lab/index.html" workers="1":
    {{uv-anatomy}} python -m tools.anatomy_smoothing_lab.build --synthetic --offline --created-at 2026-08-22T00:00:00Z --strategies exact,geos-coverage-simplify,independent-ring-rdp-unsafe --tolerances-um {{tolerances}} --maximum-error-um 20 --minimum-iou 0.98 --workers {{workers}} --output {{output}}

# Build against explicit, hash-pinned real 10 um review inputs.
anatomy-smoothing-lab-real source_lut annotation template_volume template_sha256 template_source output="artifacts/anatomy-smoothing-lab/index.html" tolerances="0,2.5,5,7.5,10,15,20" workers="1":
    {{uv-anatomy}} python -m tools.anatomy_smoothing_lab.build --offline --source-lut {{source_lut}} --annotation {{annotation}} --template-volume {{template_volume}} --template-sha256 {{template_sha256}} --template-source {{template_source}} --created-at 2026-08-22T00:00:00Z --strategies exact,geos-coverage-simplify,independent-ring-rdp-unsafe --tolerances-um {{tolerances}} --maximum-error-um 20 --minimum-iou 0.98 --workers {{workers}} --output {{output}}

# Update only the UI around an existing report; scientific evidence is reused byte-for-byte.
anatomy-smoothing-lab-rerender input output=input:
    {{uv-anatomy}} python -m tools.anatomy_smoothing_lab.rerender --input {{input}} --output {{output}}

# Build the ignored, self-contained Q14 distribution owner-review lab from exact local audits.
distribution-review-lab output="artifacts/distribution-review-lab/index.html":
    {{uv-test}} python -m tools.distribution_review_lab.build --output {{output}}

# Serve an already-built Q14 review lab without exposing repository files.
distribution-review-lab-serve port="8765":
    {{uv-test}} python -m http.server {{port}} --bind 127.0.0.1 --directory artifacts/distribution-review-lab

# Build the ignored, local-only legacy/reconstructed Top comparison lab.
top-reconstruction-lab annotation legacy_top regions="web/public/atlas/allen-ccf-2017/regions.json" output="artifacts/top-reconstruction-lab/index.html" tolerances="12.5,25,37.5":
    {{uv-anatomy}} python -m tools.top_reconstruction_lab.build --annotation {{annotation}} --legacy-top {{legacy_top}} --regions {{regions}} --created-at 2026-08-27T00:00:00Z --tolerances-um {{tolerances}} --output {{output}}

# Build from a hash-pinned, memory-mappable bilateral BrainRegions-row LUT.
top-reconstruction-lab-lut source_lut source_lut_sha256 source_parent_manifest legacy_top resolution_um="10" regions="web/public/atlas/allen-ccf-2017/regions.json" output="artifacts/top-reconstruction-lab/10um/index.html" tolerances="2.5,5,7.5":
    {{uv-anatomy}} python -m tools.top_reconstruction_lab.build --source-lut {{source_lut}} --source-lut-sha256 {{source_lut_sha256}} --source-parent-manifest {{source_parent_manifest}} --resolution-um {{resolution_um}} --legacy-top {{legacy_top}} --regions {{regions}} --created-at 2026-08-27T00:00:00Z --tolerances-um {{tolerances}} --output {{output}}

# Build shared-boundary smoothing variants without repeating simplification candidates.
top-reconstruction-lab-smoothing source_lut source_lut_sha256 source_parent_manifest legacy_top passes="1,2,4,8" strength="0.125" regions="web/public/atlas/allen-ccf-2017/regions.json" output="artifacts/top-reconstruction-lab/shared-smoothing/index.html":
    {{uv-anatomy}} python -m tools.top_reconstruction_lab.build --source-lut {{source_lut}} --source-lut-sha256 {{source_lut_sha256}} --source-parent-manifest {{source_parent_manifest}} --resolution-um 10 --legacy-top {{legacy_top}} --regions {{regions}} --created-at 2026-08-27T00:00:00Z --tolerances-um= --smoothing-passes {{passes}} --smoothing-strength {{strength}} --output {{output}}

# Build the ignored, local-only W26/Allen geometry candidate review page.
volume-geometry-review annotation annotation_sha256 volume="data/source/ephys_atlas_volumes/2026_W26/brainwide_ephys_atlas_50um.npz" volume_sha256="1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253":
    {{uv-anatomy}} python -m tools.volume_geometry_review.build --volume {{volume}} --volume-sha256 {{volume_sha256}} --annotation {{annotation}} --annotation-sha256 {{annotation_sha256}} --created-at 2026-08-23T00:00:00Z --output artifacts/volume-geometry-review

# Rebuild the pinned Allen ontology/color and legacy-SVG crosswalk asset.
atlas-regions:
    {{uv-scientific}} python tools/allen_regions/build.py --force

# Full local completion gate. Keep this aligned with .github/workflows/ci.yml.
check: docs-check docs-site test-python test-web test-browser docs-screenshots-check

# Backward-compatible alias: repository tests mean the full gate.
test: check

# Pull canonical source artifacts only; never recompute raw scientific features.
data-pull dataset release="latest":
    {{uv-scientific}} ephys-atlas-data pull {{dataset}} {{release}} --dest data/source

# Pull one explicitly resolved canonical encoding volume.
data-pull-volume release resolution_um:
    {{uv-scientific}} ephys-atlas-data pull ephys_atlas_volumes {{release}} --resolution-um {{resolution_um}} --dest data/source

# Pull the D038-approved cluster project into a content-addressed local snapshot.
data-pull-clusters release="latest":
    {{uv-scientific}} ephys-atlas-data pull ephys_atlas_clusters {{release}} --project ibl_neuropixel_brainwide_01 --dest data/source

# Build a new channel release from a pinned source and reviewed D050 selection.
data-build-channels source_release output_release feature_mode population distribution_selection created_at ibleatools_commit iblatlas_commit builder_commit:
    {{uv-scientific}} ephys-atlas-data build-channels {{source_release}} --release-id {{output_release}} --feature-mode {{feature_mode}} --population {{population}} --distribution-selection {{distribution_selection}} --created-at {{created_at}} --ibleatools-commit {{ibleatools_commit}} --iblatlas-commit {{iblatlas_commit}} --builder-commit {{builder_commit}}

# Build a new cluster release from its catalog and reviewed D050 selections.
data-build-clusters source_release output_release catalog_selection distribution_selection created_at ibleatools_commit iblatlas_commit builder_commit:
    {{uv-scientific}} ephys-atlas-data build-clusters {{source_release}} --release-id {{output_release}} --project ibl_neuropixel_brainwide_01 --population all --catalog-selection {{catalog_selection}} --distribution-selection {{distribution_selection}} --created-at {{created_at}} --ibleatools-commit {{ibleatools_commit}} --iblatlas-commit {{iblatlas_commit}} --builder-commit {{builder_commit}}

# Build an explicitly local W26 slice-pack candidate from the committed D043 selection.
data-build-volumes-candidate source_release release_id distribution_selection created_at pack_depth ibleatools_commit iblatlas_commit builder_commit:
    {{uv-scientific}} ephys-atlas-data build-volumes {{source_release}} --release-id {{release_id}} --created-at {{created_at}} --geometry-selection docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json --distribution-selection {{distribution_selection}} --layout orthogonal_slice_packs --pack-depth {{pack_depth}} --candidate --ibleatools-commit {{ibleatools_commit}} --iblatlas-commit {{iblatlas_commit}} --builder-commit {{builder_commit}}

# Preserve the exact D038 source as a new release with reviewed D050 presentation.
data-build-brainwide-map source_release output_release distribution_selection created_at builder_commit source_dir="data/source/brainwide_map/legacy-v1-1d908bea":
    {{uv-scientific}} ephys-atlas-data build-brainwide-map {{source_release}} --release-id {{output_release}} --distribution-selection {{distribution_selection}} --created-at {{created_at}} --builder-commit {{builder_commit}} --source-dir {{source_dir}}

# Validate a dataset-specific build output. Scientific transforms stay explicit recipes.
data-build dataset release="latest":
    {{uv-test}} ephys-atlas-data build {{dataset}} {{release}}

data-validate path:
    {{uv-test}} ephys-atlas-data validate {{path}}

# Inspect NPZ/NPY container metadata without decoding the full volume.
data-inspect-volume path:
    {{uv-test}} ephys-atlas-data inspect-volume {{path}}

golden:
    {{uv-test}} ephys-atlas-data golden fixtures/golden-v1
    {{uv-test}} ephys-atlas-data bundle fixtures/golden-v1 fixtures/golden-v1.ibl-ephys-atlas.zip

# Deterministic whole-release download artifact.
data-package path output:
    {{uv-test}} ephys-atlas-data package {{path}} {{output}}

# Create or validate the deterministic local-data interchange bundle.
data-bundle path output:
    {{uv-test}} ephys-atlas-data bundle {{path}} {{output}}

data-bundle-validate path:
    {{uv-test}} ephys-atlas-data validate-bundle {{path}}
