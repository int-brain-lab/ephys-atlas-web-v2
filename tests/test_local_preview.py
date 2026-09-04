import json
from pathlib import Path

import pytest

from tools.local_preview import check_latest_aliases


def _write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document))


def _fixture(tmp_path: Path) -> tuple[Path, Path]:
    descriptor = tmp_path / "data" / "development-bundle-v4.json"
    artifacts = []
    for dataset, release_id in (
        ("ephys_atlas_channels", "2026_W32"),
        ("ephys_atlas_clusters", "sha256-current"),
    ):
        destination = f"data/releases/{dataset}/reviewed-v1"
        artifacts.append({
            "kind": "release",
            "identity": {"dataset_id": dataset, "release_id": "reviewed-v1"},
            "destination": destination,
        })
        _write_json(
            tmp_path / destination / "manifest.json",
            {"provenance": {"sources": [{
                "role": "canonical-data", "release": release_id,
            }]}},
        )
        _write_json(
            tmp_path / "data" / "source" / dataset / "aliases" / "latest.json",
            {"release_id": release_id},
        )
    _write_json(descriptor, {"artifacts": artifacts})
    return descriptor, tmp_path / "data" / "source"


def test_accepts_latest_aliases_matching_reviewed_releases(tmp_path):
    descriptor, source_root = _fixture(tmp_path)
    check_latest_aliases(descriptor, source_root)


def test_rejects_unreviewed_new_source(tmp_path):
    descriptor, source_root = _fixture(tmp_path)
    alias = source_root / "ephys_atlas_channels/aliases/latest.json"
    _write_json(alias, {"release_id": "2026_W33"})
    with pytest.raises(RuntimeError, match="audit the new source"):
        check_latest_aliases(descriptor, source_root)
