import hashlib
import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ibl_ephys_atlas_publish.core import Conflict, PublicationStore, ValidationError


def artifact(path: str, data: bytes) -> dict:
    return {
        "path": path,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def publish(store: PublicationStore, dataset: str, release: str, aliases=()):
    manifest = json.dumps({
        "schema_version": "1.0",
        "dataset_id": dataset,
        "release": {"release_id": release},
    }).encode()
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
    assert not (store.public / "catalog.json").exists()

    publish(store, "ephys_atlas_channels", "2026_W12", aliases=["latest"])
    # Publication updates administrative inventory only.
    assert not (store.public / "catalog.json").exists()
    catalog = store.promote_catalog({
        "schema_version": "1.0", "default_project": "ephys",
        "projects": [{"project_id": "ephys", "title": "Ephys Atlas", "dataset_ids": ["ephys_atlas_channels"], "default_dataset": "ephys_atlas_channels", "editions": []}],
        "datasets": [{"dataset_id": "ephys_atlas_channels", "title": "Ephys Atlas channels", "description": "Channel summaries", "default_release": "2026_W12", "releases": [{"release_id": "2026_W12", "label": "Development W12"}]}],
    }, "credential")
    assert catalog == {
        "default_project": "ephys",
        "projects": [{"project_id": "ephys", "title": "Ephys Atlas", "dataset_ids": ["ephys_atlas_channels"], "default_dataset": "ephys_atlas_channels", "editions": []}],
        "schema_version": "1.0",
        "datasets": [
            {
                "dataset_id": "ephys_atlas_channels",
                "title": "Ephys Atlas channels",
                "description": "Channel summaries",
                "releases": [
                    {
                            "release_id": "2026_W12",
                            "label": "Development W12",
                        "manifest": {
                            "path": "./datasets/ephys_atlas_channels/releases/2026_W12/manifest.json",
                            "media_type": "application/json",
                            "bytes": len(json.dumps({
                                "schema_version": "1.0",
                                "dataset_id": "ephys_atlas_channels",
                                "release": {"release_id": "2026_W12"},
                            }).encode()),
                            "sha256": hashlib.sha256(json.dumps({
                                "schema_version": "1.0",
                                "dataset_id": "ephys_atlas_channels",
                                "release": {"release_id": "2026_W12"},
                            }).encode()).hexdigest(),
                            "codec": {
                                "name": "none",
                                "decoded_bytes": len(json.dumps({
                                    "schema_version": "1.0",
                                    "dataset_id": "ephys_atlas_channels",
                                    "release": {"release_id": "2026_W12"},
                                }).encode()),
                            },
                        },
                    }
                ],
                "default_release": "2026_W12",
            }
        ],
    }


def test_public_catalog_resolves_aliases_to_immutable_release_ids(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1", aliases=["paper"])
    publish(store, "d", "r2", aliases=["latest"])

    config = {"schema_version": "1.0", "default_project": "p",
      "projects": [{"project_id": "p", "title": "P", "dataset_ids": ["d"], "default_dataset": "d", "editions": []}],
      "datasets": [{"dataset_id": "d", "title": "D", "default_release": "r1", "releases": [{"release_id": "r1", "label": "Paper"}, {"release_id": "r2", "label": "Latest"}]}]}
    store.promote_catalog(config, "credential")
    entry = public_catalog(store)["datasets"][0]
    assert entry["default_release"] == "r1"
    assert [release["release_id"] for release in entry["releases"]] == ["r1", "r2"]

    store.set_alias("d", "paper", "r2", "credential")
    # Administrative aliases cannot mutate the curator-owned public catalog.
    assert public_catalog(store)["datasets"][0]["default_release"] == "r1"


def test_archived_dataset_stays_in_admin_api_but_leaves_public_catalog(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1", aliases=["latest"])
    store.archive_dataset("d", "credential")

    assert not (store.public / "catalog.json").exists()
    admin = store.list_datasets()
    assert admin["datasets"] == []
    assert admin["archived_datasets"][0]["dataset_id"] == "d"


def _config(dataset_id="d", release_id="r1", *, edition=True):
    project = {
        "project_id": "p", "title": "Project", "dataset_ids": [dataset_id],
        "default_dataset": dataset_id,
        "editions": [{"edition_id": "e", "label": "Edition", "dataset_releases": [{"dataset_id": dataset_id, "release_id": release_id}]}] if edition else [],
    }
    if edition:
        project["default_edition"] = "e"
    return {
        "schema_version": "1.0", "default_project": "p",
        "projects": [project],
        "datasets": [{"dataset_id": dataset_id, "title": "Dataset", "default_release": release_id,
                       "releases": [{"release_id": release_id, "label": "Release label"}]}],
    }


def test_edition_identity_survives_omission_and_rejects_remapping(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1")
    store.promote_catalog(_config(), "credential")
    omitted = _config(edition=False)
    store.promote_catalog(omitted, "credential")
    publish(store, "d", "r2")
    changed = _config(release_id="r2")
    with pytest.raises(Conflict):
        store.promote_catalog(changed, "credential")
    assert public_catalog(store)["datasets"][0]["default_release"] == "r1"


def test_failed_promotion_preserves_last_good_catalog(tmp_path):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1")
    store.promote_catalog(_config(edition=False), "credential")
    before = public_catalog(store)
    with pytest.raises(ValidationError):
        store.promote_catalog({"schema_version": "1.0", "default_project": "missing", "projects": [], "datasets": []}, "credential")
    assert public_catalog(store) == before


@pytest.mark.parametrize(
    "mutation",
    [
        lambda config: config["projects"][0].update(dataset_ids=[]),
        lambda config: config["projects"][0]["editions"][0].update(dataset_releases=[]),
        lambda config: config["datasets"][0].update(description=42),
    ],
)
def test_compiler_rejects_schema_invalid_curator_input(tmp_path, mutation):
    store = PublicationStore(tmp_path)
    store.create_dataset("d", {}, "credential")
    publish(store, "d", "r1")
    config = _config()
    mutation(config)
    with pytest.raises(ValidationError):
        store.promote_catalog(config, "credential")
    assert not (store.public / "catalog.json").exists()
