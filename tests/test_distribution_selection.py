from __future__ import annotations

import json
from pathlib import Path

import pytest

from ephys_atlas_builder.distribution_selection import (
    bind_distribution_selection,
    load_distribution_selection,
    selection_provenance,
)
from ephys_atlas_builder.io import sha256_file, write_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def _document() -> dict:
    return {
        "schema": "ibl-scalar-distribution-selection-v1",
        "selection_id": "channels-2026-w32-d050-v1",
        "scientific_owner_confirmation": True,
        "dataset_id": "ephys_atlas_channels",
        "representation": "regional",
        "source_release_id": "2026_W32",
        "features": [
            {
                "id": "polarity.denoised",
                "display": {
                    "scales": [
                        {"kind": "linear"},
                        {"kind": "symlog", "linear_threshold": 0.1},
                    ],
                    "preferred_scale": "symlog",
                    "distribution_domains": [
                        {"kind": "full"},
                        {"kind": "focused", "bounds": [-0.5, 0.5]},
                    ],
                    "preferred_distribution_domain": "focused",
                },
            },
            {
                "id": "rms_ap.denoised",
                "display": {
                    "scales": [{"kind": "linear"}],
                    "preferred_scale": "linear",
                    "distribution_domains": [{"kind": "full"}],
                    "preferred_distribution_domain": "full",
                },
            },
        ],
    }


def test_distribution_selection_loads_binds_and_records_exact_bytes(tmp_path):
    path = tmp_path / "selection.json"
    write_json(path, _document())
    selection = load_distribution_selection(
        path,
        dataset_id="ephys_atlas_channels",
        representation="regional",
    )
    bound = bind_distribution_selection(
        selection,
        source_release_id="2026_W32",
        feature_ids=("rms_ap.denoised", "polarity.denoised"),
    )
    assert list(bound) == ["rms_ap.denoised", "polarity.denoised"]
    assert selection.sha256 == sha256_file(path)
    assert selection_provenance(selection) == {
        "role": "selection-freeze",
        "description": "Scientific-owner-approved D050 scalar distribution presentation",
        "repository": "rossant/ibl-ephys-atlas-web-v2",
        "path": "distribution-selection.json",
        "sha256": sha256_file(path),
    }


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda document: document.update(scientific_owner_confirmation=False), "confirmation"),
        (lambda document: document.update(dataset_id="brainwide_map"), "dataset"),
        (lambda document: document.update(representation="volume"), "representation"),
        (
            lambda document: document["features"][0]["display"]["scales"][1].update(
                linear_threshold=float("nan")
            ),
            "finite positive",
        ),
    ],
)
def test_distribution_selection_fails_closed(tmp_path, mutation, message):
    document = _document()
    mutation(document)
    path = tmp_path / "selection.json"
    path.write_text(json.dumps(document))
    with pytest.raises(ValueError, match=message):
        load_distribution_selection(
            path,
            dataset_id="ephys_atlas_channels",
            representation="regional",
        )


def test_distribution_selection_requires_exact_source_and_feature_catalog(tmp_path):
    path = tmp_path / "selection.json"
    write_json(path, _document())
    selection = load_distribution_selection(
        path,
        dataset_id="ephys_atlas_channels",
        representation="regional",
    )
    with pytest.raises(ValueError, match="source release"):
        bind_distribution_selection(
            selection,
            source_release_id="2026_W33",
            feature_ids=("polarity.denoised", "rms_ap.denoised"),
        )
    with pytest.raises(ValueError, match="catalog mismatch"):
        bind_distribution_selection(
            selection,
            source_release_id="2026_W32",
            feature_ids=("polarity.denoised",),
        )


def _committed_selection(filename, dataset_id, representation):
    return load_distribution_selection(
        REPOSITORY_ROOT / f"docs/data/{filename}",
        dataset_id=dataset_id,
        representation=representation,
    )


