"""Pinned source-snapshot adapter for the volume release builder."""

from __future__ import annotations

import json
import math
import shutil
import tempfile
from dataclasses import replace
from pathlib import Path

import numpy as np

from .distribution_selection import (
    bind_distribution_selection,
    load_distribution_selection,
    selection_provenance,
)
from .io import sha256_file
from .npz import extract_last_axis_features, inspect_volume_npz
from .volume_config import (
    DATASET_ID,
    VolumeBuildConfig,
    load_volume_geometry_selection,
)
from .volume_regional import (
    build_physical_parcellations,
    load_lateralized_volume_annotation,
    load_regional_selection,
    validate_parcellation_row_counts,
)
from .volume_release import build_volumes_release_from_arrays

def build_volumes_from_snapshot(
    source_snapshot: Path,
    release_dir: Path,
    config: VolumeBuildConfig,
) -> Path:
    if config.source_release_id is None:
        raise ValueError("snapshot builds require an explicit volume source release id")
    if config.distribution_selection is None:
        raise ValueError(
            "snapshot builds require an approved D050 distribution selection"
        )
    if (config.regional_distribution_selection is None) != (
        config.regional_annotation is None
    ):
        raise ValueError(
            "regional volume distributions require both the D078 selection and annotation"
        )
    distribution_selection = load_distribution_selection(
        config.distribution_selection,
        dataset_id=config.dataset_id,
        representation="volume",
    )
    config.validate()
    config.require_scientific_pins()
    source_json = source_snapshot / "source.json"
    if not source_json.is_file():
        raise RuntimeError(f"missing source snapshot metadata: {source_json}")
    source = json.loads(source_json.read_text())
    if source.get("dataset_id") != config.dataset_id:
        raise RuntimeError(
            f"source snapshot is not {config.dataset_id}: {source.get('dataset_id')}"
        )
    source_release_id = config.source_release_id
    if str(source.get("resolved_release")) != source_release_id:
        raise RuntimeError(
            f"source release {source.get('resolved_release')} does not match requested source release {source_release_id}"
        )
    filename = f"brainwide_ephys_atlas_{config.resolution_um}um.npz"
    entries = [
        entry for entry in source.get("files", []) if entry.get("path") == filename
    ]
    if len(entries) != 1:
        raise RuntimeError(f"source snapshot must declare exactly one {filename}")
    npz_path = source_snapshot / filename
    entry = entries[0]
    if (
        not npz_path.is_file()
        or npz_path.stat().st_size != entry.get("bytes")
        or sha256_file(npz_path) != entry.get("sha256")
    ):
        raise RuntimeError(f"source snapshot identity mismatch: {npz_path}")

    selection = (
        load_volume_geometry_selection(config.geometry_selection)
        if config.geometry_selection
        else None
    )
    if selection:
        canonical = source.get("canonical_source") or {}
        mismatches = []
        for label, actual, approved in (
            ("source URI", canonical.get("uri"), selection.source_uri),
            ("source bytes", entry.get("bytes"), selection.source_bytes),
            ("source SHA-256", entry.get("sha256"), selection.source_sha256),
            ("resolution", config.resolution_um, selection.resolution_um),
            ("reference space", config.reference_space_id, selection.reference_space_id),
            ("grid", config.grid_id, selection.grid_id),
            ("affine", tuple(config.index_to_world_um or ()), selection.index_to_world_um),
            ("outside sentinel", config.outside_value, selection.outside_value),
            ("missing policy", config.missing_values, selection.missing_values),
            ("iblatlas commit", config.iblatlas_commit, selection.iblatlas_commit),
        ):
            if actual != approved:
                mismatches.append(label)
        if mismatches:
            raise RuntimeError(
                "source/configuration does not exactly match geometry selection: "
                + ", ".join(mismatches)
            )

    report = inspect_volume_npz(npz_path)
    main = next(
        (
            member
            for member in report["members"]
            if member["path"] == "ephys_atlas_vol.npy"
        ),
        None,
    )
    if (
        main is None
        or main["fortran_order"]
        or main["dtype_descriptor"] != "<f2"
        or len(main["shape"]) != 4
    ):
        raise RuntimeError(
            "canonical encoding volume must be a C-order little-endian float16 4-D array"
        )
    with np.load(npz_path, allow_pickle=True) as archive:
        feature_names = tuple(
            str(value) for value in np.asarray(archive["feature_names"]).tolist()
        )
        grid_shape = tuple(
            int(value) for value in np.asarray(archive["grid_shape"]).tolist()
        )
        resolution_um = int(np.asarray(archive["res_um"]).reshape(-1)[0])
    if grid_shape != tuple(main["shape"][:3]) or len(feature_names) != main["shape"][3]:
        raise RuntimeError(
            "canonical encoding-volume metadata does not match the main array"
        )
    if selection and (
        grid_shape != selection.grid_shape
        or selection.grid_shape != tuple(main["shape"][:3])
        or selection.audited_value_count != math.prod(main["shape"])
    ):
        raise RuntimeError(
            "source grid or validity audit does not exactly match geometry selection"
        )
    if resolution_um != config.resolution_um:
        raise RuntimeError(
            f"source resolution {resolution_um} does not match requested {config.resolution_um}"
        )
    if len(set(feature_names)) != len(feature_names):
        raise RuntimeError("canonical encoding-volume feature names must be unique")
    selected = tuple(config.features or feature_names)
    missing = sorted(set(selected) - set(feature_names))
    if missing:
        raise ValueError(f"requested volume features are absent: {', '.join(missing)}")
    feature_display = bind_distribution_selection(
        distribution_selection,
        source_release_id=source_release_id,
        feature_ids=selected,
    )
    config = replace(config, feature_display=feature_display)

    regional_selection = (
        load_regional_selection(config.regional_distribution_selection)
        if config.regional_distribution_selection is not None
        else None
    )
    regional_parcellations = None
    if regional_selection is not None:
        assert config.regional_annotation is not None
        annotation = load_lateralized_volume_annotation(
            config.regional_annotation,
            regional_selection,
            grid_shape,
        )
        regional_parcellations = build_physical_parcellations(
            annotation,
            semantics="allen-atlas-id",
        )
        validate_parcellation_row_counts(
            regional_parcellations,
            regional_selection.volume_expected_rows,
        )

    canonical = source.get("canonical_source") or {}
    provenance_sources = [
        {
            "role": "canonical-data",
            "description": "Canonical ea_active encoding-volume NPZ",
            "release": source_release_id,
            "path": filename,
            "sha256": entry["sha256"],
            **({"uri": canonical["uri"]} if canonical.get("uri") else {}),
        },
        {
            "role": "publication-input",
            "description": "Checksummed source snapshot manifest used by the builder",
            "path": "source.json",
            "sha256": sha256_file(source_json),
        },
        *(
            [
                {
                    "role": "publication-input",
                    "description": "Scientific-owner-approved W26 geometry and validity selection",
                    "path": "geometry-selection.json",
                    "sha256": selection.sha256,
                }
            ]
            if selection
            else []
        ),
        selection_provenance(distribution_selection),
        *(
            [
                {
                    "role": "atlas-geometry",
                    "description": "Pinned Allen CCF 2017 50 um annotation used for D078 regional aggregation",
                    "path": config.regional_annotation.name,
                    "sha256": regional_selection.volume_annotation_sha256,
                },
                {
                    "role": "selection-freeze",
                    "description": "Owner-approved D078 regional volume-distribution selection",
                    "path": "regional-distribution-selection.json",
                    "sha256": regional_selection.sha256,
                },
            ]
            if regional_selection is not None
            else []
        ),
    ]
    with tempfile.TemporaryDirectory(prefix="ephys-atlas-volume-") as temporary:
        extracted: dict[str, np.ndarray] = {}
        indexes = {feature: index for index, feature in enumerate(feature_names)}
        outputs = {
            indexes[feature]: Path(temporary) / f"{feature}.npy"
            for feature in selected
        }
        extract_last_axis_features(npz_path, outputs)
        for feature in selected:
            output = outputs[indexes[feature]]
            extracted[feature] = np.load(output, mmap_mode="r")
        result = build_volumes_release_from_arrays(
            release_dir,
            config,
            extracted,
            provenance_sources,
            regional_parcellations=regional_parcellations,
            require_complete_regional_assignment=(
                regional_selection.require_volume_complete_assignment
                if regional_selection is not None
                else False
            ),
        )
    shutil.copyfile(source_json, result / "source.json")
    if selection:
        shutil.copyfile(selection.path, result / "geometry-selection.json")
    shutil.copyfile(
        distribution_selection.path, result / "distribution-selection.json"
    )
    if regional_selection is not None:
        shutil.copyfile(
            regional_selection.path,
            result / "regional-distribution-selection.json",
        )
    return result
