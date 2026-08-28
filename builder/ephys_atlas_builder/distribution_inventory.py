"""Inventory what a schema-v1 release can (and cannot) support exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .io import write_json


def _resource_path(root: Path, descriptor: dict[str, Any]) -> Path:
    return root / descriptor["resource"]["path"]


def _regional_inventory(feature_root: Path, feature: dict[str, Any]) -> list[dict[str, Any]]:
    regional = feature["representations"]["regional"]
    output = []
    for parcellation in regional["parcellations"]:
        statistics = json.loads(_resource_path(feature_root, parcellation["statistics"]).read_text())
        binnings = statistics["distribution"]["binnings"]
        output.append({
            "parcellation_id": parcellation["parcellation_id"],
            "population": statistics["population"],
            "value_counts": {
                "finite_count": statistics["global"]["count"],
                "missing_count": statistics["global"]["missing_count"],
                "positive_count": None,
                "negative_count": None,
                "zero_count": None,
            },
            "exact_binnings_already_in_release": {
                binning["id"]: {
                    "scale": binning["scale"],
                    "domain": binning["domain"],
                    "bin_count": len(binning["global_counts"]),
                }
                for binning in binnings
            },
            "new_candidate_binnings": {
                "availability": "unavailable-from-release",
                "reason": "The release stores only its declared accumulated binnings; any additional exact scale/domain combination requires the pinned source rows.",
            },
        })
    return output


def _volume_inventory(feature_root: Path, feature: dict[str, Any]) -> dict[str, Any]:
    volume = feature["representations"]["volume"]
    summary = json.loads(_resource_path(feature_root, volume["summary"]).read_text())
    binnings = summary.get("distribution", {}).get("binnings", [])
    return {
        "population": "valid finite voxels under the release-owned validity policy",
        "observation_unit": "valid voxels (spatially correlated; not independent scientific samples)",
        "validity_counts": {
            key: summary[key]
            for key in ("total_voxel_count", "valid_voxel_count", "outside_voxel_count", "missing_voxel_count")
        },
        "exact_binnings_already_in_release": {
            binning["id"]: {
                "scale": binning["scale"],
                "domain": binning["domain"],
                "bin_count": len(binning["global_counts"]),
            }
            for binning in binnings
        },
        "new_candidate_binnings": {
            "availability": "unavailable-from-summary",
            "reason": "summary.json stores only declared accumulated binnings; use the pinned source NPZ or decoded valid voxels to compute any additional exact candidates.",
        },
    }


def audit_release_inventory(release_dir: Path, output: Path) -> Path:
    """Write a read-only inventory without inventing source-value evidence."""
    root = release_dir.resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    features = []
    for entry in sorted(manifest["features"], key=lambda item: item["id"]):
        feature_path = _resource_path(root, entry["descriptor"])
        feature = json.loads(feature_path.read_text())
        representations = []
        if "regional" in feature["representations"]:
            representations.append({
                "kind": "regional",
                "parcellations": _regional_inventory(feature_path.parent, feature),
            })
        if "volume" in feature["representations"]:
            representations.append({
                "kind": "volume",
                **_volume_inventory(feature_path.parent, feature),
            })
        if not representations:
            representations.append({
                "kind": "unsupported",
                "reason": "no scalar regional or volume representation",
            })
        features.append({"id": entry["id"], "representations": representations})
    write_json(output, {
        "schema_version": "1.0",
        "audit_id": "ephys-atlas-distribution-release-inventory-v1",
        "dataset_id": manifest["dataset_id"],
        "release_id": manifest["release"]["release_id"],
        "release_dir": str(root),
        "read_only": True,
        "defaults_selected": False,
        "features": features,
        "notes": [
            "This is an availability inventory, not a source-value distribution audit.",
            "It never derives signed-log, focused, or sign-count evidence from pre-accumulated histogram bins.",
        ],
    })
    return output
