python := "python3"

# Pull canonical source artifacts only; never recompute raw scientific features.
data-pull dataset release="latest":
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli pull {{dataset}} {{release}} --dest data/source

# Validate a dataset-specific build output. Scientific transforms stay explicit recipes.
data-build dataset release="latest":
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli build data/releases/{{dataset}}/{{release}}

data-validate path:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli validate {{path}}

golden:
    PYTHONPATH=builder {{python}} -m ephys_atlas_builder.cli golden fixtures/golden-v0.1

test:
    PYTHONPATH=builder pytest -q
