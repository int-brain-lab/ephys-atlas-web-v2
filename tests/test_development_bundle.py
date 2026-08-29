from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil

import pytest

import ephys_atlas_builder.development_bundle as development_bundle

from ephys_atlas_builder.development_bundle import (
    DevelopmentBundleError,
    load_development_bundle,
    sync_development_bundle,
    validate_development_bundle,
)
from ephys_atlas_builder.fixture import generate_golden
from tools.development_bundle import _environment


ROOT = Path(__file__).resolve().parents[1]


def descriptor(release: Path, *, destination: str = "data/releases/golden/golden-v1") -> dict:
    manifest = release / "manifest.json"
    encoded = manifest.read_bytes()
    return {
        "schema_version": "1.0",
        "bundle_id": "test-bundle-v1",
        "provenance": {
            "generator": "test",
            "version": "1",
            "launcher_baseline_commit": "68f3a1e",
        },
        "default_view": {
            "dataset_id": "golden_fixture",
            "release_id": "golden-v1",
            "feature_id": "rms_ap",
            "parcellation_id": "allen",
        },
        "artifacts": [
            {
                "role": "channels",
                "kind": "release",
                "identity": {"dataset_id": "golden_fixture", "release_id": "golden-v1"},
                "maturity": "validated-real-local",
                "destination": destination,
                "root_manifest": {
                    "path": "manifest.json",
                    "media_type": "application/json",
                    "bytes": len(encoded),
                    "sha256": hashlib.sha256(encoded).hexdigest(),
                },
                "source": {"state": "unresolved"},
                "launch_critical": True,
            }
        ],
        "unavailable": [],
    }


def write_descriptor(root: Path, document: dict) -> Path:
    path = root / "data" / "development-bundle-v2.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document))
    return path


