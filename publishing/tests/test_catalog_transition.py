from copy import deepcopy
import json
from pathlib import Path

import pytest

from ibl_ephys_atlas_publish.catalog_transition import validate_catalog_transition
from ibl_ephys_atlas_publish.errors import ValidationError
from test_catalog import _config, retirement_record


@pytest.mark.parametrize("kind", ["projects", "datasets", "releases", "editions"])
def test_each_discovery_identity_is_protected(kind):
    previous = _config()
    candidate = deepcopy(previous)
    if kind in {"projects", "datasets"}:
        candidate[kind] = []
    elif kind == "releases":
        candidate["datasets"][0][kind] = []
    else:
        candidate["projects"][0][kind] = []
    with pytest.raises(ValidationError, match="explicit retirement"):
        validate_catalog_transition(previous, candidate)
    record = retirement_record(previous, candidate)
    assert validate_catalog_transition(previous, candidate, record)["removed"] == record["removed"]


@pytest.mark.parametrize("change", ["stale", "missing", "extra", "reason", "decision", "unsupported"])
def test_retirement_is_exact_and_cannot_be_reused(change):
    previous, candidate = _config(), _config(edition=False)
    record = retirement_record(previous, candidate)
    if change == "stale": record["baseline_sha256"] = "0" * 64
    if change == "missing": record["removed"]["editions"] = []
    if change == "extra": record["removed"]["datasets"] = ["other"]
    if change in {"reason", "decision"}: record[change] = " "
    if change == "unsupported": record["allow_all"] = True
    with pytest.raises(ValidationError, match="exact baseline"):
        validate_catalog_transition(previous, candidate, record)
    valid = retirement_record(previous, candidate)
    with pytest.raises(ValidationError):
        validate_catalog_transition(candidate, candidate, valid)


def test_first_publication_and_additive_updates_need_no_retirement():
    previous = _config(edition=False)
    assert not any(validate_catalog_transition(None, previous)["removed"].values())
    result = validate_catalog_transition(previous, _config())
    assert result["added"]["editions"] == ["p/e"]
    assert not any(result["removed"].values())


def test_new_default_release_preserves_historical_discovery():
    previous = _config(edition=False)
    candidate = deepcopy(previous)
    candidate["datasets"][0]["default_release"] = "r2"
    candidate["datasets"][0]["releases"].append({"release_id": "r2", "label": "New"})
    result = validate_catalog_transition(previous, candidate)
    assert result["added"]["releases"] == ["d/r2"]
    assert not any(result["removed"].values())


def test_bwm_restoration_preserves_the_entire_current_production_inventory():
    root = Path(__file__).resolve().parents[2]
    # Frozen W39 evidence remains the incident baseline after a future promotion.
    previous = json.loads((root / "data/deployment/dependencies/435e77daae52affa9949f7592745ed3fa039317f30b3e5b4363b182cfe2b5f93.json").read_bytes())
    candidate = json.loads((root / "data/deployment/initial-curator.json").read_bytes())
    result = validate_catalog_transition(previous, candidate)
    assert result["added"]["datasets"] == ["brainwide_map"]
    assert result["added"]["projects"] == ["brainwide-map"]
    assert result["added"]["releases"] == ["brainwide_map/legacy-v1-1d908bea-ibl-review-20260908-v1"]
    assert not any(result["removed"].values())
