from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from ibl_ephys_atlas_publish.core import Conflict, ValidationError
from ibl_ephys_atlas_publish.s3 import Destination
from ibl_ephys_atlas_publish.s3_assets import asset_plan, publish_assets
from test_s3 import FakeS3


@pytest.mark.parametrize("kind,entry", [("projection", "manifest.json"), ("mesh", "manifest.json"), ("site", "index.html")])
def test_immutable_dependencies_before_entry_and_retry(tmp_path, kind, entry):
    (tmp_path / entry).write_text("{}" if entry.endswith("json") else "<html></html>")
    (tmp_path / "data.bin").write_bytes(b"test-only")
    destination, store = Destination("staging"), FakeS3()
    plan = asset_plan(tmp_path, destination, kind, "test-v1", [entry, "data.bin"])
    publish_assets(tmp_path, destination, plan, store)
    public = [k for k in store.writes if "/_staging/" not in k]
    assert public[0].endswith("data.bin")
    assert public[1].endswith(entry)
    if kind == "site":
        assert public[-1] == destination.key("site/index.html")
        assert store.objects[public[-1]][1]["CacheControl"] == "no-cache"
        assert b"atlas-publication:" in store.objects[public[-1]][0]
    before = len(store.writes)
    publish_assets(tmp_path, destination, plan, store)
    assert len(store.writes) == before + int(kind == "site")


def test_site_failure_preserves_entry_and_assets_cannot_overwrite(tmp_path):
    (tmp_path / "index.html").write_text("<html>old</html>")
    destination, store = Destination("staging"), FakeS3()
    plan = asset_plan(tmp_path, destination, "site", "old", ["index.html"])
    publish_assets(tmp_path, destination, plan, store)
    old = store.objects[destination.key("site/index.html")]
    (tmp_path / "index.html").write_text("<html>new</html>")
    with pytest.raises(Conflict):
        publish_assets(tmp_path, destination, asset_plan(tmp_path, destination, "site", "old", ["index.html"]), store)
    new = asset_plan(tmp_path, destination, "site", "new", ["index.html"])
    store.fail_at = "builds/new/index.html"
    with pytest.raises(RuntimeError):
        publish_assets(tmp_path, destination, new, store)
    assert store.objects[destination.key("site/index.html")] == old


def test_site_missing_external_dependency_fails_before_writes(tmp_path):
    (tmp_path / "index.html").write_text("<html></html>")
    destination, store = Destination("staging"), FakeS3()
    plan = asset_plan(tmp_path, destination, "site", "test", ["index.html"], [{"path": "catalog.json"}])
    with pytest.raises(ValidationError, match="dependency"):
        publish_assets(tmp_path, destination, plan, store)
    assert store.writes == []


def test_site_images_are_immutable_and_have_their_browser_content_type(tmp_path):
    (tmp_path / "index.html").write_text("<html></html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "hero.jpg").write_bytes(b"test-only")
    destination = Destination("staging")
    plan = asset_plan(tmp_path, destination, "site", "test", ["index.html", "assets/hero.jpg"])
    image = next(item for item in plan["artifacts"] if item["path"] == "assets/hero.jpg")
    assert image["content_type"] == "image/jpeg"
