python := "python3"

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

test:
    PYTHONPATH=builder pytest -q

# Deterministic whole-release download artifact.
data-package path output:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli package {{path}} {{output}}
