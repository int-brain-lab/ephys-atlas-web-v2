from __future__ import annotations

import json
import math
import re
import shlex
import shutil
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import numpy as np

from .io import json_resource, sha256_file, write_json
from .npz import extract_last_axis_feature, inspect_volume_npz
from .regional_release import histogram_edges
from .statistics import describe, histogram
from .volume import write_chunked_volume, write_slice_packed_volume

DATASET_ID = "ephys_atlas_volumes"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class VolumeBuildConfig:
    release_id: str
    created_at: str
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
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None

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
        edges = histogram_edges(valid_values, config.histogram_bins)
        summary["histogram"] = {
            "edges": edges.tolist(),
            "counts": histogram(valid_values, edges).astype(int).tolist(),
            "bin_rule": "left-closed-right-open-last-closed",
        }
    summary_path = feature_root / "volume" / "summary.json"
    write_json(summary_path, summary)

    feature = {
        "schema_version": "1.0",
        "id": feature_id,
        "label": feature_id.replace("_", " "),
        "description": f"Raw, unnormalized {feature_id} scalar encoding volume.",
        "unit": None,
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
    selected = tuple(config.features or sorted(feature_values))
    missing = sorted(set(selected) - set(feature_values))
    if missing:
        raise ValueError(f"requested volume features are absent: {', '.join(missing)}")
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
        config.release_id,
        "--created-at",
        config.created_at,
        "--resolution-um",
        str(config.resolution_um),
        "--reference-space-id",
        str(config.reference_space_id),
        "--grid-id",
        str(config.grid_id),
        "--index-to-world-um",
        *(f"{value:.17g}" for value in config.index_to_world_um or ()),
        "--outside-value",
        repr(config.outside_value),
        "--missing-values",
        str(config.missing_values),
        "--layout",
        str(config.layout),
        "--histogram-bins",
        str(config.histogram_bins),
    ]
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
        "title": "IBL Ephys Atlas encoding volumes",
        "description": "Orthogonal scalar feature volumes derived from a pinned canonical encoding-volume object.",
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
                "transport": transport,
            },
            "notes": [
                "The builder requires scientific geometry and validity choices as explicit inputs and never infers them from shape or mask overlap.",
                "The browser transport is a deterministic physical transform; feature values are not normalized or otherwise changed.",
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
    if str(source.get("resolved_release")) != config.release_id:
        raise RuntimeError(
            f"source release {source.get('resolved_release')} does not match requested release {config.release_id}"
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

    canonical = source.get("canonical_source") or {}
    provenance_sources = [
        {
            "role": "canonical-data",
            "description": "Canonical ea_active encoding-volume NPZ",
            "release": config.release_id,
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
    ]
    with tempfile.TemporaryDirectory(prefix="ephys-atlas-volume-") as temporary:
        extracted: dict[str, np.ndarray] = {}
        indexes = {feature: index for index, feature in enumerate(feature_names)}
        for feature in selected:
            output = Path(temporary) / f"{feature}.npy"
            extract_last_axis_feature(npz_path, output, indexes[feature])
            extracted[feature] = np.load(output, mmap_mode="r")
        result = build_volumes_release_from_arrays(
            release_dir,
            config,
            extracted,
            provenance_sources,
        )
    shutil.copyfile(source_json, result / "source.json")
    return result
