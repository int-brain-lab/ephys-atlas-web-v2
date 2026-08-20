import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ibl_ephys_atlas_publish.core import PublicationStore


def artifact(path: str, data: bytes) -> dict:
    return {
        "path": path,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def publish(store: PublicationStore, dataset: str, release: str, aliases=()):
    manifest = json.dumps({"schema_version": "0.1", "dataset_id": dataset}).encode()
    upload = store.create_upload(
        dataset,
        release,
        [artifact("manifest.json", manifest)],
        {},
        "credential",
    )
    store.append_artifact(upload["upload_id"], "manifest.json", 0, manifest)
    store.publish_upload(upload["upload_id"], list(aliases), "credential")


def public_catalog(store: PublicationStore) -> dict:
    return json.loads((store.public / "catalog.json").read_text())


def test_public_catalog_matches_browser_contract(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset(
        "ephys_atlas_channels",
        {"title": "Ephys Atlas channels", "description": "Channel summaries"},
        "credential",
    )
    assert public_catalog(store) == {"schemaVersion": "0.1", "datasets": []}

    publish(store, "ephys_atlas_channels", "2026_W12", aliases=["latest"])
    catalog = public_catalog(store)
    assert catalog == {
        "schemaVersion": "0.1",
        "datasets": [
            {
                "id": "ephys_atlas_channels",
                "title": "Ephys Atlas channels",
                "description": "Channel summaries",
                "releases": [
                    {
                        "id": "2026_W12",
                        "label": "2026_W12",
                        "manifest": "./datasets/ephys_atlas_channels/releases/2026_W12/manifest.json",
                        "immutable": True,
                    }
                ],
                "defaultRelease": "2026_W12",
            }
        ],
    }


def test_public_catalog_resolves_aliases_to_immutable_release_ids(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1", aliases=["paper"])
    publish(store, "d", "r2", aliases=["latest"])

    entry = public_catalog(store)["datasets"][0]
    assert entry["defaultRelease"] == "r1"
    assert [release["id"] for release in entry["releases"]] == ["r1", "r2"]
    assert all(release["immutable"] for release in entry["releases"])

    store.set_alias("d", "paper", "r2", "credential")
    assert public_catalog(store)["datasets"][0]["defaultRelease"] == "r2"


def test_archived_dataset_stays_in_admin_api_but_leaves_public_catalog(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1", aliases=["latest"])
    store.archive_dataset("d", "credential")

    assert public_catalog(store) == {"schemaVersion": "0.1", "datasets": []}
    admin = store.list_datasets()
    assert admin["datasets"] == []
    assert admin["archived_datasets"][0]["dataset_id"] == "d"
