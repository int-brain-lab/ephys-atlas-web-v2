from __future__ import annotations

import json
import math
import re
import shlex
import shutil
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from itertools import product
from pathlib import Path

import numpy as np

from .io import json_resource, sha256_file, write_json
from .distribution_selection import (
    bind_distribution_selection,
    load_distribution_selection,
    selection_provenance,
)
from .npz import extract_last_axis_features, inspect_volume_npz
from .regional_release import (
    build_global_distribution_binnings,
    linear_full_display,
    validate_scalar_display,
)
from .statistics import describe
from .volume import write_chunked_volume, write_slice_packed_volume

DATASET_ID = "ephys_atlas_volumes"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class VolumeBuildConfig:
    release_id: str
    created_at: str
    source_release_id: str | None = None
    resolution_um: int | None = None
    reference_space_id: str | None = None
    grid_id: str | None = None
    index_to_world_um: tuple[float, ...] | None = None
    outside_value: float | None = None
    missing_values: str | None = None
    layout: str | None = None
    pack_depth: int | None = None
    chunk_shape: tuple[int, int, int] | None = None
    features: tuple[str, ...] | None = None
    feature_display: Mapping[str, dict] | None = None
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None
    geometry_selection: Path | None = None
    distribution_selection: Path | None = None
    candidate: bool = False

    def validate(self) -> None:
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError(
                "created_at is required for deterministic release metadata"
            )
        if self.resolution_um is None or self.resolution_um <= 0:
            raise ValueError("resolution_um must be explicitly positive")
        if not self.reference_space_id:
            raise ValueError("reference_space_id is required and must not be inferred")
        if not self.grid_id:
            raise ValueError("grid_id is required and must not be inferred")
        if self.index_to_world_um is None:
            raise ValueError("index_to_world_um is required and must not be inferred")
        if len(self.index_to_world_um) != 16:
            raise ValueError("index_to_world_um must contain exactly 16 values")
        if self.outside_value is None or not math.isfinite(self.outside_value):
            raise ValueError("outside_value must be an explicit finite sentinel")
        if self.missing_values != "nonfinite":
            raise ValueError("missing_values must be explicitly nonfinite")
        if self.layout not in {"chunks3d", "orthogonal_slice_packs"}:
            raise ValueError(
                "layout must be explicitly chunks3d or orthogonal_slice_packs"
            )
        if self.layout == "orthogonal_slice_packs":
            if self.pack_depth is None or self.pack_depth < 1:
                raise ValueError(
                    "orthogonal_slice_packs requires an explicit positive pack_depth"
                )
            if self.chunk_shape is not None:
                raise ValueError("chunk_shape is not valid for orthogonal_slice_packs")
        else:
            if (
                self.chunk_shape is None
                or len(self.chunk_shape) != 3
                or any(value < 1 for value in self.chunk_shape)
            ):
                raise ValueError(
                    "chunks3d requires an explicit positive three-value chunk_shape"
                )
            if self.pack_depth is not None:
                raise ValueError("pack_depth is not valid for chunks3d")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        if self.features is not None:
            if not self.features or len(set(self.features)) != len(self.features):
                raise ValueError("features must be nonempty and unique when provided")
            invalid = [
                feature
                for feature in self.features
                if not _IDENTIFIER_RE.fullmatch(feature)
            ]
            if invalid:
                raise ValueError(f"invalid feature identifiers: {', '.join(invalid)}")
        for name, value in (
            ("ibleatools_commit", self.ibleatools_commit),
            ("iblatlas_commit", self.iblatlas_commit),
            ("builder_commit", self.builder_commit),
        ):
            if value is not None and not _COMMIT_RE.fullmatch(value):
                raise ValueError(
                    f"{name} must be a 7-40 character lowercase Git commit"
                )

    def require_scientific_pins(self) -> None:
        missing = [
            name
            for name, value in (
                ("ibleatools_commit", self.ibleatools_commit),
                ("iblatlas_commit", self.iblatlas_commit),
                ("builder_commit", self.builder_commit),
            )
            if value is None
        ]
        if missing:
            raise ValueError(
                f"snapshot builds require reproducibility pins: {', '.join(missing)}"
            )


