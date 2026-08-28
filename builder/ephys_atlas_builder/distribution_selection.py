"""Pinned owner-reviewed D050 scalar-presentation selections.

The loader validates selection structure only. Dataset builders bind the file
to the exact source release and complete feature population, then validate each
display against the actual finite observations or valid voxels while building.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

from .io import sha256_file
from .regional_release import validate_scalar_display

_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class DistributionSelection:
    path: Path
    sha256: str
    selection_id: str
    dataset_id: str
    representation: str
    source_release_id: str
    features: Mapping[str, dict]


def load_distribution_selection(
    path: Path,
    *,
    dataset_id: str,
    representation: str,
) -> DistributionSelection:
    path = path.resolve()
    try:
        document = json.loads(path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load D050 distribution selection {path}") from error
    if document.get("schema") != "ibl-scalar-distribution-selection-v1":
        raise ValueError("unsupported D050 distribution selection schema")
    if document.get("scientific_owner_confirmation") is not True:
        raise ValueError("D050 distribution selection lacks scientific-owner confirmation")
    if document.get("dataset_id") != dataset_id:
        raise ValueError("D050 distribution selection dataset does not match the builder")
    if document.get("representation") != representation:
        raise ValueError("D050 distribution selection representation does not match the builder")
    selection_id = document.get("selection_id")
    source_release_id = document.get("source_release_id")
    if not isinstance(selection_id, str) or not _IDENTIFIER_RE.fullmatch(selection_id):
        raise ValueError("D050 distribution selection has an invalid selection id")
    if not isinstance(source_release_id, str) or not _IDENTIFIER_RE.fullmatch(source_release_id):
        raise ValueError("D050 distribution selection has an invalid source release id")
    raw_features = document.get("features")
    if not isinstance(raw_features, list) or not raw_features:
        raise ValueError("D050 distribution selection must declare a nonempty feature catalog")
    features: dict[str, dict] = {}
    for item in raw_features:
        if not isinstance(item, dict) or set(item) != {"id", "display"}:
            raise ValueError("D050 distribution selection feature entries require only id and display")
        feature_id = item["id"]
        if not isinstance(feature_id, str) or not _IDENTIFIER_RE.fullmatch(feature_id):
            raise ValueError("D050 distribution selection has an invalid feature id")
        if feature_id in features:
            raise ValueError("D050 distribution selection contains duplicate feature ids")
        if not isinstance(item["display"], dict):
            raise ValueError(f"D050 distribution selection {feature_id} display must be an object")
        # Structural validation uses a positive dummy population so Log remains
        # eligible here. Exact eligibility/focus bounds are checked against the
        # real complete population by the dataset producer.
        features[feature_id] = validate_scalar_display(
            item["display"], np.asarray([1.0, 2.0], dtype=np.float64)
        )
    return DistributionSelection(
        path=path,
        sha256=sha256_file(path),
        selection_id=selection_id,
        dataset_id=dataset_id,
        representation=representation,
        source_release_id=source_release_id,
        features=features,
    )


def bind_distribution_selection(
    selection: DistributionSelection,
    *,
    source_release_id: str,
    feature_ids: Sequence[str],
) -> Mapping[str, dict]:
    if selection.source_release_id != source_release_id:
        raise ValueError("D050 distribution selection source release does not match the build")
    expected = list(feature_ids)
    if len(expected) != len(set(expected)):
        raise ValueError("release feature catalog contains duplicate ids")
    if set(selection.features) != set(expected):
        missing = sorted(set(expected) - set(selection.features))
        extra = sorted(set(selection.features) - set(expected))
        raise ValueError(
            "D050 distribution selection feature catalog mismatch"
            f" (missing: {', '.join(missing) or 'none'}; extra: {', '.join(extra) or 'none'})"
        )
    return {feature_id: selection.features[feature_id] for feature_id in expected}


def selection_provenance(selection: DistributionSelection) -> dict:
    return {
        "role": "selection-freeze",
        "description": "Scientific-owner-approved D050 scalar distribution presentation",
        "repository": "rossant/ibl-ephys-atlas-web-v2",
        "path": "distribution-selection.json",
        "sha256": selection.sha256,
    }

