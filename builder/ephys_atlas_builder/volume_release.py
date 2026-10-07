"""Deterministic schema-v1 volume release serialization."""

from __future__ import annotations

import shlex
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from .build_environment import build_environment
from .io import json_resource, sha256_file, write_json
from .regional_release import (
    build_global_distribution_binnings,
    linear_full_display,
    validate_scalar_display,
)
from .statistics import describe
from .volume import write_chunked_volume, write_slice_packed_volume
from .volume_config import (
    DATASET_ID,
    VolumeBuildConfig,
    _IDENTIFIER_RE,
    _clean_floats,
    _grid_descriptor,
)
from .volume_regional import (
    PhysicalParcellation,
    write_physical_parcellations,
    write_volume_regional_distributions,
)

def _write_volume_feature(
    release_dir: Path,
    feature_id: str,
    values: np.ndarray,
    config: VolumeBuildConfig,
    grid: dict,
    regional_parcellations: Mapping[str, PhysicalParcellation] | None = None,
    require_complete_regional_assignment: bool = False,
) -> dict:
    volume = np.asarray(values)
    if volume.ndim != 3 or tuple(volume.shape) != tuple(grid["shape"]):
        raise ValueError(f"feature {feature_id} does not match the release grid shape")
    if volume.dtype != np.dtype("<f2"):
        raise ValueError(f"feature {feature_id} must preserve source float16 values")
    feature_root = release_dir / "features" / feature_id
    if config.layout == "chunks3d":
        assert config.chunk_shape is not None
        resource_index = write_chunked_volume(
            feature_root,
            volume,
            dtype="float16",
            chunk_shape=config.chunk_shape,
            codec="gzip",
            path_template="volume/chunks/{i0}.{i1}.{i2}.f16.gz",
            grid_id=config.grid_id,
        )
    else:
        assert config.pack_depth is not None
        resource_index = write_slice_packed_volume(
            feature_root,
            volume,
            dtype="float16",
            pack_depth=config.pack_depth,
            codec="gzip",
            path_template="volume/packs/{axis}/{pack}.f16.gz",
            grid_id=config.grid_id,
        )
    resource_index_path = feature_root / "volume" / "resource-index.json"
    write_json(resource_index_path, resource_index)

    outside = volume == config.outside_value
    missing = ~outside & ~np.isfinite(volume)
    valid = ~outside & ~missing
    valid_values = np.asarray(volume[valid], dtype=np.float64)
    display = validate_scalar_display(
        (config.feature_display or {}).get(feature_id) or linear_full_display(),
        valid_values,
    )
    stats = describe(valid_values)
    summary = {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-summary-v1",
        "grid_id": config.grid_id,
        "grid_shape": list(volume.shape),
        "total_voxel_count": int(volume.size),
        "valid_voxel_count": int(valid.sum()),
        "outside_voxel_count": int(outside.sum()),
        "missing_voxel_count": int(missing.sum()),
        "valid_statistics": {
            field: stats[field]
            for field in (
                "min",
                "max",
                "mean",
                "std",
                "q05",
                "q25",
                "median",
                "q75",
                "q95",
            )
        },
    }
    if valid_values.size:
        binnings = build_global_distribution_binnings(
            valid_values, config.histogram_bins, display
        )
        summary["distribution"] = {"binnings": binnings}
        if regional_parcellations is not None:
            summary["regional_distributions"] = write_volume_regional_distributions(
                feature_root / "volume",
                volume,
                valid,
                binnings,
                regional_parcellations,
                require_complete_assignment=require_complete_regional_assignment,
            )
    summary_path = feature_root / "volume" / "summary.json"
    write_json(summary_path, summary)

    feature = {
        "schema_version": "1.0",
        "id": feature_id,
        "label": feature_id.replace("_", " "),
        "description": f"Raw, unnormalized {feature_id} scalar encoding volume.",
        "unit": None,
        "display": {"volume": display},
        "value_semantics": {
            "quantity": feature_id,
            "transform": "identity; raw unnormalized source float16 values",
            "source_population": "all voxels in the canonical encoding-volume grid",
            "missing_values": (
                f"{config.outside_value!r} is outside brain; non-finite values are missing; "
                "outside is classified before missing"
            ),
            "source_column": feature_id,
            "qc_filter": "none",
        },
        "representations": {
            "volume": {
                "format": "ephys-atlas-volume-v1",
                "grid": grid,
                "array": {"dtype": "float16", "order": "C", "endianness": "little"},
                "validity": {
                    "kind": "sentinel",
                    "outside_value": config.outside_value,
                    "missing_values": "nonfinite",
                    "classification_order": ["outside", "missing", "valid"],
                },
                "summary": json_resource(
                    summary_path, feature_root, "ephys-atlas-volume-summary-v1"
                ),
                "encoding": {
                    "layout": config.layout,
                    "resource_index": json_resource(
                        resource_index_path,
                        feature_root,
                        "ephys-atlas-volume-resource-index-v1",
                    ),
                },
            }
        },
        "artifacts": [],
    }
    feature_path = feature_root / "feature.json"
    write_json(feature_path, feature)
    return {
        "id": feature_id,
        "descriptor": json_resource(
            feature_path, release_dir, "ephys-atlas-feature-v1"
        ),
    }