def test_committed_q14_channel_selection_is_complete_and_exact():
    selection = _committed_selection(
        "CHANNELS_DISTRIBUTION_SELECTION.json", "ephys_atlas_channels", "regional"
    )

    assert selection.selection_id == "channels-2026-w32-d050-q14-v1"
    assert len(selection.features) == 70
    assert sum("log" in {item["kind"] for item in display["scales"]} for display in selection.features.values()) == 7
    assert sum("symlog" in {item["kind"] for item in display["scales"]} for display in selection.features.values()) == 17
    assert sum("focused" in {item["kind"] for item in display["distribution_domains"]} for display in selection.features.values()) == 25
    assert sum(display["preferred_distribution_domain"] == "focused" for display in selection.features.values()) == 18
    assert all(display["preferred_scale"] == "linear" for display in selection.features.values())
    peak = selection.features["peak_val.raw"]
    assert peak == {
        "scales": [
            {"kind": "linear"},
            {"kind": "symlog", "linear_threshold": 1.23},
        ],
        "preferred_scale": "linear",
        "distribution_domains": [
            {"kind": "full"},
            {
                "kind": "focused",
                "bounds": [-9.467077467918395, 2.5583932574651715],
            },
        ],
        "preferred_distribution_domain": "focused",
    }
    assert selection.features["cor_ratio.raw"] == {
        "scales": [
            {"kind": "linear"},
            {"kind": "symlog", "linear_threshold": 0.248147329587871},
        ],
        "preferred_scale": "linear",
        "distribution_domains": [
            {"kind": "full"},
            {"kind": "focused", "bounds": [0.0917126877089167, 0.8477706861681354]},
        ],
        "preferred_distribution_domain": "full",
    }
    assert selection.features["channel_labels.raw"] == {
        "scales": [{"kind": "linear"}],
        "preferred_scale": "linear",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }


def test_committed_q14_cluster_and_unchanged_representation_selections():
    cluster = _committed_selection(
        "CLUSTERS_DISTRIBUTION_SELECTION.json", "ephys_atlas_clusters", "regional"
    )
    assert cluster.selection_id == "clusters-sha256-9b5e55215b306f26-d050-d048-q14-v1"
    assert len(cluster.features) == 14
    assert sum("log" in {item["kind"] for item in display["scales"]} for display in cluster.features.values()) == 6
    assert sum("focused" in {item["kind"] for item in display["distribution_domains"]} for display in cluster.features.values()) == 10
    assert sum(display["preferred_distribution_domain"] == "focused" for display in cluster.features.values()) == 8
    assert cluster.features["noise_cutoff"] == {
        "scales": [
            {"kind": "linear"},
            {"kind": "symlog", "linear_threshold": 0.33973759809182},
        ],
        "preferred_scale": "symlog",
        "distribution_domains": [
            {"kind": "full"},
            {
                "kind": "focused",
                "bounds": [-1.0125791108334214, 2408.1410236819806],
            },
        ],
        "preferred_distribution_domain": "focused",
    }
    baseline = {
        "scales": [{"kind": "linear"}],
        "preferred_scale": "linear",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }
    for filename, dataset_id, expected_id, count in (
        (
            "BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json",
            "brainwide_map",
            "brainwide-map-legacy-v1-1d908bea-d050-q14-linear-full-v1",
            30,
        ),
        (
            "VOLUME_2026_W26_DISTRIBUTION_SELECTION.json",
            "ephys_atlas_volumes",
            "volumes-2026-w26-d050-q14-linear-full-v1",
            41,
        ),
    ):
        selection = _committed_selection(
            filename, dataset_id, "regional" if dataset_id == "brainwide_map" else "volume"
        )
        assert selection.selection_id == expected_id
        assert len(selection.features) == count
        assert all(display == baseline for display in selection.features.values())


def test_committed_q14_review_translates_exactly_to_all_selections():
    review = json.loads(
        (REPOSITORY_ROOT / "docs/data/Q14_DISTRIBUTION_REVIEW_2026-08-29.json").read_text()
    )
    assert review["format"] == "ibl-scalar-distribution-human-review-v1"
    assert review["production_effect"] == "none"
    assert "scientific_owner_confirmation" not in review
    selections = {
        "ephys_atlas_channels": json.loads((REPOSITORY_ROOT / "docs/data/CHANNELS_DISTRIBUTION_SELECTION.json").read_text()),
        "ephys_atlas_clusters": json.loads((REPOSITORY_ROOT / "docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json").read_text()),
        "brainwide_map": json.loads((REPOSITORY_ROOT / "docs/data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json").read_text()),
        "ephys_atlas_volumes": json.loads((REPOSITORY_ROOT / "docs/data/VOLUME_2026_W26_DISTRIBUTION_SELECTION.json").read_text()),
    }
    dispositions = {}
    identities = set()
    for dataset in review["datasets"]:
        reviewed = {feature["id"]: feature for feature in dataset["features"]}
        selected = {feature["id"]: feature["display"] for feature in selections[dataset["dataset_id"]]["features"]}
        assert reviewed.keys() == selected.keys()
        for feature_id, feature in reviewed.items():
            identity = (dataset["dataset_id"], feature_id)
            assert identity not in identities
            identities.add(identity)
            dispositions[feature["disposition"]] = dispositions.get(feature["disposition"], 0) + 1
            assert feature["display"] == selected[feature_id]
    assert len(identities) == 155
    assert dispositions == {"accept-proposal": 34, "unchanged-baseline": 121}
