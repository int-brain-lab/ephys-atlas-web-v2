import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from ibl_ephys_atlas_publish.core import Conflict, ValidationError
from ibl_ephys_atlas_publish.s3 import (
    Destination,
    publish_release,
    publish_staging_benchmark,
    release_plan,
)
from ibl_ephys_atlas_publish.s3_catalog import promote_catalog
from test_catalog import _config
from test_s3 import FakeS3


@pytest.fixture
def published(tmp_path):
    destination, store, releases = Destination("staging"), FakeS3(), []
    for release in ["r1", "r2"]:
        root = tmp_path / release
        root.mkdir()
        (root / "manifest.json").write_text(json.dumps({"dataset_id": "d", "release": {"release_id": release}}))
        plan = release_plan(root, destination, ["manifest.json"], [])
        publish_release(root, destination, plan, store)
        releases.append((root, plan))
    return destination, store, releases


def promote(published, config=None):
    destination, store, releases = published
    return promote_catalog(config or _config(), releases, destination, store, lambda c: None)


def test_catalog_last_and_history_survives_omission(published):
    destination, store, _ = published
    first = promote(published)
    assert store.writes[-1] == destination.key("catalog.json")
    omitted = promote(published, _config(edition=False))
    assert omitted["publication_id"] != first["publication_id"]
    with pytest.raises(Conflict, match="remapped"):
        promote(published, _config(release_id="r2"))
    assert store.get_json(destination.key("catalog.json"))[0] == omitted


@pytest.mark.parametrize("failure", ["catalog-history", "/catalog.json"])
def test_failure_keeps_last_good_catalog_and_retry_recovers(published, failure):
    destination, store, _ = published
    first = promote(published)
    store.fail_at = failure
    with pytest.raises(RuntimeError):
        promote(published, _config(edition=False))
    assert store.get_json(destination.key("catalog.json"))[0] == first
    store.fail_at = None
    promote(published, _config(edition=False))


def test_stale_writer_cannot_win_after_same_content_is_restored(published):
    destination, store, _ = published
    first = promote(published)
    stale = store.get_json(destination.key("catalog.json"))
    promote(published, _config(edition=False))
    restored = promote(published)
    assert restored["publication_id"] != first["publication_id"]
    original = store.get_json
    store.get_json = lambda key: stale if key == destination.key("catalog.json") else original(key)
    with pytest.raises(Conflict):
        promote(published)
    assert original(destination.key("catalog.json"))[0] == restored


def test_missing_history_blocks_promotion(published):
    destination, store, _ = published
    catalog = promote(published)
    del store.objects[destination.key(f"_staging/catalog-history/{catalog['publication_id']}.json")]
    with pytest.raises(ValidationError, match="history"):
        promote(published)


def test_missing_dependency_or_archived_dataset_never_creates_catalog(published):
    destination, store, _ = published
    del store.objects[destination.key("datasets/d/releases/r2/manifest.json")]
    before = len(store.writes)
    with pytest.raises(ValidationError, match="absent"):
        promote(published)
    assert len(store.writes) == before
    assert store.get_json(destination.key("catalog.json")) is None


def test_staging_benchmark_has_no_curator_completion_record(tmp_path):
    destination, store = Destination("staging"), FakeS3()
    ordinary = tmp_path / "r0"
    ordinary.mkdir()
    (ordinary / "manifest.json").write_text(
        json.dumps({"dataset_id": "d", "release": {"release_id": ordinary.name}})
    )
    ordinary_plan = release_plan(ordinary, destination, ["manifest.json"], [])
    publish_release(ordinary, destination, ordinary_plan, store)
    root = tmp_path / "r1-candidate"
    root.mkdir()
    (root / "manifest.json").write_text(
        json.dumps({"dataset_id": "d", "release": {"release_id": root.name}})
    )
    plan = release_plan(root, destination, ["manifest.json"], [])
    publish_staging_benchmark(root, destination, plan, store)
    with pytest.raises(ValidationError, match="release is incomplete"):
        promote_catalog(
            _config(release_id=root.name),
            [(root, plan)],
            destination,
            store,
            lambda catalog: None,
        )
    assert store.get_json(destination.key("catalog.json")) is None