def build_volumes_release_from_arrays(
    release_dir: Path,
    config: VolumeBuildConfig,
    feature_values: Mapping[str, np.ndarray],
    provenance_sources: Sequence[dict],
    *,
    regional_parcellations: Mapping[str, PhysicalParcellation] | None = None,
    require_complete_regional_assignment: bool = False,
) -> Path:
    config.validate()
    if not feature_values:
        raise ValueError("at least one feature is required")
    if (regional_parcellations is None) != (
        config.regional_distribution_selection is None
    ):
        raise ValueError(
            "regional parcellations and the D078 selection must be supplied together"
        )
    selected = tuple(config.features or feature_values)
    missing = sorted(set(selected) - set(feature_values))
    if missing:
        raise ValueError(f"requested volume features are absent: {', '.join(missing)}")
    unknown_display = sorted(set(config.feature_display or {}) - set(selected))
    if unknown_display:
        raise ValueError(
            f"volume display selections are not in the release catalog: {', '.join(unknown_display)}"
        )
    if len(set(selected)) != len(selected):
        raise ValueError("selected volume features must be unique")
    invalid = [feature for feature in selected if not _IDENTIFIER_RE.fullmatch(feature)]
    if invalid:
        raise ValueError(f"invalid feature identifiers: {', '.join(invalid)}")
    shapes = {tuple(np.asarray(feature_values[feature]).shape) for feature in selected}
    if len(shapes) != 1:
        raise ValueError("all volume features must have the same grid shape")
    shape = next(iter(shapes))
    if len(shape) != 3:
        raise ValueError("volume features must be 3-D")
    grid = _grid_descriptor(config, shape)

    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)
    parcellation_entries = (
        write_physical_parcellations(release_dir, regional_parcellations)
        if regional_parcellations is not None
        else []
    )
    feature_entries = [
        _write_volume_feature(
            release_dir,
            feature,
            feature_values[feature],
            config,
            grid,
            regional_parcellations,
            require_complete_regional_assignment,
        )
        for feature in selected
    ]
    transport = (
        {"layout": config.layout, "pack_depth": config.pack_depth}
        if config.layout == "orthogonal_slice_packs"
        else {"layout": config.layout, "chunk_shape": list(config.chunk_shape or ())}
    )
    command = [
        "ephys-atlas-data",
        "build-volumes",
        str(config.source_release_id or config.release_id),
        "--release-id",
        config.release_id,
        "--created-at",
        config.created_at,
        "--layout",
        str(config.layout),
        "--histogram-bins",
        str(config.histogram_bins),
    ]
    if config.geometry_selection:
        command.extend(("--geometry-selection", str(config.geometry_selection)))
    if config.distribution_selection:
        command.extend(
            ("--distribution-selection", "distribution-selection.json")
        )
    if config.regional_distribution_selection:
        command.extend(
            ("--regional-distribution-selection", "regional-distribution-selection.json")
        )
    if config.regional_annotation:
        command.extend(("--regional-annotation", str(config.regional_annotation)))
    if config.layout == "orthogonal_slice_packs":
        command.extend(("--pack-depth", str(config.pack_depth)))
    else:
        command.extend(
            ("--chunk-shape", *(str(value) for value in config.chunk_shape or ()))
        )
    for feature in config.features or ():
        command.extend(("--feature", feature))
    if config.dataset_id != DATASET_ID:
        command.extend(("--dataset-id", config.dataset_id))
    if config.title:
        command.extend(("--title", config.title))
    if config.paper_snapshot:
        command.append("--paper-snapshot")
    if config.candidate:
        command.append("--candidate")
    for name, value in (
        ("--ibleatools-commit", config.ibleatools_commit),
        ("--iblatlas-commit", config.iblatlas_commit),
        ("--builder-commit", config.builder_commit),
    ):
        if value:
            command.extend((name, value))
    manifest = {
        "schema_version": "1.0",
        "dataset_id": config.dataset_id,
        "title": config.title or "IBL Encoding Volumes",
        "description": (
            "Local non-published transport candidate derived from a pinned canonical encoding-volume object."
            if config.candidate
            else "Orthogonal scalar feature volumes derived from a pinned canonical encoding-volume object."
        ),
        "release": {
            "release_id": config.release_id,
            "immutable": True,
            "created_at": config.created_at,
            "paper_snapshot": config.paper_snapshot,
        },
        "provenance": {
            "sources": [
                *provenance_sources,
                *(
                    [
                        {
                            "role": "scientific-code",
                            "description": "Encoding-volume access and source metadata",
                            "repository": "int-brain-lab/ibleatools",
                            "commit": config.ibleatools_commit,
                        }
                    ]
                    if config.ibleatools_commit
                    else []
                ),
                *(
                    [
                        {
                            "role": "scientific-code",
                            "description": "IBL Allen atlas coordinate implementation",
                            "repository": "int-brain-lab/iblatlas",
                            "commit": config.iblatlas_commit,
                        }
                    ]
                    if config.iblatlas_commit
                    else []
                ),
            ],
            "builder": {
                "name": "ibl-ephys-atlas-builder",
                "version": (
                    "1.1.0"
                    if config.regional_distribution_selection is not None
                    else "1.0.0"
                ),
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **({"commit": config.builder_commit} if config.builder_commit else {}),
                "command": shlex.join(command),
                "environment": build_environment(),
            },
            "recipe": {
                "id": "ephys-atlas-volumes-web-v1",
                "resolution_um": config.resolution_um,
                "reference_space_id": config.reference_space_id,
                "grid_id": config.grid_id,
                "index_to_world_um": list(config.index_to_world_um or ()),
                "index_convention": "integer-centers-half-integer-edges",
                "outside_value": config.outside_value,
                "missing_values": config.missing_values,
                "classification_order": ["outside", "missing", "valid"],
                "features": list(selected),
                "histogram_bins": config.histogram_bins,
                **(
                    {
                        "distribution_selection_sha256": sha256_file(
                            config.distribution_selection
                        )
                    }
                    if config.distribution_selection is not None
                    else {}
                ),
                **(
                    {
                        "regional_distribution_selection_sha256": sha256_file(
                            config.regional_distribution_selection
                        ),
                        "regional_decision": "D078",
                        "regional_parcellations": ["allen", "beryl", "cosmos"],
                        "regional_hemisphere_encoding": "signed-atlas-ids-negative-left",
                    }
                    if config.regional_distribution_selection is not None
                    else {}
                ),
                "transport": transport,
            },
            "notes": [
                "The builder requires scientific geometry and validity choices as explicit inputs and never infers them from shape or mask overlap.",
                "The browser transport is a deterministic physical transform; feature values are not normalized or otherwise changed.",
                *(
                    ["This release is an explicitly local candidate and is not approved for publication."]
                    if config.candidate
                    else []
                ),
            ],
        },
        "parcellations": parcellation_entries,
        "features": feature_entries,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir
