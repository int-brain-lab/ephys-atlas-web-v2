import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from ibl_ephys_atlas_publish.core import Conflict, ValidationError
from ibl_ephys_atlas_publish.s3 import (
    IMMUTABLE_CACHE,
    AwsCliStore,
    Destination,
    checksum,
    publish_direct_benchmark,
    publish_release,
    publish_staging_benchmark,
    release_plan,
)


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.writes = []
        self.fail_at = None

    def head(self, key):
        return self.objects[key][1] if key in self.objects else None

    def get_json(self, key):
        if key not in self.objects:
            return None
        body, head = self.objects[key]
        return json.loads(body), head["ETag"]

    def put(self, key, path, *, sha256, content_type, cache_control, expected_etag=None):
        if self.fail_at and self.fail_at in key:
            raise RuntimeError("injected interruption")
        old = self.head(key)
        if (old is not None if expected_etag is None else old is None or old["ETag"] != expected_etag):
            raise Conflict("conditional write failed")
        body = path.read_bytes()
        assert hashlib.sha256(body).hexdigest() == sha256
        self.objects[key] = (body, {"ETag": f'"{sha256}"', "ContentLength": len(body),
                                  "ChecksumSHA256": checksum(sha256), "ContentType": content_type,
                                  "CacheControl": cache_control})
        self.writes.append(key)


@pytest.fixture
def release(tmp_path):
    root = tmp_path / "r1"
    root.mkdir()
    (root / "manifest.json").write_text(json.dumps({"dataset_id": "d", "release": {"release_id": "r1"}}))
    (root / "slice.isvg.gz").write_bytes(b"opaque synthetic test bytes")
    destination = Destination("staging")
    plan = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], ["latest"])
    return root, destination, plan


@pytest.fixture
def direct_benchmark_release(tmp_path):
    root = tmp_path / "2026_W26-candidate-depth4"
    root.mkdir()
    (root / "manifest.json").write_text(
        json.dumps({"dataset_id": "ephys_atlas_volumes", "release": {"release_id": root.name}})
    )
    (root / "slice.isvg.gz").write_bytes(b"opaque synthetic direct candidate bytes")
    destination = Destination("production")
    plan = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], [])
    return root, destination, plan


@pytest.fixture
def benchmark_release(tmp_path):
    root = tmp_path / "r1-candidate-depth4"
    root.mkdir()
    (root / "manifest.json").write_text(
        json.dumps({"dataset_id": "d", "release": {"release_id": root.name}})
    )
    (root / "slice.isvg.gz").write_bytes(b"opaque synthetic candidate bytes")
    destination = Destination("staging")
    plan = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], [])
    return root, destination, plan


def test_stage_before_immutable_manifest_and_index_last_with_idempotent_resume(release):
    root, destination, plan = release
    store = FakeS3()
    result = publish_release(root, destination, plan, store)
    assert result["catalog_changed"] is False
    assert all(key.startswith(destination.root) for key in store.writes)
    assert store.writes[-1].endswith("datasets/d/index.json")
    public = [key for key in store.writes if "/_staging/" not in key]
    assert public[0].endswith("slice.isvg.gz")
    assert public[1].endswith("manifest.json")
    assert public[2].endswith("_publication.json")
    assert not any(key.endswith("catalog.json") for key in store.writes)
    _, head = store.objects[public[0]]
    assert head["ContentType"] == "application/octet-stream"
    assert head["CacheControl"] == IMMUTABLE_CACHE
    assert "ContentEncoding" not in head
    count = len(store.writes)
    publish_release(root, destination, plan, store)
    assert store.writes[count:] == [destination.key("datasets/d/index.json")]
    index, _ = store.get_json(store.writes[-1])
    assert index["releases"] == [{"release_id": "r1"}]
    assert index["aliases"] == {"latest": "r1"}


def test_direct_benchmark_uses_production_benchmark_namespace_only(direct_benchmark_release):
    root, destination, plan = direct_benchmark_release
    store = FakeS3()
    result = publish_direct_benchmark(root, destination, plan, store)
    assert result["publication_scope"] == "direct-origin-benchmark"
    assert result["dataset_index_changed"] is False
    assert result["catalog_changed"] is False
    assert store.get_json(destination.key("datasets/ephys_atlas_volumes/index.json")) is None
    assert store.get_json(destination.key("catalog.json")) is None
    assert not any("/releases/" in key for key in store.writes)
    public = [key for key in store.writes if "/_staging/" not in key]
    assert all(key.startswith(destination.root + "datasets/ephys_atlas_volumes/benchmarks/") for key in public)
    assert public[-2].endswith("/manifest.json")
    assert public[-1].endswith("/_benchmark_publication.json")
    completion = store.get_json(result["completion_key"])
    assert completion[0]["publication_scope"] == "direct-origin-benchmark"
    count = len(store.writes)
    publish_direct_benchmark(root, destination, plan, store)
    assert len(store.writes) == count


def test_direct_benchmark_rejects_staging_alias_nonvolume_and_non_candidate(direct_benchmark_release):
    root, destination, plan = direct_benchmark_release
    store = FakeS3()
    staging = Destination("staging")
    staging_plan = release_plan(root, staging, ["manifest.json", "slice.isvg.gz"], [])
    with pytest.raises(ValidationError, match="restricted to production"):
        publish_direct_benchmark(root, staging, staging_plan, store)
    aliased = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], ["latest"])
    with pytest.raises(ValidationError, match="aliases"):
        publish_direct_benchmark(root, destination, aliased, store)
    (root / "manifest.json").write_text(
        json.dumps({"dataset_id": "channels", "release": {"release_id": root.name}})
    )
    nonvolume = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], [])
    with pytest.raises(ValidationError, match="ephys_atlas_volumes"):
        publish_direct_benchmark(root, destination, nonvolume, store)
    (root / "manifest.json").write_text(
        json.dumps({"dataset_id": "ephys_atlas_volumes", "release": {"release_id": "ordinary-v1"}})
    )
    ordinary = root.with_name("ordinary-v1")
    root.rename(ordinary)
    noncandidate = release_plan(ordinary, destination, ["manifest.json", "slice.isvg.gz"], [])
    with pytest.raises(ValidationError, match="candidate identity"):
        publish_direct_benchmark(ordinary, destination, noncandidate, store)
    assert store.writes == []


def test_staging_benchmark_is_direct_only_and_cannot_be_curated(benchmark_release):
    root, destination, plan = benchmark_release
    store = FakeS3()
    result = publish_staging_benchmark(root, destination, plan, store)
    assert result["publication_scope"] == "staging-benchmark"
    assert result["dataset_index_changed"] is False
    assert result["catalog_changed"] is False
    assert store.get_json(destination.key("datasets/d/index.json")) is None
    assert store.get_json(destination.key("catalog.json")) is None
    assert store.get_json(destination.key("datasets/d/releases/r1-candidate-depth4/_publication.json")) is None
    completion = store.get_json(result["completion_key"])
    assert completion[0]["publication_scope"] == "staging-benchmark"
    public = [key for key in store.writes if "/_staging/" not in key]
    assert public[-2].endswith("/manifest.json")
    assert public[-1].endswith("/_benchmark_publication.json")
    count = len(store.writes)
    publish_staging_benchmark(root, destination, plan, store)
    assert len(store.writes) == count


def test_staging_benchmark_rejects_alias_production_and_non_candidate(benchmark_release):
    root, destination, _ = benchmark_release
    store = FakeS3()
    aliased = release_plan(root, destination, ["manifest.json", "slice.isvg.gz"], ["latest"])
    with pytest.raises(ValidationError, match="aliases"):
        publish_staging_benchmark(root, destination, aliased, store)
    production = Destination("production")
    production_plan = release_plan(root, production, ["manifest.json", "slice.isvg.gz"], [])
    with pytest.raises(ValidationError, match="restricted to staging"):
        publish_staging_benchmark(root, production, production_plan, store)
    (root / "manifest.json").write_text(json.dumps({"dataset_id": "d", "release": {"release_id": "r1"}}))
    ordinary = root.with_name("r1")
    root.rename(ordinary)
    ordinary_plan = release_plan(ordinary, destination, ["manifest.json", "slice.isvg.gz"], [])
    with pytest.raises(ValidationError, match="candidate identity"):
        publish_staging_benchmark(ordinary, destination, ordinary_plan, store)
    assert store.writes == []


@pytest.mark.parametrize("failure", ["_staging/", "releases/r1/slice", "releases/r1/manifest", "_publication", "datasets/d/index"])
def test_interruption_does_not_publish_index_and_retry_recovers(release, failure):
    root, destination, plan = release
    store = FakeS3()
    store.fail_at = failure
    with pytest.raises(RuntimeError, match="interruption"):
        publish_release(root, destination, plan, store)
    assert destination.key("datasets/d/index.json") not in store.objects
    store.fail_at = None
    publish_release(root, destination, plan, store)
    assert store.get_json(destination.key("datasets/d/index.json")) is not None


def test_distinct_plan_cannot_reuse_release_identity_or_overwrite(release):
    root, destination, plan = release
    store = FakeS3()
    publish_release(root, destination, plan, store)
    before = dict(store.objects)
    (root / "slice.isvg.gz").write_bytes(b"changed")
    other = release_plan(root, destination, [a["path"] for a in plan["artifacts"]], [])
    with pytest.raises(Conflict, match="differ"):
        publish_release(root, destination, other, store)
    assert store.objects == before


@pytest.mark.parametrize("field,value", [("ChecksumSHA256", "wrong"), ("ContentLength", 0), ("ContentEncoding", "gzip"), ("CacheControl", "wrong"), ("ContentType", "text/html")])
def test_remote_integrity_and_metadata_fail_closed(release, field, value):
    root, destination, plan = release
    store = FakeS3()
    publish_release(root, destination, plan, store)
    key = destination.key("datasets/d/releases/r1/slice.isvg.gz")
    store.objects[key][1][field] = value
    count = len(store.writes)
    with pytest.raises(Conflict, match="differ"):
        publish_release(root, destination, plan, store)
    assert len(store.writes) == count


