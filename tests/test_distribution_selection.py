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


def test_committed_channel_selection_changes_only_peak_val_raw():
    selection = load_distribution_selection(
        REPOSITORY_ROOT / "docs/data/CHANNELS_DISTRIBUTION_SELECTION.json",
        dataset_id="ephys_atlas_channels",
        representation="regional",
    )

    assert selection.selection_id == "channels-2026-w32-d050-peak-val-raw-v2"
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
    baseline = {
        "scales": [{"kind": "linear"}],
        "preferred_scale": "linear",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }
    assert all(
        display == baseline
        for feature_id, display in selection.features.items()
        if feature_id != "peak_val.raw"
    )
