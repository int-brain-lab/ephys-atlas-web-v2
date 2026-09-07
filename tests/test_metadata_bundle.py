from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.io import canonical_json
from ephys_atlas_builder.metadata_bundle import write_metadata_bundle
from ephys_atlas_builder.validate import ValidationError, validate_release

PATHS = [
    "parcellations/allen/regions.json",
    "features/rms_ap/feature.json",
    "features/rms_ap/allen.statistics.json",
    "features/rms_ap/volume/summary.json",
    "features/rms_ap/volume/resource-index.json",
]


def _add_bundle(release: Path, paths: list[str] = PATHS) -> dict:
    resource = write_metadata_bundle(release, paths)
    manifest_path = release / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["metadata_bundle"] = resource
    manifest_path.write_bytes(canonical_json(manifest))
    return resource


def test_metadata_bundle_is_deterministic_and_validates_complete_graph(tmp_path: Path) -> None:
    first = generate_golden(tmp_path / "first")
    second = generate_golden(tmp_path / "second")
    first_resource = _add_bundle(first)
    second_resource = _add_bundle(second)

    assert first_resource == second_resource
    assert (first / first_resource["path"]).read_bytes() == (
        second / second_resource["path"]
    ).read_bytes()
    document = json.loads(gzip.decompress((first / first_resource["path"]).read_bytes()))
    assert [item["path"] for item in document["resources"]] == sorted(PATHS)
    assert document["resources"][0]["text"].encode() == (
        first / document["resources"][0]["path"]
    ).read_bytes()
    validate_release(first)


def test_metadata_bundle_may_contain_a_subset(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    _add_bundle(release, [PATHS[0]])
    validate_release(release)


def test_metadata_bundle_rejects_changed_authoritative_text(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    resource = _add_bundle(release)
    path = release / resource["path"]
    document = json.loads(gzip.decompress(path.read_bytes()))
    document["resources"][0]["text"] = "{}\n"
    decoded = canonical_json(document)
    with path.open("wb") as output, gzip.GzipFile(
        filename="", mode="wb", fileobj=output, mtime=0
    ) as stream:
        stream.write(decoded)
    manifest = json.loads((release / "manifest.json").read_text())
    from ephys_atlas_builder.io import sha256_file
    manifest["metadata_bundle"]["bytes"] = path.stat().st_size
    manifest["metadata_bundle"]["sha256"] = sha256_file(path)
    manifest["metadata_bundle"]["codec"]["decoded_bytes"] = len(decoded)
    (release / "manifest.json").write_bytes(canonical_json(manifest))
    with pytest.raises(ValidationError, match="differs from authoritative bytes"):
        validate_release(release)


@pytest.mark.parametrize("path", ["../escape.json", "/absolute.json", "manifest.json", "value.bin"])
def test_metadata_bundle_producer_rejects_invalid_entries(tmp_path: Path, path: str) -> None:
    release = generate_golden(tmp_path / "release")
    with pytest.raises((ValueError, FileNotFoundError)):
        write_metadata_bundle(release, [path])


def test_metadata_bundle_producer_rejects_empty_and_duplicate_entries(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    with pytest.raises(ValueError, match="at least one"):
        write_metadata_bundle(release, [])
    with pytest.raises(ValueError, match="duplicate"):
        write_metadata_bundle(release, [PATHS[0], PATHS[0]])


def test_metadata_bundle_producer_refuses_to_overwrite(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    write_metadata_bundle(release, [PATHS[0]])
    with pytest.raises(FileExistsError, match="already exists"):
        write_metadata_bundle(release, [PATHS[0]])
