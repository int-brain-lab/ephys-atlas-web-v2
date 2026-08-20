python := "python3"

# Install local development dependencies in a fresh checkout.
bootstrap:
    {{python}} -m pip install -e 'builder[test]'
    {{python}} -m pip install -e publishing
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
    cd web && npm run dev

# Run the viewer against a pinned local real channel release (development only).
dev-real release="2026_W32" feature="rms_ap.denoised":
    cd web && EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_channels/{{release}} EPHYS_ATLAS_REAL_FEATURE={{feature}} npm run dev:real

# Builder/schema tests.
test-builder:
    PYTHONPATH=builder {{python}} -m pytest -q tests

# Publishing service/client tests.
test-publishing:
    PYTHONPATH=publishing/src {{python}} -m pytest -q publishing/tests

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
    uv run --project builder --extra anatomy --extra scientific --extra test --locked python -m pytest -q tests/test_anatomy_pack.py tests/test_anatomy_pack_schema.py tests/test_anatomy_compare.py

# Build a new immutable anatomy pack from a clean commit. Existing output is never replaced.
anatomy-pack tolerance="15" depth="16" output="artifacts/anatomy-pack-v1":
    uv run --project builder --extra anatomy --extra scientific --extra test --locked python -m tools.anatomy_pack.build --tolerance-um {{tolerance}} --pack-depth {{depth}} --created-at 2026-08-20T00:00:00Z --output {{output}}

# Derive a sparse indexed-SVG display corpus from one validated immutable v2 pack.
sampled-anatomy-pack parent output spacing="80" depth="8":
    uv run --project builder --extra anatomy --extra scientific --extra test --locked python -m tools.svg_pack.build_sampled --parent {{parent}} --output {{output}} --spacing-um {{spacing}} --pack-depth {{depth}} --created-at 2026-08-21T00:00:00Z

# Generate the ignored, fully offline anatomy comparison lab.
anatomy-compare resolution="25":
    uv run --project builder --extra anatomy --extra scientific --extra test --locked python tools/anatomy_compare/build.py --resolution {{resolution}}

# Rebuild the pinned Allen ontology/color and legacy-SVG crosswalk asset.
atlas-regions:
    uv run --project builder --extra scientific --locked python tools/allen_regions/build.py --force

# Full local completion gate. Keep this aligned with .github/workflows/ci.yml.
check: test-python test-web test-browser

# Backward-compatible alias: repository tests mean the full gate.
test: check

# Pull canonical source artifacts only; never recompute raw scientific features.
data-pull dataset release="latest":
    uv run --project builder --extra scientific --locked ephys-atlas-data pull {{dataset}} {{release}} --dest data/source

# Build the launch channel dataset. Raw/denoised and population are intentionally explicit.
data-build-channels release feature_mode population created_at ibleatools_commit iblatlas_commit builder_commit:
    uv run --project builder --extra scientific --locked ephys-atlas-data build-channels {{release}} --feature-mode {{feature_mode}} --population {{population}} --created-at {{created_at}} --ibleatools-commit {{ibleatools_commit}} --iblatlas-commit {{iblatlas_commit}} --builder-commit {{builder_commit}}

# Validate a dataset-specific build output. Scientific transforms stay explicit recipes.
data-build dataset release="latest":
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli build {{dataset}} {{release}}

data-validate path:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli validate {{path}}

# Inspect NPZ/NPY container metadata without decoding the full volume.
data-inspect-volume path:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli inspect-volume {{path}}

golden:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli golden fixtures/golden-v0.3

# Deterministic whole-release download artifact.
data-package path output:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli package {{path}} {{output}}
