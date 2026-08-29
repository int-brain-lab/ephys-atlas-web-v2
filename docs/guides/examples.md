# Executable Python examples

Status: runnable guide examples; behavior is governed by the active
[authoring contract](../data/CUSTOM_DATA_AUTHORING.md) and schema v1.

The repository examples use small deterministic synthetic inputs. They make no
scientific claim and do not download an atlas: each volume example constructs
its demonstration geometry in memory and passes an already-created atlas
object to the public API.

Run an example from the repository root with the locked builder environment:

```bash
uv run --project builder --locked python examples/python/regional_values.py \
  regional-values.ibl-ephys-atlas.zip
```

Each script takes the destination archive as its positional argument; use
`--help` for the exact options.

## Examples

- [`regional_values.py`](https://github.com/int-brain-lab/ephys-atlas-web-v2/blob/main/examples/python/regional_values.py)
  authors one already-aggregated value per Allen region.
- [`regional_observations.py`](https://github.com/int-brain-lab/ephys-atlas-web-v2/blob/main/examples/python/regional_observations.py)
  aggregates repeated observations and requests supported reduced mappings.
- [`volume_mask.py`](https://github.com/int-brain-lab/ephys-atlas-web-v2/blob/main/examples/python/volume_mask.py)
  classifies valid, outside, and missing voxels with explicit masks.
- [`volume_sentinel.py`](https://github.com/int-brain-lab/ephys-atlas-web-v2/blob/main/examples/python/volume_sentinel.py)
  uses an explicit outside sentinel while non-finite values remain missing.
- [`mixed_representations.py`](https://github.com/int-brain-lab/ephys-atlas-web-v2/blob/main/examples/python/mixed_representations.py)
  places regional and volume representations on one feature without changing
  either representation's scientific meaning.

After running a script, import the resulting `.ibl-ephys-atlas.zip` through the
viewer dataset menu. The browser validates the complete schema-v1 graph before
storage mutation. A local share URL contains no dataset bytes; another browser
must import the same immutable archive before that URL can resolve.

For a detailed walkthrough of regional input identity, hemisphere folding,
aggregation, reduced mappings, validation, and import, continue with the
[regional authoring tutorial](../data/CUSTOM_DATA_TUTORIAL.md).
