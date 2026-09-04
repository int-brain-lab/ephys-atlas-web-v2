from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "publishing" / "src"))

from ibl_ephys_atlas_publish.core import PublicationStore  # noqa: E402

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document


def test_curator_compiler_emits_the_canonical_catalog_contract(tmp_path: Path) -> None:
    store = PublicationStore(tmp_path)
    store.create_dataset("synthetic-dataset", {}, "credential")
    manifest = json.dumps({
        "schema_version": "1.0",
        "dataset_id": "synthetic-dataset",
        "release": {"release_id": "release-v1"},
    }).encode()
    upload = store.create_upload(
        "synthetic-dataset",
        "release-v1",
        [{
            "path": "manifest.json",
            "size": len(manifest),
            "sha256": hashlib.sha256(manifest).hexdigest(),
        }],
        {},
        "credential",
    )
    store.append_artifact(upload["upload_id"], "manifest.json", 0, manifest)
    store.publish_upload(upload["upload_id"], [], "credential")

    catalog = store.promote_catalog({
        "schema_version": "1.0",
        "default_project": "synthetic-project",
        "projects": [{
            "project_id": "synthetic-project",
            "title": "Synthetic project",
            "dataset_ids": ["synthetic-dataset"],
            "default_dataset": "synthetic-dataset",
            "default_edition": "synthetic-edition",
            "editions": [{
                "edition_id": "synthetic-edition",
                "label": "Synthetic edition",
                "dataset_releases": [{
                    "dataset_id": "synthetic-dataset",
                    "release_id": "release-v1",
                }],
            }],
        }],
        "datasets": [{
            "dataset_id": "synthetic-dataset",
            "title": "Synthetic dataset",
            "default_release": "release-v1",
            "releases": [{"release_id": "release-v1", "label": "Synthetic release"}],
        }],
    }, "credential")

    validate_schema_v1_document(catalog, "catalog.schema.json")