@dataclass(frozen=True)
class VolumeGeometrySelection:
    path: Path
    sha256: str
    resolution_um: int
    reference_space_id: str
    grid_id: str
    grid_shape: tuple[int, int, int]
    index_to_world_um: tuple[float, ...]
    outside_value: float
    missing_values: str
    source_uri: str
    source_bytes: int
    source_sha256: str
    iblatlas_commit: str
    audited_value_count: int


def load_volume_geometry_selection(path: Path) -> VolumeGeometrySelection:
    """Load one owner-approved geometry record and reject incomplete policy."""
    path = path.resolve()
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load volume geometry selection {path}") from error
    try:
        source = document["source"]
        volume = source["volume"]
        validity = document["validity"]
        shape = tuple(document["grid_shape"])
        affine = tuple(document["index_to_world_um"])
    except (KeyError, TypeError) as error:
        raise ValueError("volume geometry selection is incomplete") from error
    if document.get("schema") != "ibl-volume-geometry-selection-v1":
        raise ValueError("unsupported volume geometry selection schema")
    if document.get("scientific_owner_confirmation") is not True:
        raise ValueError("volume geometry selection lacks scientific-owner confirmation")
    if document.get("axis_order") != ["ml", "ap", "dv"]:
        raise ValueError("volume geometry selection must declare ML/AP/DV source axes")
    if document.get("index_convention") != "voxel_centers":
        raise ValueError("volume geometry selection must declare voxel centers")
    if len(shape) != 3 or any(type(value) is not int or value < 1 for value in shape):
        raise ValueError("volume geometry selection has an invalid grid shape")
    if len(affine) != 16 or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        for value in affine
    ):
        raise ValueError("volume geometry selection has an invalid affine")
    if validity.get("missing_values") != "nonfinite":
        raise ValueError("volume geometry selection has an unsupported missing policy")
    if not isinstance(validity.get("outside_value"), (int, float)) or not math.isfinite(
        validity["outside_value"]
    ):
        raise ValueError("volume geometry selection has an invalid outside sentinel")
    if type(validity.get("audited_value_count")) is not int or validity["audited_value_count"] < math.prod(shape):
        raise ValueError("volume geometry selection has an invalid validity audit count")
    if validity.get("audited_nan_count") != 0 or validity.get("audited_infinite_count") != 0:
        raise ValueError("volume geometry selection validity audit is not the approved W26 policy")
    sha = volume.get("sha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise ValueError("volume geometry selection has an invalid source SHA-256")
    selection = VolumeGeometrySelection(
        path=path,
        sha256=sha256_file(path),
        resolution_um=int(document["resolution_um"]),
        reference_space_id=str(document["reference_space_id"]),
        grid_id=str(document["grid_id"]),
        grid_shape=shape,
        index_to_world_um=tuple(float(value) for value in affine),
        outside_value=float(validity["outside_value"]),
        missing_values=validity["missing_values"],
        source_uri=str(volume["uri"]),
        source_bytes=int(volume["bytes"]),
        source_sha256=sha,
        iblatlas_commit=str(source["iblatlas"]["commit"]),
        audited_value_count=validity["audited_value_count"],
    )
    if selection.resolution_um <= 0 or not selection.reference_space_id or not selection.grid_id:
        raise ValueError("volume geometry selection has invalid grid identity")
    return selection


def apply_volume_geometry_selection(
    config: VolumeBuildConfig, selection: VolumeGeometrySelection
) -> VolumeBuildConfig:
    """Populate scientific geometry only from the reviewed selection record."""
    return replace(
        config,
        resolution_um=selection.resolution_um,
        reference_space_id=selection.reference_space_id,
        grid_id=selection.grid_id,
        index_to_world_um=selection.index_to_world_um,
        outside_value=selection.outside_value,
        missing_values=selection.missing_values,
        geometry_selection=config.geometry_selection or selection.path,
    )

def _clean_floats(values: np.ndarray) -> list[float]:
    return [
        0.0 if abs(float(value)) < 1e-12 else float(value)
        for value in values.reshape(-1)
    ]


def _grid_descriptor(config: VolumeBuildConfig, shape: tuple[int, int, int]) -> dict:
    matrix = np.asarray(config.index_to_world_um, dtype=np.float64).reshape(4, 4)
    if not np.isfinite(matrix).all() or not np.array_equal(matrix[3], [0, 0, 0, 1]):
        raise ValueError(
            "index_to_world_um must be a finite affine with homogeneous row [0, 0, 0, 1]"
        )
    spatial = matrix[:3, :3]
    nonzero = np.abs(spatial) > 1e-12
    if not np.all(nonzero.sum(axis=0) == 1) or not np.all(nonzero.sum(axis=1) == 1):
        raise ValueError("index_to_world_um must be an axis-aligned signed permutation")
    inverse = np.linalg.inv(matrix)
    corners = np.array(
        [
            [i0, i1, i2, 1.0]
            for i0, i1, i2 in product(
                (-0.5, shape[0] - 0.5),
                (-0.5, shape[1] - 0.5),
                (-0.5, shape[2] - 0.5),
            )
        ]
    )
    world = corners @ matrix.T
    bounds = [(world[:, axis].min(), world[:, axis].max()) for axis in range(3)]
    extent = np.asarray([value for pair in bounds for value in pair])
    # Schema order is [ml_min, ml_max, ap_min, ap_max, dv_min, dv_max].
    return {
        "reference_space_id": config.reference_space_id,
        "grid_id": config.grid_id,
        "world_axes": ["ml", "ap", "dv"],
        "shape": list(shape),
        "index_to_world_um": _clean_floats(matrix),
        "world_to_index": _clean_floats(inverse),
        "voxel_edge_extent_um": _clean_floats(extent),
        "index_convention": "integer-centers-half-integer-edges",
    }


def _write_volume_feature(
    release_dir: Path,
    feature_id: str,
    values: np.ndarray,
    config: VolumeBuildConfig,
    grid: dict,
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
        summary["distribution"] = {
            "binnings": build_global_distribution_binnings(
                valid_values, config.histogram_bins, display
            )
        }
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
) -> Path:
    config.validate()
    if not feature_values:
        raise ValueError("at least one feature is required")
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
    feature_entries = [
        _write_volume_feature(
            release_dir, feature, feature_values[feature], config, grid
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
    if config.layout == "orthogonal_slice_packs":
        command.extend(("--pack-depth", str(config.pack_depth)))
    else:
        command.extend(
            ("--chunk-shape", *(str(value) for value in config.chunk_shape or ()))
        )
    for feature in config.features or ():
        command.extend(("--feature", feature))
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
        "dataset_id": DATASET_ID,
        "title": "IBL Encoding Volumes",
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
                "version": "1.0.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **({"commit": config.builder_commit} if config.builder_commit else {}),
                "command": shlex.join(command),
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
        "parcellations": [],
        "features": feature_entries,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir


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
    distribution_selection = load_distribution_selection(
        config.distribution_selection,
        dataset_id=DATASET_ID,
        representation="volume",
    )
    config.validate()
    config.require_scientific_pins()
    source_json = source_snapshot / "source.json"
    if not source_json.is_file():
        raise RuntimeError(f"missing source snapshot metadata: {source_json}")
    source = json.loads(source_json.read_text())
    if source.get("dataset_id") != DATASET_ID:
        raise RuntimeError(
            f"source snapshot is not {DATASET_ID}: {source.get('dataset_id')}"
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
        )
    shutil.copyfile(source_json, result / "source.json")
    if selection:
        shutil.copyfile(selection.path, result / "geometry-selection.json")
    shutil.copyfile(
        distribution_selection.path, result / "distribution-selection.json"
    )
    return result