def test_validates_exact_release_root_and_complete_graph(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    release = generate_golden(tmp_path / "source")
    destination = tmp_path / "repo/data/releases/golden/golden-v1"
    shutil.copytree(release, destination)
    path = write_descriptor(tmp_path / "repo", descriptor(destination))

    result = validate_development_bundle(path, tmp_path / "repo")

    assert result.bundle_id == "test-bundle-v1"
    assert result.default_view["feature_id"] == "rms_ap"
    assert len(result.artifacts) == 1
    assert result.artifacts[0].file_count > 1
    assert result.stored_bytes > result.artifacts[0].root.joinpath("manifest.json").stat().st_size
    monkeypatch.setenv("EPHYS_ATLAS_REAL_MESH_PACK", "/unverified/mesh")
    monkeypatch.setenv("EPHYS_ATLAS_PROJECTION_PACK", "/unverified/projection")
    monkeypatch.setenv("VITE_BRAIN_MESH_MANIFEST_URL", "/unverified/manifest.json")
    monkeypatch.setenv("VITE_DATASET_CATALOG_URL", "https://unverified.example/catalog.json")
    environment = _environment(result)
    assert environment["EPHYS_ATLAS_REAL_RELEASE"] == str(destination)
    assert environment["EPHYS_ATLAS_ADDITIONAL_RELEASES"] == ""
    assert environment["EPHYS_ATLAS_EXPECTED_RELEASES"] == "golden_fixture=golden-v1"
    assert environment["EPHYS_ATLAS_REAL_FEATURE"] == "rms_ap"
    assert "EPHYS_ATLAS_REAL_MESH_PACK" not in environment
    assert "EPHYS_ATLAS_PROJECTION_PACK" not in environment
    assert "VITE_BRAIN_MESH_MANIFEST_URL" not in environment
    assert "VITE_DATASET_CATALOG_URL" not in environment


@pytest.mark.parametrize(
    "destination",
    ["/absolute", "../escape", "data/releases/../escape", "data\\releases\\bad"],
)
def test_rejects_unsafe_or_unbounded_destinations(tmp_path: Path, destination: str) -> None:
    release = generate_golden(tmp_path / "source")
    path = write_descriptor(tmp_path / "repo", descriptor(release, destination=destination))

    with pytest.raises(DevelopmentBundleError, match="destination"):
        load_development_bundle(path)


def test_rejects_unsupported_version_and_duplicate_identity(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    document = descriptor(release)
    document["schema_version"] = "2.0"
    path = write_descriptor(tmp_path / "repo", document)
    with pytest.raises(DevelopmentBundleError, match="unsupported"):
        load_development_bundle(path)

    document["schema_version"] = "1.0"
    duplicate = json.loads(json.dumps(document["artifacts"][0]))
    duplicate["destination"] = "data/releases/golden/duplicate"
    document["artifacts"].append(duplicate)
    path = write_descriptor(tmp_path / "repo", document)
    with pytest.raises(DevelopmentBundleError, match="duplicate development bundle identity"):
        load_development_bundle(path)


def test_source_may_pin_one_resolved_https_origin(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    document = descriptor(release)
    document["artifacts"][0]["source"] = {
        "state": "resolved",
        "base_url": "https://static.example.test/releases/golden-v1/",
    }
    path = write_descriptor(tmp_path / "repo", document)
    assert load_development_bundle(path)["artifacts"][0]["source"]["state"] == "resolved"

    document["artifacts"][0]["source"]["base_url"] = "http://mutable.example.test/latest?x=1"
    path = write_descriptor(tmp_path / "repo", document)
    with pytest.raises(DevelopmentBundleError, match="pinned HTTPS"):
        load_development_bundle(path)

    for base_url in (
        "https://static.example.test/releases/golden-v1",
        "https://static.example.test/releases/LATEST/",
        "https://static.example.test/releases/%2e%2e/private/",
    ):
        document["artifacts"][0]["source"]["base_url"] = base_url
        path = write_descriptor(tmp_path / "repo", document)
        with pytest.raises(DevelopmentBundleError, match="pinned HTTPS"):
            load_development_bundle(path)


def remote_release(release: Path, base_url: str) -> tuple[dict, dict[str, bytes]]:
    document = descriptor(release)
    document["artifacts"][0]["source"] = {
        "state": "resolved",
        "base_url": base_url,
    }
    resources = {
        f"{base_url}{item.relative_to(release).as_posix()}": item.read_bytes()
        for item in release.rglob("*") if item.is_file()
    }
    return document, resources


def remote_pack(
    pack: Path,
    *,
    role: str,
    kind: str,
    destination: str,
    base_url: str,
) -> tuple[dict, dict[str, bytes]]:
    manifest = json.loads((pack / "manifest.json").read_text())
    encoded = (pack / "manifest.json").read_bytes()
    artifact = {
        "role": role,
        "kind": kind,
        "identity": {"pack_id": manifest["pack_id"]},
        "maturity": "production-intent",
        "destination": destination,
        "root_manifest": {
            "path": "manifest.json",
            "media_type": "application/json",
            "bytes": len(encoded),
            "sha256": hashlib.sha256(encoded).hexdigest(),
        },
        "source": {"state": "resolved", "base_url": base_url},
        "launch_critical": kind == "projection_pack",
    }
    resources = {
        f"{base_url}{item.relative_to(pack).as_posix()}": item.read_bytes()
        for item in pack.rglob("*") if item.is_file()
    }
    return artifact, resources


def test_sync_downloads_absent_resolved_release_into_atomic_sibling_stage(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    requests: list[str] = []

    def fetch(url: str, maximum_bytes: int) -> bytes:
        requests.append(url)
        encoded = resources[url]
        assert len(encoded) <= maximum_bytes
        return encoded

    result = sync_development_bundle(path, repository, fetch)

    destination = repository / document["artifacts"][0]["destination"]
    assert result.artifacts[0].root == destination
    assert (destination / "manifest.json").read_bytes() == (release / "manifest.json").read_bytes()
    assert set(requests) == set(resources)
    assert not list(destination.parent.glob(f".{destination.name}.bundle-stage-*"))


def test_sync_reuses_valid_unresolved_artifact_without_network(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    repository = tmp_path / "repo"
    destination = repository / "data/releases/golden/golden-v1"
    shutil.copytree(release, destination)
    path = write_descriptor(repository, descriptor(release))

    result = sync_development_bundle(
        path,
        repository,
        lambda *_args: (_ for _ in ()).throw(AssertionError("network was used")),
    )

    assert result.artifacts[0].root == destination


def test_missing_optional_artifact_does_not_block_launch_critical_bundle(
    tmp_path: Path,
) -> None:
    release = generate_golden(tmp_path / "source")
    repository = tmp_path / "repo"
    destination = repository / "data/releases/golden/golden-v1"
    shutil.copytree(release, destination)
    document = descriptor(release)
    optional, _resources = remote_pack(
        ROOT / "fixtures/mesh-pack-v1/pack",
        role="mesh",
        kind="mesh_pack",
        destination="artifacts/optional-mesh",
        base_url="https://static.example.test/mesh/optional-v1/",
    )
    optional["source"] = {"state": "unresolved"}
    document["artifacts"].append(optional)
    path = write_descriptor(repository, document)

    validated = validate_development_bundle(path, repository)
    synced = sync_development_bundle(
        path,
        repository,
        lambda *_args: (_ for _ in ()).throw(AssertionError("network was used")),
    )

    for result in (validated, synced):
        assert [item.role for item in result.artifacts] == ["channels"]
        assert result.unavailable[0]["role"] == "mesh"
        assert result.unavailable[0]["required_for_complete_bundle"] is False
        assert _environment(result)["EPHYS_ATLAS_EXPECTED_MESH"] == "0"


def test_sync_reports_missing_unresolved_artifact_actionably(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    repository = tmp_path / "repo"
    path = write_descriptor(repository, descriptor(release))

    with pytest.raises(DevelopmentBundleError, match="no resolved immutable HTTPS source"):
        sync_development_bundle(path, repository)


def test_sync_preflights_disk_space_before_network_and_cleans_stage(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, _resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)

    with pytest.raises(DevelopmentBundleError, match="insufficient disk space"):
        sync_development_bundle(
            path,
            repository,
            lambda *_args: (_ for _ in ()).throw(AssertionError("network was used")),
            free_space=lambda _path: 0,
        )

    destination = repository / document["artifacts"][0]["destination"]
    assert not destination.exists()
    assert not list(destination.parent.glob(f".{destination.name}.bundle-stage-*"))


def test_sync_preflights_each_discovered_graph_layer_before_resource_requests(
    tmp_path: Path,
) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    root_url = f"{base_url}manifest.json"
    requests: list[str] = []

    def fetch(url: str, _maximum: int) -> bytes:
        requests.append(url)
        return resources[url]

    with pytest.raises(DevelopmentBundleError, match="insufficient disk space"):
        sync_development_bundle(
            path,
            repository,
            fetch,
            free_space=lambda _path: len(resources[root_url]),
        )

    assert requests == [root_url]


class FakeResponse:
    def __init__(self, url: str, payload: bytes, content_length: int):
        self.url = url
        self.payload = payload
        self.headers = {"Content-Length": str(content_length)}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def geturl(self) -> str:
        return self.url

    def read(self, amount: int) -> bytes:
        return self.payload[:amount]


def test_default_transport_rejects_redirects_and_content_length_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested = "https://static.example.test/immutable/file.bin"
    with pytest.raises(ValueError, match="redirected"):
        development_bundle._RejectRedirects().redirect_request(
            development_bundle.Request(requested),
            None,
            302,
            "Found",
            {},
            "https://other.example.test/mutable/file.bin",
        )

    monkeypatch.setattr(
        development_bundle,
        "_open_pinned_url",
        lambda *_args, **_kwargs: FakeResponse(
            "https://other.example.test/mutable/file.bin", b"data", 4
        ),
    )
    with pytest.raises(ValueError, match="redirected"):
        development_bundle._default_fetch(requested, 4)

    monkeypatch.setattr(
        development_bundle,
        "_open_pinned_url",
        lambda *_args, **_kwargs: FakeResponse(requested, b"data", 3),
    )
    with pytest.raises(ValueError, match="Content-Length"):
        development_bundle._default_fetch(requested, 4)


def test_sync_cleans_failed_stage_and_never_admits_corrupt_resource(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    resource_url = next(url for url in resources if not url.endswith("manifest.json"))
    resources[resource_url] = b"x" * len(resources[resource_url])

    with pytest.raises(DevelopmentBundleError, match="resource SHA-256 differs"):
        sync_development_bundle(path, repository, lambda url, _maximum: resources[url])

    destination = repository / document["artifacts"][0]["destination"]
    assert not destination.exists()
    assert not list(destination.parent.glob(f".{destination.name}.bundle-stage-*"))


def test_sync_never_overwrites_existing_corrupt_destination(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, _resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    destination = repository / document["artifacts"][0]["destination"]
    destination.mkdir(parents=True)
    (destination / "manifest.json").write_bytes(b"keep corrupt local bytes")

    with pytest.raises(DevelopmentBundleError, match="was not overwritten"):
        sync_development_bundle(
            path,
            repository,
            lambda *_args: (_ for _ in ()).throw(AssertionError("network was used")),
        )

    assert (destination / "manifest.json").read_bytes() == b"keep corrupt local bytes"


@pytest.mark.parametrize(
    ("pack", "role", "kind", "destination", "base_url"),
    [
        (
            ROOT / "web/public/atlas/projections/ibl-static-registered-v1",
            "projections",
            "projection_pack",
            "web/public/atlas/projections/downloaded-test-pack",
            "https://static.example.test/projections/immutable-pack/",
        ),
        (
            ROOT / "fixtures/mesh-pack-v1/pack",
            "mesh",
            "mesh_pack",
            "artifacts/downloaded-test-mesh",
            "https://static.example.test/mesh/immutable-pack/",
        ),
    ],
)
def test_sync_downloads_and_validates_complete_pack_graphs(
    tmp_path: Path,
    pack: Path,
    role: str,
    kind: str,
    destination: str,
    base_url: str,
) -> None:
    release = generate_golden(tmp_path / "release")
    repository = tmp_path / "repo"
    release_destination = repository / "data/releases/golden/golden-v1"
    shutil.copytree(release, release_destination)
    document = descriptor(release)
    artifact, resources = remote_pack(
        pack,
        role=role,
        kind=kind,
        destination=destination,
        base_url=base_url,
    )
    document["artifacts"].append(artifact)
    path = write_descriptor(repository, document)

    result = sync_development_bundle(
        path, repository, lambda url, maximum: resources[url]
    )

    installed = repository / destination
    assert next(item for item in result.artifacts if item.role == role).root == installed
    assert {
        item.relative_to(installed).as_posix() for item in installed.rglob("*") if item.is_file()
    } == {
        item.relative_to(pack).as_posix() for item in pack.rglob("*") if item.is_file()
    }


def test_sync_treats_existing_symlink_as_corrupt_and_does_not_replace_it(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, _resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    destination = repository / document["artifacts"][0]["destination"]
    destination.parent.mkdir(parents=True)
    destination.symlink_to(tmp_path / "absent-target", target_is_directory=True)

    with pytest.raises(DevelopmentBundleError, match="symbolic link"):
        sync_development_bundle(
            path,
            repository,
            lambda *_args: (_ for _ in ()).throw(AssertionError("network was used")),
        )

    assert destination.is_symlink()


def test_sync_rejects_parent_swap_without_writing_or_cleaning_through_symlink(
    tmp_path: Path,
) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    destination = repository / document["artifacts"][0]["destination"]
    moved_parent = tmp_path / "moved-release-parent"
    outside = tmp_path / "outside"
    outside.mkdir()
    swapped = False

    def fetch(url: str, _maximum: int) -> bytes:
        nonlocal swapped
        if not swapped:
            destination.parent.rename(moved_parent)
            destination.parent.symlink_to(outside, target_is_directory=True)
            swapped = True
        return resources[url]

    with pytest.raises(DevelopmentBundleError, match="parent changed"):
        sync_development_bundle(path, repository, fetch)

    assert not list(outside.iterdir())
    assert not list(moved_parent.glob(f".{destination.name}.bundle-stage-*"))
    assert not list(moved_parent.glob("*.bundle-sync.lock"))


def test_sync_refuses_destination_created_during_download(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    destination = repository / document["artifacts"][0]["destination"]
    created = False

    def fetch(url: str, _maximum: int) -> bytes:
        nonlocal created
        if not created:
            destination.mkdir()
            created = True
        return resources[url]

    with pytest.raises(DevelopmentBundleError, match="destination appeared"):
        sync_development_bundle(path, repository, fetch)

    assert destination.is_dir()
    assert not any(destination.iterdir())
    assert not list(destination.parent.glob(f".{destination.name}.bundle-stage-*"))


def test_sync_reuses_unlocked_advisory_lock_file_after_interrupted_process(
    tmp_path: Path,
) -> None:
    release = generate_golden(tmp_path / "remote")
    base_url = "https://static.example.test/releases/golden-v1/"
    document, resources = remote_release(release, base_url)
    repository = tmp_path / "repo"
    path = write_descriptor(repository, document)
    destination_text = document["artifacts"][0]["destination"]
    lock_directory = repository / "artifacts/.development-bundle-locks"
    lock_directory.mkdir(parents=True)
    lock_name = hashlib.sha256(destination_text.encode()).hexdigest()
    (lock_directory / f"{lock_name}.lock").write_bytes(b"")

    result = sync_development_bundle(
        path,
        repository,
        lambda url, _maximum: resources[url],
    )

    assert result.artifacts[0].root == repository / destination_text


def test_reports_every_missing_artifact_together(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    document = descriptor(release)
    second = json.loads(json.dumps(document["artifacts"][0]))
    second["role"] = "clusters"
    second["identity"]["dataset_id"] = "other_dataset"
    second["identity"]["release_id"] = "other-v1"
    second["destination"] = "data/releases/other/other-v1"
    document["artifacts"].append(second)
    path = write_descriptor(tmp_path / "repo", document)

    with pytest.raises(DevelopmentBundleError) as caught:
        validate_development_bundle(path, tmp_path / "repo")

    assert "channels" in str(caught.value)
    assert "clusters" in str(caught.value)


def test_rejects_root_integrity_identity_and_undeclared_files(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "source")
    repository = tmp_path / "repo"
    destination = repository / "data/releases/golden/golden-v1"
    shutil.copytree(release, destination)
    document = descriptor(destination)
    path = write_descriptor(repository, document)

    document["artifacts"][0]["root_manifest"]["sha256"] = "0" * 64
    path = write_descriptor(repository, document)
    with pytest.raises(DevelopmentBundleError, match="root manifest SHA-256 differs"):
        validate_development_bundle(path, repository)

    document = descriptor(destination)
    document["artifacts"][0]["identity"]["release_id"] = "other-v1"
    document["default_view"]["release_id"] = "other-v1"
    path = write_descriptor(repository, document)
    with pytest.raises(DevelopmentBundleError, match="release identity differs"):
        validate_development_bundle(path, repository)

    document = descriptor(destination)
    path = write_descriptor(repository, document)
    (destination / "undeclared.txt").write_text("not in the graph")
    with pytest.raises(DevelopmentBundleError, match="undeclared"):
        validate_development_bundle(path, repository)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("feature_id", "missing_feature", "default feature is absent"),
        ("parcellation_id", "cosmos", "default parcellation is absent"),
    ],
)
def test_rejects_default_view_absent_from_selected_release(
    tmp_path: Path, field: str, value: str, message: str
) -> None:
    release = generate_golden(tmp_path / "source")
    repository = tmp_path / "repo"
    destination = repository / "data/releases/golden/golden-v1"
    shutil.copytree(release, destination)
    document = descriptor(destination)
    document["default_view"][field] = value
    path = write_descriptor(repository, document)

    with pytest.raises(DevelopmentBundleError, match=message):
        validate_development_bundle(path, repository)


def test_committed_descriptor_is_structurally_valid_and_truthful() -> None:
    document = load_development_bundle(ROOT / "data/development-bundle-v3.json")

    assert document["bundle_id"] == "local-development-core-2026-08-29-v3"
    assert document["provenance"] == {
        "generator": "manually-reviewed-development-bundle",
        "version": "1",
        "launcher_baseline_commit": "fa70916",
    }
    assert [item["role"] for item in document["artifacts"]] == [
        "channels", "clusters", "brainwide_map", "volume", "projections", "mesh"
    ]
    assert [item["identity"] for item in document["artifacts"][:4]] == [
        {"dataset_id": "ephys_atlas_channels", "release_id": "2026_W32-d050-peak-val-raw-v7"},
        {
            "dataset_id": "ephys_atlas_clusters",
            "release_id": "sha256-9b5e55215b306f26-d050-d048-v6",
        },
        {
            "dataset_id": "brainwide_map",
            "release_id": "legacy-v1-1d908bea-d050-linear-full-v2",
        },
        {
            "dataset_id": "ephys_atlas_volumes",
            "release_id": "2026_W26-candidate-depth4-d050-linear-full-v3",
        },
    ]
    assert document["artifacts"][5]["identity"] == {
        "pack_id": "ibl-bwm-d042-c7bb3a88157c42cc"
    }
    assert document["unavailable"] == []
