from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil

import pytest

from ephys_atlas_builder.development_bundle import (
    DevelopmentBundleError,
    load_development_bundle,
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
