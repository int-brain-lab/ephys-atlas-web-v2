"""Build MERFISH and lipid schema-v1 volume releases.

Both products live on the 200 um AGEA loader grid (`iblatlas.genomics.agea`)
and reuse its hash-pinned `label.npy` as the anatomical domain. Sources are
staged snapshots under `data/source/<source-dataset>/<source-release>/` whose
`source.json` pins every file by size and SHA-256 and records the exact clean
iblatlas commit whose loader produced them. Display is the neutral Linear/Full
baseline, recorded as owner-approved in D090.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from ephys_atlas_builder.build_environment import build_environment
from ephys_atlas_builder.io import json_resource, sha256_file, write_json
from ephys_atlas_builder.metadata_bundle import write_metadata_bundle
from ephys_atlas_builder.regional_release import (
    build_global_distribution_binnings,
    linear_full_display,
)
from ephys_atlas_builder.statistics import describe
from ephys_atlas_builder.validate import validate_release
from ephys_atlas_builder.volume import write_chunked_volume
from ephys_atlas_builder.volume_regional import (
    build_physical_parcellations,
    load_regional_selection,
    validate_parcellation_row_counts,
    write_physical_parcellations,
    write_volume_regional_distributions,
)

from tools.agea_preview import (
    GRID_ID,
    REGIONAL_SELECTION,
    _binary_array,
    _grid,
    _loader_affine,
)

STATISTICS = ("min", "max", "mean", "std", "q05", "q25", "median", "q75", "q95")


@dataclass(frozen=True)
class Product:
    """Dataset identity and value semantics of one genomics volume product."""

    dataset_id: str
    source_dataset: str
    title: str
    volume_file: str
    table_file: str
    quantity: str
    missing_values: str
    notes: tuple[str, ...]


PRODUCTS = {
    "merfish_class": Product(
        dataset_id="merfish_class",
        source_dataset="merfish",
        title="MERFISH cell classes",
        volume_file="volume.npy",
        table_file="types.pqt",
        quantity="proportion of cells of this class per voxel",
        missing_values="none inside the brain; label.npy == 0 is outside",
        notes=("Denoised proportions over all 34 classes, non-neuronal included, from iblatlas merfish.load_volume(include_non_neuronal=True).",),
    ),
    "lipids": Product(
        dataset_id="lipids",
        source_dataset="lipids",
        title="Lipid Brain Atlas",
        volume_file="lipid_volumes.npy",
        table_file="lipids.pqt",
        quantity="log lipid intensity (uMAIA-normalised arbitrary units)",
        missing_values="NaN inside the brain (unsampled olfactory bulb and anterior frontal cortex) is missing",
        notes=(
            "MALDI mass-spectrometry imaging (Fusar Bassini et al. 2025) interpolated on the AGEA grid.",
            "All lipids are kept; reliability is reported in each feature description, not used as a filter.",
        ),
    ),
}


def _verify_source(source: Path) -> dict:
    """Return source.json after checking every declared file's size and SHA-256."""
    record = json.loads(source.joinpath("source.json").read_text())
    for item in record["files"]:
        path = source.joinpath(item["path"])
        if path.stat().st_size != item["bytes"] or sha256_file(path) != item["sha256"]:
            raise ValueError(f"source file does not match source.json: {path}")
    return record


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-").lower()


def _feature_rows(product: Product, table: pd.DataFrame) -> list[tuple[str, str, str]]:
    """Return (feature_id, label, description) per volume channel, in channel order."""
    if product.source_dataset == "merfish":
        return [
            (f"type-{row.type_id}", row.name, f"{product.title}: {row.name} (taxonomy id {row.type_id}).")
            for row in table.itertuples()
        ]
    return [
        (
            f"lipid-{index:03d}-{_slug(row.lipid)}",
            row.lipid,
            f"{product.title}: {row.lipid}. Between-brain reliability {row.reliability:.3f}.",
        )
        for index, row in enumerate(table.itertuples())
    ]


