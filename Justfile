uv-test := "uv run --project builder --extra test --locked"
uv-publishing := "uv run --project publishing --extra test --locked"
uv-scientific := "uv run --project builder --extra scientific --locked"
uv-anatomy := "uv run --project builder --extra anatomy --extra scientific --extra test --locked"

# Install all locked local development dependencies in a fresh checkout.
bootstrap:
    uv sync --project builder --python 3.12 --extra anatomy --extra scientific --extra test --locked
    uv sync --project publishing --python 3.12 --extra test --locked
    cd web && npm ci
    cd web && npx playwright install chromium

# Install the exact scientific channel-builder environment (no sudo required).
bootstrap-scientific:
    uv sync --project builder --python 3.12 --extra scientific --locked

# Install the pinned atlas/vectorization benchmark environment (no sudo required).
bootstrap-anatomy:
    uv sync --project builder --python 3.12 --extra anatomy --extra scientific --extra test --locked

# Run the browser app locally.
dev:
    cd web && EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_channels/2026_W32 EPHYS_ATLAS_REAL_FEATURE=rms_ap.denoised npm run dev:real

# Run the viewer against a pinned local real channel release (development only).
dev-real release="2026_W32" feature="rms_ap.denoised":
    cd web && EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_channels/{{release}} EPHYS_ATLAS_REAL_FEATURE={{feature}} npm run dev:real

# Builder/schema tests.
test-builder:
    {{uv-test}} python -m pytest -q tests

# Publishing service/client tests.
test-publishing:
    {{uv-publishing}} python -m pytest -q publishing/tests

# All Python gates used by CI.
test-python: test-builder test-publishing

# TypeScript, unit tests, and production build.
test-web:
    cd web && npm run typecheck
    cd web && npm run test:unit
    cd web && npm run test:rendering
    cd web && npm run build

# User-observable browser regression suite.
test-browser:
    cd web && npm run test:browser

# Profile cold-pack, same-pack, and retained SVG navigation in Chromium.
benchmark-anatomy:
    cd web && npm run benchmark:anatomy

# Exercise the anatomy contract, generator, artifact validator, and comparison cases.
test-anatomy:
    {{uv-anatomy}} python -m pytest -q tests/test_anatomy_pack.py tests/test_anatomy_pack_schema.py tests/test_anatomy_compare.py tests/test_anatomy_smoothing_lab.py tests/test_anatomy_pack_v2.py tests/test_anatomy_pack_v2_schema.py tests/test_svg_pack.py tests/test_sampled_svg_pack.py tests/test_projection_pack.py

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

# Generate the ignored, fully offline anatomy comparison lab.
anatomy-compare resolution="25":
    {{uv-anatomy}} python tools/anatomy_compare/build.py --resolution {{resolution}}

# Build the deterministic synthetic anatomy-smoothing evidence report offline.
anatomy-smoothing-lab tolerances="0,2.5,5,7.5,10,15,20" output="artifacts/anatomy-smoothing-lab/index.html":
    {{uv-anatomy}} python -m tools.anatomy_smoothing_lab.build --synthetic --offline --created-at 2026-08-22T00:00:00Z --strategies exact,geos-coverage-simplify,independent-ring-rdp-unsafe --tolerances-um {{tolerances}} --maximum-error-um 20 --minimum-iou 0.98 --output {{output}}

# Build against explicit, hash-pinned real 10 um review inputs.
anatomy-smoothing-lab-real source_lut annotation template_volume template_sha256 template_source output="artifacts/anatomy-smoothing-lab/index.html" tolerances="0,2.5,5,7.5,10,15,20":
    {{uv-anatomy}} python -m tools.anatomy_smoothing_lab.build --offline --source-lut {{source_lut}} --annotation {{annotation}} --template-volume {{template_volume}} --template-sha256 {{template_sha256}} --template-source {{template_source}} --created-at 2026-08-22T00:00:00Z --strategies exact,geos-coverage-simplify,independent-ring-rdp-unsafe --tolerances-um {{tolerances}} --maximum-error-um 20 --minimum-iou 0.98 --output {{output}}

# Rebuild the pinned Allen ontology/color and legacy-SVG crosswalk asset.
atlas-regions:
    {{uv-scientific}} python tools/allen_regions/build.py --force

# Full local completion gate. Keep this aligned with .github/workflows/ci.yml.
check: test-python test-web test-browser

# Backward-compatible alias: repository tests mean the full gate.
test: check

# Pull canonical source artifacts only; never recompute raw scientific features.
data-pull dataset release="latest":
    {{uv-scientific}} ephys-atlas-data pull {{dataset}} {{release}} --dest data/source

# Build the launch channel dataset. Raw/denoised and population are intentionally explicit.
data-build-channels release feature_mode population created_at ibleatools_commit iblatlas_commit builder_commit:
    {{uv-scientific}} ephys-atlas-data build-channels {{release}} --feature-mode {{feature_mode}} --population {{population}} --created-at {{created_at}} --ibleatools-commit {{ibleatools_commit}} --iblatlas-commit {{iblatlas_commit}} --builder-commit {{builder_commit}}

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

# Deterministic whole-release download artifact.
data-package path output:
    {{uv-test}} ephys-atlas-data package {{path}} {{output}}