def test_index_race_preserves_other_writer_and_retries_merge(release):
    root, destination, plan = release
    store = FakeS3()
    original = store.put
    index_key = destination.key("datasets/d/index.json")

    def race(key, path, **kwargs):
        if key == index_key and index_key not in store.objects:
            body = json.dumps({"dataset_id": "d", "metadata": {}, "archived": False,
                               "releases": [{"release_id": "r0"}], "aliases": {"paper": "r0"}}).encode()
            store.objects[key] = (body, {"ETag": '"other"'})
        original(key, path, **kwargs)

    store.put = race
    with pytest.raises(Conflict):
        publish_release(root, destination, plan, store)
    assert store.get_json(index_key)[0]["releases"] == [{"release_id": "r0"}]
    store.put = original
    publish_release(root, destination, plan, store)
    assert store.get_json(index_key)[0]["aliases"] == {"paper": "r0", "latest": "r1"}


def test_local_change_is_rejected_before_network(release):
    root, destination, plan = release
    (root / "slice.isvg.gz").write_bytes(b"changed")
    store = FakeS3()
    with pytest.raises(ValidationError, match="differs"):
        publish_release(root, destination, plan, store)
    assert store.objects == {}


def test_destination_paths_and_symlinks(release):
    root, destination, _ = release
    for path in ["../source", "/source", "x/../source", "x//y", "x\\y"]:
        with pytest.raises(ValidationError):
            destination.key(path)
    with pytest.raises(ValidationError):
        Destination("../production")
    (root / "link").symlink_to(root / "manifest.json")
    with pytest.raises(ValidationError):
        release_plan(root, destination, ["manifest.json", "link"], [])


def test_multipart_sized_object_rejected_during_plan(release, monkeypatch):
    root, destination, _ = release
    monkeypatch.setattr("ibl_ephys_atlas_publish.s3.MAX_OBJECT_BYTES", 1)
    with pytest.raises(ValidationError, match="multipart"):
        release_plan(root, destination, ["manifest.json"], [])


def test_identical_concurrent_create_is_verified_and_reused(release):
    root, destination, plan = release
    store = FakeS3()
    original = store.put
    def race(key, path, **kwargs):
        original(key, path, **kwargs)
        if not key.endswith("index.json"):
            raise Conflict("identical writer won first")
    store.put = race
    publish_release(root, destination, plan, store)
    assert store.get_json(destination.key("datasets/d/index.json")) is not None


def test_cli_adapter_enforces_scope_checksums_and_conditions(monkeypatch, tmp_path):
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, "{}", "")
    monkeypatch.setattr(subprocess, "run", run)
    destination = Destination("staging")
    store = AwsCliStore(destination, "ibl-atlas")
    store.put(destination.key("test"), tmp_path / "body", sha256="ab"*32,
              content_type="application/octet-stream", cache_control="no-cache")
    assert calls[-1][-2:] == ["--if-none-match", "*"]
    assert "--checksum-sha256" in calls[-1]
    assert "--content-encoding" not in calls[-1]
    store.put(destination.key("index.json"), tmp_path / "body", sha256="ab"*32,
              content_type="application/json", cache_control="no-cache", expected_etag='"old"')
    assert calls[-1][-2:] == ["--if-match", '"old"']
    with pytest.raises(ValidationError, match="escapes"):
        store.head(Destination("production").key("test"))


@pytest.mark.parametrize("error,missing", [("(404)", True), ("(NoSuchKey)", True), ("(AccessDenied)", False), ("timeout", False)])
def test_cli_adapter_does_not_treat_errors_as_absence(monkeypatch, error, missing):
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 1, "", error))
    store = AwsCliStore(Destination("staging"), "ibl-atlas")
    if missing:
        assert store.head(store.destination.key("test")) is None
    else:
        with pytest.raises(ValidationError):
            store.head(store.destination.key("test"))


@pytest.mark.parametrize("present", [False, True])
def test_prefix_scoped_listing_disambiguates_denied_head(monkeypatch, present):
    store = AwsCliStore(Destination("staging"), "ibl-atlas")
    key = store.destination.key("test")
    def run(args, **kwargs):
        if "list-objects-v2" in args:
            assert args[args.index("--prefix")+1] == key
            return subprocess.CompletedProcess(args, 0, json.dumps({
                "KeyCount": int(present), "Contents": [{"Key": key}] if present else [],
            }), "")
        return subprocess.CompletedProcess(args, 1, "", "(403)")
    monkeypatch.setattr(subprocess, "run", run)
    if present:
        with pytest.raises(ValidationError):
            store.head(key)
    else:
        assert store.head(key) is None