def _write_feature(release, feature_id, label, description, values, labels, grid, product, parcellations):
    """Write one float32 single-chunk volume feature with its validity mask and summaries."""
    outside = labels == 0
    missing = ~outside & ~np.isfinite(values)
    valid = ~(outside | missing)
    # The validity mask is authoritative; masked voxels are stored as 0 so no NaN is served.
    stored = np.where(valid, values, 0).astype(np.float32)
    feature_root = release.joinpath("features", feature_id)
    index = write_chunked_volume(
        feature_root, stored, dtype="float32", chunk_shape=tuple(stored.shape), codec="gzip",
        path_template="volume/chunks/{i0}.{i1}.{i2}.f32.gz", grid_id=GRID_ID,
    )
    index_path = feature_root.joinpath("volume", "resource-index.json")
    write_json(index_path, index)
    valid_values = np.asarray(stored[valid], dtype=np.float64)
    stats = describe(valid_values)
    display = linear_full_display()
    summary = {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-summary-v1",
        "grid_id": GRID_ID,
        "grid_shape": list(stored.shape),
        "total_voxel_count": int(stored.size),
        "valid_voxel_count": int(valid.sum()),
        "outside_voxel_count": int(outside.sum()),
        "missing_voxel_count": int(missing.sum()),
        "valid_statistics": {key: stats[key] for key in STATISTICS},
    }
    if valid_values.size:
        binnings = build_global_distribution_binnings(valid_values, 64, display)
        summary["distribution"] = {"binnings": binnings}
        summary["regional_distributions"] = write_volume_regional_distributions(
            feature_root.joinpath("volume"), stored, valid, binnings, parcellations,
            require_complete_assignment=True,
        )
    summary_path = feature_root.joinpath("volume", "summary.json")
    write_json(summary_path, summary)
    mask = np.zeros(stored.shape, dtype="u1")
    mask[outside] = 1
    mask[missing] = 2
    feature = {
        "schema_version": "1.0",
        "id": feature_id,
        "label": label,
        "description": description,
        "unit": None,
        "display": {"volume": display},
        "value_semantics": {
            "quantity": product.quantity,
            "transform": "identity; source float values",
            "source_population": "every finite source value where label.npy != 0",
            "missing_values": product.missing_values,
            "source_column": label,
            "qc_filter": "none",
        },
        "representations": {
            "volume": {
                "format": "ephys-atlas-volume-v1",
                "grid": grid,
                "array": {"dtype": "float32", "order": "C", "endianness": "little"},
                "validity": {
                    "kind": "mask",
                    "mask": _binary_array(feature_root.joinpath("volume", "validity.u8.gz"), feature_root, mask),
                    "codes": {"valid": 0, "outside": 1, "missing": 2},
                    "classification_order": ["outside", "missing", "valid"],
                },
                "summary": json_resource(summary_path, feature_root, "ephys-atlas-volume-summary-v1"),
                "encoding": {
                    "layout": "chunks3d",
                    "resource_index": json_resource(index_path, feature_root, "ephys-atlas-volume-resource-index-v1"),
                },
            }
        },
        "artifacts": [],
    }
    feature_path = feature_root.joinpath("feature.json")
    write_json(feature_path, feature)
    return {"id": feature_id, "descriptor": json_resource(feature_path, release, "ephys-atlas-feature-v1")}


