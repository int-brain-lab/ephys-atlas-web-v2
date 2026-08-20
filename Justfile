python := "python3"

# Install local development dependencies in a fresh checkout.
bootstrap:
    {{python}} -m pip install -e 'builder[test]'
    {{python}} -m pip install -e publishing
    cd web && npm install
    cd web && npx playwright install chromium

# Run the browser app locally.
dev:
    cd web && npm run dev

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
    cd web && npm run build

# User-observable browser regression suite.
test-browser:
    cd web && npm run test:browser

# Full local completion gate. Keep this aligned with .github/workflows/ci.yml.
check: test-python test-web test-browser

# Backward-compatible alias: repository tests mean the full gate.
test: check

# Pull canonical source artifacts only; never recompute raw scientific features.
data-pull dataset release="latest":
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli pull {{dataset}} {{release}} --dest data/source

# Build the launch channel dataset. Raw/denoised and population are intentionally explicit.
data-build-channels release feature_mode population created_at:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli build-channels {{release}} --feature-mode {{feature_mode}} --population {{population}} --created-at {{created_at}}

# Validate a dataset-specific build output. Scientific transforms stay explicit recipes.
data-build dataset release="latest":
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli build {{dataset}} {{release}}

data-validate path:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli validate {{path}}

golden:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli golden fixtures/golden-v0.1

# Deterministic whole-release download artifact.
data-package path output:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli package {{path}} {{output}}
