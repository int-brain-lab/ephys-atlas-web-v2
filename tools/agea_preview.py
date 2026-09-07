"""Build the explicitly non-public AGEA schema-v1 local preview."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from ephys_atlas_builder.build_environment import build_environment
from ephys_atlas_builder.io import (
    encoded_resource,
    json_resource,
    sha256_file,
    write_chunk,
    write_json,
)
from ephys_atlas_builder.metadata_bundle import write_metadata_bundle
from ephys_atlas_builder.regional_release import (
    build_global_distribution_binnings,
    linear_full_display,
)
from ephys_atlas_builder.statistics import describe
from ephys_atlas_builder.validate import validate_release
from ephys_atlas_builder.volume import write_chunked_volume
from iblatlas.genomics import agea

from tools.agea_benchmark import SHAPE, SOURCE_HASHES, verify

TITLE = "AGEA — local preview; registration provisional"
DATASET_ID = "agea"
SOURCE_URI = "https://ibl-brain-wide-map-public.s3.amazonaws.com/atlas/agea/"
IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"
GRID_ID = "agea-original-200um-loader-grid"


def _loader_affine(source: Path) -> tuple[float, ...]:
    atlas = agea.load_atlas(source)
    origin = atlas.bc.i2xyz(np.zeros(3)) * 1e6
    matrix = np.eye(4)
    matrix[:3, 3] = origin
    for dimension, basis in enumerate(np.eye(3)):
        matrix[:3, dimension] = atlas.bc.i2xyz(basis[atlas.dims2xyz]) * 1e6 - origin
    return tuple(float(value) for value in matrix.ravel())


def _grid(shape: tuple[int, int, int], affine: tuple[float, ...]) -> dict:
    matrix = np.asarray(affine, dtype=np.float64).reshape(4, 4)
    inverse = np.linalg.inv(matrix)
    corners = np.array(
        [
            [i0, i1, i2, 1]
            for i0 in (-0.5, shape[0] - 0.5)
            for i1 in (-0.5, shape[1] - 0.5)
            for i2 in (-0.5, shape[2] - 0.5)
        ]
    )
    world = corners @ matrix.T
    clean = lambda values: [
        0.0 if abs(float(v)) < 1e-12 else float(v) for v in np.ravel(values)
    ]
    return {
        "reference_space_id": "allen-ccf-2017",
        "grid_id": GRID_ID,
        "world_axes": ["ml", "ap", "dv"],
        "shape": list(shape),
        "index_to_world_um": clean(matrix),
        "world_to_index": clean(inverse),
        "voxel_edge_extent_um": clean(
            np.array(
                [
                    bound
                    for axis in range(3)
                    for bound in (world[:, axis].min(), world[:, axis].max())
                ]
            )
        ),
        "index_convention": "integer-centers-half-integer-edges",
    }


def _binary_array(path: Path, root: Path, values: np.ndarray) -> dict:
    write_chunk(path, values, dtype="uint8", codec="gzip", level=6)
    return {
        "format": "raw-binary-array-v1",
        "resource": encoded_resource(
            path,
            root,
            "application/octet-stream",
            codec="gzip",
            decoded_bytes=values.size,
            level=6,
        ),
        "dtype": "uint8",
        "shape": list(values.shape),
        "order": "C",
        "endianness": "not-applicable",
    }


def _transport_features(transport: Path | None) -> dict[str, dict]:
    if transport is None:
        return {}
    audit = json.loads((transport / "audit.json").read_text())
    descriptor = audit["metadata"]
    verify(transport / descriptor["path"], descriptor["sha256"])
    metadata = json.loads(
        gzip.decompress((transport / descriptor["path"]).read_bytes())
    )
    return {item["experiment_id"]: item for item in metadata["features"]}


def _write_feature(
    release: Path,
    feature_id: str,
    gene: str,
    experiment_id: str,
    values: np.ndarray,
    grid: dict,
    transport: Path | None,
    transport_item: dict | None,
) -> dict:
    feature_root = release / "features" / feature_id
    if transport_item is None:
        index = write_chunked_volume(
            feature_root,
            values,
            dtype="float16",
            chunk_shape=tuple(values.shape),
            codec="gzip",
            path_template="volume/chunks/{i0}.{i1}.{i2}.f16.gz",
            grid_id=GRID_ID,
        )
    else:
        source_descriptor = transport_item["volume"]
        source_path = transport / source_descriptor["path"]  # type: ignore[operator]
        verify(source_path, source_descriptor["sha256"])
        raw = gzip.decompress(source_path.read_bytes())
        if raw != np.ascontiguousarray(values, dtype="<f2").tobytes():
            raise ValueError(
                f"transport bytes differ from pinned source experiment {experiment_id}"
            )
        destination = feature_root / "volume/chunks/0.0.0.f16.gz"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, destination)
        index = {
            "schema_version": "1.0",
            "format": "ephys-atlas-volume-resource-index-v1",
            "grid_id": GRID_ID,
            "layout": "chunks3d",
            "chunk_shape": list(values.shape),
            "chunks": [
                {
                    "origin": [0, 0, 0],
                    "decoded": {
                        "dtype": "float16",
                        "shape": list(values.shape),
                        "order": "C",
                        "endianness": "little",
                        "storage_axes": ["i0", "i1", "i2"],
                    },
                    "resource": encoded_resource(
                        destination,
                        feature_root,
                        "application/octet-stream",
                        codec="gzip",
                        decoded_bytes=values.nbytes,
                        level=6,
                    ),
                }
            ],
        }
    index_path = feature_root / "volume/resource-index.json"
    write_json(index_path, index)

    missing = values == -1
    valid_values = np.asarray(values[~missing], dtype=np.float64)
    stats = describe(valid_values)
    summary = {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-summary-v1",
        "grid_id": GRID_ID,
        "grid_shape": list(values.shape),
        "total_voxel_count": int(values.size),
        "valid_voxel_count": int((~missing).sum()),
        "outside_voxel_count": 0,
        "missing_voxel_count": int(missing.sum()),
        "valid_statistics": {
            key: stats[key]
            for key in (
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
    display = linear_full_display()
    if valid_values.size:
        summary["distribution"] = {
            "binnings": build_global_distribution_binnings(valid_values, 64, display)
        }
    summary_path = feature_root / "volume/summary.json"
    write_json(summary_path, summary)
    mask = np.where(missing, 2, 0).astype("u1")
    validity = {
        "kind": "mask",
        "mask": _binary_array(
            feature_root / "volume/validity.u8.gz", feature_root, mask
        ),
        "codes": {"valid": 0, "outside": 1, "missing": 2},
        "classification_order": ["outside", "missing", "valid"],
    }
    label = f"{gene} · {experiment_id}"
    feature = {
        "schema_version": "1.0",
        "id": feature_id,
        "label": label,
        "description": f"{TITLE}. Original Allen expression-energy experiment {experiment_id}; raw source values.",
        "unit": None,
        "display": {"volume": display},
        "value_semantics": {
            "quantity": "Allen gene expression energy",
            "transform": "identity; original source float16 values",
            "source_population": "every measured source voxel, including zero values and zero-labelled anatomy",
            "missing_values": "source value -1 is missing; no voxel is classified outside",
            "source_column": experiment_id,
            "qc_filter": "none",
        },
        "representations": {
            "volume": {
                "format": "ephys-atlas-volume-v1",
                "grid": grid,
                "array": {"dtype": "float16", "order": "C", "endianness": "little"},
                "validity": validity,
                "summary": json_resource(
                    summary_path, feature_root, "ephys-atlas-volume-summary-v1"
                ),
                "encoding": {
                    "layout": "chunks3d",
                    "resource_index": json_resource(
                        index_path, feature_root, "ephys-atlas-volume-resource-index-v1"
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
        "descriptor": json_resource(feature_path, release, "ephys-atlas-feature-v1"),
    }


def build_preview(
    source: Path,
    output: Path,
    *,
    created_at: str,
    alignment_review: Path,
    transport: Path | None = None,
    shape: tuple[int, int, int, int] = SHAPE,
    source_hashes: dict[str, str] = SOURCE_HASHES,
    affine: tuple[float, ...] | None = None,
    builder_commit: str | None = None,
) -> Path:
    if output.exists():
        raise ValueError(f"output already exists: {output}")
    sources = {
        name: verify(source / name, digest) for name, digest in source_hashes.items()
    }
    review_sha = sha256_file(alignment_review)
    rows = pd.read_parquet(source / "gene-expression.pqt").to_dict("records")
    if len(rows) != shape[0] or len({str(row["id"]) for row in rows}) != len(rows):
        raise ValueError("unexpected experiment inventory")
    source_volume = source / "gene-expression.bin"
    if source_volume.stat().st_size != int(np.prod(shape)) * 2:
        raise ValueError("unexpected volume byte length")
    matrix = affine or _loader_affine(source)
    grid = _grid(shape[1:], matrix)
    commit = (
        builder_commit
        or subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[1],
        ).stdout.strip()
    )
    script_sha = sha256_file(Path(__file__))
    release_id = (
        f"agea-original-local-preview-{source_hashes['gene-expression.bin'][:8]}-"
        f"{commit[:8]}-{script_sha[:8]}"
    )
    release = output / "releases" / DATASET_ID / release_id
    release.mkdir(parents=True)
    volumes = np.memmap(source_volume, dtype="<f2", mode="r", shape=shape)
    transported = _transport_features(transport)
    features = []
    for index, row in enumerate(rows):
        experiment_id = str(row["id"])
        gene = str(row["gene"])
        item = transported.get(experiment_id)
        if transport is not None and item is None:
            raise ValueError(f"transport omits experiment {experiment_id}")
        if item is not None and (
            item["gene"] != gene or item["id"] != f"experiment-{experiment_id}"
        ):
            raise ValueError(
                f"transport identity mismatch for experiment {experiment_id}"
            )
        values = np.asarray(volumes[index])
        invalid = ~np.isfinite(values) | ((values < 0) & (values != -1))
        if np.any(invalid):
            raise ValueError(
                f"experiment {experiment_id} contains nonfinite or unsupported negative values"
            )
        features.append(
            _write_feature(
                release,
                f"experiment-{experiment_id}",
                gene,
                experiment_id,
                values,
                grid,
                transport,
                item,
            )
        )
    json_paths = [entry["descriptor"]["resource"]["path"] for entry in features]
    json_paths += [
        f"features/{entry['id']}/volume/resource-index.json" for entry in features
    ] + [f"features/{entry['id']}/volume/summary.json" for entry in features]
    manifest = {
        "schema_version": "1.0",
        "dataset_id": DATASET_ID,
        "title": TITLE,
        "description": f"{TITLE}. Owner-authorized real-data preview only; never production or publication.",
        "release": {
            "release_id": release_id,
            "immutable": True,
            "created_at": created_at,
            "paper_snapshot": False,
        },
        "provenance": {
            "sources": [
                *[
                    {
                        "role": "canonical-data",
                        "description": f"Pinned original AGEA source {name}",
                        "uri": SOURCE_URI + name,
                        "sha256": info["sha256"],
                    }
                    for name, info in sources.items()
                ],
                {
                    "role": "scientific-code",
                    "description": "Pinned AGEA loader and source-derived coordinate mapping",
                    "repository": "int-brain-lab/iblatlas",
                    "commit": IBLATLAS_COMMIT,
                },
                {
                    "role": "selection-freeze",
                    "description": "Owner AGEA local-preview alignment review; registration remains provisional",
                    "path": alignment_review.name,
                    "sha256": review_sha,
                },
                {
                    "role": "publication-input",
                    "description": "Exact local-preview builder script; not a production publication input",
                    "path": "tools/agea_preview.py",
                    "sha256": script_sha,
                },
            ],
            "builder": {
                "name": "agea-local-preview-builder",
                "version": "1.0.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                "commit": commit,
                "command": "python -m tools.agea_preview (local preview only)",
                "environment": build_environment(),
            },
            "recipe": {
                "id": "agea-original-local-preview-v1",
                "decision": "D069",
                "scientific_release": False,
                "source_variant": "original",
                "source_vintage_marker": "2025-03-18.version",
                "original_binary_last_modified": "2024-01-21",
                "experiment_count": len(features),
                "axis_order": ["ml", "dv", "ap"],
                "grid_shape": list(shape[1:]),
                "index_to_world_um": list(matrix),
                "reference_space_id": "allen-ccf-2017",
                "registration_status": "provisional",
                "validity": {
                    "valid": "all measured values >= 0, including zero and label 0",
                    "missing": "-1",
                    "outside": "none",
                },
                "transform": "none",
                "normalization": "none",
                "layout": "chunks3d-one-chunk-per-experiment",
                "histogram": "Linear/Full, 64 bins",
                "builder_worktree": "dirty local preview allowed; exact script SHA recorded",
            },
            "notes": [
                TITLE,
                "Explicitly owner-authorized for local preview only; this is not an approved scientific or publishable release.",
                "No anatomical mask was invented. Source values and the pinned loader affine are unchanged.",
            ],
        },
        "parcellations": [],
        "features": features,
        "artifacts": [],
    }
    manifest["metadata_bundle"] = write_metadata_bundle(release, json_paths)
    write_json(release / "manifest.json", manifest)
    validate_release(release)
    manifest_resource = encoded_resource(
        release / "manifest.json", output, "application/json"
    )
    catalog = {
        "schema_version": "1.0",
        "default_project": "agea-local-preview",
        "projects": [
            {
                "project_id": "agea-local-preview",
                "title": TITLE,
                "description": f"{TITLE}. Never production or publication.",
                "dataset_ids": [DATASET_ID],
                "default_dataset": DATASET_ID,
                "default_edition": release_id,
                "editions": [
                    {
                        "edition_id": release_id,
                        "label": TITLE,
                        "description": f"{TITLE}. Original source; owner-authorized local preview only.",
                        "dataset_releases": [
                            {"dataset_id": DATASET_ID, "release_id": release_id}
                        ],
                    }
                ],
            }
        ],
        "datasets": [
            {
                "dataset_id": DATASET_ID,
                "title": TITLE,
                "description": f"{TITLE}. Full original AGEA experiment catalog.",
                "default_release": release_id,
                "releases": [
                    {
                        "release_id": release_id,
                        "label": TITLE,
                        "status": "development",
                        "description": f"{TITLE}. Never production or publication.",
                        "manifest": manifest_resource,
                    }
                ],
            }
        ],
    }
    write_json(output / "catalog.json", catalog)
    return release


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path, default=Path("artifacts/agea-local-preview")
    )
    parser.add_argument("--created-at", required=True)
    parser.add_argument(
        "--alignment-review",
        type=Path,
        default=Path("docs/data/AGEA_ALIGNMENT_REVIEW.json"),
    )
    parser.add_argument("--transport", type=Path)
    args = parser.parse_args()
    release = build_preview(
        args.source,
        args.output,
        created_at=args.created_at,
        alignment_review=args.alignment_review,
        transport=args.transport,
    )
    print(release)


if __name__ == "__main__":
    main()