def build_release(
    product: Product,
    source: Path,
    agea_source: Path,
    release_root: Path,
    created_at: str,
    release_id: str,
) -> Path:
    """Build and validate one release; returns its directory.

    Parameters
    ----------
    product : Product
        Dataset identity and value semantics.
    source : Path
        Staged source snapshot directory containing `source.json`.
    agea_source : Path
        AGEA loader folder providing `label.npy` and the grid affine.
    release_root : Path
        Root under which `<dataset_id>/<release_id>/` is created.
    created_at : str
        ISO-8601 UTC creation timestamp recorded in the manifest.
    release_id : str
        Immutable output release identifier.
    """
    record = _verify_source(source)
    regional = load_regional_selection(REGIONAL_SELECTION)
    if sha256_file(agea_source.joinpath("label.npy")) != regional.agea_label_sha256:
        raise ValueError("AGEA label.npy differs from the D078-pinned label volume")
    labels = np.load(agea_source.joinpath("label.npy"))
    volumes = np.load(source.joinpath(product.volume_file), mmap_mode="r")
    table = pd.read_parquet(source.joinpath(product.table_file))
    if volumes.shape[1:] != labels.shape or volumes.shape[0] != len(table):
        raise ValueError(f"unexpected source shape {volumes.shape} for {len(table)} channels")
    grid = _grid(labels.shape, _loader_affine(agea_source))
    release = release_root.joinpath(product.dataset_id, release_id)
    release.mkdir(parents=True, exist_ok=False)
    parcellations = build_physical_parcellations(labels, semantics="brainregions-index")
    validate_parcellation_row_counts(parcellations, regional.agea_expected_rows)
    parcellation_entries = write_physical_parcellations(release, parcellations)
    features = [
        _write_feature(release, feature_id, label, description, np.asarray(volumes[i], dtype=np.float32),
                       labels, grid, product, parcellations)
        for i, (feature_id, label, description) in enumerate(_feature_rows(product, table))
    ]
    json_paths = [entry["descriptor"]["resource"]["path"] for entry in features]
    json_paths += [f"features/{entry['id']}/volume/{name}" for entry in features for name in ("resource-index.json", "summary.json")]
    json_paths += [item["metadata"]["resource"]["path"] for item in parcellation_entries]
    commit = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    recipe = record["recipe"]
    upstream = recipe.get("upstream_files_sha256") or {item["path"]: item["sha256"] for item in record["files"]}
    manifest = {
        "schema_version": "1.0",
        "dataset_id": product.dataset_id,
        "title": product.title,
        "description": f"{product.title} on the 200 um AGEA loader grid, summarized by region.",
        "release": {"release_id": release_id, "immutable": True, "created_at": created_at, "paper_snapshot": False},
        "provenance": {
            "sources": [
                *[
                    {"role": "canonical-data", "description": f"Upstream {product.source_dataset} file {name}",
                     "uri": f"{recipe['upstream_uri']}{name}", "sha256": digest}
                    for name, digest in upstream.items()
                ],
                {"role": "scientific-code", "description": record["recipe"]["loader"],
                 "repository": record["recipe"]["code"]["repository"], "commit": record["recipe"]["code"]["commit"]},
            ],
            "builder": {
                "name": "genomics-volume-builder",
                "version": "1.0.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                "commit": commit,
                "command": shlex.join(["python", "-m", "tools.genomics_volumes", *(
                    "<agea-loader-folder>" if arg == str(agea_source) else arg for arg in sys.argv[1:]
                )]),
                "environment": build_environment(),
            },
            "recipe": {
                "id": f"{product.dataset_id}-volume-v1",
                "scientific_release": True,
                "source_recipe": record["recipe"],
                "axis_order": ["ml", "dv", "ap"],
                "grid_shape": list(labels.shape),
                "reference_space_id": "allen-ccf-2017",
                "validity": {"valid": "finite values where label.npy != 0", "outside": "label.npy == 0",
                             "missing": product.missing_values},
                "histogram": "Linear/Full, 64 bins",
                "regional_parcellations": ["allen", "beryl", "cosmos"],
            },
            "notes": [*product.notes, "Display is the neutral Linear/Full baseline (owner-approved, D090); no feature-specific review."],
        },
        "parcellations": parcellation_entries,
        "features": features,
        "artifacts": [],
    }
    manifest["metadata_bundle"] = write_metadata_bundle(release, json_paths)
    write_json(release.joinpath("manifest.json"), manifest)
    validate_release(release)
    return release


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", choices=sorted(PRODUCTS))
    parser.add_argument("--source", type=Path, required=True, help="staged source snapshot directory")
    parser.add_argument("--agea-source", type=Path, required=True, help="AGEA loader folder with label.npy")
    parser.add_argument("--release-root", type=Path, default=Path("data/releases"))
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--release-id", required=True, help="immutable output release identifier")
    args = parser.parse_args()
    print(build_release(PRODUCTS[args.dataset], args.source, args.agea_source, args.release_root, args.created_at, args.release_id))


if __name__ == "__main__":
    main()
